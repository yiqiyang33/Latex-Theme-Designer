import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { OverleafClient, OverleafSocketSession } from './overleafClient';
import { mapWithConcurrency, mapWithDynamicByteConcurrency, SyncHealthService } from './syncHealthService';
import { buildProjectTreeIndex } from './tree';
import type { OverleafCodexManifest } from './types';
import { formatUnknownError } from './util';

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
}

const BINARY_READ_CONCURRENCY = 4;
const BINARY_READ_MAX_IN_FLIGHT_BYTES = 64 * 1024 * 1024;
const DOC_JOIN_CONCURRENCY = 4;

/**
 * Reads the remote project tree, joins the documents and downloads the binaries that
 * `planRemoteReads` says are worth re-reading, and returns everything the status classifier needs.
 * Binaries are streamed to a temp file and hashed rather than held in memory.
 */
export async function fetchRemoteSnapshot(deps: RemoteSnapshotDeps): Promise<RemoteSnapshot> {
  const { manifest, session, client, syncHealth, signal } = deps;
  const project = session.getProject();
  if (!project) {
    throw new Error('Overleaf realtime session does not have a project tree.');
  }
  const indexed = buildProjectTreeIndex(manifest.serverUrl, manifest.projectId, manifest.projectName, project);
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

  const plan = syncHealth.planRemoteReads(manifest, indexed.manifest, {
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

  return { manifest: indexed.manifest, contents, hashes, blobHashes, failures, reused, metrics };
}
