import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import { defaultBeamerSettings, writeBeamerSettings, writeTemplateMetadata } from "./beamer";
import { ensureWorkspaceTemplateAssets, StateService } from "./state";
import type { UpgradeThemeAssetsOptions, UpgradeThemeAssetsResult } from "./types";
import { exists, extractDocumentclassDeclaration, isSubpath, normalizeCompileTarget, toPosixPath, workspaceRel } from "./utils";
import { generateVscodeSettingsIfMissing } from "./vscodeSettings";

const UPGRADE_THEME_ASSET_FILES = ["theme.sty", "theorems.tex", "commands.tex"];
const COLOR_OVERRIDE_FILES = ["theme.colors.tex", "theme.ui.json"];

export class TemplateService {
  constructor(
    private readonly rootDir: string,
    private readonly extensionDir: string,
    private readonly stateService: StateService
  ) {}

  async initializeWorkspace(templateId?: string): Promise<{ copied: string[]; vscode_settings: { generated: boolean; generated_path: string; message: string } }> {
    const copied = await ensureWorkspaceTemplateAssets(this.rootDir, this.extensionDir, templateId);
    const vscodeSettings = await generateVscodeSettingsIfMissing(this.rootDir);
    return { copied, vscode_settings: vscodeSettings };
  }

  async upgradeThemeAssets(options: UpgradeThemeAssetsOptions = { colorPolicy: "preserve" }): Promise<UpgradeThemeAssetsResult> {
    const colorPolicy = options.colorPolicy ?? "preserve";
    if (colorPolicy !== "preserve" && colorPolicy !== "default") {
      throw new Error(`Unknown upgrade color policy: ${String(colorPolicy)}`);
    }
    const assetRoot = path.join(this.extensionDir, "assets", "template");
    const backupDir = path.join(this.rootDir, ".latex-editing-toolkit", "backups", this.timestamp());
    const upgradedFiles: string[] = [];
    const updatedOverrideFiles: string[] = [];
    const skippedMissingFiles: string[] = [];
    const assetReplacements: Array<{ file: string; source: string; target: string }> = [];

    for (const file of UPGRADE_THEME_ASSET_FILES) {
      const source = path.join(assetRoot, file);
      const target = path.join(this.rootDir, file);
      this.assertInsideWorkspace(target);
      if (!(await exists(source))) {
        skippedMissingFiles.push(file);
        continue;
      }
      assetReplacements.push({ file, source, target });
    }

    // Load before replacing theme.sty so malformed/legacy state is normalized against
    // the user's current project, while non-color settings remain untouched.
    const state = colorPolicy === "default" ? await this.stateService.loadState() : undefined;
    const targets = assetReplacements.map((item) => item.target);
    if (colorPolicy === "default") {
      targets.push(...COLOR_OVERRIDE_FILES.map((file) => path.join(this.rootDir, file)));
    }
    const existedBefore = new Map<string, boolean>();

    await fs.mkdir(backupDir, { recursive: true });
    for (const target of targets) {
      this.assertInsideWorkspace(target);
      const existed = await exists(target);
      existedBefore.set(target, existed);
      if (existed) await this.backupFile(target, backupDir);
    }

    try {
      for (const { file, source, target } of assetReplacements) {
        await this.replaceFileAtomic(source, target);
        upgradedFiles.push(file);
      }

      if (colorPolicy === "default" && state) {
        this.stateService.applyStylePreset(state, "default");
        await this.stateService.writeColorState(state);
        updatedOverrideFiles.push(...COLOR_OVERRIDE_FILES);
      }
    } catch (err) {
      const rollbackErrors = await this.rollbackTargets(targets, existedBefore, backupDir);
      const suffix = rollbackErrors.length > 0 ? ` Rollback errors: ${rollbackErrors.join("; ")}` : "";
      throw new Error(`Theme asset upgrade failed: ${(err as Error).message}.${suffix}`, { cause: err });
    }

    return {
      success: true,
      backup_dir: workspaceRel(this.rootDir, backupDir),
      upgraded_files: upgradedFiles,
      color_policy: colorPolicy,
      updated_override_files: updatedOverrideFiles,
      reset_files: [...updatedOverrideFiles],
      skipped_missing_files: skippedMissingFiles
    };
  }

  async createStarter(templateId: unknown, outputTarget: unknown, overwrite: boolean): Promise<{ response: unknown; generated_target: string; overwrote_existing: boolean }> {
    const normalizedTarget = this.normalizeOutputTarget(outputTarget);
    const template = STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === String(templateId || "").trim())
      ?? STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === "book-minimal")
      ?? STARTER_TEMPLATE_DEFINITIONS[0];
    if (!template) throw new Error("No starter templates available.");
    const targetAbs = path.resolve(this.rootDir, normalizedTarget);
    const assetDestination = template.kind === "beamer" ? path.dirname(targetAbs) : this.rootDir;
    await ensureWorkspaceTemplateAssets(this.rootDir, this.extensionDir, template.id, assetDestination);
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
    await writeTemplateMetadata(this.rootDir, { kind: template.kind, templateId: template.id, target: normalizedTarget });
    if (template.kind === "beamer") await writeBeamerSettings(this.rootDir, normalizedTarget, defaultBeamerSettings());

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

  private async backupFile(source: string, backupDir: string): Promise<void> {
    this.assertInsideWorkspace(source);
    const rel = workspaceRel(this.rootDir, source);
    const backupPath = path.join(backupDir, rel);
    this.assertInsideWorkspace(backupPath);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.copyFile(source, backupPath);
  }

  private async replaceFileAtomic(source: string, target: string): Promise<void> {
    const tempPath = `${target}.tmp-${process.pid}-${randomUUID()}`;
    this.assertInsideWorkspace(target);
    this.assertInsideWorkspace(tempPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.copyFile(source, tempPath);
      await fs.rename(tempPath, target);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw err;
    }
  }

  private async rollbackTargets(targets: string[], existedBefore: Map<string, boolean>, backupDir: string): Promise<string[]> {
    const errors: string[] = [];
    for (const target of [...targets].reverse()) {
      try {
        if (existedBefore.get(target)) {
          const backupPath = path.join(backupDir, workspaceRel(this.rootDir, target));
          await this.replaceFileAtomic(backupPath, target);
        } else {
          await fs.unlink(target).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== "ENOENT") throw err;
          });
        }
      } catch (err) {
        errors.push(`${workspaceRel(this.rootDir, target)}: ${(err as Error).message}`);
      }
    }
    return errors;
  }

  private assertInsideWorkspace(absPath: string): void {
    if (!isSubpath(path.resolve(absPath), this.rootDir)) throw new Error("Theme asset path is outside workspace.");
  }

  private timestamp(): string {
    return new Date().toISOString().replace(/[-:]/g, "").replace(".", "-");
  }
}
