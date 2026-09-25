import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { addOrUpdateFile, isAlwaysLocal, readBaseDoc, shouldIgnore, writeBaseDoc } from './manifest';
import type { OverleafClient, OverleafSocketSession } from './overleafClient';
import {
  cachedLocalFileHash,
  classifyFolderStructure,
  classifySyncStatus,
  type FolderManifestRepair,
  type LocalProjectScan,
  makeSyncStatusReport,
  mergeTargetedSyncStatusReport,
  repairFolderManifestFromRemote
} from './syncStatus';
import { mapWithConcurrency, mapWithDynamicByteConcurrency, SyncHealthService } from './syncHealthService';
import { buildProjectTreeIndex } from './tree';
import type { ManifestFile, OverleafCodexManifest, SyncStatusItem, SyncStatusReport } from './types';
import { formatUnknownError, sha1 } from './util';

/**
 * Sync logic shared by the two engines that drive it: the VS Code realtime service
 * (`realtimeSync.ts`) and the CLI engine (`cliSyncEngine.ts`). Both used to carry their own copy
 * of this, which let their behaviour drift apart. Everything here must stay free of `vscode` so
 * the CLI can use it and so it stays directly unit testable.
 */

export interface RemoteSnapshot {
  manifest: OverleafCodexManifest;
  contents: Map<string, string>;
  hashes: Map<string, string>;
  blobHashes: Map<string, string>;
  failures: Map<string, string>;
  reused: Set<string>;
  metrics: RemoteSnapshotMetrics;
}

export interface RemoteSnapshotMetrics {
  treeCount: number;
  joinDocCount: number;
  binaryGetCount: number;
  remoteCacheReuseCount: number;
}

/** Structured so each caller can phrase its own progress message without this module choosing one. */
export interface RemoteReadProgress {
  path: string;
  completed: number;
  total: number;
}

export interface RemoteSnapshotDeps {
  manifest: OverleafCodexManifest;
  session: OverleafSocketSession;
  client?: OverleafClient;
  syncHealth: SyncHealthService;
  mode?: 'incremental' | 'full';
  paths?: Iterable<string>;
  signal?: AbortSignal;
  onProgress?(progress: RemoteReadProgress): void;
  /** Per-path read failure. The snapshot records it either way; this is for logging. */
  onFailure?(relPath: string, message: string): void;
  /**
   * A tree index the caller already built. Pass it when earlier work in the same pass depended on
   * that exact view: `session.getProject()` keeps mutating as remote events arrive, so re-indexing
   * here would classify against a different tree than the caller reasoned about.
   */
  indexedRemote?: OverleafCodexManifest;
}

const BINARY_READ_CONCURRENCY = 4;
const BINARY_READ_MAX_IN_FLIGHT_BYTES = 64 * 1024 * 1024;
// Kept at 4 deliberately. Raising it to 8 was tried and measured against real startup checks: a
// 13-document project did not move (844ms -> 864ms) and a 29-document one got worse
// (1594ms -> 5652ms, alongside joinDoc ack timeouts that had never appeared before). Joins are not
// round-trip-bound the way a wave model predicts, so more of them in flight only adds pressure.
const DOC_JOIN_CONCURRENCY = 4;

/**
 * Reads the remote project tree, joins the documents and downloads the binaries that
 * `planRemoteReads` says are worth re-reading, and returns everything the status classifier needs.
 * Binaries are streamed to a temp file and hashed rather than held in memory.
 */
export async function fetchRemoteSnapshot(deps: RemoteSnapshotDeps): Promise<RemoteSnapshot> {
  const { manifest, session, client, syncHealth, signal } = deps;
  let indexedRemote = deps.indexedRemote;
  if (!indexedRemote) {
    const project = session.getProject();
    if (!project) {
      throw new Error('Overleaf realtime session does not have a project tree.');
    }
    indexedRemote = buildProjectTreeIndex(manifest.serverUrl, manifest.projectId, manifest.projectName, project).manifest;
  }
  const contents = new Map<string, string>();
  const hashes = new Map<string, string>();
  const blobHashes = new Map<string, string>();
  const failures = new Map<string, string>();
  const reused = new Set<string>();
  const metrics: RemoteSnapshotMetrics = {
    treeCount: 1,
    joinDocCount: 0,
    binaryGetCount: 0,
    remoteCacheReuseCount: 0
  };

  const plan = syncHealth.planRemoteReads(manifest, indexedRemote, {
    mode: deps.mode ?? 'incremental',
    paths: deps.paths
  });
  const docs = plan.docsToJoin;
  const binaries = plan.binariesToGet;
  for (const reusedPath of plan.reusedPaths) reused.add(reusedPath);
  metrics.remoteCacheReuseCount = reused.size;

  const total = docs.length + binaries.length + reused.size;
  let completed = 0;
  const reportProgress = (relPath: string): void => {
    completed += 1;
    deps.onProgress?.({ path: relPath, completed, total });
  };
  const recordFailure = (relPath: string, error: unknown): void => {
    const message = formatUnknownError(error);
    failures.set(relPath, message);
    deps.onFailure?.(relPath, message);
  };

  for (const reusedPath of reused) reportProgress(reusedPath);

  await mapWithConcurrency(docs, DOC_JOIN_CONCURRENCY, async file => {
    try {
      metrics.joinDocCount += 1;
      const joined = await session.joinDoc(file.entityId, signal);
      file.version = joined.version;
      contents.set(file.path, joined.content);
    } catch (error) {
      recordFailure(file.path, error);
    } finally {
      reportProgress(file.path);
    }
  });

  if (!client && binaries.length > 0) {
    throw new Error('Overleaf client is not available for binary download.');
  }
  const remoteTempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-health-'));
  try {
    await mapWithDynamicByteConcurrency(
      binaries,
      BINARY_READ_CONCURRENCY,
      BINARY_READ_MAX_IN_FLIGHT_BYTES,
      async (file, reservation) => {
        const target = path.join(remoteTempRoot, file.entityId);
        try {
          metrics.binaryGetCount += 1;
          const result = await client!.downloadProjectFileToPath(manifest.projectId, file.entityId, target, {
            signal,
            onSize: bytes => reservation.reserve(bytes)
          });
          file.remoteSize = result.size;
          hashes.set(file.path, result.sha1);
          blobHashes.set(file.path, result.gitBlobHash);
        } catch (error) {
          recordFailure(file.path, error);
        } finally {
          await fs.rm(target, { force: true }).catch(() => undefined);
          reportProgress(file.path);
        }
      }
    );
  } finally {
    await fs.rm(remoteTempRoot, { recursive: true, force: true });
  }

  return { manifest: indexedRemote, contents, hashes, blobHashes, failures, reused, metrics };
}

