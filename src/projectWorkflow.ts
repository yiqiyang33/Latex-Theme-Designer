import { promises as fs, constants as fsConstants } from "node:fs";
import * as path from "node:path";
import { STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import type { LocalNoteProject } from "./types";
import type { CreateProjectDraft, CreateProjectPreflightResult } from "./types";
import { extractDocumentclassDeclaration } from "./utils";

export interface CreateProjectService {
  handle(command: string, payload?: Record<string, unknown>): Promise<unknown>;
}

export interface CreateProjectRegistry {
  add(rootPath: string, templateId: string): Promise<LocalNoteProject>;
}

/**
 * Create a Toolkit project in the only safe registration order: assets, main.tex,
 * then the cross-workspace Local Notes registry.
 */
export async function runCreateProjectWorkflow(
  service: CreateProjectService,
  registry: CreateProjectRegistry,
  rootPath: string,
  templateId: string
): Promise<void> {
  await fs.mkdir(rootPath, { recursive: true });
  await service.handle("initialize-workspace", { template_id: templateId });
  await service.handle("template-bootstrap", {
    template_id: templateId,
    output_target: "main.tex",
    overwrite: false
  });
  await registry.add(rootPath, templateId);
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export async function preflightCreateProject(draft: CreateProjectDraft, extensionDir: string): Promise<CreateProjectPreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parentPath = path.resolve(String(draft.parentPath || ""));
  const projectName = String(draft.projectName || "").trim();
  const template = STARTER_TEMPLATE_DEFINITIONS.find((item) => item.id === draft.templateId);

  if (!path.isAbsolute(String(draft.parentPath || ""))) errors.push("Parent location must be an absolute local path.");
  if (!projectName) errors.push("Project name is required.");
  if (projectName === "." || projectName === "..") errors.push("Project name cannot be '.' or '..'.");
  if (/[\\/\0]/.test(projectName)) errors.push("Project name cannot contain path separators or NUL characters.");
  if (WINDOWS_RESERVED_NAME.test(projectName)) errors.push("Project name is reserved by Windows.");

  const rootPath = path.resolve(parentPath, projectName || "New Notes");
  if (path.dirname(rootPath) !== path.normalize(parentPath)) errors.push("Project path must remain directly inside the selected parent folder.");

  try {
    const stat = await fs.stat(parentPath);
    if (!stat.isDirectory()) errors.push("Selected parent location is not a directory.");
    else await fs.access(parentPath, fsConstants.W_OK);
  } catch (err) {
    errors.push(`Parent location is not writable: ${(err as Error).message}`);
  }

  let targetExists = false;
  let targetEmpty = false;
  try {
    const stat = await fs.lstat(rootPath);
    targetExists = true;
    if (!stat.isDirectory()) errors.push("A non-directory item already exists at the project path.");
    else {
      const entries = await fs.readdir(rootPath);
      targetEmpty = entries.length === 0;
      if (targetEmpty) warnings.push("The project folder already exists and is empty.");
      else errors.push(`Project folder is not empty: ${entries.slice(0, 5).join(", ")}${entries.length > 5 ? ` and ${entries.length - 5} more` : ""}.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") errors.push(`Could not inspect project path: ${(err as Error).message}`);
  }

  if (!template) errors.push(`Unknown starter template: ${draft.templateId}.`);
  else {
    try {
      const source = path.join(extensionDir, "assets", "template", "templates", template.filename);
      const text = await fs.readFile(source, "utf8");
      if (!extractDocumentclassDeclaration(text)) errors.push(`Starter template '${template.filename}' has no valid \\documentclass declaration.`);
      for (const asset of template.assetManifest) {
        try {
          await fs.access(path.join(extensionDir, "assets", "template", asset));
        } catch {
          errors.push(`Starter template asset is unavailable: ${asset}`);
        }
      }
    } catch (err) {
      errors.push(`Starter template is unavailable: ${(err as Error).message}`);
    }
  }

  return {
    ok: errors.length === 0,
    rootPath,
    targetExists,
    targetEmpty,
    errors,
    warnings,
    plannedFiles: template
      ? [
          "main.tex",
          ...template.assetManifest,
          ".latex-editing-toolkit/template.json",
          ...(template.kind === "beamer"
            ? [".latex-editing-toolkit/beamer-class-options.tex", ".latex-editing-toolkit/beamer-settings.tex"]
            : []),
          ".vscode/settings.json"
        ]
      : ["main.tex", ".vscode/settings.json"]
  };
}
