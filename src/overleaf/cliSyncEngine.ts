import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import chokidar, { type FSWatcher } from 'chokidar';
import type { SyncHost, SyncPolicy } from './coreInterfaces';
import { OverleafClient, OverleafSocketSession } from './overleafClient';
import {
  addOrUpdateFile,
  addOrUpdateFolder,
  folderPathById,
  metadataPath,
  readBaseDoc,
  readManifest,
  readSyncStatus,
  shouldIgnore,
  shouldIgnoreUntrackedLocalPath,
  writeBaseDoc,
  writeManifest,
  writeSyncStatus
} from './manifest';
import { buildProjectTreeIndex, moveProjectTreeEntity, renameProjectTreeEntity } from './tree';
import type {
  ManifestFile,
  ManifestFolder,
  OverleafCodexManifest,
  OverleafDoc,
  OverleafFileRef,
  SyncStatusItem,
  SyncStatusReport
} from './types';
import {
  cachedLocalFileHash,
  classifyFolderStructure,
  classifySyncStatus,
  scanLocalProject,
  makeSyncStatusReport,
  mergeTargetedSyncStatusReport,
  repairFolderManifestFromRemote,
  trashPathFor
} from './syncStatus';
import { buildOtOperations } from './ot';
import { ConflictStore, type PersistedConflict } from './conflictStore';
import { BinaryTransactionStore, type BinaryTransaction } from './binaryTransactions';
import { assertNoSymlinkPath, assertPathWithin, formatUnknownError, gitBlobHash, isTextLike, normalizeProjectRelativePath, sha1, toPosixPath } from './util';
import { planSafeSyncActions, selectRemoteWriteTarget } from './syncCommandCore';
import { performRemotePathChange, recoverBinaryTransactions, transactionName } from './remoteMutationCore';
import { mapWithConcurrency, mapWithDynamicByteConcurrency, SyncHealthService } from './syncHealthService';
import { renameLocalPathTransactionally } from './localRename';
import { hashFileDigests, installStagedFile, type FileDigests } from './binaryTransfer';
import { buildManifestFolderFingerprints, folderFingerprintFromLocal } from './folderFingerprint';

const REMOTE_EVENTS = [
  'otUpdateApplied', 'reciveNewDoc', 'reciveNewFile', 'reciveNewFolder',
  'reciveEntityRename', 'reciveEntityMove', 'removeEntity', 'rootDocUpdated'
];

interface BinaryUploadResult {
  _id: string;
  name: string;
  hash?: string;
  transactionId?: string;
}

interface RemoteFileSnapshot {
  file: ManifestFile;
  content?: Buffer;
  sourcePath?: string;
  digests: FileDigests;
  dispose(): Promise<void>;
}

export class OverleafSyncEngine {
  private manifest?: OverleafCodexManifest;
  private session?: OverleafSocketSession;
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private operation: Promise<unknown> = Promise.resolve();
  private readonly events = new EventEmitter();
  private readonly syncHealth = new SyncHealthService();

  constructor(
    readonly root: string,
    private readonly client: OverleafClient,
    private readonly policy: SyncPolicy,
    private readonly host: SyncHost
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    if (this.stopping) throw new Error('Overleaf sync engine is stopping.');
    if (!this.startPromise) {
      this.startPromise = this.startNow().finally(() => {
        this.startPromise = undefined;
      });
    }
    return this.startPromise;
  }

  async stop(): Promise<void> {
    if (!this.stopPromise) {
      this.stopPromise = this.stopNow().finally(() => {
        this.stopPromise = undefined;
      });
    }
    return this.stopPromise;
  }

  private async startNow(): Promise<void> {
    const manifest = await readManifest(this.root);
    const session = await this.client.connectSocket(manifest.projectId);
    this.manifest = manifest;
    this.session = session;
    try {
      await this.recoverBinaryTransactions();
      if (this.stopping) throw new Error('Overleaf sync engine stopped during startup.');
      this.running = true;
      for (const event of REMOTE_EVENTS) session.on(event, () => this.scheduleSync(`remote:${event}`));
    } catch (error) {
      session.disconnect();
      if (this.session === session) this.session = undefined;
      throw error;
    }
  }

  private async stopNow(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.watcher?.close();
    this.watcher = undefined;
    await this.startPromise?.catch(() => undefined);
    await this.operation.catch(() => undefined);
    this.running = false;
    this.session?.disconnect();
    this.session = undefined;
    this.stopping = false;
  }

  onEvent(listener: (event: { event: string; data?: unknown }) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }

  async status(
    refresh = false,
    full = false,
    paths?: Iterable<string>,
    reason = 'status'
  ): Promise<SyncStatusReport | undefined> {
    if (!refresh && !full && !paths) return readSyncStatus(this.root);
    await this.start();
    return this.check(full ? 'full' : 'incremental', { intent: 'status', paths, reason });
  }

