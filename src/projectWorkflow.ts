import { promises as fs, constants as fsConstants } from "node:fs";
import * as path from "node:path";
import { STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import { templateFilePlan } from "./templatePlan";
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
  templateId: string,
  stylePreset?: string
): Promise<void> {
  await fs.mkdir(rootPath, { recursive: true });
  await service.handle("initialize-workspace", { template_id: templateId });
  await service.handle("template-bootstrap", {
    template_id: templateId,
    output_target: "main.tex",
    overwrite: false,
    style_preset: stylePreset
  });
  await registry.add(rootPath, templateId);
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/**
 * Checks the two things that do not depend on the final project path: the starter template is
 * usable, and the parent directory can be written to.
 *
 * Creating a project on Overleaf has to happen before the local path is known, because the folder
 * is named after the project id the server assigns. Running these checks first means a bad
 * template or an unwritable parent fails before anything exists remotely to roll back.
 */
export async function validateTemplateAndParent(
  templateId: string,
  parentPath: string,
  extensionDir: string
): Promise<string[]> {
  const errors: string[] = [];
  const resolvedParent = path.resolve(parentPath || "");
  try {
    const stat = await fs.stat(resolvedParent);
    if (!stat.isDirectory()) errors.push("Selected parent location is not a directory.");
    else await fs.access(resolvedParent, fsConstants.W_OK);
  } catch (err) {
    errors.push(`Parent location is not writable: ${(err as Error).message}`);
  }

  const template = STARTER_TEMPLATE_DEFINITIONS.find((item) => item.id === templateId);
  if (!template) {
    errors.push(`Unknown starter template: ${templateId}.`);
    return errors;
  }
  try {
    const source = path.join(extensionDir, "assets", "template", "templates", template.filename);
    const text = await fs.readFile(source, "utf8");
    if (!extractDocumentclassDeclaration(text)) {
      errors.push(`Starter template '${template.filename}' has no valid \\documentclass declaration.`);
    }
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
  return errors;
}

export async function preflightCreateProject(draft: CreateProjectDraft, extensionDir: string): Promise<CreateProjectPreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parentPath = path.resolve(String(draft.parentPath || ""));
  const projectName = String(draft.projectName || "").trim();

  if (!path.isAbsolute(String(draft.parentPath || ""))) errors.push("Parent location must be an absolute local path.");
  if (!projectName) errors.push("Project name is required.");
  if (projectName === "." || projectName === "..") errors.push("Project name cannot be '.' or '..'.");
  if (/[\\/\0]/.test(projectName)) errors.push("Project name cannot contain path separators or NUL characters.");
  if (WINDOWS_RESERVED_NAME.test(projectName)) errors.push("Project name is reserved by Windows.");

  const rootPath = path.resolve(parentPath, projectName || "New Notes");
  if (path.dirname(rootPath) !== path.normalize(parentPath)) errors.push("Project path must remain directly inside the selected parent folder.");

  // Parent writability and starter-template validity are exactly what
  // validateTemplateAndParent checks; keeping a second copy here let the two drift.
  errors.push(...await validateTemplateAndParent(String(draft.templateId || ""), parentPath, extensionDir));

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

  const plan = templateFilePlan(draft.templateId, "main.tex");

  return {
    ok: errors.length === 0,
    rootPath,
    targetExists,
    targetEmpty,
    errors,
    warnings,
    // Derived from the shared plan so the preview lists what the generator actually
    // writes. The previous hand-written list omitted everything under templates/.
    plannedFiles: plan
      ? ["main.tex", ...plan.assets, ...plan.metadata, ".vscode/settings.json"]
      : ["main.tex", ".vscode/settings.json"]
  };
}
