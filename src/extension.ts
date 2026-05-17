import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import { ToolkitService } from "./toolkitService";

let activePanel: ToolkitPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("latexEditingToolkit.openToolkit", async () => {
      const folder = await selectWorkspaceFolder();
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
      await vscode.commands.executeCommand("vscode.openFolder", target[0], { forceNewWindow: false });
    }),
    vscode.commands.registerCommand("latexEditingToolkit.initializeWorkspace", async () => {
      const service = await serviceForCommand(context);
      if (!service) return;
      const result = await service.handle("initialize-workspace", {});
      vscode.window.showInformationMessage(`Initialized LaTeX Toolkit workspace: ${JSON.stringify(result)}`);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.upgradeWorkspaceThemeAssets", async () => {
      const service = await serviceForCommand(context);
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
      vscode.window.showInformationMessage(`Upgraded ${result.upgraded_files?.length ?? 0} theme asset(s). Backup: ${result.backup_dir}.${resetSuffix}`);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.generateVscodeSettings", async () => {
      const service = await serviceForCommand(context);
      if (!service) return;
      const result = await service.handle("vscode-settings-generate", {}) as { message?: string };
      vscode.window.showInformationMessage(result.message ?? "VS Code settings checked.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.saveOverrides", async () => {
      const service = await serviceForCommand(context);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: unknown };
      await service.handle("save", response.state as Record<string, unknown>);
      vscode.window.showInformationMessage("Saved LaTeX Toolkit overrides.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.resetOverrides", async () => {
      const service = await serviceForCommand(context);
      if (!service) return;
      const ok = await vscode.window.showWarningMessage("Delete theme.ui.json, theme.overrides.tex, and theme.colors.tex?", { modal: true }, "Delete");
      if (ok !== "Delete") return;
      await service.handle("reset", {});
      vscode.window.showInformationMessage("Deleted LaTeX Toolkit override files.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.compilePdf", async () => {
      const service = await serviceForCommand(context);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: Record<string, unknown> };
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Compiling LaTeX PDF" }, () => service.handle("compile", response.state));
      const success = Boolean((result as { success?: boolean }).success);
      vscode.window.showInformationMessage(success ? "LaTeX compile succeeded." : "LaTeX compile failed. Open Toolkit for logs.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.cleanArtifacts", async () => {
      const service = await serviceForCommand(context);
      if (!service) return;
      const ok = await vscode.window.showWarningMessage("Clean LaTeX build artifacts in the workspace?", { modal: true }, "Clean");
      if (ok !== "Clean") return;
      const result = await service.handle("clean", {}) as { deleted_count?: number; errors?: string[] };
      vscode.window.showInformationMessage(`Cleaned ${result.deleted_count ?? 0} file(s).${result.errors?.length ? " Some errors occurred." : ""}`);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.splitCurrentTarget", async () => {
      const service = await serviceForCommand(context);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: { compile_target?: string } };
      await service.handle("split", { compile_target: response.state.compile_target ?? "main.tex", dry_run: false });
      vscode.window.showInformationMessage("Split current LaTeX target.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.renumberUnits", async () => {
      const service = await serviceForCommand(context);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: { compile_target?: string } };
      await service.handle("renumber", { compile_target: response.state.compile_target ?? "main.tex", mode: "add", dry_run: false });
      vscode.window.showInformationMessage("Renumbered referenced units.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.unsplitUnit", async () => {
      const service = await serviceForCommand(context);
      if (!service) return;
      const response = await service.handle("state", {}) as { state: { compile_target?: string } };
      const ok = await vscode.window.showWarningMessage("Merge selected subfiles unit back to its root and delete the source unit?", { modal: true }, "Merge");
      if (ok !== "Merge") return;
      await service.handle("unsplit", { compile_target: response.state.compile_target ?? "", dry_run: false, delete_source: true });
      vscode.window.showInformationMessage("Merged selected unit back to root.");
    })
  );
}

export function deactivate(): void {
  activePanel?.dispose();
  activePanel = undefined;
}

async function selectWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
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
  if (localFolders.length === 1) return localFolders[0];
  const picked = await vscode.window.showQuickPick(localFolders.map((folder) => ({ label: folder.name, folder })), { placeHolder: "Select Toolkit workspace" });
  return picked?.folder;
}

async function serviceForCommand(context: vscode.ExtensionContext): Promise<ToolkitService | undefined> {
  const folder = await selectWorkspaceFolder();
  if (!folder) return undefined;
  return new ToolkitService(folder.uri.fsPath, context.extensionPath);
}

class ToolkitPanel {
  private readonly service: ToolkitService;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  static createOrShow(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): ToolkitPanel {
    if (activePanel) {
      activePanel.panel.reveal(vscode.ViewColumn.One);
      return activePanel;
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
