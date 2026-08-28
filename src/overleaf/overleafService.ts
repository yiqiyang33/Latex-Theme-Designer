import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Socket } from "node:net";
import * as vscode from "vscode";
import { CompileDiagnosticProvider } from "./diagnostics";
import { CompileService } from "./compileService";
import { manifestPath, readManifest, OUTPUT_DIR } from "./manifest";
import { latestRemotePdf } from './compileCore';
import { MirrorManager, type LocalMirrorRecord } from "./mirrorManager";
import { OverleafClient, OverleafHttpError } from "./overleafClient";
import { RealtimeSyncService, type ConflictInfo, type SyncActivityEntry } from "./realtimeSync";
import { SecretStore } from "./secretStore";
import { getWithLegacyFallback } from "./config";
import { firstWorkspaceMirrorRoot, pathIsWithin, resolveMirrorRootForPath, workspaceContainsPath } from "./mirrorRoots";
import type { Identity, NetworkTimeouts, ProjectSummary, SyncStatusItem, SyncStatusReport } from "./types";
import { formatUnknownError, normalizeServerUrl } from "./util";
import { SyncOwnerCoordinator } from "./syncOwnerCoordinator";
import { executeSyncCommand, syncOperationRequiresForce, type SyncCommandBackend } from "./syncCommandCore";
import type { ProjectSyncGate } from "./syncGate";

export interface OverleafState {
  available: boolean;
  authenticated: boolean;
  serverUrl?: string;
  projectId?: string;
  projectName?: string;
  mirrorRoot?: string;
  rootDocument?: string;
  running: boolean;
  syncStatus?: SyncStatusReport;
  syncItems: SyncStatusItem[];
  conflicts: ConflictInfo[];
  collaborators: unknown[];
  lastSyncAt?: string;
  error?: string;
  compileMode: "local" | "overleaf";
  ownerRole: "owner" | "client" | "none";
  connectionState: ProjectSyncGate;
  connectionReason?: string;
  reconnectAttempts: number;
  activityLog: SyncActivityEntry[];
  lastRemoteCompile?: {
    completedAt: string;
    pdfPath?: string;
    logPath?: string;
  };
}

interface OwnerStateSnapshot {
  syncStatus?: SyncStatusReport;
  conflicts: ConflictInfo[];
  collaborators: unknown[];
  connectionState: ProjectSyncGate;
  connectionReason?: string;
  reconnectAttempts: number;
  activityLog: SyncActivityEntry[];
}

type CommandRegistrar = (id: string, handler: (...args: any[]) => unknown) => vscode.Disposable;