export interface DivergedContext {
  relPath: string;
  remoteFile: ManifestFile;
  remoteContent?: string;
}

export interface ClassifyPathsDeps {
  root: string;
  manifest: OverleafCodexManifest;
  remote: RemoteSnapshot;
  localScan: LocalProjectScan;
  mode?: 'incremental' | 'full';
  requestedPaths?: Set<string>;
  /** Caller-specific exclusions on top of the shared ones (e.g. toolkit override files). */
  isExcluded?(relPath: string): boolean;
  onProgress?(progress: RemoteReadProgress): void;
  /** Lets a caller capture a copy of the remote side before the divergence is reported. */
  onDiverged?(context: DivergedContext): Promise<void>;
}

export interface ClassifyPathsResult {
  items: SyncStatusItem[];
  /** True when the pass mutated `manifest`; the caller owns persisting it. */
  manifestChanged: boolean;
  localCacheReuseCount: number;
}

/**
 * Classifies every path that either side knows about into a sync status. Mutates `manifest` in
 * place to adopt newly matched remote files, refresh remote metadata on synced entries, and
 * initialise the trusted base for documents that do not have one yet - that base is what makes
 * three-way divergence detection work at all.
 */
export async function classifyProjectPaths(deps: ClassifyPathsDeps): Promise<ClassifyPathsResult> {
  const { root, manifest, remote, localScan, requestedPaths } = deps;
  const mode = deps.mode ?? 'incremental';
  const isExcluded = deps.isExcluded ?? (() => false);

  const candidates = new Set([
    ...Object.keys(manifest.files),
    ...Object.keys(remote.manifest.files),
    ...localScan.files,
    ...(requestedPaths ?? [])
  ]);
  const ordered = [...candidates].sort();

  const items: SyncStatusItem[] = [];
  let manifestChanged = false;
  let localCacheReuseCount = 0;
  let completed = 0;

  for (const relPath of ordered) {
    if (requestedPaths && !requestedPaths.has(relPath)) continue;
    if (shouldIgnore(manifest, relPath) || isAlwaysLocal(relPath) || isExcluded(relPath)) continue;

    const manifestFile = manifest.files[relPath];
    const remoteFile = remote.manifest.files[relPath];
    const metadata = localScan.fileMetadata.get(relPath);
    const localResult = await cachedLocalFileHash(path.join(root, relPath), manifestFile, mode === 'full', metadata);
    const localHash = localResult.hash;
    if (localResult.reused) localCacheReuseCount += 1;
    if (localResult.cacheChanged) manifestChanged = true;

    const remoteContent = remote.contents.get(relPath);
    const remoteHash = remote.hashes.get(relPath) ?? (remoteContent === undefined
      ? remote.reused.has(relPath) ? manifestFile?.sha1 : undefined
      : sha1(remoteContent));
    const remoteReadError = remote.failures.get(relPath);

    // Nothing anywhere knows about this path, so there is nothing to report on.
    if (!manifestFile && !remoteFile && localHash === undefined && !remoteReadError) continue;

    let baseHash = manifestFile?.baseHash;
    if (remoteFile?.entityType === 'doc' && !baseHash) {
      const baseContent = await readBaseDoc(root, remoteFile.entityId);
      baseHash = baseContent === undefined ? undefined : sha1(baseContent);
      const canInitializeBase = remoteContent !== undefined
        && (manifestFile?.sha1 === remoteHash || localHash === remoteHash);
      if (!baseHash && canInitializeBase && typeof remoteContent === 'string') {
        baseHash = await writeBaseDoc(root, remoteFile.entityId, remoteContent);
        if (manifestFile) {
          manifestFile.baseHash = baseHash;
          manifestChanged = true;
        }
      }
    }

    const item = classifySyncStatus({
      path: relPath,
      manifestFile,
      remoteFile,
      localHash,
      remoteHash,
      baseHash,
      localExists: localHash !== undefined,
      remoteReadError,
      localSize: metadata?.size,
      localMtimeMs: metadata?.mtimeMs
    });

    if (item.status === 'diverged' && remoteFile) {
      await deps.onDiverged?.({ relPath, remoteFile, remoteContent });
    }

    if (item.status === 'synced' && manifestFile && remoteFile) {
      const stale = manifestFile.version !== remoteFile.version
        || manifestFile.remoteBlobHash !== remoteFile.remoteBlobHash
        || manifestFile.remoteRevision !== remoteFile.remoteRevision
        || manifestFile.remoteSize !== remoteFile.remoteSize
        || (remoteHash !== undefined && manifestFile.sha1 !== remoteHash);
      if (stale) {
        manifestFile.version = remoteFile.version;
        manifestFile.remoteBlobHash = remoteFile.remoteBlobHash;
        manifestFile.remoteRevision = remoteFile.remoteRevision;
        manifestFile.remoteSize = remoteFile.remoteSize;
        if (remoteHash !== undefined) manifestFile.sha1 = remoteHash;
        manifestChanged = true;
      }
      // Content both sides hold is the agreed base by definition. A base recorded wrong would
      // otherwise turn the next edit of this document into a false conflict.
      if (remoteFile.entityType === 'doc' && remoteHash !== undefined && manifestFile.baseHash !== remoteHash) {
        if (typeof remoteContent === 'string') {
          manifestFile.baseHash = await writeBaseDoc(root, remoteFile.entityId, remoteContent);
          manifestChanged = true;
        } else {
          const stored = await readBaseDoc(root, remoteFile.entityId);
          if (stored !== undefined && sha1(stored) === remoteHash) {
            manifestFile.baseHash = remoteHash;
            manifestChanged = true;
          }
        }
      }
    }

    if (!manifestFile && remoteFile && localHash === remoteHash && remoteHash !== undefined) {
      addOrUpdateFile(manifest, remoteFile, remoteContent);
      manifest.files[relPath].sha1 = remoteHash;
      manifest.files[relPath].baseHash = baseHash;
      manifestChanged = true;
    }

    items.push(item);
    completed += 1;
    deps.onProgress?.({ path: relPath, completed, total: ordered.length });
  }

  return { items, manifestChanged, localCacheReuseCount };
}

