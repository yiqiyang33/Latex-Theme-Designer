import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { HistoryConflictError, workspaceHistoryStorageRoot } from "./changeHistory";
import { confirmationSpec, isConfirmAction } from "./confirmations";
import { PersonalStyleRegistry } from "./personalStyles";
import { LocalProjectRegistry } from "./projectRegistry";
import { preflightCreateProject, runCreateProjectWorkflow } from "./projectWorkflow";
import { STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import { registerSnippetHost } from "./snippets/engine/host";
import { getSnippetDir } from "./snippets/engine/utils";
import { getSnippetFiles } from "./snippets/engine/snippetProfiles";
import { SnippetService } from "./snippets/snippetService";
import { ToolkitService } from "./toolkitService";
import { OverleafService } from "./overleaf/overleafService";
import type { LocalNoteProjectStatus, ResponseState, ToolkitState } from "./types";

let activePanel: ToolkitPanel | undefined;
const toolkitServices = new Map<string, ToolkitService>();
let personalStyles: PersonalStyleRegistry | undefined;
let overleafService: OverleafService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("LaTeX Editing Toolkit");
  const projectRegistry = new LocalProjectRegistry(context.globalState);
  personalStyles = new PersonalStyleRegistry(context.globalState);
  const treeProvider = new ToolkitTreeProvider(context, projectRegistry);
  const command = <T extends unknown[]>(id: string, handler: (...args: T) => unknown): vscode.Disposable => registerToolkitCommand(output, id, handler);

  overleafService = new OverleafService(context, output, () => treeProvider.refresh());

  registerSnippetHost(context, output);
  void warnAboutLegacySnips(context, output);

  context.subscriptions.push(
    output,
    treeProvider,
    vscode.window.registerTreeDataProvider("latexEditingToolkit.actions", treeProvider),
    vscode.workspace.onDidChangeWorkspaceFolders(() => treeProvider.refresh()),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) treeProvider.refresh();
    }),
    command("latexEditingToolkit.openToolkit", async (folderUri?: vscode.Uri) => {
      const folder = await selectWorkspaceFolder(folderUri);
      if (!folder) return;
      activePanel = ToolkitPanel.createOrShow(context, folder, output, personalStyles!, () => treeProvider.refresh());
    }),
    command("latexEditingToolkit.openSync", async (folderUri?: vscode.Uri) => {
      const folder = await selectWorkspaceFolder(folderUri);
      if (!folder) return;
      activePanel = ToolkitPanel.createOrShow(context, folder, output, personalStyles!, () => treeProvider.refresh());
      await activePanel.openSection("sync");
    }),
    command("hsnips.openSnippetManager", async (folderUri?: vscode.Uri) => {
      const folder = folderUri instanceof vscode.Uri
        ? vscode.workspace.getWorkspaceFolder(folderUri)
        : (vscode.window.activeTextEditor
          ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
          : vscode.workspace.workspaceFolders?.[0]);
      activePanel = ToolkitPanel.createOrShow(context, folder, output, personalStyles!, () => treeProvider.refresh());
      await activePanel.openSection("snippets");
    }),
    command("latexEditingToolkit.createProject", async () => {
      await createProjectWizard(context, projectRegistry, treeProvider, output);
    }),
    command("latexEditingToolkit.openLocalProject", async (projectPath?: unknown) => {
      await openLocalProject(projectPath);
    }),
    command("latexEditingToolkit.relocateLocalProject", async (projectPath?: unknown) => {
      await relocateLocalProject(projectRegistry, treeProvider, projectPath);
    }),
    command("latexEditingToolkit.removeLocalProject", async (projectPath?: unknown) => {
      await removeLocalProject(projectRegistry, treeProvider, projectPath);
    }),
    command("latexEditingToolkit.refreshTree", () => {
      treeProvider.refresh();
    }),
    command("latexEditingToolkit.undoLastChange", async (folderUri?: vscode.Uri) => {
      await restoreLastToolkitChange(context, treeProvider, output, "undo", folderUri);
    }),
    command("latexEditingToolkit.redoLastChange", async (folderUri?: vscode.Uri) => {
      await restoreLastToolkitChange(context, treeProvider, output, "redo", folderUri);
    }),
    command("latexEditingToolkit.createStarterInWorkspace", async (folderUri?: vscode.Uri) => {
      await createStarterInWorkspace(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.pickCompileTarget", async (folderUri?: vscode.Uri) => {
      await pickCompileTarget(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.pickCompileRecipe", async (folderUri?: vscode.Uri) => {
      await pickCompileRecipe(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.toggleInternalFallback", async (folderUri?: vscode.Uri) => {
      await toggleInternalFallback(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.openCurrentPdf", async (folderUri?: vscode.Uri) => {
      await openCurrentPdf(context, folderUri);
    }),
    command("latexEditingToolkit.toggleThemeOption", async (folderUri?: vscode.Uri, toggleId?: string) => {
      await toggleThemeOption(context, treeProvider, folderUri, toggleId);
    }),
    command("latexEditingToolkit.pickClassConfig", async (folderUri?: vscode.Uri, fieldId?: string) => {
      await pickClassConfig(context, treeProvider, folderUri, fieldId);
    }),
    command("latexEditingToolkit.pickStylePreset", async (folderUri?: vscode.Uri) => {
      await pickStylePreset(context, treeProvider, folderUri);
    }),
    // Legacy command aliases now use the unified style preset.
    command("latexEditingToolkit.pickBlockPreset", async (folderUri?: vscode.Uri) => {
      await pickStylePreset(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.pickHeadingTocPreset", async (folderUri?: vscode.Uri) => {
      await pickStylePreset(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.pickBodyFontSize", async (folderUri?: vscode.Uri) => {
      await pickBodyFontSize(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.initializeWorkspace", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const result = await service.handle("initialize-workspace", {});
      treeProvider.refresh();
      vscode.window.setStatusBarMessage(`Initialized LaTeX Toolkit workspace: ${JSON.stringify(result)}`, 3000);
    }),
    command("latexEditingToolkit.upgradeWorkspaceThemeAssets", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const choice = await vscode.window.showWarningMessage(
        "Upgrade bundled theme assets? Existing files are backed up first. Preserve Colors keeps all current settings; Reset to Default only replaces the complete color/style package.",
        { modal: true },
        "Preserve Colors",
        "Reset to Default"
      );
      if (!choice) return;
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Upgrading LaTeX Toolkit theme assets" },
        () => service.handle("upgrade-theme-assets", { color_policy: choice === "Reset to Default" ? "default" : "preserve" })
      ) as { backup_dir?: string; upgraded_files?: string[]; color_policy?: string; updated_override_files?: string[] };
      const resetSuffix = result.updated_override_files?.length ? ` Updated ${result.updated_override_files.length} color state file(s).` : " Colors preserved.";
      treeProvider.refresh();
      vscode.window.setStatusBarMessage(`Upgraded ${result.upgraded_files?.length ?? 0} theme asset(s).${resetSuffix}`, 3000);
    }),
    command("latexEditingToolkit.generateVscodeSettings", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const result = await service.handle("vscode-settings-generate", {}) as { message?: string };
      treeProvider.refresh();
      vscode.window.setStatusBarMessage(result.message ?? "VS Code settings checked.", 2500);
    }),
    command("latexEditingToolkit.saveOverrides", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: unknown };
      await service.handle("save", response.state as Record<string, unknown>);
      treeProvider.refresh();
      vscode.window.setStatusBarMessage("Saved LaTeX Toolkit overrides.", 2000);
    }),
    command("latexEditingToolkit.resetOverrides", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const ok = await vscode.window.showWarningMessage(
        "Reset all Toolkit overrides? This deletes theme.ui.json, theme.overrides.tex, and theme.colors.tex, including theme, compile, class, toggle, and status settings.",
        { modal: true },
        "Reset All"
      );
      if (ok !== "Reset All") return;
      await service.handle("reset", {});
      treeProvider.refresh();
      vscode.window.setStatusBarMessage("Reset all LaTeX Toolkit override files.", 2500);
    }),
    command("latexEditingToolkit.compilePdf", async (folderUri?: vscode.Uri) => {
      const scoped = await folderAndServiceForCommand(context, folderUri);
      if (!scoped) return;
      const response = await scoped.service.handle("state", {}) as { state: Record<string, unknown> };
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Compiling LaTeX PDF" }, () => scoped.service.handle("compile", response.state)) as { success?: boolean; output?: string };
      logCompileResult(output, scoped.folder.uri.fsPath, result);
      const success = Boolean(result.success);
      treeProvider.refresh();
      if (success) vscode.window.setStatusBarMessage("LaTeX compile succeeded.", 2500);
      else {
        const action = await vscode.window.showErrorMessage("LaTeX compile failed. The complete log is available in LaTeX Editing Toolkit output.", "Show Log");
        if (action === "Show Log") output.show(true);
      }
    }),
    command("latexEditingToolkit.cleanArtifacts", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const ok = await vscode.window.showWarningMessage("Clean LaTeX build artifacts in the workspace?", { modal: true }, "Clean");
      if (ok !== "Clean") return;
      const result = await service.handle("clean", {}) as { deleted_count?: number; errors?: string[] };
      treeProvider.refresh();
      vscode.window.setStatusBarMessage(`Cleaned ${result.deleted_count ?? 0} file(s).${result.errors?.length ? " Some errors occurred." : ""}`, 2500);
    }),
    command("latexEditingToolkit.splitCurrentTarget", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: { compile_target?: string } };
      await service.handle("split", { compile_target: response.state.compile_target ?? "main.tex", dry_run: false });
      treeProvider.refresh();
      vscode.window.setStatusBarMessage("Split current LaTeX target.", 2500);
    }),
    command("latexEditingToolkit.renumberUnits", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: { compile_target?: string } };
      await service.handle("renumber", { compile_target: response.state.compile_target ?? "main.tex", mode: "add", dry_run: false });
      treeProvider.refresh();
      vscode.window.setStatusBarMessage("Renumbered referenced units.", 2500);
    }),
    command("latexEditingToolkit.unsplitUnit", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: { compile_target?: string } };
      const ok = await vscode.window.showWarningMessage("Merge selected subfiles unit back to its root and delete the source unit?", { modal: true }, "Merge");
      if (ok !== "Merge") return;
      await service.handle("unsplit", { compile_target: response.state.compile_target ?? "", dry_run: false, delete_source: true });
      treeProvider.refresh();
      vscode.window.setStatusBarMessage("Merged selected unit back to root.", 2500);
    })
  );
  overleafService.registerCommands((id, handler) => command(id, handler));
  void autoStartOverleafMirror(overleafService, output);
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void overleafService?.onWorkspaceChanged().catch(error => output.appendLine(`Overleaf workspace refresh failed: ${String(error)}`))));
}

