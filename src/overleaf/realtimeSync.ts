import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { OverleafClient, OverleafSocketSession } from './overleafClient';
import { BinaryTransaction, BinaryTransactionStore } from './binaryTransactions';
import {
  addOrUpdateFile,
  addOrUpdateFolder,
  filePathById,
  folderPathById,
  LOCAL_IGNORE_NAME,
  atomicWriteText,
  metadataPath,
  readBaseDoc,
  readManifest,
  readSyncStatus,
  shouldIgnore,
  isToolkitOverridePath,
  shouldIgnoreUntrackedLocalPath,
  writeBaseDoc
} from './manifest';
import { buildProjectTreeIndex } from './tree';
import {
  CollaboratorPosition,
  ManifestFile,
  ManifestFolder,
  OnlineUser,
  OtOperation,
  OtUpdate,
  OverleafCodexManifest,
  OverleafDoc,
  OverleafFileRef,
  OverleafFolder,
  SyncStatusItem,
  SyncStatusReport
} from './types';
import {
  classifySyncStatus,
  classifyFolderStructure,
  cachedLocalFileHash,
  listLocalProjectFiles,
  makeSyncStatusReport,
  mergeTargetedSyncStatusReport,
  isBlockingStatus,
  trashPathFor
} from './syncStatus';
import { formatUnknownError, gitBlobHash, isTextLike, sha1, toPosixPath } from './util';
import { SyncGate } from './syncGate';
import { ConflictStore } from './conflictStore';
import { ManifestStore } from './manifestStore';
import { OtDocumentSession, OtDocumentState } from './otDocumentSession';
import { RenameDetection, RenameDetector } from './renameDetector';
import { SyncCheckScheduler } from './syncCheckScheduler';
import { SyncHealthService } from './syncHealthService';
import { getWithLegacyFallback } from './config';
import {
  applyOtOperations,
  buildOtOperations,
  hasLocalChangedSinceLastSync,
  hasRemoteChangedSinceLastSync,
  mergeRemoteIntoLocal,
  shareJsBlobHash
} from './ot';
export {
  applyOtOperations,
  buildOtOperations,
  hasLocalChangedSinceLastSync,
  hasRemoteChangedSinceLastSync,
  mergeRemoteIntoLocal,
  shareJsBlobHash
} from './ot';

interface DocState extends OtDocumentState {
  relPath: string;
  paused?: boolean;
  conflictPath?: string;
  conflictReason?: string;
}

export interface ConflictInfo {
  relPath: string;
  conflictPath?: string;
  reason?: string;
}

interface CollaboratorState extends CollaboratorPosition {
  color: string;
  decoration: vscode.TextEditorDecorationType;
}

type LocalChangeKind = 'create' | 'change' | 'delete';

interface RemoteSnapshot {
  manifest: OverleafCodexManifest;
  contents: Map<string, Uint8Array | string>;
  failures: Map<string, string>;
  reused: Set<string>;
  metrics: {
    treeCount: number;
    joinDocCount: number;
    binaryGetCount: number;
    remoteCacheReuseCount: number;
  };
}

interface SyncCheckResult {
  report: SyncStatusReport;
  remote: RemoteSnapshot;
}

export interface SyncCheckOptions {
  mode?: 'incremental' | 'full';
  paths?: Iterable<string>;
  reason?: string;
  signal?: AbortSignal;
}

interface InternalSyncCheckOptions extends SyncCheckOptions {
  expectedGeneration?: number;
}

type SyncProgress = vscode.Progress<{ message?: string; increment?: number }>;