export class OverleafService implements vscode.Disposable {
  readonly secrets: SecretStore;
  readonly mirrorManager: MirrorManager;
  readonly realtimeSync: RealtimeSyncService;
  readonly diagnostics: CompileDiagnosticProvider;
  readonly compileService: CompileService;
  private readonly ownerCoordinator = new SyncOwnerCoordinator();
  private ownerSubscription?: Socket;
  private takeoverTimer?: NodeJS.Timeout;
  private takeoverEnabled = false;
  private externalSyncStatus?: SyncStatusReport;
  private externalConflicts: ConflictInfo[] = [];
  private externalCollaborators: unknown[] = [];
  private externalConnectionState?: ProjectSyncGate;
  private externalConnectionReason?: string;
  private externalReconnectAttempts = 0;
  private externalActivityLog: SyncActivityEntry[] = [];
  private compileOnSaveTimer?: NodeJS.Timeout;
  private compileOnSaveDocument?: vscode.TextDocument;
  private compileOnSaveInFlight?: Promise<void>;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly onChanged: () => void = () => undefined
  ) {
    this.secrets = new SecretStore(context);
    this.mirrorManager = new MirrorManager(context);
    this.realtimeSync = new RealtimeSyncService(context, output);
    this.diagnostics = new CompileDiagnosticProvider("LaTeX Editing Toolkit");
    this.compileService = new CompileService(this.diagnostics);
    this.disposables.push(
      this.realtimeSync,
      this.diagnostics,
      this.realtimeSync.onDidChangeStatus(() => this.onChanged()),
      this.realtimeSync.onDidChangeSyncStatus(() => this.onChanged()),
      this.realtimeSync.onDidChangeConflicts(() => this.onChanged()),
      this.realtimeSync.onDidChangeCollaborators(() => this.onChanged()),
      vscode.workspace.onDidSaveTextDocument(document => {
        this.scheduleCompileOnSave(document);
      })
    );
    this.disposables.push(
      this.realtimeSync.onDidChangeStatus(() => this.broadcastOwnerSnapshot()),
      this.realtimeSync.onDidChangeSyncStatus(() => this.broadcastOwnerSnapshot()),
      this.realtimeSync.onDidChangeConflicts(() => this.broadcastOwnerSnapshot()),
      this.realtimeSync.onDidChangeCollaborators(() => this.broadcastOwnerSnapshot())
    );
  }

  registerCommands(register: CommandRegistrar): void {
    const entries: Array<[string, (...args: any[]) => unknown]> = [
      ["overleafCodex.loginWithCookie", (candidate?: unknown) => this.loginWithCookie(candidate)],
      ["overleafCodex.listProjects", (candidate?: unknown) => this.listProjects(candidate)],
      ["overleafCodex.openProjectLocally", (candidate?: unknown) => this.openProjectLocally(candidate)],
      ["overleafCodex.startRealtimeSync", (candidate?: unknown) => this.startRealtimeSync(candidate)],
      ["overleafCodex.stopRealtimeSync", (candidate?: unknown) => this.stopRealtimeSync(candidate)],
      ["overleafCodex.checkSyncStatus", (candidate?: unknown) => this.checkSyncStatus("incremental", candidate)],
      ["overleafCodex.runFullSyncAudit", (candidate?: unknown) => this.checkSyncStatus("full", candidate)],
      ["overleafCodex.retrySyncPath", (candidate?: unknown) => this.retrySyncPath(candidate)],
      ["overleafCodex.pushLocalFile", (candidate?: unknown) => this.pushLocalFile(candidate)],
      ["overleafCodex.pullRemoteFile", (candidate?: unknown) => this.pullRemoteFile(candidate)],
      ["overleafCodex.openSyncDiff", (candidate?: unknown) => this.openSyncDiff(candidate)],
      ["overleafCodex.resolveConflictUseLocal", (candidate?: unknown) => this.resolveConflictUseLocal(candidate)],
      ["overleafCodex.resolveConflictAcceptRemote", (candidate?: unknown) => this.resolveConflictAcceptRemote(candidate)],
      ["overleafCodex.moveRemoteDeletedToTrash", (candidate?: unknown) => this.moveRemoteDeletedToTrash(candidate)],
      ["overleafCodex.compile", (candidate?: unknown) => this.compileRemote(candidate)],
      ["overleafCodex.viewPdf", (candidate?: unknown) => this.openRemotePdf(candidate)],
      ["overleafCodex.showCompileLog", (candidate?: unknown) => this.showCompileLog(candidate)],
      ["overleafCodex.openLocalMirror", (candidate?: unknown) => this.openLocalMirror(candidate)],
      ["overleafCodex.deleteLocalMirror", (candidate?: unknown) => this.deleteLocalMirror(candidate)],
      ["overleafCodex.forgetLocalMirror", (candidate?: unknown) => this.forgetLocalMirror(candidate)],
      ["overleafCodex.initializeMirrorGit", (candidate?: unknown) => this.initializeMirrorGit(candidate)],
      ["overleafCodex.showCollaborators", (candidate?: unknown) => this.showCollaborators(candidate)],
      ["overleafCodex.showConflicts", (candidate?: unknown) => this.showConflicts(candidate)],
      ["overleafCodex.openConflictDiff", (candidate?: unknown) => this.openConflictDiff(candidate)],
      ["overleafCodex.acceptRemoteConflict", (candidate?: unknown) => this.resolveConflictAcceptRemote(candidate)],
      ["overleafCodex.useLocalConflict", (candidate?: unknown) => this.resolveConflictUseLocal(candidate)],
      ["overleafCodex.refreshViews", () => this.refresh()],
      ["overleafCodex.logout", (candidate?: unknown) => this.logout(candidate)]
    ];
    for (const [id, handler] of entries) this.disposables.push(register(id, handler));
  }

  async state(candidate?: unknown): Promise<OverleafState> {
    const mirrorRoot = this.resolveMirrorRoot(candidate) ?? this.findWorkspaceMirrorRootSync();
    if (!mirrorRoot) {
      return {
        available: false,
        authenticated: false,
        running: this.realtimeSync.running,
        syncItems: [],
        conflicts: [],
        collaborators: [],
        compileMode: this.compileMode(),
        ownerRole: "none",
        connectionState: "stopped",
        reconnectAttempts: 0,
        activityLog: []
      };
    }
    try {
      const manifest = await readManifest(mirrorRoot);
      const identity = await this.secrets.getIdentity(manifest.serverUrl);
      return {
        available: true,
        authenticated: Boolean(identity),
        serverUrl: manifest.serverUrl,
        projectId: manifest.projectId,
        projectName: manifest.projectName,
        mirrorRoot,
        rootDocument: manifest.rootDocPath,
        running: (this.realtimeSync.running && this.realtimeSync.currentRoot === mirrorRoot)
          || this.ownerCoordinator.currentRoot === mirrorRoot,
        syncStatus: this.realtimeSync.currentRoot === mirrorRoot
          ? this.realtimeSync.getSyncStatusReport()
          : this.ownerCoordinator.currentRoot === mirrorRoot ? this.externalSyncStatus : undefined,
        syncItems: this.realtimeSync.currentRoot === mirrorRoot
          ? this.realtimeSync.getSyncStatusItems()
          : this.ownerCoordinator.currentRoot === mirrorRoot ? this.externalSyncStatus?.items ?? [] : [],
        conflicts: this.realtimeSync.currentRoot === mirrorRoot ? this.realtimeSync.getConflicts()
          : this.ownerCoordinator.currentRoot === mirrorRoot ? this.externalConflicts : [],
        collaborators: this.realtimeSync.currentRoot === mirrorRoot ? this.realtimeSync.getCollaborators()
          : this.ownerCoordinator.currentRoot === mirrorRoot ? this.externalCollaborators : [],
        lastSyncAt: manifest.lastSyncAt,
        lastRemoteCompile: manifest.lastRemoteCompile,
        compileMode: this.compileMode(),
        ownerRole: this.ownerCoordinator.currentRoot === mirrorRoot
          ? this.ownerCoordinator.isOwner ? "owner" : "client"
          : "none",
        connectionState: this.connectionStateForRoot(mirrorRoot),
        connectionReason: this.connectionReasonForRoot(mirrorRoot),
        reconnectAttempts: this.reconnectAttemptsForRoot(mirrorRoot),
        activityLog: this.activityLogForRoot(mirrorRoot)
      };
    } catch (error) {
      return {
        available: true,
        authenticated: false,
        mirrorRoot,
        running: false,
        syncItems: [],
        conflicts: [],
        collaborators: [],
        error: formatUnknownError(error),
        compileMode: this.compileMode(),
        ownerRole: this.ownerCoordinator.currentRoot === mirrorRoot
          ? this.ownerCoordinator.isOwner ? "owner" : "client"
          : "none",
        connectionState: this.connectionStateForRoot(mirrorRoot),
        connectionReason: this.connectionReasonForRoot(mirrorRoot),
        reconnectAttempts: this.reconnectAttemptsForRoot(mirrorRoot),
        activityLog: this.activityLogForRoot(mirrorRoot)
      };
    }
  }

  async onWorkspaceChanged(): Promise<void> {
    if (this.realtimeSync.running || this.ownerCoordinator.currentRoot) {
      const activeRoot = this.realtimeSync.currentRoot ?? this.ownerCoordinator.currentRoot;
      if (this.isMirrorRootOpen(activeRoot)) {
        this.onChanged();
        return;
      }
      await this.realtimeSync.stop();
      this.takeoverEnabled = false;
      this.ownerSubscription = undefined;
      this.clearExternalSnapshot();
      await this.ownerCoordinator.release();
      this.onChanged();
    }
    const state = await this.state();
    if (!state.available || !state.authenticated || !state.mirrorRoot) return;
    if (!vscode.workspace.getConfiguration("latexEditingToolkit.overleaf").get<boolean>("autoSync", true)) return;
    if (!state.running) await this.startRealtimeSync(state.mirrorRoot);
  }

  async listMirrors(): Promise<LocalMirrorRecord[]> {
    return this.mirrorManager.listLocalMirrors();
  }

  async pdfStatus(candidate?: unknown): Promise<{ path: string; exists: boolean }> {
    const root = await this.requireMirrorRoot(candidate);
    const pdf = await this.findPdf(root);
    return { path: pdf ?? path.join(root, ".overleaf-codex", OUTPUT_DIR, "output.pdf"), exists: Boolean(pdf) };
  }

  async handle(command: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    switch (command) {
      case "overleaf-state": return this.state(payload.workspacePath);
      case "overleaf-login": await this.loginWithCookie(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-list-projects": await this.listProjects(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-open-project": await this.openProjectLocally(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-start-sync": await this.startRealtimeSync(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-stop-sync": await this.stopRealtimeSync(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-check-sync": await this.checkSyncStatus(payload.mode === "full" ? "full" : "incremental", payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-full-audit": await this.checkSyncStatus("full", payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-push": await this.pushLocalFile({ path: payload.path, workspacePath: payload.workspacePath }); return this.state(payload.workspacePath);
      case "overleaf-pull": await this.pullRemoteFile({ path: payload.path, workspacePath: payload.workspacePath }); return this.state(payload.workspacePath);
      case "overleaf-open-diff": await this.openSyncDiff({ path: payload.path, workspacePath: payload.workspacePath }); return this.state(payload.workspacePath);
      case "overleaf-resolve-conflict":
        const conflictPayload = { conflict: { relPath: String(payload.path ?? "") }, workspacePath: payload.workspacePath };
        if (payload.resolution === "local") await this.resolveConflictUseLocal(conflictPayload);
        else if (payload.resolution === "remote") await this.resolveConflictAcceptRemote(conflictPayload);
        else await this.openConflictDiff(conflictPayload);
        return this.state(payload.workspacePath);
      case "overleaf-remote-compile": await this.compileRemote(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-open-pdf": await this.openRemotePdf(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-show-log": await this.showCompileLog(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-copy-diagnostics": await this.copyDiagnostics(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-refresh": this.refresh(); return this.state(payload.workspacePath);
      case "overleaf-open-mirror": await this.openLocalMirror({ mirror: { root: String(payload.mirrorRoot ?? payload.workspacePath ?? "") } }); return this.state(payload.workspacePath);
      case "overleaf-delete-mirror": await this.deleteLocalMirror({ mirror: { root: String(payload.mirrorRoot ?? payload.workspacePath ?? "") } }); return this.state(payload.workspacePath);
      case "overleaf-forget-mirror": await this.forgetLocalMirror({ mirror: { root: String(payload.mirrorRoot ?? payload.workspacePath ?? "") } }); return this.state(payload.workspacePath);
      case "overleaf-init-git": await this.initializeMirrorGit(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-show-collaborators": await this.showCollaborators(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-show-conflicts": await this.showConflicts(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-retry": await this.retrySyncPath({ path: payload.path, workspacePath: payload.workspacePath }); return this.state(payload.workspacePath);
      case "overleaf-trash": await this.moveRemoteDeletedToTrash({ path: payload.path, workspacePath: payload.workspacePath }); return this.state(payload.workspacePath);
      case "overleaf-bulk-sync":
        await this.bulkSync(payload.paths, payload.workspacePath);
        return this.state(payload.workspacePath);
      case "overleaf-clear-activity":
        await this.clearActivityLog(payload.workspacePath);
        return this.state(payload.workspacePath);
      case "overleaf-set-compile-mode":
        await vscode.workspace.getConfiguration("latexEditingToolkit.overleaf").update("compileMode", payload.mode === "overleaf" ? "overleaf" : "local", vscode.ConfigurationTarget.Global);
        return this.state(payload.workspacePath);
      default: throw new Error(`Unknown Overleaf request: ${command}`);
    }
  }

  async disposeAsync(): Promise<void> {
    this.takeoverEnabled = false;
    if (this.takeoverTimer) clearTimeout(this.takeoverTimer);
    this.takeoverTimer = undefined;
    this.ownerSubscription = undefined;
    this.cancelCompileOnSave();
    await this.realtimeSync.stop().catch(() => undefined);
    await this.ownerCoordinator.release().catch(() => undefined);
    this.dispose();
  }

  dispose(): void {
    this.takeoverEnabled = false;
    if (this.takeoverTimer) clearTimeout(this.takeoverTimer);
    this.ownerSubscription = undefined;
    this.cancelCompileOnSave();
    void this.ownerCoordinator.release();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  private async loginWithCookie(candidate?: unknown): Promise<void> {
    const requestedServer = candidate && typeof candidate === 'object' && typeof (candidate as { serverUrl?: unknown }).serverUrl === 'string'
      ? (candidate as { serverUrl: string }).serverUrl : undefined;
    const serverUrl = requestedServer ? normalizeServerUrl(requestedServer) : await this.pickServerUrl("Login Server", true);
    if (!serverUrl) return;
    const cookie = await vscode.window.showInputBox({
      title: "Overleaf Cookie",
      prompt: `Paste the Cookie request header from an authenticated browser session on ${serverUrl}.`,
      password: true,
      ignoreFocusOut: true
    });
    if (!cookie) return;
    const client = new OverleafClient(serverUrl, undefined, this.clientTimeout(), this.networkTimeouts());
    const identity = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Logging in to Overleaf", cancellable: false },
      () => client.loginWithCookie(cookie)
    );
    await this.secrets.saveIdentity(serverUrl, identity);
    this.output.appendLine(`[${new Date().toISOString()}] Overleaf login succeeded for ${serverUrl}`);
    vscode.window.setStatusBarMessage(`Overleaf login succeeded${identity.userEmail ? ` as ${identity.userEmail}` : ""}.`, 3000);
    this.onChanged();
  }

  private async listProjects(_candidate?: unknown): Promise<void> {
    const serverUrl = await this.pickServerUrl("Project Server");
    if (!serverUrl) return;
    const client = await this.makeClient(serverUrl);
    let projects: ProjectSummary[];
    try {
      projects = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Loading Overleaf projects", cancellable: false },
        () => client.listProjects()
      );
    } catch (error) {
      if (error instanceof OverleafHttpError && [401, 403].includes(error.status)) {
        await this.secrets.deleteIdentity(serverUrl);
        const action = await vscode.window.showErrorMessage("Overleaf login expired. Sign in again with a fresh Cookie.", "Login again");
        if (action === "Login again") await this.loginWithCookie({ serverUrl });
      }
      throw error;
    }
    const picked = await this.pickProject(projects);
    if (picked) vscode.window.setStatusBarMessage(`${picked.name} · ${picked.id}`, 3000);
  }

  private async openProjectLocally(_candidate?: unknown): Promise<void> {
    const serverUrl = await this.pickServerUrl("Project Server");
    if (!serverUrl) return;
    const client = await this.makeClient(serverUrl);
    const project = await this.pickProject(await client.listProjects());
    if (!project) return;
    const parent = await this.pickMirrorParentFolder();
    if (!parent) return;
    const root = this.mirrorManager.getProjectMirrorRoot(parent, project);
    if (await exists(root)) {
      const manifest = await readManifest(root).catch(() => undefined);
      if (manifest?.projectId === project.id) {
        const choice = await vscode.window.showWarningMessage(
          `A local mirror for "${project.name}" already exists at ${root}.`,
          { modal: true }, "Open Existing", "Cancel"
        );
        if (choice !== "Open Existing") return;
        await this.mirrorManager.registerLocalMirror(root);
        await this.mirrorManager.openFolder(root);
        this.onChanged();
        return;
      }
      if (manifest) throw new Error(`The target folder already contains a different Overleaf mirror: ${root}`);
      throw new Error(`The target folder already exists and is not an Overleaf mirror: ${root}`);
    }
    const mirrored = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Mirroring ${project.name}`, cancellable: false },
      () => this.mirrorManager.mirrorProject(client, project, parent)
    );
    await this.mirrorManager.registerLocalMirror(mirrored);
    await this.mirrorManager.openFolder(mirrored);
    this.onChanged();
  }

  private async startRealtimeSync(candidate?: unknown): Promise<void> {
    const root = await this.requireMirrorRoot(candidate);
    if (this.realtimeSync.running && this.realtimeSync.currentRoot === root && this.ownerCoordinator.isOwner) return;
    if (this.ownerCoordinator.currentRoot === root && !this.ownerCoordinator.isOwner && this.ownerSubscription) return;
    this.takeoverEnabled = true;
    this.ownerSubscription = undefined;
    this.clearExternalSnapshot();
    const role = await this.ownerCoordinator.claim(root, (command, args) => this.handleOwnerCommand(command, args));
    if (role === "client") {
      this.output.appendLine(`[${new Date().toISOString()}] Using existing sync owner for ${root}.`);
      await this.connectToExistingOwner(root);
      this.onChanged();
      return;
    }
    try {
      const manifest = await readManifest(root);
      const client = await this.makeClient(manifest.serverUrl);
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Starting Overleaf realtime sync", cancellable: true },
        (progress, token) => this.realtimeSync.start(root, client, progress, abortSignalFromToken(token))
      );
    } catch (error) {
      await this.ownerCoordinator.release().catch(() => undefined);
      throw error;
    }
    this.onChanged();
  }

  private async stopRealtimeSync(candidate?: unknown): Promise<void> {
    const root = this.resolveMirrorRoot(candidate);
    if (root && this.realtimeSync.currentRoot && this.realtimeSync.currentRoot !== root) return;
    this.takeoverEnabled = false;
    if (this.takeoverTimer) clearTimeout(this.takeoverTimer);
    this.takeoverTimer = undefined;
    this.ownerSubscription = undefined;
    this.clearExternalSnapshot();
    await this.realtimeSync.stop();
    await this.ownerCoordinator.release();
    this.onChanged();
  }

  private async checkSyncStatus(mode: "incremental" | "full", candidate?: unknown): Promise<void> {
    const root = await this.requireMirrorRoot(candidate);
    await this.ensureRunning(root);
    if (this.ownerCoordinator.currentRoot === root && !this.ownerCoordinator.isOwner) {
      await this.ownerCoordinator.request("status", { refresh: true, full: mode === "full" });
      this.onChanged();
      return;
    }
    const manifest = await readManifest(root);
    const client = await this.makeClient(manifest.serverUrl);
    const report = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Checking Overleaf sync (${mode})`, cancellable: true },
      (progress, token) => this.realtimeSync.checkSyncStatus(root, client, progress, { mode, reason: "manual", signal: abortSignalFromToken(token) })
    );
    this.output.appendLine(`[${new Date().toISOString()}] Overleaf sync ${mode}: ${report.items.filter(item => item.status !== "synced").length} item(s) need review`);
    this.onChanged();
  }

  private async retrySyncPath(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus(["error"]);
    if (!item) return;
    if (!this.ownerCoordinator.isOwner && this.ownerCoordinator.currentRoot) {
      await this.ownerCoordinator.request("retry", { path: item.path });
      this.onChanged();
      return;
    }
    await this.realtimeSync.retrySyncPath(item.path);
    this.onChanged();
  }

  private async pushLocalFile(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus(["local ahead", "local only", "local deleted", "remote deleted", "diverged"]);
    if (!item) return;
    if (this.isDestructive(item)) await this.confirmDestructive(`Push local deletion or conflict for ${item.path}?`);
    if (!this.ownerCoordinator.isOwner && this.ownerCoordinator.currentRoot) {
      await this.ownerCoordinator.request("push", { path: item.path, force: this.isDestructive(item) });
      this.onChanged();
      return;
    }
    await this.realtimeSync.pushLocalFile(item.path);
    this.onChanged();
  }

  private async pullRemoteFile(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus(["remote ahead", "remote only", "local deleted", "diverged"]);
    if (!item) return;
    if (this.isDestructive(item)) await this.confirmDestructive(`Replace local content with the remote version of ${item.path}?`);
    if (!this.ownerCoordinator.isOwner && this.ownerCoordinator.currentRoot) {
      await this.ownerCoordinator.request("pull", { path: item.path, force: this.isDestructive(item) });
      this.onChanged();
      return;
    }
    await this.realtimeSync.pullRemoteFile(item.path);
    this.onChanged();
  }

  private async openSyncDiff(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus();
    if (!item) return;
    if (!this.ownerCoordinator.isOwner && this.ownerCoordinator.currentRoot) {
      await this.ownerCoordinator.request("open-diff", { path: item.path });
      return;
    }
    await this.realtimeSync.openSyncDiff(item.path);
  }

  private async resolveConflictUseLocal(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const conflict = this.conflictFromArgument(candidate) ?? (await this.pickConflict());
    if (conflict) {
      if (!this.ownerCoordinator.isOwner && this.ownerCoordinator.currentRoot) {
        await this.ownerCoordinator.request("conflicts-resolve", { path: conflict.relPath, use: "local" });
      } else await this.realtimeSync.useLocalConflict(conflict.relPath);
    }
    this.onChanged();
  }

  private async resolveConflictAcceptRemote(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const conflict = this.conflictFromArgument(candidate) ?? (await this.pickConflict());
    if (conflict) {
      if (!this.ownerCoordinator.isOwner && this.ownerCoordinator.currentRoot) {
        await this.ownerCoordinator.request("conflicts-resolve", { path: conflict.relPath, use: "remote" });
      } else await this.realtimeSync.acceptRemoteConflict(conflict.relPath);
    }
    this.onChanged();
  }

  private async moveRemoteDeletedToTrash(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus(["remote deleted"]);
    if (!item) return;
    await this.confirmDestructive(`Move ${item.path} to the local Overleaf trash?`);
    if (!this.ownerCoordinator.isOwner && this.ownerCoordinator.currentRoot) {
      await this.ownerCoordinator.request("trash", { path: item.path });
      this.onChanged();
      return;
    }
    await this.realtimeSync.moveRemoteDeletedToTrash(item.path);
    this.onChanged();
  }

  private async bulkSync(rawPaths: unknown, candidate?: unknown): Promise<void> {
    const paths = Array.isArray(rawPaths)
      ? rawPaths.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).slice(0, 500)
      : [];
    if (!paths.length) throw new Error('Select at least one safe sync item first.');
    const root = await this.requireMirrorRoot(candidate);
    await this.ensureRunning(root);
    const run = async (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken): Promise<void> => {
      const items = (this.realtimeSync.getSyncStatusItems()).filter(item => paths.includes(item.path)
        && item.entityType !== 'folder'
        && ['remote ahead', 'remote only', 'local ahead', 'local only'].includes(item.status));
      if (!items.length) throw new Error('The selected paths are no longer safe to sync. Refresh status and try again.');
      const total = items.length;
      const failures: string[] = [];
      for (let index = 0; index < items.length; index += 1) {
        if (token.isCancellationRequested) {
          this.output.appendLine(`[${new Date().toISOString()}] Bulk sync cancelled after ${index}/${total} item(s).`);
          break;
        }
        const item = items[index];
        progress.report({ message: `${index + 1}/${total} ${item.status === 'remote ahead' || item.status === 'remote only' ? 'Pulling' : 'Pushing'} ${item.path}` });
        try {
          if (!this.ownerCoordinator.isOwner && this.ownerCoordinator.currentRoot) {
            await this.ownerCoordinator.request(item.status === 'remote ahead' || item.status === 'remote only' ? 'pull' : 'push', { path: item.path, force: false });
          } else if (item.status === 'remote ahead' || item.status === 'remote only') {
            await this.realtimeSync.pullRemoteFile(item.path, false);
          } else {
            await this.realtimeSync.pushLocalFile(item.path, false);
          }
        } catch (error) {
          failures.push(`${item.path}: ${formatUnknownError(error)}`);
        }
        progress.report({ increment: 100 / total });
      }
      await this.realtimeSync.checkSyncStatus(root, undefined, undefined, { mode: 'incremental', reason: 'bulk-sync' }).catch(() => undefined);
      if (failures.length) vscode.window.showWarningMessage(`Bulk sync finished with ${failures.length} failure(s). ${failures.slice(0, 3).join(' · ')}`);
    };
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Applying Overleaf sync', cancellable: true }, run);
    this.onChanged();
  }

  private async clearActivityLog(candidate?: unknown): Promise<void> {
    const root = await this.requireMirrorRoot(candidate);
    if (this.realtimeSync.currentRoot === root) await this.realtimeSync.clearActivityLog();
    else if (this.ownerCoordinator.currentRoot === root && !this.ownerCoordinator.isOwner) await this.ownerCoordinator.request('clear-activity');
    this.onChanged();
  }

  private async compileRemote(candidate?: unknown): Promise<void> {
    const root = await this.requireMirrorRoot(candidate);
    await this.ensureRunning(root);
    const preflight = await this.remoteCompilePreflight(root);
    if (preflight && (preflight.globalBlockReason || preflight.items.some(item => item.status !== "synced"))) {
      const pending = preflight.items.filter(item => item.status !== "synced");
      const choice = await vscode.window.showWarningMessage(
        `Overleaf has ${pending.length} path(s) that are not synced. Compile the latest local changes first?`,
        { modal: true },
        "Sync and Compile",
        "Compile Remote Version",
        "Cancel"
      );
      if (choice === "Cancel" || !choice) throw new Error("Operation cancelled.");
      if (choice === "Sync and Compile") {
        if (this.ownerCoordinator.isOwner) await this.realtimeSync.syncOnce();
        else if (this.ownerCoordinator.currentRoot) await this.ownerCoordinator.request("sync-once");
        const verified = await this.remoteCompilePreflight(root);
        if (verified && (verified.globalBlockReason || verified.items.some(item => item.status !== "synced"))) {
          throw new Error("Sync completed with unresolved changes. Review Sync Status before compiling.");
        }
      }
    }
    const manifest = await readManifest(root);
    const client = await this.makeClient(manifest.serverUrl);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Compiling on Overleaf", cancellable: true },
      (progress, token) => this.compileService.compile(root, client, {
        signal: abortSignalFromToken(token),
        onProgress: message => progress.report({ message })
      })
    );
    this.output.appendLine(`[${new Date().toISOString()}] Remote Overleaf compile completed for ${root}`);
    this.onChanged();
  }

  private async remoteCompilePreflight(root: string): Promise<SyncStatusReport | undefined> {
    if (this.ownerCoordinator.currentRoot === root && !this.ownerCoordinator.isOwner) {
      const result = await this.ownerCoordinator.request("status", { refresh: true, reason: "compile-preflight" });
      return isSyncStatusReport(result) ? result : undefined;
    }
    const manifest = await readManifest(root);
    const client = await this.makeClient(manifest.serverUrl);
    return this.realtimeSync.checkSyncStatus(root, client, undefined, { mode: "incremental", reason: "compile-preflight" });
  }

  private async openRemotePdf(candidate?: unknown): Promise<void> {
    const root = await this.requireMirrorRoot(candidate);
    const output = await this.findPdf(root);
    if (!output) throw new Error("No remote PDF has been generated yet.");
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(output));
  }

  private async showCompileLog(candidate?: unknown): Promise<void> {
    await this.compileService.showLog(await this.requireMirrorRoot(candidate));
  }

  private async openLocalMirror(candidate?: unknown): Promise<void> {
    const mirror = this.mirrorFromArgument(candidate) ?? await this.pickMirror();
    if (mirror) await this.mirrorManager.openFolder(mirror.root);
  }

  private async deleteLocalMirror(candidate?: unknown): Promise<void> {
    const mirror = this.mirrorFromArgument(candidate) ?? await this.pickMirror();
    if (!mirror) return;
    const choice = await vscode.window.showWarningMessage(`Delete only the local mirror "${mirror.name}"? The Overleaf cloud project will not be deleted.`, { modal: true }, "Delete Local Mirror");
    if (choice !== "Delete Local Mirror") return;
    if (this.realtimeSync.currentRoot === mirror.root) await this.realtimeSync.stop();
    await vscode.workspace.fs.delete(vscode.Uri.file(mirror.root), { recursive: true, useTrash: true });
    await this.mirrorManager.forgetLocalMirror(mirror.root);
    this.onChanged();
  }

  private async forgetLocalMirror(candidate?: unknown): Promise<void> {
    const mirror = this.mirrorFromArgument(candidate) ?? await this.pickMirror();
    if (!mirror) return;
    await this.mirrorManager.forgetLocalMirror(mirror.root);
    this.onChanged();
  }

  private async initializeMirrorGit(candidate?: unknown): Promise<void> {
    const root = this.resolveMirrorRoot(candidate);
    const mirror = this.mirrorFromArgument(candidate)
      ?? (root ? { root } as LocalMirrorRecord : undefined)
      ?? await this.pickMirror();
    if (!mirror) return;
    await this.mirrorManager.initializeGitRepository(mirror.root);
    this.onChanged();
  }

  private async openConflictDiff(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const conflict = this.conflictFromArgument(candidate) ?? await this.pickConflict();
    if (!conflict) return;
    if (!this.ownerCoordinator.isOwner && this.ownerCoordinator.currentRoot) {
      await this.ownerCoordinator.request("conflict-diff", { path: conflict.relPath });
      return;
    }
    await this.realtimeSync.openConflictDiff(conflict.relPath);
  }

  private async showConflicts(candidate?: unknown): Promise<void> {
    const root = this.resolveMirrorRoot(candidate);
    if (root && this.realtimeSync.currentRoot !== root) await this.ensureRunning(root);
    if (!this.ownerCoordinator.isOwner && this.ownerCoordinator.currentRoot) {
      await this.ownerCoordinator.request("show-conflicts");
      return;
    }
    await this.realtimeSync.showConflicts();
  }

  private async logout(candidate?: unknown): Promise<void> {
    const root = this.resolveMirrorRoot(candidate);
    const server = root ? (await readManifest(root).catch(() => undefined))?.serverUrl ?? this.getConfiguredServerUrl() : this.getConfiguredServerUrl();
    await this.secrets.deleteIdentity(server);
    this.onChanged();
  }

  private async copyDiagnostics(candidate?: unknown): Promise<void> {
    const state = await this.state(candidate);
    const lines = [
      "LaTeX Editing Toolkit Overleaf diagnostics",
      `server=${state.serverUrl ?? ""}`,
      `project=${state.projectId ?? ""}`,
      `role=${state.ownerRole}`,
      `connection=${state.connectionState}`,
      `connectionReason=${state.connectionReason ?? ""}`,
      `reconnectAttempts=${state.reconnectAttempts}`,
      `syncItems=${state.syncItems.length}`,
      `conflicts=${state.conflicts.length}`,
      "activity:",
      ...state.activityLog.slice(-50).map(entry => `[${entry.at}] ${entry.message}`)
    ];
    await vscode.env.clipboard.writeText(lines.join("\n"));
    vscode.window.setStatusBarMessage("Copied Overleaf diagnostics.", 2500);
  }

  private refresh(): void {
    this.onChanged();
  }

  private async requireMirrorRoot(candidate?: unknown): Promise<string> {
    const root = this.resolveMirrorRoot(candidate) ?? this.findWorkspaceMirrorRootSync();
    if (!root) throw new Error("Open a local Overleaf mirror folder first.");
    return root;
  }

  private findWorkspaceMirrorRootSync(): string | undefined {
    return firstWorkspaceMirrorRoot(this.workspaceFileRoots(), root => existsSync(manifestPath(root)));
  }

  private resolveMirrorRoot(value: unknown): string | undefined {
    const candidate = value && typeof value === "object" && "workspacePath" in value
      ? (value as { workspacePath?: unknown }).workspacePath
      : value;
    if (candidate instanceof vscode.Uri) {
      return this.mirrorRootForPath(candidate.fsPath);
    }
    if (typeof candidate !== "string" || !candidate.trim()) return undefined;
    return this.mirrorRootForPath(candidate);
  }

  private mirrorRootForPath(candidate: string): string | undefined {
    return resolveMirrorRootForPath(candidate, this.workspaceFileRoots(), root => existsSync(manifestPath(root)));
  }

  private workspaceFileRoots(): string[] {
    return (vscode.workspace.workspaceFolders ?? [])
      .filter(folder => folder.uri.scheme === "file")
      .map(folder => folder.uri.fsPath);
  }

  private isMirrorRootOpen(root: string | undefined): boolean {
    return Boolean(root && existsSync(manifestPath(root)) && workspaceContainsPath(root, this.workspaceFileRoots()));
  }

  private async ensureRunning(candidate?: unknown): Promise<void> {
    const root = await this.requireMirrorRoot(candidate);
    if (this.realtimeSync.running && this.realtimeSync.currentRoot === root) return;
    this.takeoverEnabled = true;
    if (this.ownerCoordinator.currentRoot === root && !this.ownerCoordinator.isOwner) {
      if (!this.ownerSubscription) await this.connectToExistingOwner(root);
      return;
    }
    this.ownerSubscription = undefined;
    this.clearExternalSnapshot();
    const role = await this.ownerCoordinator.claim(root, (command, args) => this.handleOwnerCommand(command, args));
    if (role === "client") {
      await this.connectToExistingOwner(root);
      return;
    }
    try {
      const manifest = await readManifest(root);
      const client = await this.makeClient(manifest.serverUrl);
      await this.realtimeSync.start(root, client);
    } catch (error) {
      await this.ownerCoordinator.release().catch(() => undefined);
      throw error;
    }
  }

  private async connectToExistingOwner(root: string): Promise<void> {
    const snapshot = await this.ownerCoordinator.request("snapshot").catch(() => undefined);
    this.applyExternalSnapshot(snapshot);
    if (!isOwnerStateSnapshot(snapshot)) {
      const status = await this.ownerCoordinator.request("status").catch(() => undefined);
      if (isSyncStatusReport(status)) this.externalSyncStatus = status;
    }
    let socket: Socket;
    try {
      socket = await this.ownerCoordinator.subscribe(event => {
        if (event.event === "snapshot") {
          this.applyExternalSnapshot(event.data);
          this.onChanged();
        } else if (event.event === "status" && isSyncStatusReport(event.data)) {
          this.externalSyncStatus = event.data;
          this.onChanged();
        }
      });
    } catch (error) {
      this.output.appendLine(`[${new Date().toISOString()}] Could not subscribe to sync owner: ${formatUnknownError(error)}`);
      await this.ownerCoordinator.release().catch(() => undefined);
      this.scheduleOwnerTakeover(root);
      return;
    }
    this.ownerSubscription = socket;
    socket.once("close", () => {
      if (this.ownerSubscription !== socket) return;
      this.ownerSubscription = undefined;
      this.scheduleOwnerTakeover(root);
    });
  }

  private scheduleOwnerTakeover(root: string): void {
    if (!this.takeoverEnabled || !this.isMirrorRootOpen(root)) return;
    if (this.takeoverTimer) clearTimeout(this.takeoverTimer);
    this.takeoverTimer = setTimeout(() => {
      this.takeoverTimer = undefined;
      void this.startRealtimeSync(root).catch(error => {
        this.output.appendLine(`[${new Date().toISOString()}] Sync owner takeover failed: ${formatUnknownError(error)}`);
        this.onChanged();
      });
    }, 500);
  }

  private async handleOwnerCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
    if (command === "snapshot") return this.ownerSnapshot();
    if (command === "retry") {
      const relPath = ownerCommandPath(args);
      return this.realtimeSync.retrySyncPath(relPath);
    }
    if (command === "open-diff") {
      await this.realtimeSync.openSyncDiff(ownerCommandPath(args));
      return undefined;
    }
    if (command === "conflict-diff") {
      await this.realtimeSync.openConflictDiff(ownerCommandPath(args));
      return undefined;
    }
    if (command === "show-conflicts") {
      await this.realtimeSync.showConflicts();
      return undefined;
    }
    if (command === "show-collaborators") {
      await this.realtimeSync.showCollaborators();
      return undefined;
    }
    if (command === "trash") {
      await this.realtimeSync.moveRemoteDeletedToTrash(ownerCommandPath(args));
      return this.realtimeSync.getSyncStatusReport();
    }
    if (command === "clear-activity") {
      await this.realtimeSync.clearActivityLog();
      return undefined;
    }
    if (command === "bulk-sync") {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      for (const value of paths) {
        if (typeof value !== 'string') continue;
        const status = this.realtimeSync.getSyncStatusItems().find(item => item.path === value);
        if (!status || !['remote ahead', 'remote only', 'local ahead', 'local only'].includes(status.status)) continue;
        if (status.status === 'remote ahead' || status.status === 'remote only') await this.realtimeSync.pullRemoteFile(value, false);
        else await this.realtimeSync.pushLocalFile(value, false);
      }
      return this.realtimeSync.getSyncStatusReport();
    }
    const backend: SyncCommandBackend = {
      status: request => request.refresh || request.full || request.paths
        ? this.realtimeSync.checkSyncStatus(
          this.realtimeSync.currentRoot,
          undefined,
          undefined,
          {
            mode: request.full ? "full" : "incremental",
            paths: request.paths,
            reason: request.reason ?? "ipc-status"
          }
        )
        : Promise.resolve(this.realtimeSync.getSyncStatusReport()),
      syncOnce: () => this.realtimeSync.syncOnce(),
      push: (relPath, force) => this.realtimeSync.pushLocalFile(relPath, false, force),
      pull: (relPath, force) => this.pullForOwnerCommand(relPath, force),
      conflicts: () => this.realtimeSync.getPersistedConflicts(),
      resolveConflict: async (relPath, use) => {
        if (use === "remote") await this.realtimeSync.acceptRemoteConflict(relPath);
        else await this.realtimeSync.useLocalConflict(relPath);
      },
      authorize: (ownerCommand, relPath, force) => this.assertIpcForceIfDestructive(relPath, ownerCommand, force)
    };
    return executeSyncCommand(backend, command, args);
  }

  private ownerSnapshot(): OwnerStateSnapshot {
    return {
      syncStatus: this.realtimeSync.getSyncStatusReport(),
      conflicts: this.realtimeSync.getConflicts(),
      collaborators: this.realtimeSync.getCollaborators(),
      connectionState: this.realtimeSync.projectSyncState,
      connectionReason: this.realtimeSync.projectSyncReason,
      reconnectAttempts: this.realtimeSync.reconnectAttempts,
      activityLog: this.realtimeSync.getActivityLog()
    };
  }

  private broadcastOwnerSnapshot(): void {
    if (!this.ownerCoordinator.isOwner || !this.realtimeSync.currentRoot) return;
    this.ownerCoordinator.emit("snapshot", this.ownerSnapshot());
  }

  private applyExternalSnapshot(value: unknown): void {
    if (!isOwnerStateSnapshot(value)) return;
    this.externalSyncStatus = value.syncStatus;
    this.externalConflicts = value.conflicts;
    this.externalCollaborators = value.collaborators;
    this.externalConnectionState = value.connectionState ?? "checking";
    this.externalConnectionReason = value.connectionReason;
    this.externalReconnectAttempts = value.reconnectAttempts ?? 0;
    this.externalActivityLog = value.activityLog ?? [];
  }

  private clearExternalSnapshot(): void {
    this.externalSyncStatus = undefined;
    this.externalConflicts = [];
    this.externalCollaborators = [];
    this.externalConnectionState = undefined;
    this.externalConnectionReason = undefined;
    this.externalReconnectAttempts = 0;
    this.externalActivityLog = [];
  }

  private connectionStateForRoot(root: string): ProjectSyncGate {
    if (this.realtimeSync.currentRoot === root) return this.realtimeSync.projectSyncState;
    if (this.ownerCoordinator.currentRoot === root) return this.externalConnectionState ?? "checking";
    return "stopped";
  }

  private connectionReasonForRoot(root: string): string | undefined {
    if (this.realtimeSync.currentRoot === root) return this.realtimeSync.projectSyncReason;
    return this.ownerCoordinator.currentRoot === root ? this.externalConnectionReason : undefined;
  }

  private reconnectAttemptsForRoot(root: string): number {
    if (this.realtimeSync.currentRoot === root) return this.realtimeSync.reconnectAttempts;
    return this.ownerCoordinator.currentRoot === root ? this.externalReconnectAttempts : 0;
  }

  private activityLogForRoot(root: string): SyncActivityEntry[] {
    if (this.realtimeSync.currentRoot === root) return this.realtimeSync.getActivityLog();
    return this.ownerCoordinator.currentRoot === root ? this.externalActivityLog : [];
  }

  private async pullForOwnerCommand(relPath: string, force: boolean): Promise<void> {
    const status = this.realtimeSync.getSyncStatusItems().find(item => item.path === relPath)?.status;
    if (force && status === "remote deleted") {
      await this.realtimeSync.moveRemoteDeletedToTrash(relPath);
      return;
    }
    await this.realtimeSync.pullRemoteFile(relPath, false);
  }

  private async assertIpcForceIfDestructive(
    relPath: string,
    operation: "push" | "pull",
    force: boolean
  ): Promise<void> {
    const report = await this.realtimeSync.checkSyncStatus(
      this.realtimeSync.currentRoot,
      undefined,
      undefined,
      { mode: "incremental", paths: [relPath], reason: "ipc-safety-check" }
    );
    const status = report.items.find(item => item.path === relPath)?.status;
    if (force) return;
    if (syncOperationRequiresForce(operation, status)) {
      throw new Error(`${operation} ${relPath} requires explicit --force because its status is ${status}.`);
    }
  }

  private async makeClient(serverUrl: string): Promise<OverleafClient> {
    const normalized = normalizeServerUrl(serverUrl);
    const identity = await this.secrets.getIdentity(normalized);
    if (!identity) {
      const action = "Login with Cookie";
      const selected = await vscode.window.showErrorMessage(`Overleaf is not logged in to ${normalized}.`, action);
      if (selected === action) {
        await this.loginWithCookie();
        const retry = await this.secrets.getIdentity(normalized);
        if (retry) return new OverleafClient(normalized, retry, this.clientTimeout(), this.networkTimeouts());
      }
      throw new Error(`Not logged in to ${normalized}. Run Overleaf: Login with Cookie first.`);
    }
    return new OverleafClient(normalized, identity, this.clientTimeout(), this.networkTimeouts());
  }

  private async compileOnSave(document: vscode.TextDocument): Promise<void> {
    const enabled = getWithLegacyFallback(
      vscode.workspace.getConfiguration("latexEditingToolkit.overleaf"),
      "compileOnSave",
      vscode.workspace.getConfiguration("overleafCodex"),
      "compileOnSave",
      false
    );
    if (!enabled) return;
    if (document.uri.scheme !== "file" || !/\.(tex|ltx|bib|sty|cls)$/i.test(document.uri.fsPath)) return;
    const root = this.resolveMirrorRoot(document.uri);
    if (!root || !pathIsWithin(root, document.uri.fsPath)) return;
    const manifest = await readManifest(root);
    const client = await this.makeClient(manifest.serverUrl);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Compiling on Overleaf", cancellable: false },
      () => this.compileService.compile(root, client)
    );
    vscode.window.setStatusBarMessage("Overleaf compile completed.", 2500);
    this.onChanged();
  }

  private scheduleCompileOnSave(document: vscode.TextDocument): void {
    if (this.compileOnSaveTimer) clearTimeout(this.compileOnSaveTimer);
    this.compileOnSaveDocument = document;
    this.compileOnSaveTimer = setTimeout(() => {
      this.compileOnSaveTimer = undefined;
      const latest = this.compileOnSaveDocument;
      this.compileOnSaveDocument = undefined;
      if (!latest) return;
      const previous = this.compileOnSaveInFlight ?? Promise.resolve();
      const current = previous.catch(() => undefined).then(() => this.compileOnSave(latest));
      this.compileOnSaveInFlight = current;
      void current.catch(error => {
        this.output.appendLine(`[${new Date().toISOString()}] Overleaf compile-on-save failed: ${formatError(error)}`);
        this.onChanged();
      }).finally(() => {
        if (this.compileOnSaveInFlight === current) this.compileOnSaveInFlight = undefined;
      });
    }, this.compileOnSaveDebounceMs());
  }

  private cancelCompileOnSave(): void {
    if (this.compileOnSaveTimer) clearTimeout(this.compileOnSaveTimer);
    this.compileOnSaveTimer = undefined;
    this.compileOnSaveDocument = undefined;
  }

  private compileOnSaveDebounceMs(): number {
    const configured = vscode.workspace.getConfiguration("latexEditingToolkit.overleaf")
      .get<number>("compileOnSaveDebounceMs", 750);
    return Number.isFinite(configured) ? Math.max(0, Math.min(10_000, configured)) : 750;
  }

  private clientTimeout(): number {
    return vscode.workspace.getConfiguration("overleafCodex").get<number>("timeout", 60);
  }

  private compileMode(): "local" | "overleaf" {
    const mode = vscode.workspace.getConfiguration("latexEditingToolkit.overleaf").get<string>("compileMode", "local");
    return mode === "overleaf" ? "overleaf" : "local";
  }

  private networkTimeouts(): Partial<NetworkTimeouts> {
    const c = vscode.workspace.getConfiguration("overleafCodex");
    return {
      connectMs: c.get<number>("connectTimeout", 20) * 1000,
      projectJoinMs: c.get<number>("projectJoinTimeout", 30) * 1000,
      httpMs: c.get<number>("httpTimeout", this.clientTimeout()) * 1000,
      joinDocMs: c.get<number>("joinDocTimeout", 30) * 1000,
      otAckMs: c.get<number>("otAckTimeout", 15) * 1000
    };
  }

  private getConfiguredServerUrl(): string {
    return normalizeServerUrl(vscode.workspace.getConfiguration("overleafCodex").get<string>("serverUrl", "https://www.overleaf.com/"));
  }

  private async pickServerUrl(title: string, allowNew = false): Promise<string | undefined> {
    const configured = this.getConfiguredServerUrl();
    const known = await this.secrets.listServers();
    const servers = [...new Set([configured, "https://www.overleaf.com/", "https://latex.sjtu.edu.cn/", ...known].map(normalizeServerUrl))];
    const picked = await vscode.window.showQuickPick([
      ...servers.map(server => ({ label: server, description: known.includes(server) ? "logged in" : undefined, server })),
      ...(allowNew ? [{ label: "$(plus) Enter another server URL", description: "Custom Overleaf-compatible server", server: undefined }] : [])
    ], { title, placeHolder: "Select an Overleaf server" });
    if (!picked) return undefined;
    if (picked.server) return picked.server;
    const input = await vscode.window.showInputBox({ title: "Overleaf Server URL", value: configured, ignoreFocusOut: true });
    if (!input) return undefined;
    try {
      return normalizeServerUrl(input);
    } catch {
      vscode.window.showErrorMessage("Enter a valid http(s) Overleaf server URL.");
      return undefined;
    }
  }

  private async pickProject(projects: ProjectSummary[]): Promise<ProjectSummary | undefined> {
    const picked = await vscode.window.showQuickPick(projects.map(project => ({ label: project.name, description: project.accessLevel, detail: project.id, project })), { title: "Overleaf Projects", placeHolder: "Select a project" });
    return picked?.project;
  }

  private async pickMirrorParentFolder(): Promise<string | undefined> {
    const defaultRoot = this.mirrorManager.getConfiguredProjectsRoot();
    await fs.mkdir(defaultRoot, { recursive: true }).catch(() => undefined);
    const picked = await vscode.window.showOpenDialog({ title: "Select Parent Folder for Local Mirror", openLabel: "Use This Folder", canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri: vscode.Uri.file(defaultRoot) });
    return picked?.[0]?.scheme === "file" ? picked[0].fsPath : undefined;
  }

  private async pickMirror(): Promise<LocalMirrorRecord | undefined> {
    const mirrors = await this.listMirrors();
    if (!mirrors.length) return undefined;
    const picked = await vscode.window.showQuickPick(mirrors.map(mirror => ({ label: mirror.name, description: path.basename(mirror.root), detail: `${mirror.serverUrl} · ${mirror.projectId}`, mirror })), { title: "Overleaf Mirrors", placeHolder: "Select a mirror" });
    return picked?.mirror;
  }

  private async pickStatus(statuses?: SyncStatusItem["status"][]): Promise<SyncStatusItem | undefined> {
    const items = this.syncItemsForSelection().filter(item => item.status !== "synced").filter(item => !statuses || statuses.includes(item.status));
    if (!items.length) return undefined;
    const picked = await vscode.window.showQuickPick(items.map(item => ({ label: item.path, description: item.status, detail: item.message, item })), { title: "Overleaf Sync Status", placeHolder: "Select a file" });
    return picked?.item;
  }

  private async pickConflict(): Promise<ConflictInfo | undefined> {
    const conflicts = this.conflictsForSelection();
    if (!conflicts.length) return undefined;
    const picked = await vscode.window.showQuickPick(conflicts.map(conflict => ({ label: conflict.relPath, description: conflict.reason, conflict })), { title: "Overleaf Conflicts", placeHolder: "Select a conflict" });
    return picked?.conflict;
  }

  private statusFromArgument(value: unknown): SyncStatusItem | undefined {
    const candidate = (value && typeof value === "object" && "syncItem" in value)
      ? (value as { syncItem?: unknown }).syncItem
      : value;
    if (candidate && typeof candidate === "object" && typeof (candidate as { path?: unknown }).path === "string") {
      const pathValue = (candidate as { path: string }).path;
      const current = this.syncItemsForSelection().find(item => item.path === pathValue);
      if (current) return current;
      return { path: pathValue, status: "error", blocking: true } as SyncStatusItem;
    }
    return candidate && typeof candidate === "object" && typeof (candidate as SyncStatusItem).path === "string" ? candidate as SyncStatusItem : undefined;
  }

  private conflictFromArgument(value: unknown): ConflictInfo | undefined {
    const candidate = (value && typeof value === "object" && "conflict" in value) ? (value as { conflict?: unknown }).conflict : value;
    return candidate && typeof candidate === "object" && typeof (candidate as ConflictInfo).relPath === "string" ? candidate as ConflictInfo : undefined;
  }

  private mirrorFromArgument(value: unknown): LocalMirrorRecord | undefined {
    const candidate = (value && typeof value === "object" && "mirror" in value) ? (value as { mirror?: unknown }).mirror : value;
    return candidate && typeof candidate === "object" && typeof (candidate as LocalMirrorRecord).root === "string" ? candidate as LocalMirrorRecord : undefined;
  }

  private async showCollaborators(candidate?: unknown): Promise<void> {
    const root = this.resolveMirrorRoot(candidate);
    if (root && this.realtimeSync.currentRoot !== root) {
      await this.ensureRunning(root);
    }
    if (!this.ownerCoordinator.isOwner && this.ownerCoordinator.currentRoot) {
      await this.ownerCoordinator.request("show-collaborators");
      return;
    }
    await this.realtimeSync.showCollaborators();
  }

  private syncItemsForSelection(): SyncStatusItem[] {
    const local = this.realtimeSync.getSyncStatusItems();
    return local.length > 0 || this.ownerCoordinator.isOwner || !this.ownerCoordinator.currentRoot
      ? local
      : this.externalSyncStatus?.items ?? [];
  }

  private conflictsForSelection(): ConflictInfo[] {
    const local = this.realtimeSync.getConflicts();
    return local.length > 0 || this.ownerCoordinator.isOwner || !this.ownerCoordinator.currentRoot
      ? local
      : this.externalConflicts;
  }

  private isDestructive(item: SyncStatusItem): boolean {
    return item.status.includes("deleted") || item.status === "diverged";
  }

  private async confirmDestructive(detail: string): Promise<void> {
    if (!vscode.workspace.getConfiguration("latexEditingToolkit.overleaf").get<boolean>("confirmDestructiveChanges", true)) return;
    const choice = await vscode.window.showWarningMessage(detail, { modal: true }, "Continue");
    if (choice !== "Continue") throw new Error("Operation cancelled.");
  }

  private async findPdf(root: string): Promise<string | undefined> {
    return latestRemotePdf(root);
  }
}