export function deactivate(): void {
  activePanel?.dispose();
  activePanel = undefined;
  toolkitServices.clear();
  personalStyles = undefined;
  overleafService?.dispose();
  overleafService = undefined;
}

async function autoStartOverleafMirror(service: OverleafService, output: vscode.OutputChannel): Promise<void> {
  try {
    const state = await service.state();
    if (!state.available || !state.authenticated || !state.mirrorRoot) return;
    if (!vscode.workspace.getConfiguration("latexEditingToolkit.overleaf").get<boolean>("autoSync", true)) return;
    await vscode.commands.executeCommand("overleafCodex.startRealtimeSync", { workspacePath: state.mirrorRoot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`[${new Date().toISOString()}] Overleaf auto-sync skipped: ${message}`);
  }
}

const LEGACY_SNIPS_NOTICE_KEY = "latexEditingToolkit.legacySnipsNotice.v1";

async function warnAboutLegacySnips(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
  const legacyId = "yiqiyang33.yiqis-latexsnips";
  const legacy = vscode.extensions.getExtension(legacyId);
  if (!legacy || context.globalState.get<boolean>(LEGACY_SNIPS_NOTICE_KEY)) return;
  await context.globalState.update(LEGACY_SNIPS_NOTICE_KEY, true);
  output.appendLine(`[${new Date().toISOString()}] Legacy extension detected: ${legacyId}`);
  const action = await vscode.window.showWarningMessage(
    "Yiqi's LatexSnips is also installed. LaTeX Editing Toolkit 1.0 now includes the same snippet engine; disable the old extension to avoid duplicate completions and Enter/Tab behavior.",
    "Open Extension",
    "Continue"
  );
  if (action === "Open Extension") {
    await vscode.commands.executeCommand("workbench.extensions.action.showExtensionsWithIds", [legacyId]);
  }
}

const RECENT_PROJECT_PARENTS_KEY = "latexEditingToolkit.recentProjectParents.v1";

async function createProjectWizard(
  context: vscode.ExtensionContext,
  registry: LocalProjectRegistry,
  treeProvider: ToolkitTreeProvider,
  output: vscode.OutputChannel
): Promise<void> {
  const recent = context.globalState.get<string[]>(RECENT_PROJECT_PARENTS_KEY) ?? [];
  const suggested = new Set<string>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme === "file") {
      suggested.add(folder.uri.fsPath);
      suggested.add(path.dirname(folder.uri.fsPath));
    }
  }
  for (const item of recent) suggested.add(item);
  const location = await vscode.window.showQuickPick(
    [
      ...[...suggested].map((folderPath) => ({ label: path.basename(folderPath) || folderPath, description: folderPath, folderPath })),
      { label: "$(folder-opened) Browse…", description: "Choose another parent folder", folderPath: "" }
    ],
    { title: "Create Project (1/3): Location", placeHolder: "Choose the parent folder for the new project" }
  );
  if (!location) return;
  let parentPath = location.folderPath;
  if (!parentPath) {
    const selected = await vscode.window.showOpenDialog({
      title: "Create Project (1/3): Choose Parent Folder",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use as Parent Folder"
    });
    if (!selected?.[0]) return;
    if (selected[0].scheme !== "file") throw new Error("Create Project only supports local parent folders.");
    parentPath = selected[0].fsPath;
  }

  const projectName = await vscode.window.showInputBox({
    title: "Create Project (2/3): Project Name",
    prompt: `A new folder will be created inside ${parentPath}`,
    value: "New Notes",
    valueSelection: [0, "New Notes".length],
    validateInput: (value) => {
      const name = value.trim();
      if (!name) return "Project name is required.";
      if (name === "." || name === ".." || /[\\/\0]/.test(name)) return "Use a single folder name without path separators.";
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) return "This name is reserved by Windows.";
      return undefined;
    }
  });
  if (!projectName) return;

  const pickedTemplate = await vscode.window.showQuickPick(
    STARTER_TEMPLATE_DEFINITIONS.map((template) => ({
      label: template.label,
      description: template.id,
      detail: template.description,
      template
    })),
    { title: "Create Project (3/3): Template", placeHolder: "Choose the document structure" }
  );
  if (!pickedTemplate) return;

  const preflight = await preflightCreateProject({ parentPath, projectName, templateId: pickedTemplate.template.id }, context.extensionPath);
  if (!preflight.ok) {
    const action = await vscode.window.showErrorMessage(`Cannot create project: ${preflight.errors.join(" ")}`, "Show Log");
    output.appendLine(`[${new Date().toISOString()}] CREATE PROJECT PREFLIGHT`);
    for (const error of preflight.errors) output.appendLine(`- ${error}`);
    if (action === "Show Log") output.show(true);
    return;
  }
  if (preflight.targetExists && preflight.targetEmpty) {
    const choice = await vscode.window.showWarningMessage(
      `The folder '${preflight.rootPath}' already exists and is empty. Use it for the new project?`,
      { modal: true },
      "Use Empty Folder"
    );
    if (choice !== "Use Empty Folder") return;
  }

  const nextRecent = [parentPath, ...recent.filter((item) => path.normalize(item) !== path.normalize(parentPath))].slice(0, 8);
  await context.globalState.update(RECENT_PROJECT_PARENTS_KEY, nextRecent);
  const service = new ToolkitService(preflight.rootPath, context.extensionPath, {
    additionalStylePresets: personalStyles?.definitions() ?? []
  });
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Creating LaTeX Toolkit project" }, () => (
      runCreateProjectWorkflow(service, registry, preflight.rootPath, pickedTemplate.template.id)
    ));
  } catch (err) {
    logToolkitError(output, "latexEditingToolkit.createProject", preflight.rootPath, err);
    const message = err instanceof Error ? err.message : String(err);
    const action = await vscode.window.showErrorMessage(
      `Project creation failed: ${message}. The folder may contain partially generated resources.`,
      "Open Folder",
      "Show Log"
    );
    if (action === "Open Folder") await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(preflight.rootPath), { forceNewWindow: false });
    if (action === "Show Log") output.show(true);
    return;
  }
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(`Created LaTeX Toolkit project: ${projectName}`, 3000);
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(preflight.rootPath), { forceNewWindow: false });
}

