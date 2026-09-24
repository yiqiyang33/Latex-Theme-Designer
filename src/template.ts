import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import { defaultBeamerSettings, isHomeworkTemplate, readTemplateMetadata, starterTemplate, writeBeamerSettings, writeTemplateMetadata } from "./beamer";
import { defaultHomeworkSettings, writeHomeworkSettings } from "./homework";
import { ensureWorkspaceTemplateAssets, StateService } from "./state";
import { upgradableTemplateExtras } from "./templatePlan";
import type { UpgradeThemeAssetsOptions, UpgradeThemeAssetsResult } from "./types";
import { assertWorkspacePathSafe, exists, extractDocumentclassDeclaration, isSubpath, normalizeCompileTarget, toPosixPath, workspaceRel } from "./utils";
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
    // Beamer theme assets are resolved relative to the deck, so they have to land next to
    // it, exactly as createStarter places them.
    const definition = templateId ? STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === templateId) : undefined;
    const destination = definition?.kind === "beamer"
      ? path.dirname(path.resolve(this.rootDir, (await this.stateService.loadState()).compile_target || "main.tex"))
      : this.rootDir;
    const copied = await ensureWorkspaceTemplateAssets(this.rootDir, this.extensionDir, templateId, destination);
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

    const queueReplacement = async (file: string, onlyWhenPresent = false): Promise<void> => {
      const source = path.join(assetRoot, file);
      const target = path.join(this.rootDir, file);
      this.assertInsideWorkspace(target);
      if (!(await exists(source))) {
        skippedMissingFiles.push(file);
        return;
      }
      if (onlyWhenPresent && !(await exists(target))) return;
      assetReplacements.push({ file, source, target });
    };

    for (const file of UPGRADE_THEME_ASSET_FILES) await queueReplacement(file);

    // Per-starter support packages, e.g. homework.sty. Taken from the project's recorded
    // template so a homework project that predates the package gains it here, and also
    // from disk so a project keeps whatever it already has even without metadata.
    const metadata = await readTemplateMetadata(this.rootDir);
    const extras = new Set(upgradableTemplateExtras(starterTemplate(metadata?.templateId ?? "")));
    for (const definition of STARTER_TEMPLATE_DEFINITIONS) {
      for (const file of upgradableTemplateExtras(definition)) {
        if (!extras.has(file) && await exists(path.join(this.rootDir, file))) extras.add(file);
      }
    }
    for (const file of extras) await queueReplacement(file);

    // The project's own templates/ copies shadow the bundled starters
    // (StateService.templateSourcePath prefers them), so leaving them stale means
    // regenerating inside an old project reproduces the old starter. They are backed up
    // like every other replaced file.
    for (const definition of STARTER_TEMPLATE_DEFINITIONS) {
      await queueReplacement(toPosixPath(path.join("templates", definition.filename)), true);
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
      await assertWorkspacePathSafe(this.rootDir, target);
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

  /**
   * @param stylePreset Applied to the generated project when the starter actually consumes
   *   theme.sty. Without it a new project falls back to the defaults baked into theme.sty,
   *   because generation otherwise never writes theme.colors.tex.
   */
  async createStarter(templateId: unknown, outputTarget: unknown, overwrite: boolean, stylePreset?: string): Promise<{ response: unknown; generated_target: string; overwrote_existing: boolean }> {
    // Everything that can fail runs before the first write. The old order copied assets
    // and wrote the target first, so a later failure (an unknown compile target, a
    // rejected overwrite) left a half-populated workspace behind while reporting an error.
    const requestedId = String(templateId || "").trim();
    const template = requestedId
      ? STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === requestedId)
      : STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === "book-minimal") ?? STARTER_TEMPLATE_DEFINITIONS[0];
    if (!template) {
      throw new Error(requestedId
        ? `Unknown starter template: ${requestedId}.`
        : "No starter templates available.");
    }
    const normalizedTarget = await this.resolveOutputTarget(outputTarget, overwrite);
    const targetAbs = path.resolve(this.rootDir, normalizedTarget);
    await assertWorkspacePathSafe(this.rootDir, targetAbs);
    const existed = await exists(targetAbs);
    if (existed) {
      const stat = await fs.stat(targetAbs);
      if (stat.isDirectory()) throw new Error(`Output target is a directory: ${normalizedTarget}`);
      if (!overwrite) throw new Error(`Output target already exists: ${normalizedTarget}. Set overwrite=true to replace it.`);
    }
    const source = await this.stateService.templateSourcePath(template.filename);
    const text = await fs.readFile(source, "utf8");
    if (!extractDocumentclassDeclaration(text)) throw new Error(`Starter template is missing a valid \\documentclass declaration: ${template.filename}`);

    const assetDestination = template.kind === "beamer" ? path.dirname(targetAbs) : this.rootDir;
    await ensureWorkspaceTemplateAssets(this.rootDir, this.extensionDir, template.id, assetDestination);
    await fs.mkdir(path.dirname(targetAbs), { recursive: true });
    // 'wx' closes the window between the existence probe above and this write.
    await fs.writeFile(targetAbs, text, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
    await writeTemplateMetadata(this.rootDir, { kind: template.kind, templateId: template.id, target: normalizedTarget });
    if (template.kind === "beamer") await writeBeamerSettings(this.rootDir, normalizedTarget, defaultBeamerSettings());
    if (isHomeworkTemplate(template.id)) await writeHomeworkSettings(this.rootDir, normalizedTarget, defaultHomeworkSettings());

    const state = await this.stateService.loadState();
    state.compile_targets = await this.stateService.listCandidateTexFiles();
    state.compile_target = normalizeCompileTarget(this.rootDir, normalizedTarget, state.compile_targets);
    await this.stateService.applyCompilePreferences(state, { compile_target: state.compile_target });
    // Only starters that load theme.sty can be themed; research-paper and the Beamer
    // decks are self-contained and would silently ignore the choice.
    if (stylePreset && template.capabilities.includes("toolkit-theme")) {
      this.stateService.applyStylePreset(state, stylePreset);
      await this.stateService.writeOverrideFiles(state);
    }
    await this.stateService.persistUiState(state);
    return {
      response: await this.stateService.buildResponseState(),
      generated_target: workspaceRel(this.rootDir, targetAbs),
      overwrote_existing: existed
    };
  }

  /**
   * Normalizes the target and reconciles it with what is actually on disk. On a
   * case-insensitive filesystem `Main.tex` and `main.tex` are one file, so writing the
   * requested spelling would silently overwrite the existing one and then fail downstream
   * when the compile-target lookup cannot find the requested casing.
   */
  private async resolveOutputTarget(raw: unknown, overwrite: boolean): Promise<string> {
    const normalized = this.normalizeOutputTarget(raw);
    const targetAbs = path.resolve(this.rootDir, normalized);
    const directory = path.dirname(targetAbs);
    const requestedName = path.basename(targetAbs);
    const entries = await fs.readdir(directory).catch(() => [] as string[]);
    const onDisk = entries.find((entry) => entry.toLowerCase() === requestedName.toLowerCase());
    if (!onDisk || onDisk === requestedName) return normalized;
    if (!overwrite) {
      throw new Error(`Output target already exists as ${onDisk}: ${normalized}. Names differing only by case refer to the same file on this filesystem. Set overwrite=true to replace it.`);
    }
    return workspaceRel(this.rootDir, path.join(directory, onDisk));
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
