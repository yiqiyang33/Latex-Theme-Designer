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
import type { Identity, NetworkTimeouts, ProjectSummary, SyncStatusItem, SyncStatusReport } from "./types";
import { normalizeServerUrl } from "./util";

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
      this.realtimeSync.onDidChangeConflicts(() => this.onChanged())
    );
  }

  registerCommands(register: CommandRegistrar): void {
    const entries: Array<[string, (...args: any[]) => unknown]> = [
      ["overleafCodex.loginWithCookie", () => this.loginWithCookie()],
      ["overleafCodex.listProjects", () => this.listProjects()],
      ["overleafCodex.openProjectLocally", () => this.openProjectLocally()],
      ["overleafCodex.startRealtimeSync", () => this.startRealtimeSync()],
      ["overleafCodex.stopRealtimeSync", () => this.stopRealtimeSync()],
      ["overleafCodex.checkSyncStatus", () => this.checkSyncStatus("incremental")],
      ["overleafCodex.runFullSyncAudit", () => this.checkSyncStatus("full")],
      ["overleafCodex.retrySyncPath", (candidate?: unknown) => this.retrySyncPath(candidate)],
      ["overleafCodex.pushLocalFile", (candidate?: unknown) => this.pushLocalFile(candidate)],
      ["overleafCodex.pullRemoteFile", (candidate?: unknown) => this.pullRemoteFile(candidate)],
      ["overleafCodex.openSyncDiff", (candidate?: unknown) => this.openSyncDiff(candidate)],
      ["overleafCodex.resolveConflictUseLocal", (candidate?: unknown) => this.resolveConflictUseLocal(candidate)],
      ["overleafCodex.resolveConflictAcceptRemote", (candidate?: unknown) => this.resolveConflictAcceptRemote(candidate)],
      ["overleafCodex.moveRemoteDeletedToTrash", (candidate?: unknown) => this.moveRemoteDeletedToTrash(candidate)],
      ["overleafCodex.compile", () => this.compileRemote()],
      ["overleafCodex.viewPdf", () => this.openRemotePdf()],
      ["overleafCodex.showCompileLog", () => this.showCompileLog()],
      ["overleafCodex.openLocalMirror", (candidate?: unknown) => this.openLocalMirror(candidate)],
      ["overleafCodex.deleteLocalMirror", (candidate?: unknown) => this.deleteLocalMirror(candidate)],
      ["overleafCodex.forgetLocalMirror", (candidate?: unknown) => this.forgetLocalMirror(candidate)],
      ["overleafCodex.initializeMirrorGit", (candidate?: unknown) => this.initializeMirrorGit(candidate)],
      ["overleafCodex.showCollaborators", () => this.realtimeSync.showCollaborators()],
      ["overleafCodex.showConflicts", () => this.realtimeSync.showConflicts()],
      ["overleafCodex.openConflictDiff", (candidate?: unknown) => this.openConflictDiff(candidate)],
      ["overleafCodex.acceptRemoteConflict", (candidate?: unknown) => this.resolveConflictAcceptRemote(candidate)],
      ["overleafCodex.useLocalConflict", (candidate?: unknown) => this.resolveConflictUseLocal(candidate)],
      ["overleafCodex.refreshViews", () => this.refresh()],
      ["overleafCodex.logout", () => this.logout()]
    ];
    for (const [id, handler] of entries) this.disposables.push(register(id, handler));
  }

  async state(root = this.findWorkspaceMirrorRootSync()): Promise<OverleafState> {
    const mirrorRoot = root;
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
        lastSyncAt: manifest.lastSyncAt
        ,compileMode: this.compileMode()
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
        error: error instanceof Error ? error.message : String(error),
        compileMode: this.compileMode()
      };
    }
  }

  async onWorkspaceChanged(): Promise<void> {
    const state = await this.state();
    if (!state.available || !state.authenticated || !state.mirrorRoot) return;
    if (!vscode.workspace.getConfiguration("latexEditingToolkit.overleaf").get<boolean>("autoSync", true)) return;
    if (!this.realtimeSync.running || this.realtimeSync.currentRoot !== state.mirrorRoot) {
      const manifest = await readManifest(state.mirrorRoot);
      const client = await this.makeClient(manifest.serverUrl);
      await this.realtimeSync.start(state.mirrorRoot, client);
    }
  }

  async listMirrors(): Promise<LocalMirrorRecord[]> {
    return this.mirrorManager.listLocalMirrors();
  }

  async pdfStatus(): Promise<{ path: string; exists: boolean }> {
    const root = await this.requireMirrorRoot();
    const pdf = await this.findPdf(root);
    return { path: pdf ?? path.join(root, ".overleaf-codex", OUTPUT_DIR, "output.pdf"), exists: Boolean(pdf) };
  }

  async handle(command: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    switch (command) {
      case "overleaf-state": return this.state();
      case "overleaf-login": await this.loginWithCookie(); return this.state();
      case "overleaf-list-projects": await this.listProjects(); return this.state();
      case "overleaf-open-project": await this.openProjectLocally(); return this.state();
      case "overleaf-start-sync": await this.startRealtimeSync(); return this.state();
      case "overleaf-stop-sync": await this.stopRealtimeSync(); return this.state();
      case "overleaf-check-sync": await this.checkSyncStatus(payload.mode === "full" ? "full" : "incremental"); return this.state();
      case "overleaf-full-audit": await this.checkSyncStatus("full"); return this.state();
      case "overleaf-push": await this.pushLocalFile(payload.path); return this.state();
      case "overleaf-pull": await this.pullRemoteFile(payload.path); return this.state();
      case "overleaf-open-diff": await this.openSyncDiff(payload.path); return this.state();
      case "overleaf-resolve-conflict":
        if (payload.resolution === "local") await this.resolveConflictUseLocal({ conflict: { relPath: String(payload.path ?? "") } });
        else if (payload.resolution === "remote") await this.resolveConflictAcceptRemote({ conflict: { relPath: String(payload.path ?? "") } });
        else await this.openConflictDiff({ conflict: { relPath: String(payload.path ?? "") } });
        return this.state();
      case "overleaf-remote-compile": await this.compileRemote(); return this.state();
      case "overleaf-open-pdf": await this.openRemotePdf(); return this.state();
      case "overleaf-show-log": await this.showCompileLog(); return this.state();
      case "overleaf-refresh": this.refresh(); return this.state();
      case "overleaf-set-compile-mode":
        await vscode.workspace.getConfiguration("latexEditingToolkit.overleaf").update("compileMode", payload.mode === "overleaf" ? "overleaf" : "local", vscode.ConfigurationTarget.Global);
        return this.state();
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

  private async loginWithCookie(): Promise<void> {
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

  private async listProjects(): Promise<void> {
    const serverUrl = await this.pickServerUrl("Project Server");
    if (!serverUrl) return;
    const client = await this.makeClient(serverUrl);
    const projects = await client.listProjects();
    const picked = await this.pickProject(projects);
    if (picked) vscode.window.setStatusBarMessage(`${picked.name} · ${picked.id}`, 3000);
  }

  private async openProjectLocally(): Promise<void> {
    const serverUrl = await this.pickServerUrl("Project Server");
    if (!serverUrl) return;
    const client = await this.makeClient(serverUrl);
    const project = await this.pickProject(await client.listProjects());
    if (!project) return;
    const parent = await this.pickMirrorParentFolder();
    if (!parent) return;
    const root = this.mirrorManager.getProjectMirrorRoot(parent, project);
    if (await exists(root)) {
      const choice = await vscode.window.showWarningMessage(`A local mirror for "${project.name}" already exists.`, { modal: true }, "Open Existing");
      if (choice !== "Open Existing") return;
      await this.mirrorManager.openFolder(root);
      return;
    }
    const mirrored = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Mirroring ${project.name}`, cancellable: false },
      () => this.mirrorManager.mirrorProject(client, project, parent)
    );
    await this.mirrorManager.openFolder(mirrored);
    this.onChanged();
  }

  private async startRealtimeSync(): Promise<void> {
    const root = await this.requireMirrorRoot();
    const manifest = await readManifest(root);
    const client = await this.makeClient(manifest.serverUrl);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Starting Overleaf realtime sync", cancellable: true },
      (progress, token) => this.realtimeSync.start(root, client, progress, abortSignalFromToken(token))
    );
    this.onChanged();
  }

  private async stopRealtimeSync(): Promise<void> {
    await this.realtimeSync.stop();
    this.onChanged();
  }

  private async checkSyncStatus(mode: "incremental" | "full"): Promise<void> {
    const root = await this.requireMirrorRoot();
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
    await this.ensureRunning();
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus(["error"]);
    if (!item) return;
    await this.realtimeSync.retrySyncPath(item.path);
    this.onChanged();
  }

  private async pushLocalFile(candidate?: unknown): Promise<void> {
    await this.ensureRunning();
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus(["local ahead", "local only", "local deleted", "diverged"]);
    if (!item) return;
    if (this.isDestructive(item)) await this.confirmDestructive(`Push local deletion or conflict for ${item.path}?`);
    await this.realtimeSync.pushLocalFile(item.path);
    this.onChanged();
  }

  private async pullRemoteFile(candidate?: unknown): Promise<void> {
    await this.ensureRunning();
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus(["remote ahead", "remote only", "local deleted", "diverged"]);
    if (!item) return;
    if (this.isDestructive(item)) await this.confirmDestructive(`Replace local content with the remote version of ${item.path}?`);
    await this.realtimeSync.pullRemoteFile(item.path);
    this.onChanged();
  }

  private async openSyncDiff(candidate?: unknown): Promise<void> {
    await this.ensureRunning();
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus();
    if (item) await this.realtimeSync.openSyncDiff(item.path);
  }

  private async resolveConflictUseLocal(candidate?: unknown): Promise<void> {
    await this.ensureRunning();
    const conflict = this.conflictFromArgument(candidate) ?? (await this.pickConflict());
    if (conflict) await this.realtimeSync.useLocalConflict(conflict.relPath);
    this.onChanged();
  }

  private async resolveConflictAcceptRemote(candidate?: unknown): Promise<void> {
    await this.ensureRunning();
    const conflict = this.conflictFromArgument(candidate) ?? (await this.pickConflict());
    if (conflict) await this.realtimeSync.acceptRemoteConflict(conflict.relPath);
    this.onChanged();
  }

  private async moveRemoteDeletedToTrash(candidate?: unknown): Promise<void> {
    await this.ensureRunning();
    const item = this.statusFromArgument(candidate) ?? await this.pickStatus(["remote deleted"]);
    if (!item) return;
    await this.confirmDestructive(`Move ${item.path} to the local Overleaf trash?`);
    await this.realtimeSync.moveRemoteDeletedToTrash(item.path);
    this.onChanged();
  }

  private async compileRemote(): Promise<void> {
    const root = await this.requireMirrorRoot();
    const manifest = await readManifest(root);
    const client = await this.makeClient(manifest.serverUrl);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Compiling on Overleaf", cancellable: false }, () => this.compileService.compile(root, client));
    this.output.appendLine(`[${new Date().toISOString()}] Remote Overleaf compile completed for ${root}`);
    this.onChanged();
  }

  private async openRemotePdf(): Promise<void> {
    const root = await this.requireMirrorRoot();
    const output = await this.findPdf(root);
    if (!output) throw new Error("No remote PDF has been generated yet.");
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(output));
  }

  private async showCompileLog(): Promise<void> {
    await this.compileService.showLog(await this.requireMirrorRoot());
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
    const mirror = this.mirrorFromArgument(candidate) ?? await this.pickMirror();
    if (!mirror) return;
    await this.mirrorManager.initializeGitRepository(mirror.root);
    this.onChanged();
  }

  private async openConflictDiff(candidate?: unknown): Promise<void> {
    const conflict = this.conflictFromArgument(candidate) ?? await this.pickConflict();
    if (conflict) await this.realtimeSync.openConflictDiff(conflict.relPath);
  }

  private async logout(): Promise<void> {
    const server = this.getConfiguredServerUrl();
    await this.secrets.deleteIdentity(server);
    this.onChanged();
  }

  private refresh(): void {
    this.onChanged();
  }

  private async requireMirrorRoot(): Promise<string> {
    const root = this.findWorkspaceMirrorRootSync();
    if (!root) throw new Error("Open a local Overleaf mirror folder first.");
    return root;
  }

  private findWorkspaceMirrorRootSync(): string | undefined {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme === "file" && existsSync(manifestPath(folder.uri.fsPath))) return folder.uri.fsPath;
    }
    return undefined;
  }

  private async ensureRunning(): Promise<void> {
    const root = await this.requireMirrorRoot();
    if (this.realtimeSync.running && this.realtimeSync.currentRoot === root) return;
    const manifest = await readManifest(root);
    const client = await this.makeClient(manifest.serverUrl);
    await this.realtimeSync.start(root, client);
  }

  private async makeClient(serverUrl: string): Promise<OverleafClient> {
    const normalized = normalizeServerUrl(serverUrl);
    const identity = await this.secrets.getIdentity(normalized);
    if (!identity) throw new Error(`Not logged in to ${normalized}. Run Overleaf: Login with Cookie first.`);
    return new OverleafClient(normalized, identity, this.clientTimeout(), this.networkTimeouts());
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
    const candidate = (value && typeof value === "object" && "syncItem" in value) ? (value as { syncItem?: unknown }).syncItem : value;
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