async function restoreLastToolkitChange(
  context: vscode.ExtensionContext,
  treeProvider: ToolkitTreeProvider,
  output: vscode.OutputChannel,
  direction: "undo" | "redo",
  folderUri?: vscode.Uri
): Promise<void> {
  const scoped = await folderAndServiceForCommand(context, folderUri);
  if (!scoped) return;
  const command = direction === "undo" ? "undo-last-change" : "redo-last-change";
  try {
    await scoped.service.handle(command, {});
  } catch (err) {
    if (!(err instanceof HistoryConflictError)) throw err;
    const choice = await vscode.window.showWarningMessage(
      `Cannot ${direction}: ${err.conflicts.length} tracked item(s) changed outside the recorded operation.`,
      { modal: true },
      "Show Conflicts",
      "Force Restore"
    );
    if (choice === "Show Conflicts") {
      output.appendLine(`[${new Date().toISOString()}] ${direction.toUpperCase()} CONFLICTS`);
      for (const conflict of err.conflicts) output.appendLine(`- ${conflict}`);
      output.show(true);
      return;
    }
    if (choice !== "Force Restore") return;
    await scoped.service.handle(command, { force: true });
  }
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(`${direction === "undo" ? "Undid" : "Redid"} last Toolkit change`, 2500);
  if (activePanel?.folder?.uri.toString() === scoped.folder.uri.toString()) await activePanel.refreshState();
}

function registerToolkitCommand<T extends unknown[]>(
  output: vscode.OutputChannel,
  commandId: string,
  handler: (...args: T) => unknown
): vscode.Disposable {
  return vscode.commands.registerCommand(commandId, async (...args: unknown[]) => {
    try {
      return await handler(...args as T);
    } catch (err) {
      if (isUserCancellation(err)) return undefined;
      const workspacePath = workspacePathFromArguments(args);
      logToolkitError(output, commandId, workspacePath, err);
      const message = err instanceof Error ? err.message : String(err);
      const action = await vscode.window.showErrorMessage(`LaTeX Editing Toolkit: ${message}`, "Show Log");
      if (action === "Show Log") output.show(true);
      return undefined;
    }
  });
}

function isUserCancellation(err: unknown): boolean {
  return err instanceof vscode.CancellationError || (err instanceof Error && /cancelled|canceled/i.test(err.message));
}

function workspacePathFromArguments(args: unknown[]): string {
  for (const arg of args) {
    if (arg instanceof vscode.Uri && arg.scheme === "file") return arg.fsPath;
    const projectPath = localProjectPathFromArgument(arg);
    if (projectPath) return projectPath;
  }
  return vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === "file")?.uri.fsPath ?? "(no local workspace)";
}

function logToolkitError(output: vscode.OutputChannel, commandId: string, workspacePath: string, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  output.appendLine(`[${new Date().toISOString()}] ERROR ${commandId}`);
  output.appendLine(`Workspace: ${workspacePath}`);
  output.appendLine(error.stack ?? error.message);
  output.appendLine("");
}

function logCompileResult(output: vscode.OutputChannel, workspacePath: string, result: { success?: boolean; output?: string }): void {
  output.appendLine(`[${new Date().toISOString()}] COMPILE ${result.success ? "SUCCESS" : "FAILED"}`);
  output.appendLine(`Workspace: ${workspacePath}`);
  output.appendLine(result.output?.trimEnd() || "(compiler returned no output)");
  output.appendLine("");
}

async function selectWorkspaceFolder(preferredFolderUri?: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showErrorMessage("Open a local workspace folder before using LaTeX Editing Toolkit.");
    return undefined;
  }
  const localFolders = folders.filter((folder) => folder.uri.scheme === "file");
  if (localFolders.length === 0) {
    vscode.window.showErrorMessage("LaTeX Editing Toolkit currently supports local file workspaces only.");
    return undefined;
  }
  if (preferredFolderUri?.scheme === "file") {
    const matched = localFolders.find((folder) => folder.uri.toString() === preferredFolderUri.toString());
    if (matched) return matched;
  }
  if (localFolders.length === 1) return localFolders[0];
  const picked = await vscode.window.showQuickPick(localFolders.map((folder) => ({ label: folder.name, folder })), { placeHolder: "Select Toolkit workspace" });
  return picked?.folder;
}

async function serviceForCommand(context: vscode.ExtensionContext, preferredFolderUri?: vscode.Uri): Promise<ToolkitService | undefined> {
  return (await folderAndServiceForCommand(context, preferredFolderUri))?.service;
}

async function folderAndServiceForCommand(context: vscode.ExtensionContext, preferredFolderUri?: vscode.Uri): Promise<{ folder: vscode.WorkspaceFolder; service: ToolkitService } | undefined> {
  const folder = await selectWorkspaceFolder(preferredFolderUri);
  if (!folder) return undefined;
  return { folder, service: toolkitService(context, folder.uri.fsPath) };
}

function toolkitService(context: vscode.ExtensionContext, rootPath: string): ToolkitService {
  let canonical = path.resolve(rootPath);
  try { canonical = fs.realpathSync.native(canonical); } catch { /* Missing roots are handled by the caller. */ }
  const key = process.platform === "win32" || process.platform === "darwin" ? canonical.toLocaleLowerCase() : canonical;
  const existing = toolkitServices.get(key);
  if (existing) {
    existing.setAdditionalStylePresets(personalStyles?.definitions() ?? []);
    return existing;
  }
  const service = new ToolkitService(rootPath, context.extensionPath, {
    historyStorageDir: workspaceHistoryStorageRoot(context.globalStorageUri.fsPath, rootPath),
    additionalStylePresets: personalStyles?.definitions() ?? []
  });
  toolkitServices.set(key, service);
  return service;
}

function refreshPersonalStylesOnServices(registry: PersonalStyleRegistry): void {
  const definitions = registry.definitions();
  for (const service of toolkitServices.values()) service.setAdditionalStylePresets(definitions);
}

async function responseForCommand(context: vscode.ExtensionContext, preferredFolderUri?: vscode.Uri): Promise<{ folder: vscode.WorkspaceFolder; service: ToolkitService; response: ResponseState } | undefined> {
  const scoped = await folderAndServiceForCommand(context, preferredFolderUri);
  if (!scoped) return undefined;
  const response = await scoped.service.handle("state", {}) as ResponseState;
  return { ...scoped, response };
}

function pdfForTarget(target: string): string {
  return target && target.endsWith(".tex") ? `${target.slice(0, -4)}.pdf` : "main.pdf";
}

function currentPdfPath(state: ToolkitState): string {
  return state.compile_output_pdf || state.compile_output_pdf_expected || pdfForTarget(state.compile_target);
}

async function openLocalProject(projectPathArg: unknown): Promise<void> {
  const projectPath = localProjectPathFromArgument(projectPathArg);
  if (!projectPath) {
    vscode.window.showWarningMessage("The selected local note project could not be resolved.");
    return;
  }
  try {
    if (!(await fs.promises.stat(projectPath)).isDirectory()) throw new Error("not a directory");
  } catch {
    vscode.window.showWarningMessage(`Local note project not found: ${projectPath}`);
    return;
  }
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectPath), { forceNewWindow: false });
}