export interface ReconcileDeps extends ClassifyPathsDeps {
  /** Previous report, needed to merge a path-targeted check back into the full picture. */
  previousReport?: SyncStatusReport;
}

export interface ReconcileResult {
  report: SyncStatusReport;
  manifestChanged: boolean;
  localCacheReuseCount: number;
  /** Folder moves the repair adopted, so a caller can remap any runtime state keyed by path. */
  folderRepair: FolderManifestRepair;
}

/**
 * The whole comparison pass: repair folder metadata against the remote layout, classify folders
 * and files, and assemble the status report. Both sync engines go through here so their reports
 * are built the same way rather than by two implementations that drift.
 */
export async function reconcileProject(deps: ReconcileDeps): Promise<ReconcileResult> {
  const { manifest, remote, localScan, requestedPaths } = deps;
  const mode = deps.mode ?? 'incremental';

  const folderRepair = repairFolderManifestFromRemote(manifest, remote.manifest, localScan.folders);
  let manifestChanged = folderRepair.adopted.length > 0 || folderRepair.remapped.length > 0;

  const folderStructure = classifyFolderStructure(manifest, remote.manifest, requestedPaths, localScan.folders);
  const classified = await classifyProjectPaths(deps);
  if (classified.manifestChanged) manifestChanged = true;

  const targetedReport = makeSyncStatusReport(manifest, [...folderStructure.items, ...classified.items], {
    mode,
    completeness: folderStructure.globalBlockReason
      ? 'failed'
      : remote.failures.size > 0 ? 'partial' : 'complete',
    globalBlockReason: folderStructure.globalBlockReason
  });
  const report = requestedPaths
    ? mergeTargetedSyncStatusReport(deps.previousReport, targetedReport, requestedPaths)
    : targetedReport;

  // Only adopt the remote project version once nothing remote is outstanding, otherwise the
  // manifest would claim to be current while a remote change is still unmerged.
  const settled = !requestedPaths && remote.failures.size === 0 && report.items.every(item =>
    item.status === 'synced' || item.status === 'local ahead'
    || item.status === 'local only' || item.status === 'local deleted');
  if (settled && manifest.projectVersion !== remote.manifest.projectVersion) {
    manifest.projectVersion = remote.manifest.projectVersion;
    manifestChanged = true;
  }

  return { report, manifestChanged, localCacheReuseCount: classified.localCacheReuseCount, folderRepair };
}