  async syncOnce(): Promise<SyncStatusReport> {
    return this.serial(async () => {
      await this.start();
      let report = await this.checkNow('incremental', { intent: 'sync', reason: 'sync-once' });
      const plan = planSafeSyncActions(report, this.policy);
      for (const item of plan.pulls) {
        if (item.entityType === 'folder') {
          await fs.mkdir(await assertNoSymlinkPath(this.root, item.path), { recursive: true });
        } else {
          await this.pullNow(item.path, false);
        }
      }
      for (const item of plan.pushes) {
        await this.pushNow(item.path, false);
      }
      report = await this.checkNow('incremental', { intent: 'sync', reason: 'post-sync-once' });
      this.emit('status', report);
      return report;
    });
  }

  async watch(): Promise<void> {
    await this.start();
    await this.syncOnce();
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      ignored: candidate => this.ignoreAbsolutePath(String(candidate))
    });
    for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
      this.watcher.on(event, changed => {
        this.host.log(`Local ${event}: ${path.relative(this.root, changed)}`);
        this.scheduleSync(`local:${event}`);
      });
    }
    await new Promise<void>(resolve => this.events.once('stop', resolve));
  }

  requestStop(): void {
    this.events.emit('stop');
  }

  async check(
    mode: 'incremental' | 'full',
    options: { intent?: 'status' | 'sync'; paths?: Iterable<string>; reason?: string } = {}
  ): Promise<SyncStatusReport> {
    return this.serial(() => this.checkNow(mode, options));
  }

  private async checkNow(
    mode: 'incremental' | 'full',
    options: { intent?: 'status' | 'sync'; paths?: Iterable<string>; reason?: string } = {}
  ): Promise<SyncStatusReport> {
      await this.start();
      this.manifest = await readManifest(this.root);
      const project = this.session!.getProject();
      if (!project) throw new Error('Overleaf realtime session does not contain a project tree.');
      let remote = buildProjectTreeIndex(
        this.manifest.serverUrl,
        this.manifest.projectId,
        this.manifest.projectName,
        project
      ).manifest;
      let localScan = await scanLocalProject(this.root, this.manifest);
      let localFiles = localScan.files;
      let localFolders = localScan.folders;
      if (options.intent === 'sync') {
        const remoteRenamesChanged = await this.reconcileRemoteRenames(remote);
        if (remoteRenamesChanged) {
          localScan = await scanLocalProject(this.root, this.manifest);
          localFiles = localScan.files;
          localFolders = localScan.folders;
        }
        if (this.policy.autoPushLocalAhead) {
          const localRenamesChanged = await this.reconcileLocalRenames(localFiles, localFolders);
          if (localRenamesChanged) {
            localScan = await scanLocalProject(this.root, this.manifest);
            localFiles = localScan.files;
            localFolders = localScan.folders;
            remote = buildProjectTreeIndex(
              this.manifest.serverUrl,
              this.manifest.projectId,
              this.manifest.projectName,
              project
            ).manifest;
          }
        }
      }
      const requestedPaths = options.paths ? new Set([...options.paths].map(toPosixPath)) : undefined;
      repairFolderManifestFromRemote(this.manifest, remote, localFolders);
      const folderStatus = classifyFolderStructure(this.manifest, remote, requestedPaths, localFolders);
      const paths = new Set([
        ...Object.keys(this.manifest.files),
        ...Object.keys(remote.files),
        ...localFiles,
        ...(requestedPaths ?? [])
      ]);
      const items: SyncStatusItem[] = [...folderStatus.items];
      const conflictStore = new ConflictStore(this.root);
      const existingConflicts = await conflictStore.list();
      const remoteContents = new Map<string, string>();
      const remoteHashes = new Map<string, string>();
      const remoteFailures = new Map<string, string>();
      const remotePlan = this.syncHealth.planRemoteReads(this.manifest, remote, {
        mode,
        paths: requestedPaths
      });
      let remoteReadsCompleted = 0;
      const remoteReadsTotal = remotePlan.docsToJoin.length
        + remotePlan.binariesToGet.length
        + remotePlan.reusedPaths.size;
      const reportRemoteRead = (relPath: string): void => {
        remoteReadsCompleted += 1;
        this.host.progress({
          phase: 'check',
          message: `Read remote metadata ${relPath}`,
          path: relPath,
          completed: remoteReadsCompleted,
          total: remoteReadsTotal
        });
      };
      for (const relPath of remotePlan.reusedPaths) reportRemoteRead(relPath);
      await mapWithConcurrency(remotePlan.docsToJoin, 4, async file => {
        try {
          remoteContents.set(file.path, (await this.session!.joinDoc(file.entityId)).content);
        } catch (error) {
          remoteFailures.set(file.path, formatUnknownError(error));
        } finally {
          reportRemoteRead(file.path);
        }
      });
      const remoteTempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-health-'));
      try {
        await mapWithDynamicByteConcurrency(remotePlan.binariesToGet, 4, 64 * 1024 * 1024, async (file, reservation) => {
          const target = path.join(remoteTempRoot, file.entityId);
          try {
            const result = await this.client.downloadProjectFileToPath(this.manifest!.projectId, file.entityId, target, {
              onSize: bytes => reservation.reserve(bytes)
            });
            file.remoteSize = result.size;
            remoteHashes.set(file.path, result.sha1);
          } catch (error) {
            remoteFailures.set(file.path, formatUnknownError(error));
          } finally {
            await fs.rm(target, { force: true }).catch(() => undefined);
            reportRemoteRead(file.path);
          }
        });
      } finally {
        await fs.rm(remoteTempRoot, { recursive: true, force: true });
      }
      let completed = 0;
      for (const relPath of [...paths].sort()) {
        if (requestedPaths && !requestedPaths.has(relPath)) continue;
        if (shouldIgnore(this.manifest, relPath)) continue;
        const manifestFile = this.manifest.files[relPath];
        const remoteFile = remote.files[relPath];
        const localResult = await cachedLocalFileHash(path.join(this.root, relPath), manifestFile, mode === 'full', localScan.fileMetadata.get(relPath));
        const remoteContent = remoteContents.get(relPath);
        const remoteReadError = remoteFailures.get(relPath);
        const remoteHash = remoteHashes.get(relPath) ?? (remoteContent === undefined
          ? remotePlan.reusedPaths.has(relPath) ? manifestFile?.sha1 : undefined
          : sha1(remoteContent));
        let baseHash = manifestFile?.baseHash;
        if (!baseHash && remoteFile?.entityType === 'doc') {
          const base = await readBaseDoc(this.root, remoteFile.entityId);
          baseHash = base === undefined ? undefined : sha1(base);
        }
        const item = classifySyncStatus({
          path: relPath,
          manifestFile,
          remoteFile,
          localHash: localResult.hash,
          remoteHash,
          baseHash,
          localExists: localResult.hash !== undefined,
          remoteReadError
        });
        if (item.status === 'diverged' && remoteFile
          && !existingConflicts.some(conflict => conflict.relPath === relPath)) {
          const suffix = path.extname(relPath) || (remoteFile.entityType === 'doc' ? '.tex' : '.remote');
          const conflictPath = metadataPath(
            this.root,
            'conflicts',
            `${relPath.replace(/[\/\\]/g, '__')}.remote.${Date.now()}${suffix}`
          );
          await fs.mkdir(path.dirname(conflictPath), { recursive: true });
          if (remoteFile.entityType === 'doc' && remoteContent !== undefined) {
            await fs.writeFile(conflictPath, remoteContent);
          } else if (remoteFile.entityType === 'file') {
            await this.client.downloadProjectFileToPath(this.manifest.projectId, remoteFile.entityId, conflictPath);
          } else {
            continue;
          }
          await conflictStore.upsert({
            relPath,
            docId: remoteFile.entityId,
            remoteVersion: remoteFile.version ?? 0,
            remotePath: conflictPath,
            reason: 'Local and remote content both changed since the trusted base.',
            createdAt: new Date().toISOString()
          });
          this.host.conflict(relPath, 'Local and remote content both changed since the trusted base.');
        }
        if (!manifestFile && remoteFile && localResult.hash === remoteHash && remoteHash !== undefined) {
          addOrUpdateFile(this.manifest, remoteFile, remoteContent);
          this.manifest.files[relPath].sha1 = remoteHash;
          this.manifest.files[relPath].baseHash = remoteFile.entityType === 'doc' ? remoteHash : undefined;
        }
        if (item.status === 'synced' && manifestFile && remoteFile) {
          manifestFile.version = remoteFile.version;
          manifestFile.remoteBlobHash = remoteFile.remoteBlobHash;
          manifestFile.remoteRevision = remoteFile.remoteRevision;
          manifestFile.remoteSize = remoteFile.remoteSize;
          if (remoteHash) manifestFile.sha1 = remoteHash;
        }
        items.push(item);
        completed += 1;
        this.host.progress({ phase: 'check', message: `Checked ${relPath}`, path: relPath, completed, total: paths.size });
      }
      const targetedReport = makeSyncStatusReport(this.manifest, items, {
        mode,
        completeness: folderStatus.globalBlockReason ? 'failed' : remoteFailures.size > 0 ? 'partial' : 'complete',
        globalBlockReason: folderStatus.globalBlockReason
      });
      const report = requestedPaths
        ? mergeTargetedSyncStatusReport(await readSyncStatus(this.root), targetedReport, requestedPaths)
        : targetedReport;
      await writeManifest(this.root, this.manifest);
      await writeSyncStatus(this.root, report);
      this.host.status(report);
      return report;
  }

  async push(relPath: string, force: boolean): Promise<void> {
    await this.serial(() => this.pushNow(relPath, force));
  }

  private async pushNow(relPath: string, force: boolean): Promise<void> {
      await this.start();
      this.manifest = await readManifest(this.root);
      const normalized = this.validatePath(relPath);
      const sourcePath = await assertNoSymlinkPath(this.root, normalized);
      const localStat = await fs.stat(sourcePath).catch(() => undefined);
      const entry = this.manifest.files[normalized];
      if (!localStat) {
        if (!entry) throw new Error(`${normalized} does not exist locally.`);
        if (!force) throw new Error(`Deleting ${normalized} from Overleaf requires --force.`);
        await this.client.deleteEntity(this.manifest.projectId, entry.entityType, entry.entityId);
        delete this.manifest.files[normalized];
        await writeManifest(this.root, this.manifest);
        return;
      }
      const textFile = entry ? entry.entityType === 'doc' : isTextLike(normalized);
      const content = textFile ? await fs.readFile(sourcePath) : undefined;
      const localDigests = textFile
        ? { size: content!.length, sha1: sha1(content!), gitBlobHash: gitBlobHash(content!) }
        : await hashFileDigests(sourcePath);
      if (!entry && shouldIgnoreUntrackedLocalPath(this.manifest, normalized)) {
        throw new Error(`${normalized} is excluded by .overleaf-codexignore.`);
      }
      const remote = await this.remoteFile(normalized);
      try {
        const effectiveEntry = selectRemoteWriteTarget(normalized, entry, remote?.file, force);
        if (remote && !force) {
          const base = entry?.baseHash ?? entry?.sha1;
          if (!entry && localDigests.sha1 !== remote.digests.sha1) {
            throw new Error(`${normalized} already exists on Overleaf with different content; use --force only after reviewing it.`);
          }
          if (base && remote.digests.sha1 !== base && localDigests.sha1 !== remote.digests.sha1) {
            throw new Error(`${normalized} changed remotely; use --force only after reviewing the conflict.`);
          }
        }
        const parentFolderId = await this.ensureRemoteParentFolders(normalized);
        if (textFile) {
          let target = effectiveEntry;
          if (!target) {
            const doc = await this.client.addDoc(this.manifest.projectId, parentFolderId, path.posix.basename(normalized));
            target = { path: normalized, entityId: doc._id, entityType: 'doc', parentFolderId, binary: false };
          }
          const joined = await this.session!.joinDoc(target.entityId);
          const text = content!.toString('utf8');
          const op = buildOtOperations(joined.content, text);
          if (op.length > 0) await this.session!.applyOtUpdate(target.entityId, { doc: target.entityId, v: joined.version, op });
          target.version = joined.version + (op.length > 0 ? 1 : 0);
          addOrUpdateFile(this.manifest, target, text);
          this.manifest.files[normalized].baseHash = await writeBaseDoc(this.root, target.entityId, text);
        } else {
          if (!this.policy.syncBinaryFiles && !force) throw new Error('Binary synchronization is disabled.');
          const uploaded: BinaryUploadResult = effectiveEntry
            ? await this.replaceBinary(normalized, sourcePath, localDigests, effectiveEntry)
            : await this.client.uploadFileFromPath(this.manifest.projectId, parentFolderId, path.posix.basename(normalized), sourcePath);
          if (!effectiveEntry && (uploaded.hash
            ? uploaded.hash !== localDigests.gitBlobHash
            : !await this.remoteBlobMatches(uploaded._id, localDigests.gitBlobHash))) {
            await this.client.deleteEntity(this.manifest.projectId, 'file', uploaded._id).catch(() => undefined);
            throw new Error(`Local binary ${normalized} changed while it was being uploaded.`);
          }
          addOrUpdateFile(this.manifest, {
            path: normalized,
            entityId: uploaded._id,
            entityType: 'file',
            parentFolderId,
            binary: true,
            remoteBlobHash: uploaded.hash ?? localDigests.gitBlobHash,
            remoteSize: localDigests.size
          });
          this.manifest.files[normalized].sha1 = localDigests.sha1;
          await writeManifest(this.root, this.manifest);
          if (uploaded.transactionId) await new BinaryTransactionStore(this.root).remove(uploaded.transactionId);
          this.emit('pushed', { path: normalized });
          return;
        }
        await writeManifest(this.root, this.manifest);
        this.emit('pushed', { path: normalized });
      } finally {
        await remote?.dispose();
      }
  }

  async pull(relPath: string, force: boolean): Promise<void> {
    await this.serial(() => this.pullNow(relPath, force));
  }

  private async pullNow(relPath: string, force: boolean): Promise<void> {
      await this.start();
      this.manifest = await readManifest(this.root);
      const normalized = this.validatePath(relPath);
      const remote = await this.remoteFile(normalized);
      const entry = this.manifest.files[normalized];
      if (!remote) {
        if (!entry) throw new Error(`${normalized} does not exist on Overleaf or in the local manifest.`);
        if (!force) throw new Error(`${normalized} was deleted on Overleaf; pass --force to move the local copy to trash.`);
        const source = await assertNoSymlinkPath(this.root, normalized);
        const target = trashPathFor(this.root, normalized);
        const stat = await fs.stat(source).catch(() => undefined);
        if (stat) {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.rename(source, target).catch(async () => {
            if (stat.isDirectory()) await fs.cp(source, target, { recursive: true });
            else await fs.copyFile(source, target);
            await fs.rm(source, { recursive: stat.isDirectory(), force: true });
          });
        }
        delete this.manifest.files[normalized];
        await writeManifest(this.root, this.manifest);
        this.emit('trashed', { path: normalized, trashPath: stat ? target : undefined });
        return;
      }
      try {
        const localPath = await assertNoSymlinkPath(this.root, normalized);
        const localStat = await fs.stat(localPath).catch(() => undefined);
        if (!force && entry && localStat) {
          const base = entry.baseHash ?? entry.sha1;
          const localHash = remote.file.entityType === 'doc'
            ? sha1(await fs.readFile(localPath))
            : (await hashFileDigests(localPath)).sha1;
          if (base && localHash !== base && localHash !== remote.digests.sha1) {
            throw new Error(`${normalized} has local changes; use --force only after reviewing them.`);
          }
        }
        await fs.mkdir(path.dirname(localPath), { recursive: true });
        if (remote.file.entityType === 'file') {
          if (!remote.sourcePath) throw new Error(`Remote binary ${normalized} has no staged download.`);
          await installStagedFile(remote.sourcePath, localPath);
          addOrUpdateFile(this.manifest, { ...remote.file, remoteSize: remote.digests.size });
          this.manifest.files[normalized].sha1 = remote.digests.sha1;
          this.manifest.files[normalized].baseHash = remote.digests.sha1;
        } else {
          await fs.writeFile(localPath, remote.content!);
          addOrUpdateFile(this.manifest, remote.file, remote.content!);
          this.manifest.files[normalized].baseHash = await writeBaseDoc(
            this.root,
            remote.file.entityId,
            remote.content!.toString('utf8')
          );
        }
        await writeManifest(this.root, this.manifest);
        this.emit('pulled', { path: normalized });
      } finally {
        await remote.dispose();
      }
  }

  async conflicts(): Promise<PersistedConflict[]> {
    return new ConflictStore(this.root).list();
  }

  async resolveConflict(relPath: string, use: 'local' | 'remote'): Promise<void> {
    const normalized = this.validatePath(relPath);
    const store = new ConflictStore(this.root);
    const conflict = (await store.list()).find(item => item.relPath === normalized);
    if (!conflict) throw new Error(`No persisted conflict exists for ${normalized}.`);
    if (use === 'local') await this.push(normalized, true);
    else await this.pull(normalized, true);
    const conflictPath = assertPathWithin(metadataPath(this.root, 'conflicts'), conflict.remotePath);
    const conflictStat = await fs.lstat(conflictPath).catch(() => undefined);
    if (conflictStat?.isSymbolicLink() || conflictStat?.isDirectory()) {
      throw new Error(`Persisted conflict path is not a regular snapshot: ${conflict.remotePath}`);
    }
    await fs.rm(conflictPath, { force: true });
    await store.remove(normalized);
    this.emit('conflict-resolved', { path: normalized, use });
  }

  private async remoteFile(relPath: string): Promise<RemoteFileSnapshot | undefined> {
    const project = this.session!.getProject();
    if (!project || !this.manifest) return undefined;
    const remote = buildProjectTreeIndex(
      this.manifest.serverUrl, this.manifest.projectId, this.manifest.projectName, project
    ).manifest.files[relPath];
    if (!remote) return undefined;
    if (remote.entityType === 'doc') {
      const joined = await this.session!.joinDoc(remote.entityId);
      remote.version = joined.version;
      const content = Buffer.from(joined.content, 'utf8');
      return {
        file: remote,
        content,
        digests: { size: content.length, sha1: sha1(content), gitBlobHash: gitBlobHash(content) },
        dispose: async () => undefined
      };
    }
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-pull-'));
    const sourcePath = path.join(temporaryRoot, remote.entityId);
    try {
      const digests = await this.client.downloadProjectFileToPath(this.manifest.projectId, remote.entityId, sourcePath);
      remote.remoteSize = digests.size;
      return {
        file: remote,
        sourcePath,
        digests,
        dispose: () => fs.rm(temporaryRoot, { recursive: true, force: true })
      };
    } catch (error) {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private async ensureRemoteParentFolders(relPath: string): Promise<string> {
    const parent = path.posix.dirname(relPath);
    const parentPath = parent === '.' ? '' : parent;
    let folderId = this.manifest!.folders['']?.entityId;
    if (!folderId) throw new Error('Manifest is missing the Overleaf root folder.');
    let current = '';
    for (const segment of parentPath.split('/').filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.manifest!.folders[current];
      if (existing) { folderId = existing.entityId; continue; }
      const created = await this.client.addFolder(this.manifest!.projectId, folderId, segment);
      addOrUpdateFolder(this.manifest!, { path: current, entityId: created._id, parentFolderId: folderId });
      folderId = created._id;
    }
    return folderId;
  }

  private async replaceBinary(
    relPath: string,
    sourcePath: string,
    digests: FileDigests,
    entry: ManifestFile
  ): Promise<BinaryUploadResult> {
    try {
      return await this.client.uploadFileFromPath(
        this.manifest!.projectId, entry.parentFolderId, path.posix.basename(relPath), sourcePath
      );
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'duplicate_file_name')) throw error;
    }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const finalName = path.posix.basename(relPath);
    const tempName = transactionName(finalName, `upload-${id}`);
    const backupName = transactionName(finalName, `backup-${id}`);
    const temporary = await this.client.uploadFileFromPath(this.manifest!.projectId, entry.parentFolderId, tempName, sourcePath);
    const expected = digests.gitBlobHash;
    const verified = temporary.hash === expected
      || await this.remoteBlobMatches(temporary._id, expected);
    if (!verified) {
      await this.client.deleteEntity(this.manifest!.projectId, 'file', temporary._id).catch(() => undefined);
      throw new Error(`Could not verify temporary binary upload for ${relPath}.`);
    }
    const transaction: BinaryTransaction = {
      id, path: relPath, parentFolderId: entry.parentFolderId, finalName, tempName, backupName,
      originalEntityId: entry.entityId, tempEntityId: temporary._id, expectedBlobHash: expected,
      expectedSha1: digests.sha1,
      stage: 'temp-uploaded', createdAt: new Date().toISOString()
    };
    const store = new BinaryTransactionStore(this.root);
    await store.upsert(transaction);
    await this.client.renameEntity(this.manifest!.projectId, 'file', entry.entityId, backupName);
    transaction.stage = 'original-backed-up';
    await store.upsert(transaction);
    await this.client.renameEntity(this.manifest!.projectId, 'file', temporary._id, finalName);
    transaction.stage = 'promoted';
    await store.upsert(transaction);
    await this.client.deleteEntity(this.manifest!.projectId, 'file', entry.entityId);
    return { _id: temporary._id, name: finalName, hash: temporary.hash ?? expected, transactionId: id };
  }

  private async remoteBlobMatches(entityId: string, expectedBlobHash: string): Promise<boolean> {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-verify-'));
    try {
      const result = await this.client.downloadProjectFileToPath(
        this.manifest!.projectId,
        entityId,
        path.join(temporaryRoot, entityId)
      );
      return result.gitBlobHash === expectedBlobHash;
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  private async recoverBinaryTransactions(): Promise<void> {
    const store = new BinaryTransactionStore(this.root);
    const project = this.session?.getProject();
    if (!project) throw new Error('Cannot recover binary transactions without the current Overleaf project tree.');
    const remote = buildProjectTreeIndex(
      this.manifest!.serverUrl,
      this.manifest!.projectId,
      this.manifest!.projectName,
      project
    ).manifest;
    const entities = new Map(Object.values(remote.files).map(file => [file.entityId, {
      entityId: file.entityId,
      name: path.posix.basename(file.path),
      parentFolderId: file.parentFolderId
    }]));
    const changed = await recoverBinaryTransactions(
      this.client,
      this.manifest!.projectId,
      this.manifest!,
      store,
      {
        log: message => this.host.log(message),
        inspectEntity: entityId => entities.get(entityId)
      }
    );
    if (changed) await writeManifest(this.root, this.manifest!);
  }

  private async reconcileRemoteRenames(remote: OverleafCodexManifest): Promise<boolean> {
    let changed = false;
    const remoteFoldersById = new Map(Object.values(remote.folders).map(folder => [folder.entityId, folder]));
    const folderCandidates = Object.values(this.manifest!.folders)
      .filter(folder => folder.path)
      .map(folder => ({ local: folder, remote: remoteFoldersById.get(folder.entityId) }))
      .filter((pair): pair is { local: ManifestFolder; remote: ManifestFolder } =>
        Boolean(pair.remote && pair.remote.path !== pair.local.path))
      .sort((left, right) => left.local.path.split('/').length - right.local.path.split('/').length);
    for (const candidate of folderCandidates) {
      const oldPath = folderPathById(this.manifest!, candidate.local.entityId);
      if (!oldPath || oldPath === candidate.remote.path) continue;
      const newPath = candidate.remote.path;
      const sourcePath = await assertNoSymlinkPath(this.root, oldPath).catch(() => undefined);
      const source = sourcePath ? await fs.stat(sourcePath).catch(() => undefined) : undefined;
      if (!source?.isDirectory()) continue;
      const oldParentFolderId = this.manifest!.folders[oldPath]?.parentFolderId;
      try {
        await renameLocalPathTransactionally(
          this.root,
          oldPath,
          newPath,
          async () => {
            this.remapManifestFolder(oldPath, newPath, candidate.remote.parentFolderId);
            await writeManifest(this.root, this.manifest!);
          },
          async () => {
            const moved = this.manifest!.folders[newPath];
            if (moved?.entityId === candidate.local.entityId) {
              this.remapManifestFolder(newPath, oldPath, oldParentFolderId);
            }
          }
        );
        changed = true;
      } catch (error) {
        this.host.conflict(oldPath, `Remote folder rename to ${newPath} could not be applied safely: ${formatUnknownError(error)}`);
        throw error;
      }
    }

    const remoteFilesById = new Map(Object.values(remote.files).map(file => [file.entityId, file]));
    for (const entry of [...Object.values(this.manifest!.files)]) {
      const remoteEntry = remoteFilesById.get(entry.entityId);
      if (!remoteEntry || remoteEntry.path === entry.path) continue;
      const oldPath = entry.path;
      const newPath = remoteEntry.path;
      const oldFilePath = await assertNoSymlinkPath(this.root, oldPath).catch(() => undefined);
      if (!oldFilePath) continue;
      const hash = await cachedLocalFileHash(oldFilePath, entry);
      if (hash.hash !== entry.sha1) continue;
      if (this.manifest!.files[newPath] || this.manifest!.folders[newPath]) {
        const message = `Remote file rename to ${newPath} conflicts with an existing manifest path.`;
        this.host.conflict(oldPath, message);
        throw new Error(message);
      }
      try {
        await renameLocalPathTransactionally(
          this.root,
          oldPath,
          newPath,
          async () => {
            delete this.manifest!.files[oldPath];
            this.manifest!.files[newPath] = { ...entry, ...remoteEntry, path: newPath };
            if (this.manifest!.rootDocPath === oldPath) this.manifest!.rootDocPath = newPath;
            await writeManifest(this.root, this.manifest!);
          },
          async () => {
            const moved = this.manifest!.files[newPath];
            if (moved?.entityId !== entry.entityId) return;
            delete this.manifest!.files[newPath];
            entry.path = oldPath;
            this.manifest!.files[oldPath] = entry;
            if (this.manifest!.rootDocPath === newPath) this.manifest!.rootDocPath = oldPath;
          }
        );
        changed = true;
      } catch (error) {
        this.host.conflict(oldPath, `Remote file rename to ${newPath} could not be applied safely: ${formatUnknownError(error)}`);
        throw error;
      }
    }
    return changed;
  }

  private async reconcileLocalRenames(localFiles: string[], localFolders: string[]): Promise<boolean> {
    let changed = false;
    const localFolderSet = new Set(localFolders);
    const missingFolderPaths = new Set(Object.values(this.manifest!.folders)
      .filter(folder => folder.path && !localFolderSet.has(folder.path))
      .map(folder => folder.path));
    const missingFolders = Object.values(this.manifest!.folders).filter(folder =>
      folder.path && missingFolderPaths.has(folder.path) && !hasMissingAncestor(folder.path, missingFolderPaths));
    const untrackedFolderPaths = new Set(localFolders.filter(candidate => !this.manifest!.folders[candidate]));
    const untrackedFolders = [...untrackedFolderPaths].filter(candidate => !hasMissingAncestor(candidate, untrackedFolderPaths));
    const folderCandidates = await mapWithConcurrencyResult(untrackedFolders, 4, async candidate => ({
      path: candidate,
      fingerprint: await folderFingerprintFromLocal(this.root, candidate, this.manifest!)
    }));
    const oldFolderFingerprints = buildManifestFolderFingerprints(this.manifest!);
    const oldFolderCounts = new Map<string, number>();
    for (const fingerprint of oldFolderFingerprints.values()) oldFolderCounts.set(fingerprint, (oldFolderCounts.get(fingerprint) ?? 0) + 1);
    const candidateByFingerprint = new Map<string, typeof folderCandidates>();
    for (const candidate of folderCandidates) candidateByFingerprint.set(candidate.fingerprint, [...(candidateByFingerprint.get(candidate.fingerprint) ?? []), candidate]);
    for (const oldFolder of missingFolders) {
      const fingerprint = oldFolderFingerprints.get(oldFolder.path)!;
      const matches = candidateByFingerprint.get(fingerprint) ?? [];
      if (matches.length !== 1 || oldFolderCounts.get(fingerprint) !== 1) {
        if (matches.length > 0) this.host.conflict(oldFolder.path, 'Folder rename is ambiguous because multiple subtrees have identical content.');
        continue;
      }
      await this.applyLocalRename(oldFolder.path, matches[0].path);
      changed = true;
    }

    const refreshedFiles = localFiles;
    const localFileSet = new Set(refreshedFiles);
    const missingFiles = Object.values(this.manifest!.files).filter(file => !localFileSet.has(file.path));
    const untrackedFiles = refreshedFiles.filter(candidate => !this.manifest!.files[candidate]);
    const localCandidates = await mapWithConcurrencyResult(untrackedFiles, 4, async candidate => ({
      path: candidate,
      hash: (await hashFileDigests(await assertNoSymlinkPath(this.root, candidate))).sha1
    }));
    const candidatesByHash = new Map<string, typeof localCandidates>();
    for (const candidate of localCandidates) candidatesByHash.set(candidate.hash, [...(candidatesByHash.get(candidate.hash) ?? []), candidate]);
    const oldFileCounts = new Map<string, number>();
    for (const file of missingFiles) {
      const key = `${file.entityType}\0${file.localHashCache ?? file.sha1 ?? ''}`;
      oldFileCounts.set(key, (oldFileCounts.get(key) ?? 0) + 1);
    }
    for (const oldFile of missingFiles) {
      const expected = oldFile.localHashCache ?? oldFile.sha1;
      if (!expected) continue;
      const matches = (candidatesByHash.get(expected) ?? []).filter(candidate => (isTextLike(candidate.path) ? 'doc' : 'file') === oldFile.entityType);
      const key = `${oldFile.entityType}\0${expected}`;
      if (matches.length !== 1 || oldFileCounts.get(key) !== 1) {
        if (matches.length > 0) this.host.conflict(oldFile.path, 'File rename is ambiguous because multiple paths have identical content.');
        continue;
      }
      await this.applyLocalRename(oldFile.path, matches[0].path);
      changed = true;
    }
    return changed;
  }

  private async applyLocalRename(oldPath: string, newPath: string): Promise<void> {
    const oldFile = this.manifest!.files[oldPath];
    const oldFolder = this.manifest!.folders[oldPath];
    if (!oldFile && !oldFolder) return;
    if (this.manifest!.files[newPath] || this.manifest!.folders[newPath]) {
      throw new Error(`Cannot rename ${oldPath} to ${newPath}; the remote target already exists.`);
    }
    if (oldFolder && newPath.startsWith(`${oldPath}/`)) throw new Error(`Cannot move ${oldPath} inside itself.`);
    const parentFolderId = await this.ensureRemoteParentFolders(newPath);
    const entity = oldFile ?? oldFolder!;
    if (!entity.parentFolderId) throw new Error('The Overleaf root folder cannot be renamed.');
    const entityType = oldFile?.entityType ?? 'folder';
    const oldName = path.posix.basename(oldPath);
    const newName = path.posix.basename(newPath);
    await performRemotePathChange(this.client, this.manifest!.projectId, {
      entityType,
      entityId: entity.entityId,
      oldParentFolderId: entity.parentFolderId,
      newParentFolderId: parentFolderId,
      oldName,
      newName
    });
    const project = this.session!.getProject();
    if (project) {
      if (oldName !== newName) renameProjectTreeEntity(project, entity.entityId, newName);
      if (entity.parentFolderId !== parentFolderId) moveProjectTreeEntity(project, entity.entityId, parentFolderId);
    }
    if (oldFile) {
      delete this.manifest!.files[oldPath];
      oldFile.path = newPath;
      oldFile.parentFolderId = parentFolderId;
      this.manifest!.files[newPath] = oldFile;
    } else {
      this.remapManifestFolder(oldPath, newPath, parentFolderId);
    }
    await writeManifest(this.root, this.manifest!);
    this.emit('renamed', { oldPath, newPath });
  }

  private remapManifestFolder(oldPath: string, newPath: string, parentFolderId?: string): void {
    const prefix = `${oldPath}/`;
    for (const folder of Object.values(this.manifest!.folders)) {
      if (folder.path !== oldPath && !folder.path.startsWith(prefix)) continue;
      delete this.manifest!.folders[folder.path];
      folder.path = folder.path === oldPath ? newPath : `${newPath}/${folder.path.slice(prefix.length)}`;
      if (folder.path === newPath) folder.parentFolderId = parentFolderId;
      this.manifest!.folders[folder.path] = folder;
    }
    for (const file of Object.values(this.manifest!.files)) {
      if (!file.path.startsWith(prefix)) continue;
      delete this.manifest!.files[file.path];
      file.path = `${newPath}/${file.path.slice(prefix.length)}`;
      this.manifest!.files[file.path] = file;
    }
    if (this.manifest!.rootDocPath === oldPath || this.manifest!.rootDocPath?.startsWith(prefix)) {
      this.manifest!.rootDocPath = this.manifest!.rootDocPath === oldPath
        ? newPath
        : `${newPath}/${this.manifest!.rootDocPath.slice(prefix.length)}`;
    }
  }

  private async folderFingerprintFromLocal(relPath: string): Promise<string> {
    return folderFingerprintFromLocal(this.root, relPath, this.manifest!);
  }

  private scheduleSync(reason: string): void {
    if (!this.running || this.stopping) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.syncOnce().catch(error => {
        this.host.log(`Watch reconciliation failed (${reason}): ${formatUnknownError(error)}`);
        this.emit('error', { reason, message: formatUnknownError(error) });
      });
    }, 800);
  }

  private ignoreAbsolutePath(candidate: string): boolean {
    const rel = toPosixPath(path.relative(this.root, candidate));
    if (!rel || rel.startsWith('..')) return false;
    if (/(^|\/)(\.overleaf-codex|\.git|\.vscode)(\/|$)/.test(rel)) return true;
    return this.manifest
      ? shouldIgnore(this.manifest, rel) || shouldIgnoreUntrackedLocalPath(this.manifest, rel)
      : false;
  }

  private validatePath(relPath: string): string {
    return normalizeProjectRelativePath(relPath);
  }

  private emit(event: string, data?: unknown): void {
    this.events.emit('event', { event, data });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.operation.catch(() => undefined).then(operation);
    this.operation = current.then(() => undefined, () => undefined);
    return current;
  }
}

/** @deprecated Use OverleafSyncEngine. Kept for source compatibility with early CLI builds. */
export { OverleafSyncEngine as CliSyncEngine };

function hasMissingAncestor(relPath: string, candidates: ReadonlySet<string>): boolean {
  let parent = path.posix.dirname(relPath);
  while (parent && parent !== '.') {
    if (candidates.has(parent)) return true;
    parent = path.posix.dirname(parent);
  }
  return false;
}

async function mapWithConcurrencyResult<T, R>(
  items: readonly T[],
  concurrency: number,
  handler: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await handler(items[index]);
    }
  }));
  return results;
}