async function relocateLocalProject(
  registry: LocalProjectRegistry,
  treeProvider: ToolkitTreeProvider,
  projectPathArg: unknown
): Promise<void> {
  const oldPath = localProjectPathFromArgument(projectPathArg);
  if (!oldPath) {
    vscode.window.showWarningMessage("The selected local note project could not be resolved.");
    return;
  }
  const target = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Relocate Toolkit Project Here"
  });
  if (!target?.[0]) return;
  if (target[0].scheme !== "file") {
    vscode.window.showErrorMessage("LaTeX Editing Toolkit only supports local project folders.");
    return;
  }
  const updated = await registry.relocate(oldPath, target[0].fsPath);
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(`Relocated local note project to ${updated.rootPath}.`, 2500);
}

async function removeLocalProject(
  registry: LocalProjectRegistry,
  treeProvider: ToolkitTreeProvider,
  projectPathArg: unknown
): Promise<void> {
  const projectPath = localProjectPathFromArgument(projectPathArg);
  if (!projectPath) {
    vscode.window.showWarningMessage("The selected local note project could not be resolved.");
    return;
  }
  const project = await registry.find(projectPath);
  const label = project?.label ?? path.basename(path.normalize(projectPath));
  const choice = await vscode.window.showWarningMessage(
    `Forget local note project '${label}'? This only removes it from the Toolkit list and does not delete files.`,
    { modal: true },
    "Forget"
  );
  if (choice !== "Forget") return;
  const removed = await registry.remove(projectPath);
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(removed ? `Forgot local note project '${label}'.` : "Local note project was already removed.", 2500);
}

function localProjectPathFromArgument(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { fsPath?: unknown; resourceUri?: unknown };
  if (typeof candidate.fsPath === "string") return candidate.fsPath;
  const resourceUri = candidate.resourceUri;
  if (resourceUri && typeof resourceUri === "object" && typeof (resourceUri as { fsPath?: unknown }).fsPath === "string") {
    return (resourceUri as { fsPath: string }).fsPath;
  }
  return undefined;
}

async function createStarterInWorkspace(context: vscode.ExtensionContext, treeProvider: ToolkitTreeProvider, folderUri?: vscode.Uri): Promise<void> {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const templates = scoped.response.schema.starter_templates;
  const picked = await vscode.window.showQuickPick(
    templates.map((template) => ({
      label: template.label,
      description: template.id,
      detail: template.description,
      template
    })),
    { placeHolder: "Select starter template" }
  );
  if (!picked) return;
  const outputTarget = await vscode.window.showInputBox({
    title: "Generate Starter",
    prompt: "Workspace-relative .tex file to create",
    value: scoped.response.schema.starter_default_output_target || "main.tex"
  });
  if (!outputTarget) return;
  let overwrite = false;
  if (fs.existsSync(path.resolve(scoped.folder.uri.fsPath, outputTarget))) {
    const ok = await vscode.window.showWarningMessage(`${outputTarget} already exists. Overwrite it?`, { modal: true }, "Overwrite");
    if (ok !== "Overwrite") return;
    overwrite = true;
  }
  const result = await scoped.service.handle("template-bootstrap", {
    template_id: picked.template.id,
    output_target: outputTarget,
    overwrite
  }) as { generated_target?: string };
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(`Generated ${result.generated_target ?? outputTarget}.`, 2500);
}

async function pickCompileTarget(context: vscode.ExtensionContext, treeProvider: ToolkitTreeProvider, folderUri?: vscode.Uri): Promise<void> {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const targets = scoped.response.state.compile_targets;
  if (targets.length === 0) {
    vscode.window.showWarningMessage("No LaTeX compile targets found in this workspace.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    targets.map((target) => ({
      label: target,
      description: target === scoped.response.state.compile_target ? "current" : ""
    })),
    { placeHolder: "Select compile target" }
  );
  if (!picked) return;
  await scoped.service.handle("target", { compile_target: picked.label });
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(`Compile target set to ${picked.label}.`, 2000);
}

async function pickCompileRecipe(context: vscode.ExtensionContext, treeProvider: ToolkitTreeProvider, folderUri?: vscode.Uri): Promise<void> {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const recipes = scoped.response.state.compile_recipes;
  if (recipes.length === 0) {
    vscode.window.showWarningMessage("No VS Code LaTeX recipes found. Generate VS Code settings or use internal fallback.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    recipes.map((recipe) => ({
      label: recipe.name,
      description: recipe.id === scoped.response.state.compile_recipe ? "current" : recipe.id,
      detail: recipe.tools.join(" -> "),
      recipe
    })),
    { placeHolder: "Select compile recipe" }
  );
  if (!picked) return;
  await scoped.service.handle("compile-config", {
    compile_recipe: picked.recipe.id,
    compile_use_internal_fallback: false
  });
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(`Compile recipe set to ${picked.recipe.name}.`, 2000);
}

async function toggleInternalFallback(context: vscode.ExtensionContext, treeProvider: ToolkitTreeProvider, folderUri?: vscode.Uri): Promise<void> {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const next = !scoped.response.state.compile_use_internal_fallback;
  await scoped.service.handle("compile-config", {
    compile_recipe: scoped.response.state.compile_recipe,
    compile_use_internal_fallback: next
  });
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(`Internal fallback ${next ? "enabled" : "disabled"}.`, 2000);
}

async function openCurrentPdf(context: vscode.ExtensionContext, folderUri?: vscode.Uri): Promise<void> {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const rawPath = currentPdfPath(scoped.response.state);
  try {
    const pdfPath = await scoped.service.readPdfIfExists(rawPath);
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(pdfPath));
  } catch {
    vscode.window.showWarningMessage(`PDF not found yet: ${rawPath}`);
  }
}

async function toggleThemeOption(context: vscode.ExtensionContext, treeProvider: ToolkitTreeProvider, folderUri?: vscode.Uri, toggleId?: string): Promise<void> {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped || !toggleId) return;
  const toggle = scoped.response.schema.toggles.find((item) => item.id === toggleId);
  if (!toggle) return;
  const state = scoped.response.state;
  state.toggles[toggleId] = !state.toggles[toggleId];
  await scoped.service.handle("save", state as unknown as Record<string, unknown>);
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(`${toggle.label}: ${state.toggles[toggleId] ? "on" : "off"}.`, 2000);
}

async function pickClassConfig(context: vscode.ExtensionContext, treeProvider: ToolkitTreeProvider, folderUri?: vscode.Uri, fieldId?: string): Promise<void> {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped || !fieldId) return;
  const field = scoped.response.schema.class_config.find((item) => item.id === fieldId);
  if (!field) return;
  const current = scoped.response.state.class_config[field.id];
  const picked = await vscode.window.showQuickPick(
    field.options.map((option) => ({
      label: option.label,
      description: option.value === current ? "current" : option.value,
      option
    })),
    { placeHolder: field.label }
  );
  if (!picked) return;
  const state = scoped.response.state;
  state.class_config[field.id] = picked.option.value;
  await scoped.service.handle("save", state as unknown as Record<string, unknown>);
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(`${field.label}: ${picked.option.label}.`, 2000);
}

async function pickStylePreset(context: vscode.ExtensionContext, treeProvider: ToolkitTreeProvider, folderUri?: vscode.Uri): Promise<void> {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const presets = scoped.response.schema.style_presets;
  const current = scoped.response.state.style_preset;
  const picked = await vscode.window.showQuickPick(
    presets.map((preset) => ({
      label: preset.label,
      description: preset.id === current ? "current" : preset.id,
      detail: preset.description,
      preset
    })),
    { placeHolder: "Select style preset" }
  );
  if (!picked) return;
  await scoped.service.handle("style-preset", { style_preset: picked.preset.id });
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(`Style preset: ${picked.preset.label}.`, 2000);
}