export class RealtimeSyncService implements vscode.Disposable {
  private root?: string;
  private client?: OverleafClient;
  private manifest?: OverleafCodexManifest;
  private session?: OverleafSocketSession;
  private watcher?: vscode.FileSystemWatcher;
  private renameDisposable?: vscode.Disposable;
  private readonly docStates = new Map<string, DocState>();
  private readonly documentSessions = new Map<string, OtDocumentSession>();
  private readonly bypassHashes = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly localMutationIds = new Map<string, number[]>();
  private readonly renameDetector = new RenameDetector(2000);
  private readonly output: vscode.OutputChannel;
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 25);
  private readonly collaboratorStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 24);
  private readonly collaborators = new Map<string, CollaboratorState>();
  private readonly statusChanged = new vscode.EventEmitter<void>();
  private readonly syncStatusChanged = new vscode.EventEmitter<void>();
  private readonly collaboratorsChanged = new vscode.EventEmitter<void>();
  private readonly conflictsChanged = new vscode.EventEmitter<void>();
  private readonly presenceDisposables: vscode.Disposable[] = [];
  private syncStatusReport?: SyncStatusReport;
  private readonly syncGate = new SyncGate();
  private shouldReconnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly checkScheduler: SyncCheckScheduler<SyncStatusReport>;
  private readonly syncHealth = new SyncHealthService();
  private stopping = false;
  private positionTimer?: NodeJS.Timeout;
  private lastPositionKey?: string;
  private binaryTransactions?: BinaryTransactionStore;
  private conflictStore?: ConflictStore;
  private manifestStore?: ManifestStore;
  private generation = 0;
  private checkSequence = 0;

  constructor(private readonly context: vscode.ExtensionContext, output?: vscode.OutputChannel) {
    this.output = output ?? vscode.window.createOutputChannel('LaTeX Editing Toolkit');
    this.checkScheduler = new SyncCheckScheduler(
      request => {
        if (!this.session || this.stopping) throw new Error('Realtime sync stopped before the scheduled check started.');
        return this.checkSyncStatus(this.root, this.client, undefined, request);
      },
      undefined,
      error => this.log(`Could not refresh sync status: ${formatUnknownError(error)}`)
    );
    this.status.command = 'overleafCodex.startRealtimeSync';
    this.status.text = '$(cloud) Overleaf';
    this.status.tooltip = 'Overleaf Codex realtime sync';
    this.collaboratorStatus.command = 'overleafCodex.showCollaborators';
    this.collaboratorStatus.text = '$(organization) 0';
    this.collaboratorStatus.tooltip = 'Overleaf collaborators';
    context.subscriptions.push(this.status, this.collaboratorStatus);
    if (!output) context.subscriptions.push(this.output);
  }

  get running(): boolean {
    return Boolean(this.session);
  }

  get currentRoot(): string | undefined {
    return this.root;
  }

  get onDidChangeStatus(): vscode.Event<void> {
    return this.statusChanged.event;
  }

  get onDidChangeCollaborators(): vscode.Event<void> {
    return this.collaboratorsChanged.event;
  }

  get onDidChangeConflicts(): vscode.Event<void> {
    return this.conflictsChanged.event;
  }

  get onDidChangeSyncStatus(): vscode.Event<void> {
    return this.syncStatusChanged.event;
  }

  getSyncStatusReport(): SyncStatusReport | undefined {
    return this.syncStatusReport;
  }

  getSyncStatusItems(): SyncStatusItem[] {
    return this.syncStatusReport?.items ?? [];
  }

  getCollaborators(): CollaboratorPosition[] {
    return [...this.collaborators.values()].map(user => ({
      id: user.id,
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      doc_id: user.doc_id,
      row: user.row,
      column: user.column,
      last_updated_at: user.last_updated_at
    }));
  }

  getConflicts(): ConflictInfo[] {
    return [...this.docStates.values()]
      .filter(state => state.paused)
      .map(state => ({
        relPath: state.relPath,
        conflictPath: state.conflictPath,
        reason: state.conflictReason
      }));
  }

  async checkSyncStatus(
    root = this.root,
    client = this.client,
    progress?: SyncProgress,
    options: SyncCheckOptions = {}
  ): Promise<SyncStatusReport> {
    if (!root) {
      throw new Error('Open a local Overleaf Codex mirror folder first.');
    }

    const manifest = await readManifest(root);
    const activeClient = client ?? this.client;
    if (!activeClient) {
      throw new Error('Overleaf Codex is not connected.');
    }
    if (this.root === root && this.session && !this.stopping) {
      const expectedGeneration = this.generation;
      const report = (await this.checkSyncStatusWithSession(root, manifest, activeClient, this.session, progress, {
        ...options,
        expectedGeneration
      })).report;
      return await this.autoPushLocalAheadAfterCheck(root, report, progress, options);
    }
    progress?.report({ message: 'Connecting for sync health check' });
    const session = await activeClient.connectSocket(manifest.projectId, options.signal);

    try {
      const expectedGeneration = this.root === root ? this.generation : undefined;
      const report = (await this.checkSyncStatusWithSession(root, manifest, activeClient, session, progress, {
        ...options,
        expectedGeneration
      })).report;
      return await this.autoPushLocalAheadAfterCheck(root, report, progress, options);
    } finally {
      session.disconnect();
    }
  }

  private async checkSyncStatusWithSession(
    root: string,
    manifest: OverleafCodexManifest,
    activeClient: OverleafClient,
    session: OverleafSocketSession,
    progress?: SyncProgress,
    options: InternalSyncCheckOptions = {}
  ): Promise<SyncCheckResult> {
    const startedAt = Date.now();
    const operationId = `check-${++this.checkSequence}`;
    const mode = options.mode ?? 'incremental';
    const remote = await this.fetchRemoteSnapshot(manifest, session, activeClient, progress, options);
    progress?.report({ message: 'Comparing local and remote files' });
    const localPaths = await listLocalProjectFiles(root, manifest);
    const allPaths = new Set([
      ...Object.keys(manifest.files),
      ...Object.keys(remote.manifest.files),
      ...localPaths
    ]);
    if (!this.canSyncToolkitOverrides()) {
      for (const relPath of allPaths) {
        if (isToolkitOverridePath(relPath)) allPaths.delete(relPath);
      }
    }
    const requestedPaths = options.paths ? new Set([...options.paths].map(toPosixPath)) : undefined;
    const folderStructure = classifyFolderStructure(manifest, remote.manifest, requestedPaths);
    const items: SyncStatusItem[] = [...folderStructure.items];
    let manifestChanged = false;
    let localCacheReuseCount = 0;

    for (const requestedPath of requestedPaths ?? []) {
      allPaths.add(requestedPath);
    }
    for (const relPath of allPaths) {
      if (requestedPaths && !requestedPaths.has(relPath)) {
        continue;
      }
      if (shouldIgnore(manifest, relPath) || isAlwaysLocal(relPath)
        || (!this.canSyncToolkitOverrides() && isToolkitOverridePath(relPath))) {
        continue;
      }

      const manifestFile = manifest.files[relPath];
      const remoteFile = remote.manifest.files[relPath];
      const localAbs = path.join(root, relPath);
      const localResult = await cachedLocalFileHash(localAbs, manifestFile, mode === 'full');
      const localHash = localResult.hash;
      if (localResult.reused) localCacheReuseCount += 1;
      if (localResult.cacheChanged) manifestChanged = true;
      const remoteContent = remote.contents.get(relPath);
      const remoteHash = remoteContent === undefined
        ? remote.reused.has(relPath) ? manifestFile?.sha1 : undefined
        : sha1(remoteContent);
      const remoteReadError = remote.failures.get(relPath);
      if (!manifestFile && !remoteFile && localHash === undefined && !remoteReadError) {
        continue;
      }
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
        remoteReadError
      });

      if (item.status === 'synced' && manifestFile && remoteFile) {
        if (manifestFile.version !== remoteFile.version
          || manifestFile.remoteBlobHash !== remoteFile.remoteBlobHash
          || manifestFile.remoteRevision !== remoteFile.remoteRevision) {
          manifestFile.version = remoteFile.version;
          manifestFile.remoteBlobHash = remoteFile.remoteBlobHash;
          manifestFile.remoteRevision = remoteFile.remoteRevision;
          manifestChanged = true;
        }
      }

      if (!manifestFile && remoteFile && localHash === remoteHash && remoteHash !== undefined) {
        addOrUpdateFile(manifest, remoteFile, remoteContent);
        manifest.files[relPath].baseHash = baseHash;
        manifestChanged = true;
      }

      items.push(item);
    }

    const targetedReport = makeSyncStatusReport(manifest, items, {
      mode,
      completeness: folderStructure.globalBlockReason ? 'failed' : remote.failures.size > 0 ? 'partial' : 'complete',
      globalBlockReason: folderStructure.globalBlockReason
    });
    const report = requestedPaths
      ? mergeTargetedSyncStatusReport(await readSyncStatus(root), targetedReport, requestedPaths)
      : targetedReport;
    if (!requestedPaths && remote.failures.size === 0 && report.items.every(item =>
      item.status === 'synced' || item.status === 'local ahead' || item.status === 'local only' || item.status === 'local deleted'
    )) {
      if (manifest.projectVersion !== remote.manifest.projectVersion) {
        manifest.projectVersion = remote.manifest.projectVersion;
        manifestChanged = true;
      }
    }
    if (options.expectedGeneration !== undefined) {
      this.assertGeneration(options.expectedGeneration, options.signal);
    }
    await this.storeFor(root).writeSyncStatus(report);
    if (options.expectedGeneration !== undefined) {
      this.assertGeneration(options.expectedGeneration, options.signal);
    }
    if (!this.root || this.root === root) {
      this.root = root;
      this.client = activeClient;
      this.syncStatusReport = report;
      this.syncGate.applyReport(report);
      this.manifest = manifest;
      this.updateSyncStatusBar();
      this.syncStatusChanged.fire();
      this.statusChanged.fire();
    }
    if (mode === 'full' && !requestedPaths) {
      manifest.lastFullAuditAt = new Date().toISOString();
      manifestChanged = true;
    }
    if (manifestChanged) {
      if (options.expectedGeneration !== undefined) {
        this.assertGeneration(options.expectedGeneration, options.signal);
      }
      await this.storeFor(root).writeManifest(manifest);
    }
    this.log(
      `[${operationId}] ${mode} check (${options.reason ?? 'manual'}) completed in ${Date.now() - startedAt}ms: `
      + `tree=${remote.metrics.treeCount}, joinDoc=${remote.metrics.joinDocCount}, binaryGet=${remote.metrics.binaryGetCount}, `
      + `remoteReuse=${remote.metrics.remoteCacheReuseCount}, localReuse=${localCacheReuseCount}, failures=${remote.failures.size}.`
    );
    return { report, remote };
  }

  async retrySyncPath(relPath: string, signal?: AbortSignal): Promise<SyncStatusItem> {
    this.requireReady();
    const normalized = toPosixPath(relPath);
    const report = await this.checkSyncStatus(this.root, this.client, undefined, {
      mode: 'incremental',
      paths: [normalized],
      reason: 'retry',
      signal
    });
    const item = report.items.find(candidate => candidate.path === normalized);
    if (!item) {
      this.syncGate.clearPath(normalized);
      this.updateSyncStatusBar();
      throw new Error(`${normalized} is no longer present locally, remotely, or in the manifest.`);
    }
    if (item.status === 'error') {
      throw new Error(item.message ?? `Could not obtain a trustworthy remote snapshot for ${normalized}.`);
    }
    this.syncGate.clearPath(normalized);
    this.syncGate.applyReport(report);
    this.updateSyncStatusBar();
    return item;
  }

  async pushLocalFile(relPath: string, refreshStatus = true): Promise<void> {
    this.requireReady();
    const normalized = toPosixPath(relPath);
    if (this.syncGate.findBlocking(normalized)?.state === 'error') {
      throw new Error(`${normalized} has an unresolved remote read error. Retry its sync check before pushing.`);
    }
    this.log(`Manual Push Local requested for ${normalized}.`);
    const entry = this.manifest!.files[normalized];
    if (shouldIgnore(this.manifest!, normalized) || isAlwaysLocal(normalized)
      || (!this.canSyncToolkitOverrides() && isToolkitOverridePath(normalized))) {
      throw new Error(`${normalized} is local-only and cannot be pushed to Overleaf.`);
    }
    if (!entry && shouldIgnoreUntrackedLocalPath(this.manifest!, normalized)) {
      throw new Error(`${normalized} is excluded by ${LOCAL_IGNORE_NAME} and cannot be pushed to Overleaf.`);
    }
    await this.saveOpenLocalDocument(normalized);
    const localContent = await fs.readFile(this.abs(normalized)).catch(() => undefined);

    if (localContent === undefined) {
      if (!entry) {
        throw new Error(`${normalized} does not exist locally or in the manifest.`);
      }
      const selection = await vscode.window.showWarningMessage(
        `Delete ${normalized} from Overleaf? The local file is missing.`,
        { modal: true },
        'Delete Remote'
      );
      if (selection !== 'Delete Remote') {
        return;
      }
      await this.client!.deleteEntity(this.manifest!.projectId, entry.entityType, entry.entityId);
      delete this.manifest!.files[normalized];
      this.docStates.delete(normalized);
      await this.persistManifest();
      if (refreshStatus) {
        await this.checkTargeted([normalized], 'post-delete');
      }
      return;
    }

    if (!entry) {
      this.log(`Creating remote file for local-only path ${normalized}.`);
      await this.handleLocalFileCreate(normalized, localContent, true);
      await this.refreshBaseAfterLocalPush(normalized);
      if (refreshStatus) {
        await this.checkTargeted([normalized], 'post-create');
      }
      return;
    }

    if (entry.entityType === 'doc') {
      this.log(`Pushing local document ${normalized}.`);
      const state = await this.ensureDocState(normalized);
      state.paused = false;
      state.localCache = state.remoteCache;
      await this.syncDocContent(normalized, localContent.toString('utf8'), true);
    } else {
      this.log(`Replacing remote binary file ${normalized}.`);
      await this.replaceBinaryFile(normalized, localContent, entry, true);
    }

    if (refreshStatus) {
      await this.checkTargeted([normalized], 'post-push');
    } else {
      this.syncGate.clearPath(normalized);
    }
  }

  async pullRemoteFile(relPath: string): Promise<void> {
    this.requireReady();
    const normalized = toPosixPath(relPath);
    if (this.syncGate.findBlocking(normalized)?.state === 'error') {
      throw new Error(`${normalized} has an unresolved remote read error. Retry its sync check before pulling.`);
    }
    const remote = await this.fetchFreshRemoteSnapshot([normalized]);
    const remoteFile = remote.manifest.files[normalized];
    const remoteContent = remote.contents.get(normalized);
    const remoteFailure = remote.failures.get(normalized);
    if (remoteFailure) {
      throw new Error(`Could not read ${normalized} from Overleaf: ${remoteFailure}`);
    }
    if (!remoteFile || remoteContent === undefined) {
      throw new Error(`${normalized} is not present on Overleaf.`);
    }

    addOrUpdateFile(this.manifest!, remoteFile, remoteContent);
    this.manifest!.files[normalized].baseHash = remoteFile.entityType === 'doc' && typeof remoteContent === 'string'
      ? await writeBaseDoc(this.root!, remoteFile.entityId, remoteContent)
      : sha1(remoteContent);
    await this.writeLocalFile(
      normalized,
      typeof remoteContent === 'string' ? Buffer.from(remoteContent, 'utf8') : remoteContent,
      true
    );
    if (remoteFile.entityType === 'doc' && typeof remoteContent === 'string') {
      const state = this.docStates.get(normalized) ?? await this.joinDocState(normalized, remoteFile.entityId);
      state.version = remoteFile.version ?? state.version;
      state.localCache = remoteContent;
      state.remoteCache = remoteContent;
      state.paused = false;
    }
    await this.persistManifest();
    this.syncGate.clearPath(normalized);
    await this.checkTargeted([normalized], 'post-pull');
    vscode.window.showInformationMessage(`Pulled Overleaf version for ${normalized}.`);
  }

  async openSyncDiff(relPath: string): Promise<void> {
    this.requireReady();
    const normalized = toPosixPath(relPath);
    const remote = await this.fetchFreshRemoteSnapshot([normalized]);
    const remoteContent = remote.contents.get(normalized);
    const remoteFailure = remote.failures.get(normalized);
    if (remoteFailure) {
      throw new Error(`Could not read ${normalized} from Overleaf: ${remoteFailure}`);
    }
    if (remoteContent === undefined) {
      throw new Error(`${normalized} is not present on Overleaf.`);
    }
    const suffix = isTextLike(normalized) ? path.extname(normalized) || '.tex' : '.remote';
    const diffPath = metadataPath(this.root!, 'conflicts', `${normalized.replace(/[\/\\]/g, '__')}.remote.${Date.now()}${suffix}`);
    await fs.mkdir(path.dirname(diffPath), { recursive: true });
    await fs.writeFile(diffPath, remoteContent);
    await vscode.commands.executeCommand(
      'vscode.diff',
      vscode.Uri.file(diffPath),
      vscode.Uri.file(this.abs(normalized)),
      `Overleaf remote vs local: ${normalized}`
    );
  }

  async moveRemoteDeletedToTrash(relPath: string): Promise<void> {
    this.requireReady();
    const normalized = toPosixPath(relPath);
    await this.moveLocalToTrash(normalized);
    delete this.manifest!.files[normalized];
    this.docStates.delete(normalized);
    await this.persistManifest();
    await this.checkTargeted([normalized], 'post-trash');
    vscode.window.showInformationMessage(`Moved ${normalized} to local Overleaf Codex trash.`);
  }

  async start(root: string, client: OverleafClient, progress?: SyncProgress, signal?: AbortSignal): Promise<void> {
    await this.stop();
    const generation = ++this.generation;
    this.stopping = false;
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this.root = root;
    this.client = client;
    this.manifest = await readManifest(root);
    this.manifestStore = new ManifestStore(root);
    this.syncGate.setProject('checking');
    this.binaryTransactions = new BinaryTransactionStore(root);
    this.conflictStore = new ConflictStore(root);
    progress?.report({ message: 'Connecting to Overleaf realtime server' });
    this.session = await client.connectSocket(this.manifest.projectId, signal);
    this.assertGeneration(generation, signal);
    await this.recoverBinaryTransactions();
    this.registerRemoteHandlers();
    this.registerPresenceHandlers();
    this.status.text = '$(sync~spin) Overleaf';
    this.status.tooltip = 'Checking Overleaf Codex sync status';
    this.status.show();
    await this.reconcileOnStart(progress, signal);
    this.assertGeneration(generation, signal);
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
    this.watcher.onDidCreate(uri => this.queueLocal(uri, 'create'), this, this.context.subscriptions);
    this.watcher.onDidChange(uri => this.queueLocal(uri, 'change'), this, this.context.subscriptions);
    this.watcher.onDidDelete(uri => this.queueLocal(uri, 'delete'), this, this.context.subscriptions);
    this.renameDisposable = vscode.workspace.onDidRenameFiles(event => {
      void this.handleVsCodeRenames(event).catch(error => this.showError(error));
    });
    this.updateSyncStatusBar();
    this.status.show();
    this.collaboratorStatus.show();
    progress?.report({ message: 'Loading collaborators' });
    await this.loadConnectedUsers();
    this.statusChanged.fire();
    this.log(`Realtime sync started for ${this.manifest.projectName}.`);
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.stopping = true;
    this.shouldReconnect = false;
    this.syncGate.setProject('stopped');
    this.syncGate.clearPaths();
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.docStates.clear();
    this.documentSessions.clear();
    this.bypassHashes.clear();
    this.inFlight.clear();
    this.localMutationIds.clear();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.checkScheduler.cancelScheduled();
    this.lastPositionKey = undefined;
    if (this.positionTimer) {
      clearTimeout(this.positionTimer);
      this.positionTimer = undefined;
    }
    while (this.presenceDisposables.length) {
      this.presenceDisposables.pop()?.dispose();
    }
    this.clearCollaborators();
    this.watcher?.dispose();
    this.watcher = undefined;
    this.renameDisposable?.dispose();
    this.renameDisposable = undefined;
    this.session?.disconnect();
    this.session = undefined;
    this.manifestStore = undefined;
    this.status.text = '$(cloud) Overleaf';
    this.status.hide();
    this.collaboratorStatus.hide();
    this.statusChanged.fire();
    this.syncStatusChanged.fire();
  }

  dispose(): void {
    void this.stop();
    this.statusChanged.dispose();
    this.syncStatusChanged.dispose();
    this.collaboratorsChanged.dispose();
    this.conflictsChanged.dispose();
  }

  private registerRemoteHandlers(): void {
    if (!this.session) {
      return;
    }
    const generation = this.generation;
    const current = (): boolean => generation === this.generation && !this.stopping;

    this.session.on('otUpdateApplied', update => {
      if (!current()) return;
      void this.handleRemoteUpdate(update as OtUpdate);
    });
    this.session.on('reciveNewDoc', (parentFolderId, doc) => {
      if (!current()) return;
      void this.handleRemoteCreated(parentFolderId as string, 'doc', doc as OverleafDoc);
    });
    this.session.on('reciveNewFile', (parentFolderId, file) => {
      if (!current()) return;
      void this.handleRemoteCreated(parentFolderId as string, 'file', file as OverleafFileRef);
    });
    this.session.on('reciveNewFolder', (parentFolderId, folder) => {
      if (!current()) return;
      void this.handleRemoteFolderCreated(parentFolderId as string, folder as OverleafFolder);
    });
    this.session.on('reciveEntityRename', (entityId, newName) => {
      if (!current()) return;
      void this.handleRemoteRenamed(entityId as string, newName as string);
    });
    this.session.on('reciveEntityMove', (entityId, newParentFolderId) => {
      if (!current()) return;
      void this.handleRemoteMoved(entityId as string, newParentFolderId as string);
    });
    this.session.on('removeEntity', entityId => {
      if (!current()) return;
      void this.handleRemoteRemoved(entityId as string);
    });
    this.session.on('disconnect', () => {
      if (!current()) return;
      void this.handleSocketDisconnected('Overleaf realtime socket disconnected.');
    });
    this.session.on('connect_failed', () => {
      if (!current()) return;
      void this.handleSocketDisconnected('Overleaf realtime socket failed to reconnect.');
    });
    this.session.on('error', error => {
      if (!current()) return;
      const message = formatUnknownError(error);
      void this.handleSocketDisconnected(`Overleaf realtime socket error: ${message}`);
    });
    this.session.on('rootDocUpdated', rootDocId => {
      if (!current()) return;
      if (this.manifest) {
        this.manifest.rootDocId = rootDocId as string;
        this.manifest.rootDocPath = filePathById(this.manifest, rootDocId as string);
        void this.persistManifest();
      }
    });
  }

  private registerPresenceHandlers(): void {
    if (!this.session) {
      return;
    }

    this.session.on('clientTracking.clientUpdated', user => {
      this.updateCollaborator(user as CollaboratorPosition);
    });
    this.session.on('clientTracking.clientDisconnected', id => {
      this.removeCollaborator(id as string);
    });
    this.session.on('connectionAccepted', (_payload, publicId) => {
      if (this.session) {
        this.session.publicId = publicId as string;
      }
    });

    this.presenceDisposables.push(
      vscode.window.onDidChangeTextEditorSelection(event => this.queueLocalPosition(event)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshCollaboratorDecorations())
    );
  }

  async showCollaborators(): Promise<void> {
    if (!this.session || !this.manifest) {
      throw new Error('Realtime sync is not running.');
    }

    if (this.collaborators.size === 0) {
      vscode.window.showInformationMessage('No online Overleaf collaborators.');
      return;
    }

    const picked = await vscode.window.showQuickPick([...this.collaborators.values()].map(user => {
      const relPath = user.doc_id ? filePathById(this.manifest!, user.doc_id) : undefined;
      return {
        label: user.name || user.email || user.id,
        description: relPath ? `${relPath}:${(user.row ?? 0) + 1}` : undefined,
        detail: user.email,
        user
      };
    }), {
      title: 'Overleaf Collaborators',
      placeHolder: 'Select a collaborator to jump to their cursor'
    });

    if (!picked?.user.doc_id) {
      return;
    }
    const relPath = filePathById(this.manifest, picked.user.doc_id);
    if (!relPath || !this.root) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(this.root, relPath)));
    await vscode.window.showTextDocument(document, {
      selection: new vscode.Selection(picked.user.row ?? 0, picked.user.column ?? 0, picked.user.row ?? 0, picked.user.column ?? 0),
      preview: false
    });
  }

  async showConflicts(): Promise<void> {
    const conflicts = this.getConflicts();
    if (conflicts.length === 0) {
      vscode.window.showInformationMessage('No paused Overleaf Codex conflicts.');
      return;
    }

    const picked = await vscode.window.showQuickPick(conflicts.map(conflict => ({
      label: conflict.relPath,
      description: conflict.reason,
      conflict
    })), {
      title: 'Overleaf Codex Conflicts',
      placeHolder: 'Select a conflict to review'
    });
    if (picked) {
      await this.openConflictDiff(picked.conflict.relPath);
    }
  }

  async openConflictDiff(relPath: string): Promise<void> {
    const state = this.docStates.get(relPath);
    if (!state?.paused || !state.conflictPath) {
      throw new Error(`No active conflict for ${relPath}.`);
    }
    await vscode.commands.executeCommand(
      'vscode.diff',
      vscode.Uri.file(state.conflictPath),
      vscode.Uri.file(this.abs(relPath)),
      `Overleaf remote vs local: ${relPath}`
    );
    void this.promptConflictActions(relPath);
  }

  async acceptRemoteConflict(relPath: string): Promise<void> {
    const state = this.requireConflict(relPath);
    await this.writeLocalFile(relPath, Buffer.from(state.remoteCache, 'utf8'), true);
    state.localCache = state.remoteCache;
    state.paused = false;
    state.conflictPath = undefined;
    state.conflictReason = undefined;
    this.manifest!.files[relPath].version = state.version;
    addOrUpdateFile(this.manifest!, this.manifest!.files[relPath], state.remoteCache);
    this.manifest!.files[relPath].baseHash = await writeBaseDoc(this.root!, state.docId, state.remoteCache);
    await this.persistManifest();
    this.syncGate.clearPath(relPath);
    await this.conflictStore?.remove(relPath);
    this.conflictsChanged.fire();
    await this.checkTargeted([relPath], 'conflict-accept-remote');
    vscode.window.showInformationMessage(`Accepted Overleaf remote version for ${relPath}.`);
  }

  async useLocalConflict(relPath: string): Promise<void> {
    const state = this.requireConflict(relPath);
    await this.saveOpenLocalDocument(relPath);
    const localContent = await fs.readFile(this.abs(relPath), 'utf8');
    state.paused = false;
    state.conflictPath = undefined;
    state.conflictReason = undefined;
    state.localCache = state.remoteCache;
    this.syncGate.clearPath(relPath);
    await this.conflictStore?.remove(relPath);
    this.conflictsChanged.fire();
    await this.syncDocContent(relPath, localContent);
    await this.checkTargeted([relPath], 'conflict-use-local');
    vscode.window.showInformationMessage(`Used current local version for ${relPath} and resumed sync.`);
  }

  private async promptConflictActions(relPath: string): Promise<void> {
    const selection = await vscode.window.showInformationMessage(
      `Resolve Overleaf conflict for ${relPath}. Edit/save the right-hand local file, then choose how to resume sync.`,
      'Use Current Local',
      'Accept Remote',
      'Later'
    );
    if (selection === 'Use Current Local') {
      await this.useLocalConflict(relPath);
    } else if (selection === 'Accept Remote') {
      await this.acceptRemoteConflict(relPath);
    }
  }

  private async saveOpenLocalDocument(relPath: string): Promise<void> {
    const absPath = path.normalize(this.abs(relPath));
    const document = vscode.workspace.textDocuments.find(item =>
      path.normalize(item.uri.fsPath) === absPath
    );
    if (document?.isDirty) {
      await document.save();
    }
  }

  private requireConflict(relPath: string): DocState {
    this.requireReady();
    const state = this.docStates.get(relPath);
    if (!state?.paused) {
      throw new Error(`No active conflict for ${relPath}.`);
    }
    return state;
  }

  private async loadConnectedUsers(): Promise<void> {
    if (!this.session) {
      return;
    }
    const users = await this.session.getConnectedUsers().catch(error => {
      this.log(`Could not load collaborators: ${formatUnknownError(error)}`);
      return [] as OnlineUser[];
    });
    for (const user of users) {
      if (user.client_id === this.session.publicId) {
        continue;
      }
      this.updateCollaborator({
        id: user.client_id,
        user_id: user.user_id,
        name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email,
        email: user.email,
        doc_id: user.cursorData?.doc_id,
        row: user.cursorData?.row,
        column: user.cursorData?.column,
        last_updated_at: Number(user.last_updated_at) || Date.now()
      });
    }
    this.updateCollaboratorStatus();
  }

  private queueLocalPosition(event: vscode.TextEditorSelectionChangeEvent): void {
    if (!this.root || !this.manifest || !this.session || event.selections.length === 0) {
      return;
    }
    const relPath = toPosixPath(path.relative(this.root, event.textEditor.document.uri.fsPath));
    if (!relPath || relPath.startsWith('..')) {
      return;
    }
    const file = this.manifest.files[relPath];
    if (!file || file.entityType !== 'doc') {
      return;
    }
    const active = event.selections[0].active;
    const key = `${file.entityId}:${active.line}:${active.character}`;
    if (key === this.lastPositionKey) {
      return;
    }
    this.lastPositionKey = key;
    if (this.positionTimer) {
      clearTimeout(this.positionTimer);
    }
    this.positionTimer = setTimeout(() => {
      void this.session?.updatePosition(file.entityId, active.line, active.character)
        .catch(error => this.log(`Could not update Overleaf cursor position: ${formatUnknownError(error)}`));
    }, 250);
  }

  private updateCollaborator(user: CollaboratorPosition): void {
    if (!user.id || user.id === this.session?.publicId) {
      return;
    }
    const existing = this.collaborators.get(user.id);
    const state = existing ?? this.createCollaboratorState(user);
    state.user_id = user.user_id ?? state.user_id;
    state.name = user.name ?? state.name;
    state.email = user.email ?? state.email;
    state.doc_id = user.doc_id ?? state.doc_id;
    state.row = user.row ?? state.row ?? 0;
    state.column = user.column ?? state.column ?? 0;
    state.last_updated_at = Date.now();
    this.collaborators.set(user.id, state);
    this.refreshCollaboratorDecorations();
    this.updateCollaboratorStatus();
    this.collaboratorsChanged.fire();
  }

  private createCollaboratorState(user: CollaboratorPosition): CollaboratorState {
    const colors = [
      '#d97706', '#7c3aed', '#db2777', '#0284c7',
      '#059669', '#dc2626', '#4f46e5', '#a16207'
    ];
    const color = colors[this.collaborators.size % colors.length];
    const decoration = vscode.window.createTextEditorDecorationType({
      outline: `1px solid ${color}`,
      overviewRulerColor: color,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      rangeBehavior: vscode.DecorationRangeBehavior.OpenClosed
    });
    return {
      ...user,
      color,
      decoration
    };
  }

  private removeCollaborator(id: string): void {
    const user = this.collaborators.get(id);
    if (!user) {
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(user.decoration, []);
    }
    user.decoration.dispose();
    this.collaborators.delete(id);
    this.updateCollaboratorStatus();
    this.collaboratorsChanged.fire();
  }

  private clearCollaborators(): void {
    for (const id of [...this.collaborators.keys()]) {
      this.removeCollaborator(id);
    }
    this.updateCollaboratorStatus();
  }

  private refreshCollaboratorDecorations(): void {
    if (!this.root || !this.manifest) {
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      for (const user of this.collaborators.values()) {
        editor.setDecorations(user.decoration, []);
        if (!user.doc_id) {
          continue;
        }
        const relPath = filePathById(this.manifest, user.doc_id);
        if (!relPath || path.normalize(editor.document.uri.fsPath) !== path.normalize(path.join(this.root, relPath))) {
          continue;
        }
        const range = new vscode.Range(user.row ?? 0, user.column ?? 0, user.row ?? 0, user.column ?? 0);
        const name = user.name || user.email || 'Overleaf collaborator';
        editor.setDecorations(user.decoration, [{
          range,
          hoverMessage: new vscode.MarkdownString(name)
        }]);
      }
    }
  }

  private updateCollaboratorStatus(): void {
    const count = this.collaborators.size;
    this.collaboratorStatus.text = `$(organization) ${count}`;
    if (count === 0) {
      this.collaboratorStatus.tooltip = 'No online Overleaf collaborators';
      return;
    }
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown('Overleaf collaborators\n\n');
    for (const user of this.collaborators.values()) {
      const relPath = user.doc_id && this.manifest ? filePathById(this.manifest, user.doc_id) : undefined;
      const name = user.name || user.email || user.id;
      const line = relPath ? ` at ${relPath}:${(user.row ?? 0) + 1}` : '';
      tooltip.appendMarkdown(`- ${name}${line}\n`);
    }
    this.collaboratorStatus.tooltip = tooltip;
  }

  private queueLocal(uri: vscode.Uri, kind: LocalChangeKind): void {
    if (!this.root || !this.manifest) {
      return;
    }
    const relPath = toPosixPath(path.relative(this.root, uri.fsPath));
    if (relPath === LOCAL_IGNORE_NAME) {
      void this.reloadLocalIgnoreFile();
      return;
    }
    const tracked = Boolean(this.manifest.files[relPath] || this.manifest.folders[relPath]);
    if (
      !relPath
      || relPath.startsWith('..')
      || isAlwaysLocal(relPath)
      || shouldIgnore(this.manifest, relPath)
      || (!this.canSyncToolkitOverrides() && isToolkitOverridePath(relPath))
      || (!tracked && shouldIgnoreUntrackedLocalPath(this.manifest, relPath))
    ) {
      return;
    }
    const trackedFile = this.manifest.files[relPath];
    if (kind === 'delete' && trackedFile?.sha1) {
      const detection = this.renameDetector.registerDelete({
        path: relPath,
        hash: trackedFile.sha1,
        entityType: trackedFile.entityType
      });
      if (detection.kind !== 'none') {
        this.handleRenameDetection(detection);
        return;
      }
      this.scheduleLocalChange(relPath, kind, 2000);
      return;
    }
    if (kind === 'create' && !tracked) {
      this.cancelPathTimer(relPath);
      const timer = setTimeout(() => {
        this.timers.delete(relPath);
        void this.registerPotentialRenameCreate(relPath);
      }, 100);
      this.timers.set(relPath, timer);
      return;
    }
    this.scheduleLocalChange(relPath, kind, 750);
  }

  private scheduleLocalChange(relPath: string, kind: LocalChangeKind, delayMs: number): void {
    this.cancelPathTimer(relPath);
    const timer = setTimeout(() => {
      this.timers.delete(relPath);
      if (!this.syncGate.canSync(relPath)) {
        this.log(`Sync is paused for ${relPath}; recorded local ${kind} without uploading.`);
        this.scheduleSyncStatusCheck(undefined, [relPath]);
        return;
      }
      this.runPathOperation(relPath, () => this.handleLocalChange(relPath, kind));
    }, delayMs);
    this.timers.set(relPath, timer);
  }

  private async registerPotentialRenameCreate(relPath: string): Promise<void> {
    const stat = await fs.stat(this.abs(relPath)).catch(() => undefined);
    if (!stat || stat.isDirectory()) {
      this.scheduleLocalChange(relPath, 'create', 650);
      return;
    }
    const content = await fs.readFile(this.abs(relPath)).catch(() => undefined);
    if (!content) return;
    const detection = this.renameDetector.registerCreate({
      path: relPath,
      hash: sha1(content),
      entityType: isTextLike(relPath) ? 'doc' : 'file'
    });
    if (detection.kind !== 'none') {
      this.handleRenameDetection(detection);
      return;
    }
    this.scheduleLocalChange(relPath, 'create', 1900);
  }

  private handleRenameDetection(detection: Exclude<RenameDetection, { kind: 'none' }>): void {
    if (detection.kind === 'matched') {
      this.cancelPathTimer(detection.oldPath);
      this.cancelPathTimer(detection.newPath);
      this.runPathOperation(detection.oldPath, () => this.handleLocalRename(detection.oldPath, detection.newPath));
      return;
    }
    const reason = 'Multiple paths have identical content; confirm the rename/move manually.';
    for (const candidate of [...detection.oldPaths, ...detection.newPaths]) {
      this.cancelPathTimer(candidate);
      this.syncGate.setPath(candidate, 'pending', reason);
    }
    this.log(`${reason} Old: ${detection.oldPaths.join(', ')}; new: ${detection.newPaths.join(', ')}`);
    this.scheduleSyncStatusCheck(100, [...detection.oldPaths, ...detection.newPaths]);
  }

  private cancelPathTimer(relPath: string): void {
    const timer = this.timers.get(relPath);
    if (timer) clearTimeout(timer);
    this.timers.delete(relPath);
  }

  private runPathOperation(relPath: string, operation: () => Promise<void>): void {
    const previous = this.inFlight.get(relPath) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(operation)
      .catch(error => this.showError(error))
      .finally(() => {
        if (this.inFlight.get(relPath) === current) this.inFlight.delete(relPath);
      });
    this.inFlight.set(relPath, current);
  }

  private async reloadLocalIgnoreFile(): Promise<void> {
    if (!this.root) {
      return;
    }
    this.manifest = await readManifest(this.root);
    this.log(`Reloaded ${LOCAL_IGNORE_NAME}.`);
    this.scheduleSyncStatusCheck(100);
  }

  private async reconcileOnStart(progress?: SyncProgress, signal?: AbortSignal): Promise<void> {
    this.requireReady();
    progress?.report({ message: 'Reading remote project files' });
    const checked = await this.checkSyncStatusWithSession(
      this.root!,
      this.manifest!,
      this.client!,
      this.session!,
      progress,
      { mode: 'incremental', reason: 'startup', signal, expectedGeneration: this.generation }
    );
    progress?.report({ message: 'Initializing realtime document state' });
    await this.initializeDocStatesFromRemote(checked.remote);
    await this.restoreConflicts();
    const report = await this.autoPushLocalAhead(checked.report, progress);
    this.syncGate.applyReport(report);
    this.updateSyncStatusBar();
    this.log(`Startup sync health check completed. ${report.items.filter(item => item.status !== 'synced').length} file(s) need review.`);
    if (report.hasBlocking) {
      void vscode.window.showWarningMessage(
        `Overleaf Codex paused ${report.items.filter(item => item.blocking).length} path(s); unaffected files continue syncing. Review Sync Status before resolving them.`,
        'Show Sync Status'
      ).then(selection => {
        if (selection === 'Show Sync Status') {
          void vscode.commands.executeCommand('latexEditingToolkit.openSync');
        }
      });
    }
  }

  private async autoPushLocalAhead(report: SyncStatusReport, progress?: SyncProgress): Promise<SyncStatusReport> {
    if (!this.canAutoPushLocalAhead()) {
      return report;
    }

    const candidates = report.items.filter(item =>
      item.status === 'local ahead'
      && item.entityType === 'doc'
      && !this.docStates.get(item.path)?.paused
    );
    let pushed = 0;
    for (const item of candidates) {
      progress?.report({ message: `Pushing safe local changes ${pushed + 1}/${candidates.length}` });
      this.log(`Auto-pushing local-ahead document ${item.path}.`);
      await this.pushLocalFile(item.path, false);
      pushed += 1;
    }

    if (pushed === 0) {
      return report;
    }
    progress?.report({ message: 'Verifying uploaded changes' });
    return this.checkSyncStatus(this.root, this.client, progress, {
      mode: 'incremental',
      paths: candidates.map(item => item.path),
      reason: 'post-auto-push'
    });
  }

  private async autoPushLocalAheadAfterCheck(
    root: string,
    report: SyncStatusReport,
    progress?: SyncProgress,
    options: SyncCheckOptions = {}
  ): Promise<SyncStatusReport> {
    if (options.reason === 'post-auto-push'
      || root !== this.root
      || !this.session
      || !this.client
      || this.stopping) {
      return report;
    }
    return this.autoPushLocalAhead(report, progress);
  }

  private async fetchRemoteSnapshot(
    manifest: OverleafCodexManifest,
    session: OverleafSocketSession,
    client = this.client,
    progress?: SyncProgress,
    options: SyncCheckOptions = {}
  ): Promise<RemoteSnapshot> {
    const signal = options.signal;
    const project = session.getProject();
    if (!project) {
      throw new Error('Overleaf realtime session does not have a project tree.');
    }
    const indexed = buildProjectTreeIndex(
      manifest.serverUrl,
      manifest.projectId,
      manifest.projectName,
      project
    );
    const contents = new Map<string, Uint8Array | string>();
    const failures = new Map<string, string>();
    const reused = new Set<string>();
    const metrics = {
      treeCount: 1,
      joinDocCount: 0,
      binaryGetCount: 0,
      remoteCacheReuseCount: 0
    };
    const plan = this.syncHealth.planRemoteReads(manifest, indexed.manifest, {
      mode: options.mode ?? 'incremental',
      paths: options.paths
    });
    const docs = plan.docsToJoin;
    const binaries = plan.binariesToGet;
    for (const reusedPath of plan.reusedPaths) reused.add(reusedPath);
    metrics.remoteCacheReuseCount = reused.size;
    const selectedCount = docs.length + binaries.length + reused.size;
    let completed = 0;

    const reportProgress = (filePath: string): void => {
      completed += 1;
      progress?.report({ message: `Reading remote files ${completed}/${selectedCount}: ${filePath}` });
    };

    for (const reusedPath of reused) reportProgress(reusedPath);
    for (const file of docs) {
      try {
        metrics.joinDocCount += 1;
        const joined = await session.joinDoc(file.entityId, signal);
        file.version = joined.version;
        contents.set(file.path, joined.content);
      } catch (error) {
        const message = formatUnknownError(error);
        failures.set(file.path, message);
        this.log(`Could not read remote ${file.path}: ${message}`);
      } finally {
        reportProgress(file.path);
      }
    }

    if (!client && binaries.length > 0) {
      throw new Error('Overleaf client is not available for binary download.');
    }
    await mapWithConcurrency(binaries, 4, async file => {
      try {
        metrics.binaryGetCount += 1;
        const bytes = await client!.downloadProjectFile(manifest.projectId, file.entityId, signal);
        contents.set(file.path, bytes);
      } catch (error) {
        const message = formatUnknownError(error);
        failures.set(file.path, message);
        this.log(`Could not read remote ${file.path}: ${message}`);
      } finally {
        reportProgress(file.path);
      }
    });

    return {
      manifest: indexed.manifest,
      contents,
      failures,
      reused,
      metrics
    };
  }

  private async fetchFreshRemoteSnapshot(paths?: Iterable<string>, progress?: SyncProgress): Promise<RemoteSnapshot> {
    this.requireReady();
    const manifest = await readManifest(this.root!);
    const session = await this.client!.connectSocket(manifest.projectId);
    try {
      return await this.fetchRemoteSnapshot(manifest, session, this.client!, progress, { mode: 'full', paths });
    } finally {
      session.disconnect();
    }
  }

  private checkTargeted(paths: Iterable<string>, reason: string): Promise<SyncStatusReport> {
    return this.checkSyncStatus(this.root, this.client, undefined, {
      mode: 'incremental',
      paths,
      reason
    });
  }

  private async initializeDocStatesFromRemote(remote: RemoteSnapshot): Promise<void> {
    this.requireReady();
    for (const [relPath, remoteFile] of Object.entries(remote.manifest.files)) {
      if (remoteFile.entityType !== 'doc') {
        continue;
      }
      const content = remote.contents.get(relPath);
      if (typeof content !== 'string') {
        continue;
      }
      const localContent = await fs.readFile(this.abs(relPath), 'utf8').catch(() => content);
      this.docStates.set(relPath, {
        relPath,
        docId: remoteFile.entityId,
        version: remoteFile.version ?? this.manifest!.files[relPath]?.version ?? 0,
        localCache: localContent,
        remoteCache: content
      });
      if (this.manifest!.files[relPath]) {
        this.manifest!.files[relPath].version = remoteFile.version;
      }
    }
    await this.persistManifest();
  }

  private async joinDocState(relPath: string, docId: string): Promise<DocState> {
    const joined = await this.session!.joinDoc(docId);
    const state: DocState = {
      relPath,
      docId,
      version: joined.version,
      localCache: joined.content,
      remoteCache: joined.content
    };
    this.docStates.set(relPath, state);
    return state;
  }

  private scheduleSyncStatusCheck(delayMs?: number, paths?: Iterable<string>): void {
    if (!this.root || !this.client || !this.session) {
      return;
    }
    const normalizedPaths = paths ? [...paths].map(toPosixPath) : undefined;
    const paused = this.syncStatusReport?.items.some(item => item.blocking) ?? false;
    this.checkScheduler.schedule({
      mode: 'incremental',
      paths: normalizedPaths,
      reason: 'background-refresh'
    }, delayMs ?? (paused ? 5000 : 1500));
  }

  private updateSyncStatusBar(): void {
    if (!this.session) {
      this.status.text = '$(cloud) Overleaf';
      this.status.tooltip = 'Overleaf Codex realtime sync stopped';
      return;
    }
    const blocking = this.syncStatusReport?.items.filter(item => item.blocking).length ?? 0;
    if (this.syncGate.project === 'checking') {
      this.status.text = '$(sync~spin) Overleaf';
      this.status.tooltip = 'Checking Overleaf Codex sync status';
      return;
    }
    if (this.syncGate.project !== 'ready') {
      this.status.text = '$(debug-disconnect) Overleaf';
      this.status.tooltip = this.syncGate.reason ?? `Overleaf sync is ${this.syncGate.project}.`;
      return;
    }
    if (blocking > 0) {
      this.status.text = `$(warning) Overleaf ${blocking}`;
      this.status.tooltip = `${blocking} path(s) need review; unaffected files continue syncing.`;
      return;
    }
    this.status.text = '$(sync) Overleaf';
    this.status.tooltip = 'Overleaf Codex realtime sync is clean and automatic upload is enabled';
  }

  private async handleSocketDisconnected(reason: string): Promise<void> {
    if (this.stopping || !this.shouldReconnect) {
      return;
    }
    this.syncGate.setProject('reconnecting', reason);
    this.status.text = '$(debug-disconnect) Overleaf';
    this.status.tooltip = reason;
    this.status.show();
    this.watcher?.dispose();
    this.watcher = undefined;
    this.log(reason);
    this.statusChanged.fire();
    this.syncStatusChanged.fire();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.root || !this.client || !this.shouldReconnect) {
      return;
    }
    if (this.reconnectTimer) {
      return;
    }
    const delay = Math.min(60000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      const root = this.root;
      const client = this.client;
      if (!root || !client || !this.shouldReconnect) {
        return;
      }
      void this.start(root, client).catch(error => {
        this.log(`Reconnect failed: ${formatUnknownError(error)}`);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private async handleVsCodeRenames(event: vscode.FileRenameEvent): Promise<void> {
    if (!this.root || !this.manifest || !this.session) return;
    for (const file of event.files) {
      const oldPath = toPosixPath(path.relative(this.root, file.oldUri.fsPath));
      const newPath = toPosixPath(path.relative(this.root, file.newUri.fsPath));
      if (!oldPath || !newPath || oldPath.startsWith('..') || newPath.startsWith('..')) continue;
      this.cancelPathTimer(oldPath);
      this.cancelPathTimer(newPath);
      this.renameDetector.forget(oldPath);
      this.renameDetector.forget(newPath);
      await this.handleLocalRename(oldPath, newPath);
    }
  }

  private async handleLocalRename(oldPath: string, newPath: string): Promise<void> {
    this.requireReady();
    const normalizedOld = toPosixPath(oldPath);
    const normalizedNew = toPosixPath(newPath);
    if (normalizedOld === normalizedNew) return;
    if (!this.syncGate.canSync(normalizedOld)) {
      throw new Error(`Cannot rename ${normalizedOld} while that path is paused.`);
    }
    const file: ManifestFile | undefined = this.manifest!.files[normalizedOld];
    const folder: ManifestFolder | undefined = this.manifest!.folders[normalizedOld];
    if (!file && !folder) return;
    const targetFile: ManifestFile | undefined = this.manifest!.files[normalizedNew];
    const targetFolder: ManifestFolder | undefined = this.manifest!.folders[normalizedNew];
    if (targetFile || targetFolder) {
      const reason = `Cannot rename ${normalizedOld} to ${normalizedNew}; the target already exists on Overleaf.`;
      this.syncGate.setPath(normalizedOld, 'pending', reason);
      this.syncGate.setPath(normalizedNew, 'pending', reason);
      throw new Error(reason);
    }
    if (folder && normalizedNew.startsWith(`${normalizedOld}/`)) {
      throw new Error(`Cannot move ${normalizedOld} inside itself.`);
    }
    if (file && (isTextLike(normalizedNew) ? 'doc' : 'file') !== file.entityType) {
      const reason = `Renaming ${normalizedOld} to ${normalizedNew} would change its Overleaf entity type.`;
      this.syncGate.setPath(normalizedOld, 'pending', reason);
      this.syncGate.setPath(normalizedNew, 'pending', reason);
      throw new Error(reason);
    }

    const ensured = await this.ensureRemoteParentFolders(normalizedNew);
    const entity = file ?? folder!;
    const entityType = file?.entityType ?? 'folder';
    const oldParentFolderId = entity.parentFolderId;
    if (!oldParentFolderId) {
      await this.rollbackCreatedRemoteFolders(ensured.created);
      throw new Error(`Cannot rename the Overleaf project root folder.`);
    }
    try {
      await this.performRemotePathChange(
        entityType,
        entity.entityId,
        oldParentFolderId,
        ensured.parentFolderId,
        path.posix.basename(normalizedOld),
        path.posix.basename(normalizedNew)
      );
    } catch (error) {
      await this.rollbackCreatedRemoteFolders(ensured.created);
      const reason = `Remote rename/move failed for ${normalizedOld}; no delete/create fallback was used.`;
      this.syncGate.setPath(normalizedOld, 'error', reason, Boolean(folder));
      throw error;
    }

    if (file) {
      await this.remapFilePath(normalizedOld, normalizedNew, ensured.parentFolderId);
    } else {
      await this.remapFolderPath(normalizedOld, normalizedNew, false);
      const moved: ManifestFolder | undefined = this.manifest!.folders[normalizedNew];
      if (moved) moved.parentFolderId = ensured.parentFolderId;
    }
    await this.persistManifest();
    this.log(`Renamed/moved ${normalizedOld} to ${normalizedNew} on Overleaf.`);
    this.scheduleSyncStatusCheck(100, [normalizedOld, normalizedNew]);
  }

  private async performRemotePathChange(
    entityType: 'doc' | 'file' | 'folder',
    entityId: string,
    oldParentFolderId: string,
    newParentFolderId: string,
    oldName: string,
    newName: string
  ): Promise<void> {
    const renamed = oldName !== newName;
    const moved = oldParentFolderId !== newParentFolderId;
    if (!renamed && !moved) return;
    if (!renamed) {
      this.markLocalMutation(entityId);
      await this.client!.moveEntity(this.manifest!.projectId, entityType, entityId, newParentFolderId);
      return;
    }
    if (!moved) {
      this.markLocalMutation(entityId);
      await this.client!.renameEntity(this.manifest!.projectId, entityType, entityId, newName);
      return;
    }

    const tempName = transactionName(newName, `move-${Date.now()}`);
    this.markLocalMutation(entityId);
    await this.client!.renameEntity(this.manifest!.projectId, entityType, entityId, tempName);
    try {
      this.markLocalMutation(entityId);
      await this.client!.moveEntity(this.manifest!.projectId, entityType, entityId, newParentFolderId);
    } catch (error) {
      this.markLocalMutation(entityId);
      await this.client!.renameEntity(this.manifest!.projectId, entityType, entityId, oldName).catch(() => undefined);
      throw error;
    }
    try {
      this.markLocalMutation(entityId);
      await this.client!.renameEntity(this.manifest!.projectId, entityType, entityId, newName);
    } catch (error) {
      this.markLocalMutation(entityId);
      await this.client!.moveEntity(this.manifest!.projectId, entityType, entityId, oldParentFolderId).catch(() => undefined);
      this.markLocalMutation(entityId);
      await this.client!.renameEntity(this.manifest!.projectId, entityType, entityId, oldName).catch(() => undefined);
      throw error;
    }
  }

  private async remapFilePath(oldPath: string, newPath: string, parentFolderId: string): Promise<void> {
    const file = this.manifest!.files[oldPath];
    delete this.manifest!.files[oldPath];
    file.path = newPath;
    file.parentFolderId = parentFolderId;
    this.manifest!.files[newPath] = file;
    const state = this.docStates.get(oldPath);
    if (state) {
      this.docStates.delete(oldPath);
      state.relPath = newPath;
      this.docStates.set(newPath, state);
    }
    const bypass = this.bypassHashes.get(oldPath);
    if (bypass) {
      this.bypassHashes.delete(oldPath);
      this.bypassHashes.set(newPath, bypass);
    }
    if (this.manifest!.rootDocPath === oldPath) this.manifest!.rootDocPath = newPath;
    await this.remapRuntimePaths(oldPath, newPath, false);
  }

  private async ensureRemoteParentFolders(relPath: string): Promise<{
    parentFolderId: string;
    created: Array<{ path: string; entityId: string }>;
  }> {
    const parentPath = path.posix.dirname(toPosixPath(relPath));
    const normalizedParent = parentPath === '.' ? '' : parentPath;
    const rootFolder = this.manifest!.folders[''];
    if (!rootFolder) throw new Error('Overleaf project root folder is missing from the manifest.');
    const created: Array<{ path: string; entityId: string }> = [];
    let currentPath = '';
    let parentFolderId = rootFolder.entityId;
    try {
      for (const segment of normalizedParent.split('/').filter(Boolean)) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const existing = this.manifest!.folders[currentPath];
        if (existing) {
          parentFolderId = existing.entityId;
          continue;
        }
        if (this.manifest!.files[currentPath]) {
          throw new Error(`Cannot create remote folder ${currentPath}; a file already uses that path.`);
        }
        const folder = await this.client!.addFolder(this.manifest!.projectId, parentFolderId, segment);
        addOrUpdateFolder(this.manifest!, { path: currentPath, entityId: folder._id, parentFolderId });
        created.push({ path: currentPath, entityId: folder._id });
        parentFolderId = folder._id;
      }
      if (created.length > 0) await this.persistManifest();
      return { parentFolderId, created };
    } catch (error) {
      await this.rollbackCreatedRemoteFolders(created);
      throw error;
    }
  }

  private async rollbackCreatedRemoteFolders(created: Array<{ path: string; entityId: string }>): Promise<void> {
    for (const folder of [...created].reverse()) {
      this.markLocalMutation(folder.entityId);
      await this.client!.deleteEntity(this.manifest!.projectId, 'folder', folder.entityId).catch(() => undefined);
      delete this.manifest!.folders[folder.path];
    }
    if (created.length > 0) await this.persistManifest();
  }

  private async handleLocalChange(relPath: string, kind: LocalChangeKind): Promise<void> {
    this.requireReady();
    if (!this.syncGate.canSync(relPath)) {
      this.scheduleSyncStatusCheck(undefined, [relPath]);
      return;
    }
    if (kind === 'delete') {
      await this.handleLocalDelete(relPath);
      return;
    }

    const absPath = this.abs(relPath);
    const stat = await fs.stat(absPath).catch(() => undefined);
    if (!stat) {
      await this.handleLocalDelete(relPath);
      return;
    }

    if (stat.isDirectory()) {
      await this.handleLocalFolderCreate(relPath);
      return;
    }

    const content = await fs.readFile(absPath);
    const bypassHash = this.bypassHashes.get(relPath);
    const currentHash = sha1(content);
    if (bypassHash && bypassHash === currentHash) {
      this.bypassHashes.delete(relPath);
      return;
    }

    const entry = this.manifest!.files[relPath];
    if (!entry) {
      this.syncGate.setPath(relPath, 'pending', 'New local file is waiting for explicit Push Local.');
      this.log(`New local file ${relPath} is waiting for explicit Push Local.`);
      this.scheduleSyncStatusCheck(undefined, [relPath]);
      return;
    }

    if (entry.entityType === 'doc') {
      await this.syncDocContent(relPath, Buffer.from(content).toString('utf8'));
      return;
    }

    await this.replaceBinaryFile(relPath, content, entry);
  }

  private async handleLocalFolderCreate(relPath: string): Promise<void> {
    if (!this.manifest!.folders[relPath]) {
      this.log(`Keeping empty local directory ${relPath} local-only until a file inside it is pushed.`);
    }
  }

  private async handleLocalFileCreate(relPath: string, content: Uint8Array, manual = false): Promise<void> {
    if (!isTextLike(relPath) && !await this.canUploadBinaryFile(relPath, manual, 'Upload')) {
      this.log(`Skipped binary upload for ${relPath}. Enable overleafCodex.syncBinaryFiles to upload binary files.`);
      return;
    }
    const ensured = await this.ensureRemoteParentFolders(relPath);
    if (isTextLike(relPath)) {
      let doc: OverleafDoc;
      try {
        doc = await this.client!.addDoc(this.manifest!.projectId, ensured.parentFolderId, path.posix.basename(relPath));
      } catch (error) {
        await this.rollbackCreatedRemoteFolders(ensured.created);
        throw error;
      }
      const entry: ManifestFile = {
        path: relPath,
        entityId: doc._id,
        entityType: 'doc',
        parentFolderId: ensured.parentFolderId,
        binary: false
      };
      addOrUpdateFile(this.manifest!, entry, content);
      await this.persistManifest();
      await this.syncDocContent(relPath, Buffer.from(content).toString('utf8'));
      return;
    }
    let file: OverleafFileRef;
    try {
      file = await this.client!.uploadFile(this.manifest!.projectId, ensured.parentFolderId, path.posix.basename(relPath), content);
    } catch (error) {
      await this.rollbackCreatedRemoteFolders(ensured.created);
      throw error;
    }
    addOrUpdateFile(this.manifest!, {
      path: relPath,
      entityId: file._id,
      entityType: 'file',
      parentFolderId: ensured.parentFolderId,
      binary: true
    }, content);
    await this.persistManifest();
    if (manual) {
      vscode.window.showInformationMessage(`Uploaded ${relPath} to Overleaf.`);
    }
  }

  private async handleLocalDelete(relPath: string): Promise<void> {
    if (!this.canSyncDestructiveChanges()) {
      this.log(`Skipped remote delete for ${relPath}. Enable overleafCodex.syncDestructiveChanges to delete Overleaf entities from local deletes.`);
      this.syncGate.setPath(relPath, 'pending', 'Local deletion is waiting for explicit confirmation.');
      this.scheduleSyncStatusCheck(undefined, [relPath]);
      return;
    }

    const file = this.manifest!.files[relPath];
    if (file) {
      this.markLocalMutation(file.entityId);
      await this.client!.deleteEntity(this.manifest!.projectId, file.entityType, file.entityId);
      delete this.manifest!.files[relPath];
      this.docStates.delete(relPath);
      this.documentSessions.delete(file.entityId);
      await this.persistManifest();
      return;
    }

    const folder = this.manifest!.folders[relPath];
    if (folder) {
      this.markLocalMutation(folder.entityId);
      await this.client!.deleteEntity(this.manifest!.projectId, 'folder', folder.entityId);
      delete this.manifest!.folders[relPath];
      await this.persistManifest();
    }
  }

  private async replaceBinaryFile(relPath: string, content: Uint8Array, entry: ManifestFile, manual = false): Promise<void> {
    if (!await this.canUploadBinaryFile(relPath, manual, 'Replace')) {
      this.log(`Skipped binary replacement for ${relPath}. Enable overleafCodex.syncBinaryFiles to replace binary files.`);
      return;
    }

    const expectedBlobHash = gitBlobHash(content);
    this.markLocalMutation(entry.entityId);
    let uploaded;
    try {
      uploaded = await this.client!.uploadFile(
        this.manifest!.projectId,
        entry.parentFolderId,
        path.posix.basename(relPath),
        content
      );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'duplicate_file_name') {
        uploaded = await this.replaceBinaryWithFallbackTransaction(relPath, content, entry, expectedBlobHash);
      } else if (await this.reconcileAmbiguousBinaryUpload(relPath, content)) {
        if (manual) vscode.window.showInformationMessage(`Replaced Overleaf version of ${relPath}.`);
        return;
      } else {
        throw error;
      }
    }

    this.markLocalMutation(uploaded._id);
    if (uploaded.hash && uploaded.hash !== expectedBlobHash) {
      throw new Error(`Overleaf returned an unexpected content hash while replacing ${relPath}.`);
    }
    if (!uploaded.hash) {
      const downloaded = await this.client!.downloadProjectFile(this.manifest!.projectId, uploaded._id);
      if (gitBlobHash(downloaded) !== expectedBlobHash) {
        throw new Error(`Could not verify the uploaded content for ${relPath}.`);
      }
    }
    addOrUpdateFile(this.manifest!, {
      ...entry,
      entityId: uploaded._id,
      remoteBlobHash: uploaded.hash ?? expectedBlobHash
    }, content);
    await this.persistManifest();
    if (manual) {
      vscode.window.showInformationMessage(`Replaced Overleaf version of ${relPath}.`);
    }
  }

  private async replaceBinaryWithFallbackTransaction(
    relPath: string,
    content: Uint8Array,
    entry: ManifestFile,
    expectedBlobHash: string
  ): Promise<{ _id: string; name: string; hash?: string }> {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const finalName = path.posix.basename(relPath);
    const tempName = transactionName(finalName, `upload-${id}`);
    const backupName = transactionName(finalName, `backup-${id}`);
    const temporary = await this.client!.uploadFile(this.manifest!.projectId, entry.parentFolderId, tempName, content);
    const verified = temporary.hash === expectedBlobHash
      || gitBlobHash(await this.client!.downloadProjectFile(this.manifest!.projectId, temporary._id)) === expectedBlobHash;
    if (!verified) {
      await this.client!.deleteEntity(this.manifest!.projectId, 'file', temporary._id).catch(() => undefined);
      throw new Error(`Could not verify temporary upload for ${relPath}.`);
    }
    const transaction: BinaryTransaction = {
      id,
      path: relPath,
      parentFolderId: entry.parentFolderId,
      finalName,
      tempName,
      backupName,
      originalEntityId: entry.entityId,
      tempEntityId: temporary._id,
      expectedBlobHash,
      stage: 'temp-uploaded',
      createdAt: new Date().toISOString()
    };
    await this.binaryTransactions!.upsert(transaction);
    this.markLocalMutation(entry.entityId);
    this.markLocalMutation(temporary._id);
    try {
      await this.client!.renameEntity(this.manifest!.projectId, 'file', entry.entityId, backupName);
      transaction.stage = 'original-backed-up';
      await this.binaryTransactions!.upsert(transaction);
      await this.client!.renameEntity(this.manifest!.projectId, 'file', temporary._id, finalName);
      transaction.stage = 'promoted';
      await this.binaryTransactions!.upsert(transaction);
      await this.client!.deleteEntity(this.manifest!.projectId, 'file', entry.entityId).catch(error => {
        this.log(`Could not clean binary backup ${backupName}: ${formatUnknownError(error)}`);
      });
      await this.binaryTransactions!.remove(transaction.id);
      return { _id: temporary._id, name: finalName, hash: temporary.hash ?? expectedBlobHash };
    } catch (error) {
      if (transaction.stage === 'original-backed-up') {
        await this.client!.renameEntity(this.manifest!.projectId, 'file', entry.entityId, finalName).catch(() => undefined);
        await this.client!.deleteEntity(this.manifest!.projectId, 'file', temporary._id).catch(() => undefined);
        await this.binaryTransactions!.remove(transaction.id).catch(() => undefined);
      }
      throw error;
    }
  }

  private async reconcileAmbiguousBinaryUpload(relPath: string, content: Uint8Array): Promise<boolean> {
    const remote = await this.fetchFreshRemoteSnapshot([relPath]).catch(() => undefined);
    const remoteFile = remote?.manifest.files[relPath];
    const remoteContent = remote?.contents.get(relPath);
    if (!remoteFile || !(remoteContent instanceof Uint8Array) || gitBlobHash(remoteContent) !== gitBlobHash(content)) {
      return false;
    }
    addOrUpdateFile(this.manifest!, remoteFile, content);
    this.manifest!.files[relPath].remoteBlobHash = remoteFile.remoteBlobHash ?? gitBlobHash(content);
    await this.persistManifest();
    return true;
  }

  private async recoverBinaryTransactions(): Promise<void> {
    const records = await this.binaryTransactions?.list() ?? [];
    for (const transaction of records) {
      this.markLocalMutation(transaction.originalEntityId);
      this.markLocalMutation(transaction.tempEntityId);
      try {
        if (transaction.stage === 'temp-uploaded') {
          await this.client!.deleteEntity(this.manifest!.projectId, 'file', transaction.tempEntityId).catch(() => undefined);
        } else if (transaction.stage === 'original-backed-up') {
          await this.client!.renameEntity(this.manifest!.projectId, 'file', transaction.originalEntityId, transaction.finalName);
          await this.client!.deleteEntity(this.manifest!.projectId, 'file', transaction.tempEntityId).catch(() => undefined);
        } else {
          await this.client!.deleteEntity(this.manifest!.projectId, 'file', transaction.originalEntityId).catch(() => undefined);
          const entry = this.manifest!.files[transaction.path];
          if (entry) {
            entry.entityId = transaction.tempEntityId;
            entry.remoteBlobHash = transaction.expectedBlobHash;
          }
        }
        await this.binaryTransactions!.remove(transaction.id);
      } catch (error) {
        this.log(`Could not recover binary transaction ${transaction.id}: ${formatUnknownError(error)}`);
      }
    }
    if (records.length > 0) await this.persistManifest();
  }

  private async syncDocContent(relPath: string, content: string, force = false): Promise<void> {
    const state = await this.ensureDocState(relPath);
    if (state.paused || (!force && content === state.localCache)) {
      return;
    }

    const result = await this.documentSessionFor(state).submitLocal(content);
    if (result.conflictRemote !== undefined) {
      await this.pauseForConflict(
        relPath,
        result.conflictRemote,
        'Could not reconcile local edits after an ambiguous or concurrent Overleaf update.'
      );
      return;
    }
    if (result.content !== content) {
      await this.writeLocalFile(relPath, Buffer.from(result.content, 'utf8'), true);
    }
    if (!result.changed) {
      return;
    }
    this.manifest!.files[relPath].version = state.version;
    addOrUpdateFile(this.manifest!, this.manifest!.files[relPath], result.content);
    this.manifest!.files[relPath].baseHash = await writeBaseDoc(this.root!, state.docId, result.content);
    await this.persistManifest();
    this.syncGate.clearPath(relPath);
    this.log(`Pushed ${relPath} to Overleaf.`);
  }

  private async handleRemoteUpdate(update: OtUpdate): Promise<void> {
    if (this.syncGate.project !== 'ready') {
      this.scheduleSyncStatusCheck();
      return;
    }
    const relPath = Object.values(this.manifest!.files)
      .find(file => file.entityType === 'doc' && file.entityId === update.doc)?.path;
    if (!relPath) {
      return;
    }
    if (!this.syncGate.canSync(relPath)) {
      this.scheduleSyncStatusCheck(5000, [relPath]);
      return;
    }

    const state = await this.ensureDocState(relPath);
    let remoteNext: string;
    try {
      remoteNext = await this.documentSessionFor(state).applyRemote(update);
    } catch {
      await this.resyncOrConflict(relPath, 'Remote version changed unexpectedly.');
      return;
    }
    const localContent = await fs.readFile(this.abs(relPath), 'utf8').catch(() => state.localCache);

    if (localContent === state.localCache) {
      state.localCache = remoteNext;
      await this.writeLocalFile(relPath, Buffer.from(remoteNext, 'utf8'), true);
      this.manifest!.files[relPath].version = state.version;
      addOrUpdateFile(this.manifest!, this.manifest!.files[relPath], remoteNext);
      this.manifest!.files[relPath].baseHash = await writeBaseDoc(this.root!, state.docId, remoteNext);
      await this.persistManifest();
      return;
    }

    const merge = mergeRemoteIntoLocal(state.localCache, remoteNext, localContent);
    if (!merge.clean) {
      await this.pauseForConflict(relPath, remoteNext, 'Could not merge incoming Overleaf edits with local edits.');
      return;
    }

    state.localCache = remoteNext;
    await this.writeLocalFile(relPath, Buffer.from(merge.content, 'utf8'), true);
    await this.syncDocContent(relPath, merge.content);
  }

  private async handleRemoteCreated(parentFolderId: string, kind: 'doc' | 'file', entity: OverleafDoc | OverleafFileRef): Promise<void> {
    if (this.syncGate.project !== 'ready') {
      this.scheduleSyncStatusCheck();
      return;
    }
    const parentPath = folderPathById(this.manifest!, parentFolderId);
    if (parentPath === undefined) {
      await this.resyncOrConflict('', 'Remote create used an unknown parent folder.');
      return;
    }
    const relPath = path.posix.join(parentPath, entity.name);
    if (!this.syncGate.canSync(relPath)) {
      this.scheduleSyncStatusCheck(5000, [relPath]);
      return;
    }
    if (this.manifest!.files[relPath]) {
      return;
    }

    if (kind === 'doc') {
      const doc = await this.session!.joinDoc(entity._id);
      addOrUpdateFile(this.manifest!, {
        path: relPath,
        entityId: entity._id,
        entityType: 'doc',
        parentFolderId,
        version: doc.version,
        binary: false
      }, doc.content);
      const added = this.manifest!.files[relPath] as ManifestFile;
      added.baseHash = await writeBaseDoc(this.root!, entity._id, doc.content);
      await this.writeLocalFile(relPath, Buffer.from(doc.content, 'utf8'), true);
      await this.session!.leaveDoc(entity._id).catch(() => undefined);
    } else {
      const content = await this.client!.downloadProjectFile(this.manifest!.projectId, entity._id);
      addOrUpdateFile(this.manifest!, {
        path: relPath,
        entityId: entity._id,
        entityType: 'file',
        parentFolderId,
        binary: true
      }, content);
      await this.writeLocalFile(relPath, content, true);
    }

    await this.persistManifest();
  }

  private async handleRemoteFolderCreated(parentFolderId: string, folder: OverleafFolder): Promise<void> {
    if (this.syncGate.project !== 'ready') {
      this.scheduleSyncStatusCheck();
      return;
    }
    const parentPath = folderPathById(this.manifest!, parentFolderId);
    if (parentPath === undefined) {
      return;
    }
    const relPath = path.posix.join(parentPath, folder.name);
    if (!this.syncGate.canSync(relPath)) {
      this.scheduleSyncStatusCheck(5000, [relPath]);
      return;
    }
    addOrUpdateFolder(this.manifest!, {
      path: relPath,
      entityId: folder._id,
      parentFolderId
    });
    await fs.mkdir(this.abs(relPath), { recursive: true });
    await this.persistManifest();
  }

  private async handleRemoteRenamed(entityId: string, newName: string): Promise<void> {
    if (this.consumeLocalMutation(entityId)) return;
    if (this.syncGate.project !== 'ready') {
      this.scheduleSyncStatusCheck();
      return;
    }
    const oldPath = filePathById(this.manifest!, entityId);
    if (oldPath) {
      if (!this.syncGate.canSync(oldPath)) {
        this.scheduleSyncStatusCheck(5000, [oldPath]);
        return;
      }
      const file = this.manifest!.files[oldPath];
      const newPath = path.posix.join(path.posix.dirname(oldPath), newName).replace(/^\.\//, '');
      delete this.manifest!.files[oldPath];
      file.path = newPath;
      this.manifest!.files[newPath] = file;
      await this.renameLocal(oldPath, newPath);
      await this.persistManifest();
      return;
    }

    const folder = Object.values(this.manifest!.folders).find(item => item.entityId === entityId);
    if (folder) {
      const newPath = path.posix.join(path.posix.dirname(folder.path), newName).replace(/^\.\//, '');
      await this.remapFolderPath(folder.path, newPath);
    }
  }

  private async handleRemoteMoved(entityId: string, newParentFolderId: string): Promise<void> {
    if (this.consumeLocalMutation(entityId)) return;
    if (this.syncGate.project !== 'ready') {
      this.scheduleSyncStatusCheck();
      return;
    }
    const parentPath = folderPathById(this.manifest!, newParentFolderId);
    if (parentPath === undefined) {
      return;
    }

    const oldPath = filePathById(this.manifest!, entityId);
    if (oldPath) {
      if (!this.syncGate.canSync(oldPath)) {
        this.scheduleSyncStatusCheck(5000, [oldPath]);
        return;
      }
      const file = this.manifest!.files[oldPath];
      const newPath = path.posix.join(parentPath, path.posix.basename(oldPath));
      delete this.manifest!.files[oldPath];
      file.path = newPath;
      file.parentFolderId = newParentFolderId;
      this.manifest!.files[newPath] = file;
      await this.renameLocal(oldPath, newPath);
      await this.persistManifest();
      return;
    }

    const folder = Object.values(this.manifest!.folders).find(item => item.entityId === entityId);
    if (folder) {
      await this.remapFolderPath(folder.path, path.posix.join(parentPath, path.posix.basename(folder.path)));
    }
  }

  private async handleRemoteRemoved(entityId: string): Promise<void> {
    if (this.consumeLocalMutation(entityId)) {
      return;
    }
    if (this.syncGate.project !== 'ready') {
      this.scheduleSyncStatusCheck();
      return;
    }
    const oldPath = filePathById(this.manifest!, entityId);
    if (oldPath) {
      if (!this.syncGate.canSync(oldPath)) {
        this.scheduleSyncStatusCheck(5000, [oldPath]);
        return;
      }
      delete this.manifest!.files[oldPath];
      this.docStates.delete(oldPath);
      await this.moveLocalToTrash(oldPath);
      await this.persistManifest();
      return;
    }

    const folder = Object.values(this.manifest!.folders).find(item => item.entityId === entityId);
    if (folder && folder.path) {
      delete this.manifest!.folders[folder.path];
      await this.moveLocalToTrash(folder.path);
      await this.persistManifest();
    }
  }

  private async ensureDocState(relPath: string): Promise<DocState> {
    const existing = this.docStates.get(relPath);
    if (existing) {
      return existing;
    }

    const file = this.manifest!.files[relPath];
    if (!file || file.entityType !== 'doc') {
      throw new Error(`${relPath} is not an Overleaf document.`);
    }
    const joined = await this.session!.joinDoc(file.entityId);
    const state: DocState = {
      relPath,
      docId: file.entityId,
      version: joined.version,
      localCache: joined.content,
      remoteCache: joined.content
    };
    this.docStates.set(relPath, state);
    this.manifest!.files[relPath].version = joined.version;
    return state;
  }

  private documentSessionFor(state: DocState): OtDocumentSession {
    const existing = this.documentSessions.get(state.docId);
    if (existing && existing.state === state) {
      return existing;
    }
    if (!this.session) {
      throw new Error('Realtime sync is not running.');
    }
    const session = new OtDocumentSession(state, this.session);
    this.documentSessions.set(state.docId, session);
    return session;
  }

  private async restoreConflicts(): Promise<void> {
    const conflicts = await this.conflictStore?.list() ?? [];
    for (const conflict of conflicts) {
      const state = this.docStates.get(conflict.relPath);
      const snapshotExists = await fs.stat(conflict.remotePath).then(() => true, () => false);
      if (!state || state.docId !== conflict.docId || !snapshotExists) {
        await this.conflictStore?.remove(conflict.relPath);
        continue;
      }
      const remoteContent = await fs.readFile(conflict.remotePath, 'utf8');
      state.version = Math.max(state.version, conflict.remoteVersion);
      state.remoteCache = remoteContent;
      state.paused = true;
      state.conflictPath = conflict.remotePath;
      state.conflictReason = conflict.reason;
      this.syncGate.setPath(conflict.relPath, 'conflict', conflict.reason);
    }
    if (conflicts.length > 0) {
      this.conflictsChanged.fire();
    }
  }

  private async resyncOrConflict(relPath: string, reason: string): Promise<void> {
    if (!relPath) {
      this.log(reason);
      return;
    }
    const state = await this.ensureDocState(relPath);
    const joined = await this.session!.joinDoc(state.docId);
    const localContent = await fs.readFile(this.abs(relPath), 'utf8').catch(() => '');
    if (localContent === state.localCache) {
      state.version = joined.version;
      state.remoteCache = joined.content;
      state.localCache = joined.content;
      await this.writeLocalFile(relPath, Buffer.from(joined.content, 'utf8'), true);
      this.manifest!.files[relPath].version = joined.version;
      addOrUpdateFile(this.manifest!, this.manifest!.files[relPath], joined.content);
      this.manifest!.files[relPath].baseHash = await writeBaseDoc(this.root!, state.docId, joined.content);
      await this.persistManifest();
      return;
    }
    await this.pauseForConflict(relPath, joined.content, reason);
  }

  private async pauseForConflict(relPath: string, remoteContent: string, reason: string): Promise<void> {
    const state = this.docStates.get(relPath);
    if (state) {
      state.paused = true;
    }
    const conflictPath = metadataPath(this.root!, 'conflicts', `${relPath.replace(/[\/\\]/g, '__')}.remote.${Date.now()}.tex`);
    await atomicWriteText(conflictPath, remoteContent);
    if (state) {
      state.conflictPath = conflictPath;
      state.conflictReason = reason;
      await this.conflictStore?.upsert({
        relPath,
        docId: state.docId,
        remoteVersion: state.version,
        remotePath: conflictPath,
        reason,
        createdAt: new Date().toISOString()
      });
    }
    this.syncGate.setPath(relPath, 'conflict', reason);
    this.updateSyncStatusBar();
    this.log(`${reason} Sync paused for ${relPath}.`);
    this.conflictsChanged.fire();
    await this.openConflictDiff(relPath);
  }

  private async remapFolderPath(oldPath: string, newPath: string, renameLocalFs = true): Promise<void> {
    const oldPrefix = oldPath ? `${oldPath}/` : '';
    const newPrefix = newPath ? `${newPath}/` : '';
    const oldAbs = this.abs(oldPath);
    const newAbs = this.abs(newPath);

    for (const folder of Object.values(this.manifest!.folders)) {
      if (folder.path === oldPath || folder.path.startsWith(oldPrefix)) {
        delete this.manifest!.folders[folder.path];
        folder.path = folder.path === oldPath ? newPath : `${newPrefix}${folder.path.slice(oldPrefix.length)}`;
        this.manifest!.folders[folder.path] = folder;
      }
    }

    for (const file of Object.values(this.manifest!.files)) {
      if (file.path.startsWith(oldPrefix)) {
        delete this.manifest!.files[file.path];
        file.path = `${newPrefix}${file.path.slice(oldPrefix.length)}`;
        this.manifest!.files[file.path] = file;
      }
    }
    await this.remapRuntimePaths(oldPath, newPath, true);
    if (renameLocalFs) {
      await fs.mkdir(path.dirname(newAbs), { recursive: true });
      await fs.rename(oldAbs, newAbs).catch(async () => {
        await fs.mkdir(newAbs, { recursive: true });
      });
    }
    await this.persistManifest();
  }

  private async remapRuntimePaths(oldPath: string, newPath: string, subtree: boolean): Promise<void> {
    const oldPrefix = `${oldPath}/`;
    for (const [statePath, state] of [...this.docStates]) {
      if (statePath !== oldPath && !(subtree && statePath.startsWith(oldPrefix))) continue;
      const nextPath = statePath === oldPath ? newPath : `${newPath}/${statePath.slice(oldPrefix.length)}`;
      this.docStates.delete(statePath);
      state.relPath = nextPath;
      this.docStates.set(nextPath, state);
    }
    for (const [bypassPath, hash] of [...this.bypassHashes]) {
      if (bypassPath !== oldPath && !(subtree && bypassPath.startsWith(oldPrefix))) continue;
      const nextPath = bypassPath === oldPath ? newPath : `${newPath}/${bypassPath.slice(oldPrefix.length)}`;
      this.bypassHashes.delete(bypassPath);
      this.bypassHashes.set(nextPath, hash);
    }
    if (this.manifest!.rootDocPath === oldPath || (subtree && this.manifest!.rootDocPath?.startsWith(oldPrefix))) {
      this.manifest!.rootDocPath = this.manifest!.rootDocPath === oldPath
        ? newPath
        : `${newPath}/${this.manifest!.rootDocPath!.slice(oldPrefix.length)}`;
    }
    this.syncGate.remapPath(oldPath, newPath, subtree);
    await this.conflictStore?.remap(oldPath, newPath, subtree);
    if (this.syncStatusReport) {
      for (const item of this.syncStatusReport.items) {
        if (item.path !== oldPath && !(subtree && item.path.startsWith(oldPrefix))) continue;
        const nextPath = item.path === oldPath ? newPath : `${newPath}/${item.path.slice(oldPrefix.length)}`;
        item.path = nextPath;
        if (item.localPath) item.localPath = nextPath;
        if (item.remotePath) item.remotePath = nextPath;
        item.changeKind = path.posix.dirname(oldPath) === path.posix.dirname(newPath) ? 'rename' : 'move';
      }
    }
  }

  private async renameLocal(oldPath: string, newPath: string): Promise<void> {
    const oldAbs = this.abs(oldPath);
    const newAbs = this.abs(newPath);
    await fs.mkdir(path.dirname(newAbs), { recursive: true });
    await fs.rename(oldAbs, newAbs).catch(() => undefined);
  }

  private async moveLocalToTrash(relPath: string): Promise<void> {
    const source = this.abs(relPath);
    const target = trashPathFor(this.root!, relPath);
    const exists = await fs.stat(source).catch(() => undefined);
    if (!exists) {
      return;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target).catch(async () => {
      if (exists.isDirectory()) {
        await fs.cp(source, target, { recursive: true });
        await fs.rm(source, { recursive: true, force: true });
      } else {
        await fs.copyFile(source, target);
        await fs.rm(source, { force: true });
      }
    });
    this.log(`Moved ${relPath} to local trash: ${target}`);
  }

  private async refreshBaseAfterLocalPush(relPath: string): Promise<void> {
    const entry = this.manifest!.files[relPath];
    if (!entry || entry.entityType !== 'doc') {
      return;
    }
    const content = await fs.readFile(this.abs(relPath), 'utf8').catch(() => undefined);
    if (content === undefined) {
      return;
    }
    entry.baseHash = await writeBaseDoc(this.root!, entry.entityId, content);
    addOrUpdateFile(this.manifest!, entry, content);
    await this.persistManifest();
  }

  private async writeLocalFile(relPath: string, content: Uint8Array, bypass: boolean): Promise<void> {
    const absPath = this.abs(relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    if (bypass) {
      this.bypassHashes.set(relPath, sha1(content));
    }
    await fs.writeFile(absPath, content);
  }

  private async persistManifest(): Promise<void> {
    await this.storeFor(this.root!).writeManifest(this.manifest!);
  }

  private storeFor(root: string): ManifestStore {
    if (this.manifestStore?.root === root) {
      return this.manifestStore;
    }
    return new ManifestStore(root);
  }

  private abs(relPath: string): string {
    return path.join(this.root!, relPath);
  }

  private requireReady(): void {
    if (!this.root || !this.client || !this.manifest || !this.session) {
      throw new Error('Realtime sync is not running.');
    }
  }

  private assertGeneration(generation: number, signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('Operation cancelled.');
    }
    if (generation !== this.generation || this.stopping) {
      throw new Error('Realtime sync operation was superseded.');
    }
  }

  private canSyncBinaryFiles(): boolean {
    return getWithLegacyFallback(
      vscode.workspace.getConfiguration('latexEditingToolkit.overleaf'),
      'syncBinaryFiles',
      vscode.workspace.getConfiguration('overleafCodex'),
      'syncBinaryFiles',
      false
    );
  }

  private canSyncToolkitOverrides(): boolean {
    return getWithLegacyFallback(
      vscode.workspace.getConfiguration('latexEditingToolkit.overleaf'),
      'syncToolkitOverrides',
      vscode.workspace.getConfiguration('overleafCodex'),
      'syncToolkitOverrides',
      true
    );
  }

  private canAutoPushLocalAhead(): boolean {
    return getWithLegacyFallback(
      vscode.workspace.getConfiguration('latexEditingToolkit.overleaf'),
      'autoPushLocalAhead',
      vscode.workspace.getConfiguration('overleafCodex'),
      'autoPushLocalAhead',
      true
    );
  }

  private async canUploadBinaryFile(relPath: string, manual: boolean, verb: 'Upload' | 'Replace'): Promise<boolean> {
    if (this.canSyncBinaryFiles()) {
      return true;
    }
    if (!manual) {
      return false;
    }

    const selection = await vscode.window.showWarningMessage(
      `${verb} binary file ${relPath} to Overleaf? Binary auto-sync is disabled, so this will only push this file once.`,
      { modal: true },
      `${verb} Once`
    );
    return selection === `${verb} Once`;
  }

  private canSyncDestructiveChanges(): boolean {
    return getWithLegacyFallback(
      vscode.workspace.getConfiguration('latexEditingToolkit.overleaf'),
      'syncDestructiveChanges',
      vscode.workspace.getConfiguration('overleafCodex'),
      'syncDestructiveChanges',
      false
    );
  }

  private showError(error: unknown): void {
    const message = formatUnknownError(error);
    this.log(message);
    void vscode.window.showErrorMessage(`Overleaf Codex: ${message}`);
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  private markLocalMutation(entityId: string): void {
    const expirations = this.localMutationIds.get(entityId) ?? [];
    expirations.push(Date.now() + 30_000);
    this.localMutationIds.set(entityId, expirations);
  }

  private consumeLocalMutation(entityId: string): boolean {
    const expirations = (this.localMutationIds.get(entityId) ?? []).filter(expiry => expiry >= Date.now());
    if (expirations.length === 0) {
      this.localMutationIds.delete(entityId);
      return false;
    }
    expirations.shift();
    if (expirations.length > 0) this.localMutationIds.set(entityId, expirations);
    else this.localMutationIds.delete(entityId);
    return true;
  }
}

function transactionName(filename: string, suffix: string): string {
  const ext = path.posix.extname(filename);
  const stem = path.posix.basename(filename, ext);
  const marker = `.overleaf-codex-${suffix}`;
  const maxStem = Math.max(1, 150 - ext.length - marker.length);
  return `${stem.slice(0, maxStem)}${marker}${ext}`;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await handler(item);
    }
  });
  await Promise.all(workers);
}

function isAlwaysLocal(relPath: string): boolean {
  return [
    '.overleaf-codex/',
    '.vscode/'
  ].some(prefix => relPath === prefix.slice(0, -1) || relPath.startsWith(prefix))
    || relPath === LOCAL_IGNORE_NAME
    || /(^|\/)\.vscode(\/|$)/.test(relPath)
    || /(^|\/)\.gitignore$/.test(relPath)
    || /(^|\/)\.latexmkrc$/.test(relPath)
    || /(^|\/)\.DS_Store$/.test(relPath);
}
