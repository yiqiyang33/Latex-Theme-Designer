import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import { ToolkitService } from "./toolkitService";
import type { ResponseState, ToolkitState } from "./types";

let activePanel: ToolkitPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const treeProvider = new ToolkitTreeProvider(context);

  context.subscriptions.push(
    treeProvider,
    vscode.window.registerTreeDataProvider("latexEditingToolkit.actions", treeProvider),
    vscode.workspace.onDidChangeWorkspaceFolders(() => treeProvider.refresh()),
    vscode.commands.registerCommand("latexEditingToolkit.openToolkit", async (folderUri?: vscode.Uri) => {
      const folder = await selectWorkspaceFolder(folderUri);
      if (!folder) return;
      activePanel = ToolkitPanel.createOrShow(context, folder);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.createProject", async () => {
      const target = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Create Toolkit Project Here"
      });
      if (!target?.[0]) return;
      if (target[0].scheme !== "file") {
        vscode.window.showErrorMessage("LaTeX Editing Toolkit currently supports local file workspaces only.");
        return;
      }
      const pickedTemplate = await vscode.window.showQuickPick(
        STARTER_TEMPLATE_DEFINITIONS.map((template) => ({
          label: template.label,
          description: template.id,
          detail: template.description,
          template
        })),
        { placeHolder: "Select starter template" }
      );
      if (!pickedTemplate) return;
      const service = new ToolkitService(target[0].fsPath, context.extensionPath);
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Creating LaTeX Toolkit project" }, async () => {
        await service.handle("initialize-workspace", {});
        await service.handle("template-bootstrap", { template_id: pickedTemplate.template.id, output_target: "main.tex", overwrite: false });
      });
      vscode.window.showInformationMessage(`Created LaTeX Toolkit project in ${target[0].fsPath}.`);
      treeProvider.refresh();
      await vscode.commands.executeCommand("vscode.openFolder", target[0], { forceNewWindow: false });
    }),
    vscode.commands.registerCommand("latexEditingToolkit.refreshTree", () => {
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand("latexEditingToolkit.createStarterInWorkspace", async (folderUri?: vscode.Uri) => {
      await createStarterInWorkspace(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickCompileTarget", async (folderUri?: vscode.Uri) => {
      await pickCompileTarget(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickCompileRecipe", async (folderUri?: vscode.Uri) => {
      await pickCompileRecipe(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.toggleInternalFallback", async (folderUri?: vscode.Uri) => {
      await toggleInternalFallback(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.openCurrentPdf", async (folderUri?: vscode.Uri) => {
      await openCurrentPdf(context, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.toggleThemeOption", async (folderUri?: vscode.Uri, toggleId?: string) => {
      await toggleThemeOption(context, treeProvider, folderUri, toggleId);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickClassConfig", async (folderUri?: vscode.Uri, fieldId?: string) => {
      await pickClassConfig(context, treeProvider, folderUri, fieldId);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickBlockPreset", async (folderUri?: vscode.Uri) => {
      await pickPreset(context, treeProvider, folderUri, "block");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickHeadingTocPreset", async (folderUri?: vscode.Uri) => {
      await pickPreset(context, treeProvider, folderUri, "heading");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickBodyFontSize", async (folderUri?: vscode.Uri) => {
      await pickBodyFontSize(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.initializeWorkspace", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const result = await service.handle("initialize-workspace", {});
      treeProvider.refresh();
      vscode.window.showInformationMessage(`Initialized LaTeX Toolkit workspace: ${JSON.stringify(result)}`);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.upgradeWorkspaceThemeAssets", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const choice = await vscode.window.showWarningMessage(
        "Upgrade workspace theme assets from the bundled extension template? Existing files will be backed up first.",
        { modal: true },
        "Upgrade + Reset Colors",
        "Upgrade Assets Only"
      );
      if (!choice) return;
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Upgrading LaTeX Toolkit theme assets" },
        () => service.handle("upgrade-theme-assets", { reset_color_overrides: choice === "Upgrade + Reset Colors" })
      ) as { backup_dir?: string; upgraded_files?: string[]; reset_files?: string[] };
      const resetSuffix = result.reset_files?.length ? ` Reset ${result.reset_files.length} color override file(s).` : "";
      treeProvider.refresh();
      vscode.window.showInformationMessage(`Upgraded ${result.upgraded_files?.length ?? 0} theme asset(s). Backup: ${result.backup_dir}.${resetSuffix}`);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.generateVscodeSettings", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const result = await service.handle("vscode-settings-generate", {}) as { message?: string };
      treeProvider.refresh();
      vscode.window.showInformationMessage(result.message ?? "VS Code settings checked.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.saveOverrides", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: unknown };
      await service.handle("save", response.state as Record<string, unknown>);
      treeProvider.refresh();
      vscode.window.showInformationMessage("Saved LaTeX Toolkit overrides.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.resetOverrides", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const ok = await vscode.window.showWarningMessage("Delete theme.ui.json, theme.overrides.tex, and theme.colors.tex?", { modal: true }, "Delete");
      if (ok !== "Delete") return;
      await service.handle("reset", {});
      treeProvider.refresh();
      vscode.window.showInformationMessage("Deleted LaTeX Toolkit override files.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.compilePdf", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: Record<string, unknown> };
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Compiling LaTeX PDF" }, () => service.handle("compile", response.state));
      const success = Boolean((result as { success?: boolean }).success);
      treeProvider.refresh();
      vscode.window.showInformationMessage(success ? "LaTeX compile succeeded." : "LaTeX compile failed. Open Toolkit for logs.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.cleanArtifacts", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const ok = await vscode.window.showWarningMessage("Clean LaTeX build artifacts in the workspace?", { modal: true }, "Clean");
      if (ok !== "Clean") return;
      const result = await service.handle("clean", {}) as { deleted_count?: number; errors?: string[] };
      treeProvider.refresh();
      vscode.window.showInformationMessage(`Cleaned ${result.deleted_count ?? 0} file(s).${result.errors?.length ? " Some errors occurred." : ""}`);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.splitCurrentTarget", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: { compile_target?: string } };
      await service.handle("split", { compile_target: response.state.compile_target ?? "main.tex", dry_run: false });
      treeProvider.refresh();
      vscode.window.showInformationMessage("Split current LaTeX target.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.renumberUnits", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: { compile_target?: string } };
      await service.handle("renumber", { compile_target: response.state.compile_target ?? "main.tex", mode: "add", dry_run: false });
      treeProvider.refresh();
      vscode.window.showInformationMessage("Renumbered referenced units.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.unsplitUnit", async (folderUri?: vscode.Uri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: { compile_target?: string } };
      const ok = await vscode.window.showWarningMessage("Merge selected subfiles unit back to its root and delete the source unit?", { modal: true }, "Merge");
      if (ok !== "Merge") return;
      await service.handle("unsplit", { compile_target: response.state.compile_target ?? "", dry_run: false, delete_source: true });
      treeProvider.refresh();
      vscode.window.showInformationMessage("Merged selected unit back to root.");
    })
  );
}

export function deactivate(): void {
  activePanel?.dispose();
  activePanel = undefined;
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
  return { folder, service: new ToolkitService(folder.uri.fsPath, context.extensionPath) };
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
  vscode.window.showInformationMessage(`Generated ${result.generated_target ?? outputTarget}.`);
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
  vscode.window.showInformationMessage(`Compile target set to ${picked.label}.`);
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
  vscode.window.showInformationMessage(`Compile recipe set to ${picked.recipe.name}.`);
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
  vscode.window.showInformationMessage(`Internal fallback ${next ? "enabled" : "disabled"}.`);
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
  vscode.window.showInformationMessage(`${toggle.label}: ${state.toggles[toggleId] ? "on" : "off"}.`);
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
  vscode.window.showInformationMessage(`${field.label}: ${picked.option.label}.`);
}

async function pickPreset(context: vscode.ExtensionContext, treeProvider: ToolkitTreeProvider, folderUri: vscode.Uri | undefined, kind: "block" | "heading"): Promise<void> {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const presets = kind === "block" ? scoped.response.schema.block_presets : scoped.response.schema.heading_toc_presets;
  const current = kind === "block" ? scoped.response.state.block_preset : scoped.response.state.heading_toc_preset;
  const picked = await vscode.window.showQuickPick(
    presets.map((preset) => ({
      label: preset.label,
      description: preset.id === current ? "current" : preset.id,
      detail: preset.description,
      preset
    })),
    { placeHolder: kind === "block" ? "Select block preset" : "Select heading/TOC preset" }
  );
  if (!picked) return;
  await scoped.service.handle(kind === "block" ? "block-preset" : "heading-toc-preset", {
    [kind === "block" ? "block_preset" : "heading_toc_preset"]: picked.preset.id
  });
  treeProvider.refresh();
  vscode.window.showInformationMessage(`${kind === "block" ? "Block" : "Heading/TOC"} preset: ${picked.preset.label}.`);
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
  vscode.window.showInformationMessage(`${config.label}: ${picked.label}.`);
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

  constructor(private readonly context: vscode.ExtensionContext) {}

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
    nodes.push({
      id: "create-new-project",
      label: "Create New Project",
      description: "from template",
      tooltip: "Create a LaTeX Toolkit project in a selected local folder.",
      iconId: "new-folder",
      commandId: "latexEditingToolkit.createProject",
      contextValue: "createProject"
    });
    return nodes;
  }

  private async workspaceNode(folder: vscode.WorkspaceFolder, isOnlyFolder: boolean): Promise<ToolkitTreeNode> {
    const description = isOnlyFolder ? path.dirname(folder.uri.fsPath) : folder.uri.fsPath;
    const response = await this.loadWorkspaceState(folder);
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
      return await new ToolkitService(folder.uri.fsPath, this.context.extensionPath).handle("state", {}) as ResponseState;
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  }

  private workspaceGroups(folder: vscode.WorkspaceFolder, response: ResponseState): ToolkitTreeNode[] {
    const folderArg = [folder.uri];
    const state = response.state;
    const schema = response.schema;
    return [
      this.groupNode(`status:${folder.uri.toString()}`, "Status", "pulse", [
        this.actionNode("status-target", "Target", state.compile_target || "select target", "symbol-file", "latexEditingToolkit.pickCompileTarget", folderArg),
        this.actionNode("status-recipe", "Recipe", this.compileRecipeDescription(state), "settings-gear", "latexEditingToolkit.pickCompileRecipe", folderArg),
        this.actionNode("status-pdf", "PDF", currentPdfPath(state), "open-preview", "latexEditingToolkit.openCurrentPdf", folderArg),
        this.infoNode(`status-last-compile:${folder.uri.toString()}`, "Last Compile", this.lastCompileDescription(state), this.lastCompileIcon(state)),
        this.infoNode(`status-class:${folder.uri.toString()}`, "Document Class", this.documentClassDescription(state), "symbol-class")
      ], vscode.TreeItemCollapsibleState.Expanded),
      this.groupNode(`project:${folder.uri.toString()}`, "Project", "repo", [
        this.actionNode("open-toolkit", "Open Toolkit", "webview", "tools", "latexEditingToolkit.openToolkit", folderArg),
        this.actionNode("generate-starter", "Generate Starter", schema.starter_default_output_target || "main.tex", "new-file", "latexEditingToolkit.createStarterInWorkspace", folderArg),
        this.actionNode("initialize-workspace", "Initialize Workspace", "copy", "package", "latexEditingToolkit.initializeWorkspace", folderArg),
        this.actionNode("upgrade-theme-assets", "Upgrade Theme Assets", "backup first", "cloud-download", "latexEditingToolkit.upgradeWorkspaceThemeAssets", folderArg),
        this.actionNode("generate-settings", "Generate VS Code Settings", ".vscode/settings.json", "settings-gear", "latexEditingToolkit.generateVscodeSettings", folderArg)
      ]),
      this.groupNode(`build:${folder.uri.toString()}`, "Build", "run-all", [
        this.actionNode("compile-pdf", "Compile PDF", state.compile_target || "current target", "play", "latexEditingToolkit.compilePdf", folderArg),
        this.actionNode("pick-target", "Pick Target", `${state.compile_targets.length} found`, "symbol-file", "latexEditingToolkit.pickCompileTarget", folderArg),
        this.actionNode("pick-recipe", "Pick Recipe", `${state.compile_recipes.length} found`, "settings-gear", "latexEditingToolkit.pickCompileRecipe", folderArg),
        this.actionNode("toggle-internal-fallback", "Internal Fallback", state.compile_use_internal_fallback ? "on" : "off", "debug-restart", "latexEditingToolkit.toggleInternalFallback", folderArg),
        this.actionNode("open-current-pdf", "Open Current PDF", currentPdfPath(state), "open-preview", "latexEditingToolkit.openCurrentPdf", folderArg),
        this.actionNode("clean-artifacts", "Clean Build Artifacts", "workspace", "trash", "latexEditingToolkit.cleanArtifacts", folderArg)
      ], vscode.TreeItemCollapsibleState.Expanded),
      this.groupNode(`structure:${folder.uri.toString()}`, "Structure", "list-tree", [
        this.actionNode("split-current", "Split Current Target", "subfiles", "split-horizontal", "latexEditingToolkit.splitCurrentTarget", folderArg),
        this.actionNode("renumber-units", "Renumber Units", "references", "list-ordered", "latexEditingToolkit.renumberUnits", folderArg),
        this.actionNode("unsplit-unit", "Merge Unit Back To Root", "selected target", "git-merge", "latexEditingToolkit.unsplitUnit", folderArg)
      ]),
      this.groupNode(`theme:${folder.uri.toString()}`, "Theme", "symbol-color", [
        this.groupNode(`theme-presets:${folder.uri.toString()}`, "Presets", "symbol-misc", [
          this.actionNode("pick-block-preset", "Block Preset", this.presetLabel(schema.block_presets, state.block_preset), "symbol-color", "latexEditingToolkit.pickBlockPreset", folderArg),
          this.actionNode("pick-heading-toc-preset", "Heading/TOC Preset", this.presetLabel(schema.heading_toc_presets, state.heading_toc_preset), "list-flat", "latexEditingToolkit.pickHeadingTocPreset", folderArg),
          this.actionNode("pick-body-font-size", "Body Font Size", `${formatPointSize(state.body_font_size_pt)} pt`, "text-size", "latexEditingToolkit.pickBodyFontSize", folderArg)
        ], vscode.TreeItemCollapsibleState.Expanded),
        this.groupNode(`theme-class-config:${folder.uri.toString()}`, "Class Rules", "symbol-class", schema.class_config.map((field) => (
          this.actionNode(
            `pick-class-config-${field.id}`,
            field.label,
            this.optionLabel(field.options, state.class_config[field.id]),
            "settings",
            "latexEditingToolkit.pickClassConfig",
            [folder.uri, field.id]
          )
        )), vscode.TreeItemCollapsibleState.Expanded),
        this.groupNode(`theme-toggles:${folder.uri.toString()}`, "Feature Toggles", "checklist", schema.toggles.map((toggle) => (
          this.actionNode(
            `toggle-theme-${toggle.id}`,
            toggle.label,
            state.toggles[toggle.id] ? "on" : "off",
            state.toggles[toggle.id] ? "check" : "circle-slash",
            "latexEditingToolkit.toggleThemeOption",
            [folder.uri, toggle.id]
          )
        )), vscode.TreeItemCollapsibleState.Expanded),
        this.actionNode("save-overrides", "Save Overrides", "theme files", "save", "latexEditingToolkit.saveOverrides", folderArg),
        this.actionNode("reset-overrides", "Reset Overrides", "delete generated files", "discard", "latexEditingToolkit.resetOverrides", folderArg)
      ])
    ];
  }

  private workspaceErrorGroups(folder: vscode.WorkspaceFolder, error: Error): ToolkitTreeNode[] {
    const folderArg = [folder.uri];
    return [
      this.groupNode(`status:${folder.uri.toString()}`, "Status", "warning", [
        this.infoNode(`state-error:${folder.uri.toString()}`, "State Unavailable", error.message, "error"),
        this.actionNode("open-toolkit", "Open Toolkit", "webview", "tools", "latexEditingToolkit.openToolkit", folderArg)
      ], vscode.TreeItemCollapsibleState.Expanded),
      this.groupNode(`project:${folder.uri.toString()}`, "Project", "repo", [
        this.actionNode("generate-starter", "Generate Starter", "main.tex", "new-file", "latexEditingToolkit.createStarterInWorkspace", folderArg),
        this.actionNode("initialize-workspace", "Initialize Workspace", "copy", "package", "latexEditingToolkit.initializeWorkspace", folderArg),
        this.actionNode("upgrade-theme-assets", "Upgrade Theme Assets", "backup first", "cloud-download", "latexEditingToolkit.upgradeWorkspaceThemeAssets", folderArg),
        this.actionNode("generate-settings", "Generate VS Code Settings", ".vscode/settings.json", "settings-gear", "latexEditingToolkit.generateVscodeSettings", folderArg)
      ], vscode.TreeItemCollapsibleState.Expanded)
    ];
  }

  private groupNode(id: string, label: string, iconId: string, children: ToolkitTreeNode[], collapsibleState = vscode.TreeItemCollapsibleState.Collapsed): ToolkitTreeNode {
    return {
      id,
      label,
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
      tooltip: label,
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
  private readonly service: ToolkitService;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  static createOrShow(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): ToolkitPanel {
    if (activePanel) {
      if (activePanel.folder.uri.toString() === folder.uri.toString()) {
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
          vscode.Uri.file(folder.uri.fsPath)
        ]
      }
    );
    return new ToolkitPanel(context, folder, panel);
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly folder: vscode.WorkspaceFolder,
    readonly panel: vscode.WebviewPanel
  ) {
    this.service = new ToolkitService(folder.uri.fsPath, context.extensionPath);
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.disposables);
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

  private async handleMessage(message: unknown): Promise<void> {
    const request = message as { id?: string; command?: string; payload?: Record<string, unknown> };
    if (!request?.id || !request.command) return;
    try {
      let data: unknown;
      if (request.command === "pdf-uri") {
        const rawPath = String(request.payload?.path ?? "");
        const pdfPath = await this.service.readPdfIfExists(rawPath);
        data = { uri: this.panel.webview.asWebviewUri(vscode.Uri.file(pdfPath)).toString(), path: rawPath };
      } else if (request.command === "open-pdf") {
        const rawPath = String(request.payload?.path ?? "");
        const pdfPath = await this.service.readPdfIfExists(rawPath);
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(pdfPath));
        data = { opened: true };
      } else {
        data = await this.service.handle(request.command, request.payload ?? {});
      }
      await this.panel.webview.postMessage({ id: request.id, ok: true, data });
    } catch (err) {
      await this.panel.webview.postMessage({ id: request.id, ok: false, error: (err as Error).message });
    }
  }

  private html(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview.js")));
    const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview.css")));
    const nonce = String(Date.now()) + String(Math.random()).slice(2);
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
      `frame-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`
    ].join("; ");
    const initial = JSON.stringify({ workspaceName: this.folder.name, workspacePath: this.folder.uri.fsPath });
    const cssExists = fs.existsSync(path.join(this.context.extensionPath, "dist", "webview.css"));
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>LaTeX Editing Toolkit</title>
  ${cssExists ? `<link rel="stylesheet" href="${styleUri}">` : ""}
</head>
<body>
  <div id="app" data-initial='${initial.replace(/'/g, "&#39;")}'></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
