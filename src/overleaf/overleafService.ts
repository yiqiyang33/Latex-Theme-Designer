import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { CompileDiagnosticProvider } from "./diagnostics";
import { CompileService } from "./compileService";
import { manifestPath, readManifest, metadataPath, OUTPUT_DIR } from "./manifest";
import { MirrorManager, type LocalMirrorRecord } from "./mirrorManager";
import { OverleafClient } from "./overleafClient";
import { RealtimeSyncService, type ConflictInfo } from "./realtimeSync";
import { SecretStore } from "./secretStore";
import { getWithLegacyFallback } from "./config";
import { firstWorkspaceMirrorRoot, pathIsWithin, resolveMirrorRootForPath, workspaceContainsPath } from "./mirrorRoots";
import type { Identity, NetworkTimeouts, ProjectSummary, SyncStatusItem, SyncStatusReport } from "./types";
import { formatUnknownError, normalizeServerUrl } from "./util";

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
}

type CommandRegistrar = (id: string, handler: (...args: any[]) => unknown) => vscode.Disposable;

export class OverleafService implements vscode.Disposable {
  readonly secrets: SecretStore;
  readonly mirrorManager: MirrorManager;
  readonly realtimeSync: RealtimeSyncService;
  readonly diagnostics: CompileDiagnosticProvider;
  readonly compileService: CompileService;
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
        void this.compileOnSave(document).catch(error => {
          this.output.appendLine(`[${new Date().toISOString()}] Overleaf compile-on-save failed: ${formatError(error)}`);
          this.onChanged();
        });
      })
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
        compileMode: this.compileMode()
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
        running: this.realtimeSync.running && this.realtimeSync.currentRoot === mirrorRoot,
        syncStatus: this.realtimeSync.currentRoot === mirrorRoot ? this.realtimeSync.getSyncStatusReport() : undefined,
        syncItems: this.realtimeSync.currentRoot === mirrorRoot ? this.realtimeSync.getSyncStatusItems() : [],
        conflicts: this.realtimeSync.currentRoot === mirrorRoot ? this.realtimeSync.getConflicts() : [],
        collaborators: this.realtimeSync.currentRoot === mirrorRoot ? this.realtimeSync.getCollaborators() : [],
        lastSyncAt: manifest.lastSyncAt,
        compileMode: this.compileMode()
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
        compileMode: this.compileMode()
      };
    }
  }

  async onWorkspaceChanged(): Promise<void> {
    if (this.realtimeSync.running) {
      if (this.isMirrorRootOpen(this.realtimeSync.currentRoot)) {
        this.onChanged();
        return;
      }
      await this.realtimeSync.stop();
      this.onChanged();
    }
    const state = await this.state();
    if (!state.available || !state.authenticated || !state.mirrorRoot) return;
    if (!vscode.workspace.getConfiguration("latexEditingToolkit.overleaf").get<boolean>("autoSync", true)) return;
    if (!this.realtimeSync.running || this.realtimeSync.currentRoot !== state.mirrorRoot) {
      const manifest = await readManifest(state.mirrorRoot);
      const client = await this.makeClient(manifest.serverUrl);
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Starting Overleaf realtime sync", cancellable: true },
        (progress, token) => this.realtimeSync.start(state.mirrorRoot!, client, progress, abortSignalFromToken(token))
      );
      this.onChanged();
    }
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
      case "overleaf-refresh": this.refresh(); return this.state(payload.workspacePath);
      case "overleaf-open-mirror": await this.openLocalMirror({ mirror: { root: String(payload.mirrorRoot ?? payload.workspacePath ?? "") } }); return this.state(payload.workspacePath);
      case "overleaf-delete-mirror": await this.deleteLocalMirror({ mirror: { root: String(payload.mirrorRoot ?? payload.workspacePath ?? "") } }); return this.state(payload.workspacePath);
      case "overleaf-forget-mirror": await this.forgetLocalMirror({ mirror: { root: String(payload.mirrorRoot ?? payload.workspacePath ?? "") } }); return this.state(payload.workspacePath);
      case "overleaf-init-git": await this.initializeMirrorGit(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-show-collaborators": await this.showCollaborators(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-show-conflicts": await this.showConflicts(payload.workspacePath); return this.state(payload.workspacePath);
      case "overleaf-retry": await this.retrySyncPath({ path: payload.path, workspacePath: payload.workspacePath }); return this.state(payload.workspacePath);
      case "overleaf-trash": await this.moveRemoteDeletedToTrash({ path: payload.path, workspacePath: payload.workspacePath }); return this.state(payload.workspacePath);
      case "overleaf-set-compile-mode":
        await vscode.workspace.getConfiguration("latexEditingToolkit.overleaf").update("compileMode", payload.mode === "overleaf" ? "overleaf" : "local", vscode.ConfigurationTarget.Global);
        return this.state(payload.workspacePath);
      default: throw new Error(`Unknown Overleaf request: ${command}`);
    }
  }

  async disposeAsync(): Promise<void> {
    await this.realtimeSync.stop().catch(() => undefined);
    this.dispose();
  }

  dispose(): void {
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  private async loginWithCookie(_candidate?: unknown): Promise<void> {
    const serverUrl = await this.pickServerUrl("Login Server", true);
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
    const projects = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Loading Overleaf projects", cancellable: false },
      () => client.listProjects()
    );
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
    const manifest = await readManifest(root);
    const client = await this.makeClient(manifest.serverUrl);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Starting Overleaf realtime sync", cancellable: true },
      (progress, token) => this.realtimeSync.start(root, client, progress, abortSignalFromToken(token))
    );
    this.onChanged();
  }

  private async stopRealtimeSync(candidate?: unknown): Promise<void> {
    const root = this.resolveMirrorRoot(candidate);
    if (root && this.realtimeSync.currentRoot && this.realtimeSync.currentRoot !== root) return;
    await this.realtimeSync.stop();
    this.onChanged();
  }

  private async checkSyncStatus(mode: "incremental" | "full", candidate?: unknown): Promise<void> {
    const root = await this.requireMirrorRoot(candidate);
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
    await this.realtimeSync.retrySyncPath(item.path);
    this.onChanged();
  }

  private async pushLocalFile(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus(["local ahead", "local only", "local deleted", "diverged"]);
    if (!item) return;
    if (this.isDestructive(item)) await this.confirmDestructive(`Push local deletion or conflict for ${item.path}?`);
    await this.realtimeSync.pushLocalFile(item.path);
    this.onChanged();
  }

  private async pullRemoteFile(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus(["remote ahead", "remote only", "local deleted", "diverged"]);
    if (!item) return;
    if (this.isDestructive(item)) await this.confirmDestructive(`Replace local content with the remote version of ${item.path}?`);
    await this.realtimeSync.pullRemoteFile(item.path);
    this.onChanged();
  }

  private async openSyncDiff(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus();
    if (item) await this.realtimeSync.openSyncDiff(item.path);
  }

  private async resolveConflictUseLocal(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const conflict = this.conflictFromArgument(candidate) ?? (await this.pickConflict());
    if (conflict) await this.realtimeSync.useLocalConflict(conflict.relPath);
    this.onChanged();
  }

  private async resolveConflictAcceptRemote(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const conflict = this.conflictFromArgument(candidate) ?? (await this.pickConflict());
    if (conflict) await this.realtimeSync.acceptRemoteConflict(conflict.relPath);
    this.onChanged();
  }

  private async moveRemoteDeletedToTrash(candidate?: unknown): Promise<void> {
    await this.ensureRunning(candidate);
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus(["remote deleted"]);
    if (!item) return;
    await this.confirmDestructive(`Move ${item.path} to the local Overleaf trash?`);
    await this.realtimeSync.moveRemoteDeletedToTrash(item.path);
    this.onChanged();
  }

  private async compileRemote(candidate?: unknown): Promise<void> {
    const root = await this.requireMirrorRoot(candidate);
    const manifest = await readManifest(root);
    const client = await this.makeClient(manifest.serverUrl);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Compiling on Overleaf", cancellable: false }, () => this.compileService.compile(root, client));
    this.output.appendLine(`[${new Date().toISOString()}] Remote Overleaf compile completed for ${root}`);
    this.onChanged();
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
    if (conflict) await this.realtimeSync.openConflictDiff(conflict.relPath);
  }

  private async showConflicts(candidate?: unknown): Promise<void> {
    const root = this.resolveMirrorRoot(candidate);
    if (root && this.realtimeSync.currentRoot !== root) await this.ensureRunning(root);
    await this.realtimeSync.showConflicts();
  }

  private async logout(candidate?: unknown): Promise<void> {
    const root = this.resolveMirrorRoot(candidate);
    const server = root ? (await readManifest(root).catch(() => undefined))?.serverUrl ?? this.getConfiguredServerUrl() : this.getConfiguredServerUrl();
    await this.secrets.deleteIdentity(server);
    this.onChanged();
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
    const manifest = await readManifest(root);
    const client = await this.makeClient(manifest.serverUrl);
    await this.realtimeSync.start(root, client);
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
    return input ? normalizeServerUrl(input) : undefined;
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
    const items = this.realtimeSync.getSyncStatusItems().filter(item => item.status !== "synced").filter(item => !statuses || statuses.includes(item.status));
    if (!items.length) return undefined;
    const picked = await vscode.window.showQuickPick(items.map(item => ({ label: item.path, description: item.status, detail: item.message, item })), { title: "Overleaf Sync Status", placeHolder: "Select a file" });
    return picked?.item;
  }

  private async pickConflict(): Promise<ConflictInfo | undefined> {
    const conflicts = this.realtimeSync.getConflicts();
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
      const current = this.realtimeSync.getSyncStatusItems().find(item => item.path === pathValue);
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
    await this.realtimeSync.showCollaborators();
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
    const outputRoot = metadataPath(root, OUTPUT_DIR);
    const files = await fs.readdir(outputRoot).catch(() => [] as string[]);
    const candidate = files.find(name => name.toLowerCase().endsWith(".pdf"));
    if (!candidate) return undefined;
    const full = path.join(outputRoot, candidate);
    return (await fs.stat(full).catch(() => undefined))?.isFile() ? full : undefined;
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
