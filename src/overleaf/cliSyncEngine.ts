import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import chokidar, { type FSWatcher } from 'chokidar';
import type { SyncHost, SyncPolicy } from './coreInterfaces';
import { OverleafClient, OverleafSocketSession } from './overleafClient';
import {
  addOrUpdateFile,
  addOrUpdateFolder,
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
  listLocalProjectFiles,
  listLocalProjectFolders,
  makeSyncStatusReport,
  mergeTargetedSyncStatusReport,
  repairFolderManifestFromRemote,
  trashPathFor
} from './syncStatus';
import { buildOtOperations } from './ot';
import { ConflictStore, type PersistedConflict } from './conflictStore';
import { BinaryTransactionStore, type BinaryTransaction } from './binaryTransactions';
import { formatUnknownError, gitBlobHash, isTextLike, sha1, toPosixPath } from './util';
import { planSafeSyncActions, selectRemoteWriteTarget } from './syncCommandCore';
import { performRemotePathChange, recoverBinaryTransactions, transactionName } from './remoteMutationCore';
import { mapWithConcurrency, SyncHealthService } from './syncHealthService';

const REMOTE_EVENTS = [
  'otUpdateApplied', 'reciveNewDoc', 'reciveNewFile', 'reciveNewFolder',
  'reciveEntityRename', 'reciveEntityMove', 'removeEntity', 'rootDocUpdated'
];

