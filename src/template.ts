import { promises as fs } from "node:fs";
import * as path from "node:path";
import { STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import { ensureWorkspaceTemplateAssets, StateService } from "./state";
import { exists, extractDocumentclassDeclaration, isSubpath, normalizeCompileTarget, toPosixPath, workspaceRel } from "./utils";
import { generateVscodeSettingsIfMissing } from "./vscodeSettings";

export class TemplateService {
  constructor(
    private readonly rootDir: string,
    private readonly extensionDir: string,
    private readonly stateService: StateService
  ) {}

  async initializeWorkspace(): Promise<{ copied: string[]; vscode_settings: { generated: boolean; generated_path: string; message: string } }> {
    const copied = await ensureWorkspaceTemplateAssets(this.rootDir, this.extensionDir);
    const vscodeSettings = await generateVscodeSettingsIfMissing(this.rootDir);
    return { copied, vscode_settings: vscodeSettings };
  }

  async createStarter(templateId: unknown, outputTarget: unknown, overwrite: boolean): Promise<{ response: unknown; generated_target: string; overwrote_existing: boolean }> {
    await ensureWorkspaceTemplateAssets(this.rootDir, this.extensionDir);
    const normalizedTarget = this.normalizeOutputTarget(outputTarget);
    const template = STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === String(templateId || "").trim())
      ?? STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === "book-minimal")
      ?? STARTER_TEMPLATE_DEFINITIONS[0];
    if (!template) throw new Error("No starter templates available.");
    const targetAbs = path.resolve(this.rootDir, normalizedTarget);
    const existed = await exists(targetAbs);
    if (existed) {
      const stat = await fs.stat(targetAbs);
      if (stat.isDirectory()) throw new Error(`Output target is a directory: ${normalizedTarget}`);
      if (!overwrite) throw new Error(`Output target already exists: ${normalizedTarget}. Set overwrite=true to replace it.`);
    }
    const source = await this.stateService.templateSourcePath(template.filename);
    const text = await fs.readFile(source, "utf8");
    if (!extractDocumentclassDeclaration(text)) throw new Error(`Starter template is missing a valid \\documentclass declaration: ${template.filename}`);
    await fs.mkdir(path.dirname(targetAbs), { recursive: true });
    await fs.writeFile(targetAbs, text, "utf8");

    const state = await this.stateService.loadState();
    state.compile_targets = await this.stateService.listCandidateTexFiles();
    state.compile_target = normalizeCompileTarget(this.rootDir, normalizedTarget, state.compile_targets);
    await this.stateService.applyCompilePreferences(state, { compile_target: state.compile_target });
    await this.stateService.persistUiState(state);
    return {
      response: await this.stateService.buildResponseState(),
      generated_target: workspaceRel(this.rootDir, targetAbs),
      overwrote_existing: existed
    };
  }

  normalizeOutputTarget(raw: unknown): string {
    let target = String(raw ?? "").trim() || "main.tex";
    target = toPosixPath(target);
    if (path.isAbsolute(target)) throw new Error("Output target must be workspace-relative.");
    if (!path.extname(target)) target += ".tex";
    if (path.extname(target).toLowerCase() !== ".tex") throw new Error("Output target must end with .tex.");
    const resolved = path.resolve(this.rootDir, target);
    if (!isSubpath(resolved, this.rootDir)) throw new Error("Output target is outside workspace.");
    return workspaceRel(this.rootDir, resolved);
  }
}