async function pickBodyFontSize(context: vscode.ExtensionContext, treeProvider: ToolkitTreeProvider, folderUri?: vscode.Uri): Promise<void> {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const config = scoped.response.schema.body_font_size;
  const values: number[] = [];
  for (let value = config.min; value <= config.max + config.step / 2; value += config.step) {
    values.push(Number(value.toFixed(2)));
  }
  const current = scoped.response.state.body_font_size_pt;
  const picked = await vscode.window.showQuickPick(
    values.map((value) => ({
      label: `${formatPointSize(value)} pt`,
      description: value === current ? "current" : "",
      value
    })),
    { placeHolder: config.label }
  );
  if (!picked) return;
  const state = scoped.response.state;
  state.body_font_size_pt = picked.value;
  await scoped.service.handle("save", state as unknown as Record<string, unknown>);
  treeProvider.refresh();
  vscode.window.setStatusBarMessage(`${config.label}: ${picked.label}.`, 2000);
}

function formatPointSize(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

interface ToolkitTreeNode {
  id: string;
  label: string;
  kind?: "workspace" | "group" | "action" | "info";
  description?: string;
  tooltip?: string;
  iconId?: string;
  commandId?: string;
  commandArgs?: unknown[];
  children?: ToolkitTreeNode[];
  collapsibleState?: vscode.TreeItemCollapsibleState;
  contextValue?: string;
  resourceUri?: vscode.Uri;
  folderUri?: vscode.Uri;
}

class ToolkitTreeProvider implements vscode.TreeDataProvider<ToolkitTreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ToolkitTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projectRegistry: LocalProjectRegistry
  ) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  getTreeItem(node: ToolkitTreeNode): vscode.TreeItem {
    const collapsibleState = node.collapsibleState
      ?? (node.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    const item = new vscode.TreeItem(node.label, collapsibleState);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip ?? node.label;
    item.contextValue = node.contextValue;
    item.resourceUri = node.resourceUri;
    if (node.iconId) item.iconPath = new vscode.ThemeIcon(node.iconId);
    if (node.commandId) {
      item.command = {
        command: node.commandId,
        title: node.label,
        arguments: node.commandArgs
      };
    }
    return item;
  }

  async getChildren(node?: ToolkitTreeNode): Promise<ToolkitTreeNode[]> {
    if (node) return node.children ?? [];
    return this.rootNodes();
  }

  private async rootNodes(): Promise<ToolkitTreeNode[]> {
    const localFolders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file");
    const nodes: ToolkitTreeNode[] = [];
    nodes.push(await this.localNotesNode());
    nodes.push(await this.overleafMirrorsNode());
    if (localFolders.length === 0) {
      nodes.push({
        id: "open-local-folder",
        label: "Open Local Folder",
        description: "required",
        tooltip: "Open a local folder to use LaTeX Editing Toolkit.",
        iconId: "folder-opened",
        commandId: "workbench.action.files.openFolder",
        contextValue: "openFolder"
      });
    } else {
      nodes.push(...await Promise.all(localFolders.map((folder) => this.workspaceNode(folder, localFolders.length === 1))));
    }
    return nodes;
  }

  private async overleafMirrorsNode(): Promise<ToolkitTreeNode> {
    if (!overleafService) {
      return this.groupNode("overleaf-mirrors", "Overleaf Mirrors", "cloud", [
        this.infoNode("overleaf-unavailable", "Overleaf unavailable", "The sync service has not initialized yet.", "warning")
      ], vscode.TreeItemCollapsibleState.Collapsed);
    }
    const mirrors = await overleafService.listMirrors().catch(() => []);
    const currentRoot = overleafService.realtimeSync.currentRoot;
    const children = mirrors.length
      ? await Promise.all(mirrors.map(async mirror => {
        const state = await overleafService!.state(mirror.root);
        const status = state.conflicts.length > 0 ? "Conflict" : state.syncStatus?.hasBlocking ? "Needs attention" : state.running ? "Syncing" : "Ready";
        const icon = state.conflicts.length > 0 ? "warning" : state.syncStatus?.hasBlocking ? "git-compare" : state.running ? "cloud-upload" : "cloud";
        return this.actionNode(
          `overleaf-mirror:${mirror.root}`,
          mirror.name,
          `${status} · ${path.basename(path.dirname(mirror.root))}`,
          icon,
          "overleafCodex.openLocalMirror",
          [{ mirror }]
        );
      }))
      : [this.infoNode("overleaf-mirrors-empty", "No Overleaf mirrors", "Open a remote project to create a local mirror.", "cloud")];
    return this.groupNode("overleaf-mirrors", "Overleaf Mirrors", "cloud", children, vscode.TreeItemCollapsibleState.Expanded, currentRoot ? "Active mirror connected" : undefined);
  }

  private async localNotesNode(): Promise<ToolkitTreeNode> {
    const projects = await this.projectRegistry.list();
    const openProjectIds = new Set((await Promise.all(
      (vscode.workspace.workspaceFolders ?? [])
        .filter((folder) => folder.uri.scheme === "file")
        .map((folder) => this.projectRegistry.find(folder.uri.fsPath))
    )).filter((project): project is NonNullable<typeof project> => Boolean(project)).map((project) => project.id));
    const children = projects.length > 0
      ? projects.map((project) => this.localProjectNode(project, openProjectIds.has(project.id)))
      : [
          this.infoNode("local-notes-empty", "No local notes yet", "Create a project to add it here.", "info"),
          this.actionNode("local-notes-create", "Create New Project", "from template", "new-folder", "latexEditingToolkit.createProject", [])
        ];
    return this.groupNode(
      "local-notes",
      "Local Notes",
      "book",
      children,
      vscode.TreeItemCollapsibleState.Expanded
    );
  }

  private localProjectNode(project: LocalNoteProjectStatus, isOpen: boolean): ToolkitTreeNode {
    const parent = path.basename(path.dirname(project.rootPath)) || path.dirname(project.rootPath);
    return {
      id: `local-project:${project.id}`,
      label: project.label,
      description: project.missing ? "Missing" : isOpen ? `Open · ${parent}` : parent,
      tooltip: project.missing ? `Project folder not found: ${project.rootPath}` : project.rootPath,
      iconId: project.missing ? "warning" : isOpen ? "root-folder-opened" : "folder",
      commandId: "latexEditingToolkit.openLocalProject",
      commandArgs: [project.rootPath],
      contextValue: project.missing ? "localProjectMissing" : "localProject",
      resourceUri: vscode.Uri.file(project.rootPath)
    };
  }

  private async workspaceNode(folder: vscode.WorkspaceFolder, isOnlyFolder: boolean): Promise<ToolkitTreeNode> {
    const response = await this.loadWorkspaceState(folder);
    const description = response instanceof Error
      ? "Needs attention"
      : `${this.presetLabel(response.schema.style_presets, response.state.style_preset)} · ${this.workspaceBuildSummary(response.state)}`;
    return {
      id: `workspace:${folder.uri.toString()}`,
      label: folder.name,
      description,
      tooltip: folder.uri.fsPath,
      iconId: "root-folder",
      resourceUri: folder.uri,
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      contextValue: "workspace",
      children: response instanceof Error
        ? this.workspaceErrorGroups(folder, response)
        : this.workspaceGroups(folder, response)
    };
  }

  private async loadWorkspaceState(folder: vscode.WorkspaceFolder): Promise<ResponseState | Error> {
    try {
      return await toolkitService(this.context, folder.uri.fsPath).handle("state", {}) as ResponseState;
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  }

  private workspaceGroups(folder: vscode.WorkspaceFolder, response: ResponseState): ToolkitTreeNode[] {
    const folderArg = [folder.uri];
    const state = response.state;
    const schema = response.schema;
    const nodes: ToolkitTreeNode[] = [
      this.actionNode("open-toolkit", "Open Toolkit", "visual workbench", "tools", "latexEditingToolkit.openToolkit", folderArg)
    ];
    if (response.history?.canUndo) nodes.push(this.actionNode("undo-last-change", "Undo Last Change", response.history.label, "discard", "latexEditingToolkit.undoLastChange", folderArg));
    if (response.history?.canRedo) nodes.push(this.actionNode("redo-last-change", "Redo Last Change", response.history.label, "redo", "latexEditingToolkit.redoLastChange", folderArg));
    const activeSnippetProfile = vscode.workspace.getConfiguration("hsnips", folder.uri).get<string>("profiles.activeProfile") || "";
    const snippetFileCount = getSnippetFiles(getSnippetDir(), activeSnippetProfile, path.join(folder.uri.fsPath, ".vscode", "hsnips"), folder.uri.fsPath).length;
    nodes.push(
      this.groupNode(`snippets:${folder.uri.toString()}`, "Snippets", "symbol-snippet", [
        this.actionNode(
          "open-snippet-manager",
          "Open Snippet Manager",
          `${activeSnippetProfile || "base"} · ${snippetFileCount} file${snippetFileCount === 1 ? "" : "s"}`,
          "edit",
          "hsnips.openSnippetManager",
          folderArg
        ),
        this.actionNode("select-snippet-profile", "Select Profile", "base + profile + workspace", "account", "hsnips.selectProfile", folderArg),
        this.actionNode("reload-snippets", "Reload Snippets", ".hsnips files", "refresh", "hsnips.reloadSnippets", folderArg)
      ], vscode.TreeItemCollapsibleState.Collapsed, `${activeSnippetProfile || "Base"} · ${snippetFileCount} files`),
      this.groupNode(`build:${folder.uri.toString()}`, "Build", "play", [
        this.actionNode("compile-pdf", "Compile PDF", state.compile_target || "current target", "play", "latexEditingToolkit.compilePdf", folderArg),
        this.actionNode("open-current-pdf", "Open Current PDF", currentPdfPath(state), "open-preview", "latexEditingToolkit.openCurrentPdf", folderArg),
        this.actionNode("pick-target", "Pick Target", `${state.compile_targets.length} found`, "symbol-file", "latexEditingToolkit.pickCompileTarget", folderArg),
        this.actionNode("pick-recipe", "Pick Recipe", `${state.compile_recipes.length} found`, "settings-gear", "latexEditingToolkit.pickCompileRecipe", folderArg),
        this.actionNode("toggle-internal-fallback", "Internal Fallback", state.compile_use_internal_fallback ? "on" : "off", "debug-restart", "latexEditingToolkit.toggleInternalFallback", folderArg),
        this.actionNode("clean-artifacts", "Clean Build Artifacts", "workspace", "trash", "latexEditingToolkit.cleanArtifacts", folderArg)
      ], vscode.TreeItemCollapsibleState.Expanded),
      this.groupNode(`appearance:${folder.uri.toString()}`, "Appearance", "symbol-color", [
        this.actionNode("pick-style-preset", "Style Preset", this.presetLabel(schema.style_presets, state.style_preset), "symbol-color", "latexEditingToolkit.pickStylePreset", folderArg),
        this.actionNode("pick-body-font-size", "Body Font Size", `${formatPointSize(state.body_font_size_pt)} pt`, "text-size", "latexEditingToolkit.pickBodyFontSize", folderArg),
        this.groupNode(`appearance-toggles:${folder.uri.toString()}`, "Feature Toggles", "checklist", schema.toggles.map((toggle) => (
          this.actionNode(
            `toggle-theme-${toggle.id}`,
            toggle.label,
            state.toggles[toggle.id] ? "on" : "off",
            state.toggles[toggle.id] ? "check" : "circle-slash",
            "latexEditingToolkit.toggleThemeOption",
            [folder.uri, toggle.id]
          )
        )))
      ]),
      this.groupNode(`document:${folder.uri.toString()}`, "Document", "book", [
        this.infoNode(`document-class:${folder.uri.toString()}`, "Detected Class", this.documentClassDescription(state), "symbol-class"),
        this.groupNode(`document-class-config:${folder.uri.toString()}`, "Class Rules", "settings", schema.class_config.map((field) => (
          this.actionNode(
            `pick-class-config-${field.id}`,
            field.label,
            this.optionLabel(field.options, state.class_config[field.id]),
            "settings",
            "latexEditingToolkit.pickClassConfig",
            [folder.uri, field.id]
          )
        )))
      ]),
      this.groupNode(`project:${folder.uri.toString()}`, "Project Tools", "tools", [
        this.actionNode("generate-starter", "Generate Starter", schema.starter_default_output_target || "main.tex", "new-file", "latexEditingToolkit.createStarterInWorkspace", folderArg),
        this.actionNode("initialize-workspace", "Initialize Workspace", "copy", "package", "latexEditingToolkit.initializeWorkspace", folderArg),
        this.actionNode("upgrade-theme-assets", "Upgrade Theme Assets", "backup first", "cloud-download", "latexEditingToolkit.upgradeWorkspaceThemeAssets", folderArg),
        this.actionNode("generate-settings", "Generate VS Code Settings", ".vscode/settings.json", "settings-gear", "latexEditingToolkit.generateVscodeSettings", folderArg),
        this.actionNode("reset-overrides", "Reset All Toolkit Overrides", "deletes all generated settings", "discard", "latexEditingToolkit.resetOverrides", folderArg)
      ]),
      this.groupNode(`structure:${folder.uri.toString()}`, "Structure", "list-tree", [
        this.actionNode("split-current", "Split Current Target", "subfiles", "split-horizontal", "latexEditingToolkit.splitCurrentTarget", folderArg),
        this.actionNode("renumber-units", "Renumber Units", "references", "list-ordered", "latexEditingToolkit.renumberUnits", folderArg),
        this.actionNode("unsplit-unit", "Merge Unit Back To Root", "selected target", "git-merge", "latexEditingToolkit.unsplitUnit", folderArg)
      ])
    );
    if (overleafService) {
      nodes.push(this.groupNode(`sync:${folder.uri.toString()}`, "Sync", "cloud", [
        this.actionNode("sync-status", "Open Sync Workbench", "incremental", "shield", "latexEditingToolkit.openSync", folderArg),
        this.actionNode("sync-start", "Start Realtime Sync", "mirror files", "cloud-upload", "overleafCodex.startRealtimeSync", folderArg),
        this.actionNode("sync-stop", "Stop Realtime Sync", "pause remote updates", "debug-stop", "overleafCodex.stopRealtimeSync", folderArg),
        this.actionNode("sync-conflicts", "Show Conflicts", "manual resolution", "warning", "overleafCodex.showConflicts", folderArg),
        this.actionNode("sync-refresh", "Refresh Sync", "remote status", "refresh", "overleafCodex.refreshViews", folderArg)
      ], vscode.TreeItemCollapsibleState.Collapsed));
    }
    if (state.config_warnings.length > 0 || state.compile_last_success === false) {
      const diagnostics = [this.infoNode(`last-compile:${folder.uri.toString()}`, "Last Compile", this.lastCompileDescription(state), this.lastCompileIcon(state))];
      if (state.config_warnings.length > 0) diagnostics.push({
        ...this.infoNode(`config-warnings:${folder.uri.toString()}`, "Configuration Warnings", `${state.config_warnings.length} warning(s)`, "warning"),
        tooltip: state.config_warnings.join("\n")
      });
      nodes.push(this.groupNode(`diagnostics:${folder.uri.toString()}`, "Diagnostics", "warning", diagnostics, vscode.TreeItemCollapsibleState.Expanded));
    }
    return nodes;
  }

  private workspaceBuildSummary(state: ToolkitState): string {
    if (state.compile_last_success === false) return "Build failed";
    if (state.compile_last_success === true) return "PDF ready";
    return "Not compiled";
  }

  private workspaceErrorGroups(folder: vscode.WorkspaceFolder, error: Error): ToolkitTreeNode[] {
    const folderArg = [folder.uri];
    return [
      this.actionNode("open-toolkit", "Open Toolkit", "visual workbench", "tools", "latexEditingToolkit.openToolkit", folderArg),
      this.groupNode(`diagnostics:${folder.uri.toString()}`, "Diagnostics", "warning", [
        this.infoNode(`state-error:${folder.uri.toString()}`, "State Unavailable", error.message, "error")
      ], vscode.TreeItemCollapsibleState.Expanded),
      this.groupNode(`project:${folder.uri.toString()}`, "Project Tools", "repo", [
        this.actionNode("generate-starter", "Generate Starter", "main.tex", "new-file", "latexEditingToolkit.createStarterInWorkspace", folderArg),
        this.actionNode("initialize-workspace", "Initialize Workspace", "copy", "package", "latexEditingToolkit.initializeWorkspace", folderArg),
        this.actionNode("upgrade-theme-assets", "Upgrade Theme Assets", "backup first", "cloud-download", "latexEditingToolkit.upgradeWorkspaceThemeAssets", folderArg),
        this.actionNode("generate-settings", "Generate VS Code Settings", ".vscode/settings.json", "settings-gear", "latexEditingToolkit.generateVscodeSettings", folderArg)
      ], vscode.TreeItemCollapsibleState.Expanded)
    ];
  }

  private groupNode(id: string, label: string, iconId: string, children: ToolkitTreeNode[], collapsibleState = vscode.TreeItemCollapsibleState.Collapsed, description?: string): ToolkitTreeNode {
    return {
      id,
      label,
      description,
      iconId,
      children,
      collapsibleState,
      contextValue: "group"
    };
  }

  private actionNode(id: string, label: string, description: string, iconId: string, commandId: string, commandArgs: unknown[]): ToolkitTreeNode {
    return {
      id: `${id}:${String(commandArgs[0])}`,
      label,
      description,
      tooltip: description ? `${label}: ${description}` : label,
      iconId,
      commandId,
      commandArgs,
      contextValue: "action"
    };
  }

  private infoNode(id: string, label: string, description: string, iconId: string): ToolkitTreeNode {
    return {
      id,
      label,
      description,
      tooltip: description ? `${label}: ${description}` : label,
      iconId,
      contextValue: "info"
    };
  }

  private compileRecipeDescription(state: ToolkitState): string {
    if (state.compile_use_internal_fallback) return "internal fallback";
    return state.compile_recipe_name || state.compile_recipe || "not set";
  }

  private lastCompileDescription(state: ToolkitState): string {
    if (state.compile_last_success === null) return "not run";
    const status = state.compile_last_success ? "succeeded" : "failed";
    return state.compile_last_compile_at ? `${status} ${this.formatTimestamp(state.compile_last_compile_at)}` : status;
  }

  private lastCompileIcon(state: ToolkitState): string {
    if (state.compile_last_success === null) return "circle-outline";
    return state.compile_last_success ? "pass-filled" : "error";
  }

  private documentClassDescription(state: ToolkitState): string {
    const detected = state.detected_document_class || "unknown";
    const effective = state.effective_theme_class || "auto";
    const chapter = state.detected_document_class_has_chapter ? "chapter" : "section";
    return `${detected} -> ${effective}, ${chapter} headings`;
  }

  private presetLabel(presets: Array<{ id: string; label: string }>, value: string): string {
    return presets.find((preset) => preset.id === value)?.label ?? value;
  }

  private optionLabel(options: Array<{ value: string; label: string }>, value: string): string {
    return options.find((option) => option.value === value)?.label ?? value;
  }

  private formatTimestamp(raw: string): string {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
}

class ToolkitPanel {
  private readonly service: ToolkitService | undefined;
  private readonly snippetService: SnippetService;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  static createOrShow(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder | undefined, output: vscode.OutputChannel, styleRegistry: PersonalStyleRegistry, onStateChanged: () => void): ToolkitPanel {
    const panelKey = folder?.uri.toString() || "global-snippets";
    if (activePanel) {
      if (activePanel.panelKey === panelKey) {
        activePanel.panel.reveal(vscode.ViewColumn.One);
        return activePanel;
      }
      activePanel.dispose();
    }
    const panel = vscode.window.createWebviewPanel(
      "latexEditingToolkit.toolkit",
      "LaTeX Editing Toolkit",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "dist")),
          vscode.Uri.file(path.join(context.extensionPath, "dist", "monaco"))
        ]
      }
    );
    return new ToolkitPanel(context, folder, panel, output, styleRegistry, onStateChanged);
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    readonly folder: vscode.WorkspaceFolder | undefined,
    readonly panel: vscode.WebviewPanel,
    private readonly output: vscode.OutputChannel,
    private readonly styleRegistry: PersonalStyleRegistry,
    private readonly onStateChanged: () => void
  ) {
    this.service = folder ? toolkitService(context, folder.uri.fsPath) : undefined;
    this.snippetService = new SnippetService(folder?.uri.fsPath);
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.disposables);
  }

  private get panelKey(): string {
    return this.folder?.uri.toString() || "global-snippets";
  }

  private requireService(): ToolkitService {
    if (!this.service) throw new Error("Open a local workspace to use this Toolkit section.");
    return this.service;
  }

  private get workspacePath(): string {
    return this.folder?.uri.fsPath || "global-snippets";
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    activePanel = undefined;
    try {
      this.panel.dispose();
    } catch {
      // The panel may already be disposed by VS Code.
    }
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }

  async refreshState(): Promise<void> {
    if (!this.service) return;
    const data = await this.service.handle("state", {});
    await this.panel.webview.postMessage({ type: "toolkit-state-refresh", data });
  }

  async openSection(section: "snippets" | "sync"): Promise<void> {
    this.panel.reveal(vscode.ViewColumn.One);
    await this.panel.webview.postMessage({ type: "toolkit-open-section", section });
  }

  private async handleMessage(message: unknown): Promise<void> {
    const request = message as { id?: string; command?: string; payload?: Record<string, unknown> };
    if (!request?.id || !request.command) return;
    try {
      let data: unknown;
      if (request.command === "confirm-action") {
        const action = request.payload?.action;
        if (!isConfirmAction(action)) throw new Error("Unknown Toolkit confirmation action.");
        const spec = confirmationSpec(action, String(request.payload?.detail ?? ""));
        const choice = await vscode.window.showWarningMessage(
          spec.message,
          { modal: true, detail: spec.detail },
          spec.confirmLabel
        );
        data = { confirmed: choice === spec.confirmLabel };
      } else if (request.command === "show-log") {
        this.output.show(true);
        data = { shown: true };
      } else if (request.command === "snippets-state" || request.command === "snippets-reload") {
        if (request.command === "snippets-reload") await vscode.commands.executeCommand("hsnips.reloadSnippets");
        data = await this.snippetService.state();
      } else if (request.command === "snippets-analyze") {
        data = await this.snippetService.analyze(String(request.payload?.file_path ?? ""), String(request.payload?.content ?? ""));
      } else if (request.command === "snippets-save") {
        data = await this.snippetService.save(
          String(request.payload?.file_path ?? ""),
          String(request.payload?.content ?? ""),
          typeof request.payload?.document_hash === "string" ? request.payload.document_hash : undefined,
          typeof request.payload?.mtime_ms === "number" ? request.payload.mtime_ms : undefined
        );
      } else if (request.command === "snippets-open-source") {
        await this.snippetService.openSource(String(request.payload?.file_path ?? ""), Number(request.payload?.line ?? 1));
        data = { opened: true };
      } else if (request.command === "snippets-create-file") {
        const scope = String(request.payload?.scope ?? "base");
        if (scope !== "base" && scope !== "profile" && scope !== "workspace") throw new Error("Unknown snippet scope.");
        data = await this.snippetService.create(String(request.payload?.language ?? "latex"), scope);
      } else if (request.command === "snippets-select-profile") {
        const profile = String(request.payload?.profile ?? "").trim();
        const current = await this.snippetService.state();
        if (profile && !current.profiles.includes(profile)) throw new Error("Unknown snippet profile.");
        await vscode.workspace.getConfiguration("hsnips").update("profiles.activeProfile", profile, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand("hsnips.reloadSnippets");
        data = await this.snippetService.state();
      } else if (request.command === "snippets-open-directory") {
        const scope = String(request.payload?.scope ?? "base");
        if (scope === "base") await vscode.commands.executeCommand("hsnips.openSnippetsDir");
        else if (scope === "profile") await vscode.commands.executeCommand("hsnips.openActiveProfile");
        else if (scope === "workspace") await vscode.commands.executeCommand("hsnips.openWorkspaceSnippetsDir");
        else throw new Error("Unknown snippet directory scope.");
        data = { opened: true };
      } else if (request.command.startsWith("overleaf-")) {
        if (!overleafService) throw new Error("Overleaf service is unavailable.");
        const payload = { ...(request.payload ?? {}) };
        if (this.folder?.uri.scheme === "file" && payload.workspacePath === undefined) {
          payload.workspacePath = this.folder.uri.fsPath;
        }
        data = request.command === "overleaf-pdf-status"
          ? await overleafService.pdfStatus(payload.workspacePath)
          : await overleafService.handle(request.command, payload);
      } else if (request.command === "pdf-status") {
        const service = this.requireService();
        const rawPath = String(request.payload?.path ?? "");
        const pdfPath = service.resolvePdfPath(rawPath);
        let exists = false;
        try {
          const stat = await fs.promises.stat(pdfPath);
          exists = stat.isFile();
        } catch {
          exists = false;
        }
        data = { path: rawPath || path.basename(pdfPath), exists };
      } else if (request.command === "open-pdf") {
        const service = this.requireService();
        const rawPath = String(request.payload?.path ?? "");
        const pdfPath = await service.readPdfIfExists(rawPath);
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(pdfPath));
        data = { opened: true };
      } else if (request.command === "personal-style-save") {
        const service = this.requireService();
        const state = request.payload?.state;
        if (!isPlainRecord(state) || !isPlainRecord(state.colors)) throw new Error("Current style state is unavailable.");
        const label = await vscode.window.showInputBox({ title: "Save as Personal Style", prompt: "Style name", validateInput: (value) => value.trim() ? undefined : "Style name is required." });
        if (!label) {
          data = await service.handle("state", {});
        } else {
          const record = await this.styleRegistry.add(label, String(state.style_base_preset ?? state.style_preset ?? "default"), state.colors as Record<string, string>);
          refreshPersonalStylesOnServices(this.styleRegistry);
          service.setAdditionalStylePresets(this.styleRegistry.definitions());
          data = await service.handle("autosave", { revision: request.payload?.revision ?? 0, state: { ...state, style_preset: record.id, style_base_preset: record.basePresetId } });
        }
      } else if (request.command === "personal-style-update") {
        const service = this.requireService();
        const state = request.payload?.state;
        if (!isPlainRecord(state) || !isPlainRecord(state.colors)) throw new Error("Current style state is unavailable.");
        await this.styleRegistry.update(String(request.payload?.style_id ?? state.style_preset ?? ""), state.colors as Record<string, string>);
        refreshPersonalStylesOnServices(this.styleRegistry);
        data = await service.handle("state", {});
      } else if (request.command === "personal-style-rename") {
        const service = this.requireService();
        const id = String(request.payload?.style_id ?? "");
        const current = this.styleRegistry.list().find((style) => style.id === id);
        if (!current) throw new Error("Personal style not found.");
        const label = await vscode.window.showInputBox({ title: "Rename Personal Style", value: current.label, validateInput: (value) => value.trim() ? undefined : "Style name is required." });
        if (label) await this.styleRegistry.rename(id, label);
        refreshPersonalStylesOnServices(this.styleRegistry);
        data = await service.handle("state", {});
      } else if (request.command === "personal-style-delete") {
        const service = this.requireService();
        const id = String(request.payload?.style_id ?? "");
        const current = this.styleRegistry.list().find((style) => style.id === id);
        if (!current) throw new Error("Personal style not found.");
        const confirmed = await vscode.window.showWarningMessage(`Delete personal style '${current.label}'? Project colors will not be deleted.`, { modal: true }, "Delete Style");
        if (confirmed !== "Delete Style") data = await service.handle("state", {});
        else {
          await this.styleRegistry.remove(id);
          refreshPersonalStylesOnServices(this.styleRegistry);
          service.setAdditionalStylePresets(this.styleRegistry.definitions());
          const state = request.payload?.state;
          data = isPlainRecord(state) && state.style_preset === id
            ? await service.handle("autosave", { revision: request.payload?.revision ?? 0, state: { ...state, style_preset: current.basePresetId, style_base_preset: current.basePresetId } })
            : await service.handle("state", {});
        }
      } else if (request.command === "personal-style-import") {
        const service = this.requireService();
        const picked = await vscode.window.showOpenDialog({ title: "Import Personal Styles", canSelectMany: false, filters: { JSON: ["json"] } });
        if (!picked?.[0]) data = await service.handle("state", {});
        else {
          const raw = JSON.parse(await fs.promises.readFile(picked[0].fsPath, "utf8"));
          const summary = await this.styleRegistry.importLibrary(raw);
          refreshPersonalStylesOnServices(this.styleRegistry);
          data = { ...(await service.handle("state", {}) as Record<string, unknown>), personal_style_import: summary };
        }
      } else if (request.command === "personal-style-export") {
        const service = this.requireService();
        const id = String(request.payload?.style_id ?? "");
        const library = this.styleRegistry.exportLibrary();
        const styles = id ? library.styles.filter((style) => style.id === id) : library.styles;
        const target = await vscode.window.showSaveDialog({ title: "Export Personal Styles", defaultUri: vscode.Uri.file(path.join(this.workspacePath, id ? "personal-style.json" : "latex-toolkit-styles.json")), filters: { JSON: ["json"] } });
        if (target) await fs.promises.writeFile(target.fsPath, `${JSON.stringify({ version: 1, styles }, null, 2)}\n`, "utf8");
        data = { ...(await service.handle("state", {}) as Record<string, unknown>), exported: Boolean(target) };
      } else if (request.command === "undo-last-change" || request.command === "redo-last-change") {
        const service = this.requireService();
        try {
          data = await service.handle(request.command, request.payload ?? {});
        } catch (err) {
          if (!(err instanceof HistoryConflictError)) throw err;
          const direction = request.command.startsWith("undo") ? "undo" : "redo";
          const choice = await vscode.window.showWarningMessage(
            `Cannot ${direction}: ${err.conflicts.length} tracked item(s) changed outside the recorded operation.`,
            { modal: true },
            "Show Conflicts",
            "Force Restore"
          );
          if (choice === "Show Conflicts") {
            this.output.appendLine(`[${new Date().toISOString()}] ${direction.toUpperCase()} CONFLICTS`);
            for (const conflict of err.conflicts) this.output.appendLine(`- ${conflict}`);
            this.output.show(true);
            data = await service.handle("state", {});
          } else if (choice === "Force Restore") data = await service.handle(request.command, { force: true });
          else data = await service.handle("state", {});
        }
      } else {
        data = await this.requireService().handle(request.command, request.payload ?? {});
      }
      if (request.command === "compile") {
        logCompileResult(this.output, this.workspacePath, data as { success?: boolean; output?: string });
      }
      if (["autosave", "undo-last-change", "redo-last-change", "reset", "upgrade-theme-assets", "template-bootstrap", "split", "renumber", "unsplit", "personal-style-save", "personal-style-delete"].includes(request.command)) {
        this.onStateChanged();
      }
      await this.panel.webview.postMessage({ id: request.id, ok: true, data });
    } catch (err) {
      logToolkitError(this.output, `webview:${request.command}`, this.workspacePath, err);
      await this.panel.webview.postMessage({ id: request.id, ok: false, error: (err as Error).message });
    }
  }

  private html(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview.js")));
    const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview.css")));
    const codiconStyleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "dist", "codicon.css")));
    const monacoRootUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "dist", "monaco", "vs")));
    const nonce = String(Date.now()) + String(Math.random()).slice(2);
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval'`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
      `worker-src ${webview.cspSource} blob: data:`,
      `connect-src ${webview.cspSource}`
    ].join("; ");
    const initial = JSON.stringify({
      workspaceName: this.folder?.name || "Global Snippets",
      workspacePath: this.folder?.uri.fsPath || "global-snippets",
      snippetsOnly: !this.folder,
      monacoBaseUri: monacoRootUri.toString()
    });
    const cssExists = fs.existsSync(path.join(this.context.extensionPath, "dist", "webview.css"));
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>LaTeX Editing Toolkit</title>
  <link rel="stylesheet" href="${codiconStyleUri}">
  ${cssExists ? `<link rel="stylesheet" href="${styleUri}">` : ""}
</head>
<body>
  <div id="app" data-initial='${initial.replace(/'/g, "&#39;")}'></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