export class OverleafSyncEngine {
  private manifest?: OverleafCodexManifest;
  private session?: OverleafSocketSession;
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private running = false;
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
    this.manifest = await readManifest(this.root);
    this.session = await this.client.connectSocket(this.manifest.projectId);
    await this.recoverBinaryTransactions();
    this.running = true;
    for (const event of REMOTE_EVENTS) this.session.on(event, () => this.scheduleSync(`remote:${event}`));
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.watcher?.close();
    this.watcher = undefined;
    await this.operation.catch(() => undefined);
    this.session?.disconnect();
    this.session = undefined;
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
    await this.start();
    let report = await this.check('incremental', { intent: 'sync', reason: 'sync-once' });
    const plan = planSafeSyncActions(report, this.policy);
    for (const item of plan.pulls) {
      if (item.entityType === 'folder') {
        await fs.mkdir(path.join(this.root, item.path), { recursive: true });
      } else {
        await this.pull(item.path, false);
      }
    }
    for (const item of plan.pushes) {
      await this.push(item.path, false);
    }
    report = await this.check('incremental', { intent: 'sync', reason: 'post-sync-once' });
    this.emit('status', report);
    return report;
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
    return this.serial(async () => {
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
      let [localFiles, localFolders] = await Promise.all([
        listLocalProjectFiles(this.root, this.manifest),
        listLocalProjectFolders(this.root, this.manifest)
      ]);
      if (options.intent === 'sync') {
        await this.reconcileRemoteRenames(remote, localFiles, localFolders);
        [localFiles, localFolders] = await Promise.all([
          listLocalProjectFiles(this.root, this.manifest),
          listLocalProjectFolders(this.root, this.manifest)
        ]);
        if (this.policy.autoPushLocalAhead) {
          await this.reconcileLocalRenames(localFiles, localFolders);
          [localFiles, localFolders] = await Promise.all([
            listLocalProjectFiles(this.root, this.manifest),
            listLocalProjectFolders(this.root, this.manifest)
          ]);
          remote = buildProjectTreeIndex(
            this.manifest.serverUrl,
            this.manifest.projectId,
            this.manifest.projectName,
            project
          ).manifest;
        }
      }
      const requestedPaths = options.paths ? new Set([...options.paths].map(toPosixPath)) : undefined;
      repairFolderManifestFromRemote(this.manifest, remote, localFolders);
      const folderStatus = classifyFolderStructure(this.manifest, remote, requestedPaths);
      const paths = new Set([
        ...Object.keys(this.manifest.files),
        ...Object.keys(remote.files),
        ...localFiles,
        ...(requestedPaths ?? [])
      ]);
      const items: SyncStatusItem[] = [...folderStatus.items];
      const conflictStore = new ConflictStore(this.root);
      const existingConflicts = await conflictStore.list();
      const remoteContents = new Map<string, Uint8Array | string>();
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
      for (const file of remotePlan.docsToJoin) {
        try {
          remoteContents.set(file.path, (await this.session!.joinDoc(file.entityId)).content);
        } catch (error) {
          remoteFailures.set(file.path, formatUnknownError(error));
        } finally {
          reportRemoteRead(file.path);
        }
      }
      await mapWithConcurrency(remotePlan.binariesToGet, 4, async file => {
        try {
          remoteContents.set(
            file.path,
            await this.client.downloadProjectFile(this.manifest!.projectId, file.entityId)
          );
        } catch (error) {
          remoteFailures.set(file.path, formatUnknownError(error));
        } finally {
          reportRemoteRead(file.path);
        }
      });
      let completed = 0;
      for (const relPath of [...paths].sort()) {
        if (requestedPaths && !requestedPaths.has(relPath)) continue;
        if (shouldIgnore(this.manifest, relPath)) continue;
        const manifestFile = this.manifest.files[relPath];
        const remoteFile = remote.files[relPath];
        const localResult = await cachedLocalFileHash(path.join(this.root, relPath), manifestFile, mode === 'full');
        const remoteContent = remoteContents.get(relPath);
        const remoteReadError = remoteFailures.get(relPath);
        const remoteHash = remoteContent === undefined
          ? remotePlan.reusedPaths.has(relPath) ? manifestFile?.sha1 : undefined
          : sha1(remoteContent);
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
        if (item.status === 'diverged' && remoteFile && remoteContent !== undefined
          && !existingConflicts.some(conflict => conflict.relPath === relPath)) {
          const suffix = path.extname(relPath) || (remoteFile.entityType === 'doc' ? '.tex' : '.remote');
          const conflictPath = metadataPath(
            this.root,
            'conflicts',
            `${relPath.replace(/[\/\\]/g, '__')}.remote.${Date.now()}${suffix}`
          );
          await fs.mkdir(path.dirname(conflictPath), { recursive: true });
          await fs.writeFile(conflictPath, remoteContent);
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
          this.manifest.files[relPath].baseHash = remoteFile.entityType === 'doc' ? remoteHash : undefined;
        }
        if (item.status === 'synced' && manifestFile && remoteFile) {
          manifestFile.version = remoteFile.version;
          manifestFile.remoteBlobHash = remoteFile.remoteBlobHash;
          manifestFile.remoteRevision = remoteFile.remoteRevision;
          if (remoteHash) manifestFile.sha1 = remoteHash;
        }
        items.push(item);
        completed += 1;
        this.host.progress({ phase: 'check', message: `Checked ${relPath}`, path: relPath, completed, total: paths.size });
      }
      const targetedReport = makeSyncStatusReport(this.manifest, items, {
        mode,
        completeness: folderStatus.globalBlockReason ? 'failed' : 'complete',
        globalBlockReason: folderStatus.globalBlockReason
      });
      const report = requestedPaths
        ? mergeTargetedSyncStatusReport(await readSyncStatus(this.root), targetedReport, requestedPaths)
        : targetedReport;
      await writeManifest(this.root, this.manifest);
      await writeSyncStatus(this.root, report);
      this.host.status(report);
      return report;
    });
  }

  async push(relPath: string, force: boolean): Promise<void> {
    await this.serial(async () => {
      await this.start();
      this.manifest = await readManifest(this.root);
      const normalized = this.validatePath(relPath);
      const content = await fs.readFile(path.join(this.root, normalized)).catch(() => undefined);
      const entry = this.manifest.files[normalized];
      if (!content) {
        if (!entry) throw new Error(`${normalized} does not exist locally.`);
        if (!force) throw new Error(`Deleting ${normalized} from Overleaf requires --force.`);
        await this.client.deleteEntity(this.manifest.projectId, entry.entityType, entry.entityId);
        delete this.manifest.files[normalized];
        await writeManifest(this.root, this.manifest);
        return;
      }
      if (!entry && shouldIgnoreUntrackedLocalPath(this.manifest, normalized)) {
        throw new Error(`${normalized} is excluded by .overleaf-codexignore.`);
      }
      const remote = await this.remoteFile(normalized);
      const effectiveEntry = selectRemoteWriteTarget(normalized, entry, remote?.file, force);
      if (remote && !force) {
        const base = entry?.baseHash ?? entry?.sha1;
        if (!entry && sha1(content) !== sha1(remote.content)) {
          throw new Error(`${normalized} already exists on Overleaf with different content; use --force only after reviewing it.`);
        }
        if (base && sha1(remote.content) !== base && sha1(content) !== sha1(remote.content)) {
          throw new Error(`${normalized} changed remotely; use --force only after reviewing the conflict.`);
        }
      }
      const parentFolderId = await this.ensureRemoteParentFolders(normalized);
      if (isTextLike(normalized)) {
        let target = effectiveEntry;
        if (!target) {
          const doc = await this.client.addDoc(this.manifest.projectId, parentFolderId, path.posix.basename(normalized));
          target = { path: normalized, entityId: doc._id, entityType: 'doc', parentFolderId, binary: false };
        }
        const joined = await this.session!.joinDoc(target.entityId);
        const text = content.toString('utf8');
        const op = buildOtOperations(joined.content, text);
        if (op.length > 0) await this.session!.applyOtUpdate(target.entityId, { doc: target.entityId, v: joined.version, op });
        target.version = joined.version + (op.length > 0 ? 1 : 0);
        addOrUpdateFile(this.manifest, target, text);
        this.manifest.files[normalized].baseHash = await writeBaseDoc(this.root, target.entityId, text);
      } else {
        if (!this.policy.syncBinaryFiles && !force) throw new Error('Binary synchronization is disabled.');
        const uploaded = effectiveEntry
          ? await this.replaceBinary(normalized, content, effectiveEntry)
          : await this.client.uploadFile(this.manifest.projectId, parentFolderId, path.posix.basename(normalized), content);
        addOrUpdateFile(this.manifest, {
          path: normalized,
          entityId: uploaded._id,
          entityType: 'file',
          parentFolderId,
          binary: true,
          remoteBlobHash: uploaded.hash ?? gitBlobHash(content)
        }, content);
      }
      await writeManifest(this.root, this.manifest);
      this.emit('pushed', { path: normalized });
    });
  }

  async pull(relPath: string, force: boolean): Promise<void> {
    await this.serial(async () => {
      await this.start();
      this.manifest = await readManifest(this.root);
      const normalized = this.validatePath(relPath);
      const remote = await this.remoteFile(normalized);
      const entry = this.manifest.files[normalized];
      if (!remote) {
        if (!entry) throw new Error(`${normalized} does not exist on Overleaf or in the local manifest.`);
        if (!force) throw new Error(`${normalized} was deleted on Overleaf; pass --force to move the local copy to trash.`);
        const source = path.join(this.root, normalized);
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
      const local = await fs.readFile(path.join(this.root, normalized)).catch(() => undefined);
      if (!force && entry && local) {
        const base = entry.baseHash ?? entry.sha1;
        if (base && sha1(local) !== base && sha1(local) !== sha1(remote.content)) {
          throw new Error(`${normalized} has local changes; use --force only after reviewing them.`);
        }
      }
      await fs.mkdir(path.dirname(path.join(this.root, normalized)), { recursive: true });
      await fs.writeFile(path.join(this.root, normalized), remote.content);
      addOrUpdateFile(this.manifest, remote.file, remote.content);
      if (remote.file.entityType === 'doc') {
        this.manifest.files[normalized].baseHash = await writeBaseDoc(
          this.root,
          remote.file.entityId,
          Buffer.from(remote.content).toString('utf8')
        );
      }
      await writeManifest(this.root, this.manifest);
      this.emit('pulled', { path: normalized });
    });
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
    await fs.rm(conflict.remotePath, { force: true });
    await store.remove(normalized);
    this.emit('conflict-resolved', { path: normalized, use });
  }

  private async remoteFile(relPath: string): Promise<{ file: ManifestFile; content: Uint8Array } | undefined> {
    const project = this.session!.getProject();
    if (!project || !this.manifest) return undefined;
    const remote = buildProjectTreeIndex(
      this.manifest.serverUrl, this.manifest.projectId, this.manifest.projectName, project
    ).manifest.files[relPath];
    if (!remote) return undefined;
    if (remote.entityType === 'doc') {
      const joined = await this.session!.joinDoc(remote.entityId);
      remote.version = joined.version;
      return { file: remote, content: Buffer.from(joined.content, 'utf8') };
    }
    return { file: remote, content: await this.client.downloadProjectFile(this.manifest.projectId, remote.entityId) };
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
    content: Uint8Array,
    entry: ManifestFile
  ): Promise<{ _id: string; name: string; hash?: string }> {
    try {
      return await this.client.uploadFile(
        this.manifest!.projectId, entry.parentFolderId, path.posix.basename(relPath), content
      );
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'duplicate_file_name')) throw error;
    }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const finalName = path.posix.basename(relPath);
    const tempName = transactionName(finalName, `upload-${id}`);
    const backupName = transactionName(finalName, `backup-${id}`);
    const temporary = await this.client.uploadFile(this.manifest!.projectId, entry.parentFolderId, tempName, content);
    const expected = gitBlobHash(content);
    const verified = temporary.hash === expected
      || gitBlobHash(await this.client.downloadProjectFile(this.manifest!.projectId, temporary._id)) === expected;
    if (!verified) {
      await this.client.deleteEntity(this.manifest!.projectId, 'file', temporary._id).catch(() => undefined);
      throw new Error(`Could not verify temporary binary upload for ${relPath}.`);
    }
    const transaction: BinaryTransaction = {
      id, path: relPath, parentFolderId: entry.parentFolderId, finalName, tempName, backupName,
      originalEntityId: entry.entityId, tempEntityId: temporary._id, expectedBlobHash: expected,
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
    await this.client.deleteEntity(this.manifest!.projectId, 'file', entry.entityId).catch(() => undefined);
    await store.remove(id);
    return { _id: temporary._id, name: finalName, hash: temporary.hash ?? expected };
  }

  private async recoverBinaryTransactions(): Promise<void> {
    const store = new BinaryTransactionStore(this.root);
    const changed = await recoverBinaryTransactions(
      this.client,
      this.manifest!.projectId,
      this.manifest!,
      store,
      { log: message => this.host.log(message) }
    );
    if (changed) await writeManifest(this.root, this.manifest!);
  }

  private async reconcileRemoteRenames(
    remote: OverleafCodexManifest,
    localFiles: string[],
    localFolders: string[]
  ): Promise<void> {
    const localFileSet = new Set(localFiles);
    const localFolderSet = new Set(localFolders);
    for (const oldEntry of Object.values(this.manifest!.files)) {
      const newEntry = Object.values(remote.files).find(item => item.entityId === oldEntry.entityId);
      if (!newEntry || newEntry.path === oldEntry.path || !localFileSet.has(oldEntry.path) || localFileSet.has(newEntry.path)) continue;
      const hash = await cachedLocalFileHash(path.join(this.root, oldEntry.path), oldEntry);
      if (hash.hash !== oldEntry.sha1) continue;
      await fs.mkdir(path.dirname(path.join(this.root, newEntry.path)), { recursive: true });
      await fs.rename(path.join(this.root, oldEntry.path), path.join(this.root, newEntry.path));
      delete this.manifest!.files[oldEntry.path];
      this.manifest!.files[newEntry.path] = { ...oldEntry, ...newEntry, path: newEntry.path };
    }
    for (const oldFolder of Object.values(this.manifest!.folders)) {
      if (!oldFolder.path) continue;
      const newFolder = Object.values(remote.folders).find(item => item.entityId === oldFolder.entityId);
      if (!newFolder || newFolder.path === oldFolder.path || !localFolderSet.has(oldFolder.path) || localFolderSet.has(newFolder.path)) continue;
      await fs.mkdir(path.dirname(path.join(this.root, newFolder.path)), { recursive: true });
      await fs.rename(path.join(this.root, oldFolder.path), path.join(this.root, newFolder.path));
    }
  }

  private async reconcileLocalRenames(localFiles: string[], localFolders: string[]): Promise<void> {
    const localFolderSet = new Set(localFolders);
    const missingFolders = Object.values(this.manifest!.folders)
      .filter(folder => folder.path && !localFolderSet.has(folder.path))
      .filter(folder => !Object.values(this.manifest!.folders).some(parent =>
        parent.path && parent.path !== folder.path && folder.path.startsWith(`${parent.path}/`) && !localFolderSet.has(parent.path)
      ));
    const untrackedFolders = localFolders.filter(candidate => !this.manifest!.folders[candidate])
      .filter(candidate => !localFolders.some(parent => parent !== candidate
        && !this.manifest!.folders[parent] && candidate.startsWith(`${parent}/`)));
    const folderCandidates = await Promise.all(untrackedFolders.map(async candidate => ({
      path: candidate,
      fingerprint: await this.folderFingerprintFromLocal(candidate)
    })));
    for (const oldFolder of missingFolders) {
      const fingerprint = this.folderFingerprintFromManifest(oldFolder.path);
      const matches = folderCandidates.filter(candidate => candidate.fingerprint === fingerprint);
      const oldMatches = missingFolders.filter(candidate => this.folderFingerprintFromManifest(candidate.path) === fingerprint);
      if (matches.length !== 1 || oldMatches.length !== 1) {
        if (matches.length > 0) this.host.conflict(oldFolder.path, 'Folder rename is ambiguous because multiple subtrees have identical content.');
        continue;
      }
      await this.applyLocalRename(oldFolder.path, matches[0].path);
    }

    const refreshedFiles = await listLocalProjectFiles(this.root, this.manifest!);
    const localFileSet = new Set(refreshedFiles);
    const missingFiles = Object.values(this.manifest!.files).filter(file => !localFileSet.has(file.path));
    const untrackedFiles = refreshedFiles.filter(candidate => !this.manifest!.files[candidate]);
    const localCandidates = await Promise.all(untrackedFiles.map(async candidate => ({
      path: candidate,
      hash: await fs.readFile(path.join(this.root, candidate)).then(sha1)
    })));
    for (const oldFile of missingFiles) {
      const expected = oldFile.localHashCache ?? oldFile.sha1;
      if (!expected) continue;
      const matches = localCandidates.filter(candidate => candidate.hash === expected
        && (isTextLike(candidate.path) ? 'doc' : 'file') === oldFile.entityType);
      const oldMatches = missingFiles.filter(candidate => (candidate.localHashCache ?? candidate.sha1) === expected
        && candidate.entityType === oldFile.entityType);
      if (matches.length !== 1 || oldMatches.length !== 1) {
        if (matches.length > 0) this.host.conflict(oldFile.path, 'File rename is ambiguous because multiple paths have identical content.');
        continue;
      }
      await this.applyLocalRename(oldFile.path, matches[0].path);
    }
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

  private remapManifestFolder(oldPath: string, newPath: string, parentFolderId: string): void {
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
  }

  private folderFingerprintFromManifest(relPath: string): string {
    const prefix = `${relPath}/`;
    const parts = [
      ...Object.values(this.manifest!.folders)
        .filter(folder => folder.path.startsWith(prefix) && !shouldIgnore(this.manifest!, folder.path))
        .map(folder => `D\0${folder.path.slice(prefix.length)}`),
      ...Object.values(this.manifest!.files)
        .filter(file => file.path.startsWith(prefix) && !shouldIgnore(this.manifest!, file.path))
        .map(file => `F\0${file.path.slice(prefix.length)}\0${file.entityType}\0${file.localHashCache ?? file.sha1 ?? ''}`)
    ];
    return sha1(`folder\0${parts.sort().join('\n')}`);
  }

  private async folderFingerprintFromLocal(relPath: string): Promise<string> {
    const parts: string[] = [];
    const walk = async (absolute: string, relative: string): Promise<void> => {
      for (const entry of await fs.readdir(absolute, { withFileTypes: true }).catch(() => [])) {
        const child = toPosixPath(path.posix.join(relative, entry.name));
        const projectPath = toPosixPath(path.posix.join(relPath, child));
        if (shouldIgnore(this.manifest!, projectPath) || shouldIgnoreUntrackedLocalPath(this.manifest!, projectPath)) continue;
        if (entry.isDirectory()) {
          parts.push(`D\0${child}`);
          await walk(path.join(absolute, entry.name), child);
        } else if (entry.isFile()) {
          const content = await fs.readFile(path.join(absolute, entry.name));
          parts.push(`F\0${child}\0${isTextLike(child) ? 'doc' : 'file'}\0${sha1(content)}`);
        }
      }
    };
    await walk(path.join(this.root, relPath), '');
    return sha1(`folder\0${parts.sort().join('\n')}`);
  }

  private scheduleSync(reason: string): void {
    if (!this.running) return;
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
    return this.manifest ? shouldIgnore(this.manifest, rel) : false;
  }

  private validatePath(relPath: string): string {
    const normalized = toPosixPath(relPath);
    if (!normalized || normalized.startsWith('..') || path.isAbsolute(relPath)) throw new Error(`Invalid project path: ${relPath}`);
    return normalized;
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