function existsSync(filePath: string): boolean {
  try {
    require("node:fs").accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : formatUnknownError(error);
}

function isSyncStatusReport(value: unknown): value is SyncStatusReport {
  return Boolean(value) && typeof value === "object"
    && Array.isArray((value as SyncStatusReport).items)
    && typeof (value as SyncStatusReport).hasBlocking === "boolean";
}

function isOwnerStateSnapshot(value: unknown): value is OwnerStateSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<OwnerStateSnapshot>;
  return (snapshot.syncStatus === undefined || isSyncStatusReport(snapshot.syncStatus))
    && Array.isArray(snapshot.conflicts)
    && snapshot.conflicts.every(conflict => Boolean(conflict)
      && typeof conflict === "object"
      && typeof (conflict as ConflictInfo).relPath === "string")
    && Array.isArray(snapshot.collaborators)
    && (snapshot.connectionState === undefined || ["ready", "checking", "reconnecting", "blocked-auth", "blocked-tree", "stopped"].includes(snapshot.connectionState))
    && (snapshot.connectionReason === undefined || typeof snapshot.connectionReason === "string")
    && (snapshot.reconnectAttempts === undefined || Number.isSafeInteger(snapshot.reconnectAttempts) && snapshot.reconnectAttempts >= 0)
    && (snapshot.activityLog === undefined || Array.isArray(snapshot.activityLog) && snapshot.activityLog.every(entry => Boolean(entry)
      && typeof entry === "object"
      && typeof (entry as SyncActivityEntry).at === "string"
      && typeof (entry as SyncActivityEntry).message === "string"));
}

function ownerCommandPath(args: Record<string, unknown>): string {
  const value = args.path;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A project-relative path is required.");
  }
  return value;
}

function abortSignalFromToken(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) controller.abort(new Error("Operation cancelled."));
  token.onCancellationRequested(() => controller.abort(new Error("Operation cancelled.")));
  return controller.signal;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
