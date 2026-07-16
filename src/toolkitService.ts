import { promises as fs } from "node:fs";
import * as path from "node:path";
import { ChangeHistoryService } from "./changeHistory";
import type { CleanResult, CompileResult, ResponseState, StylePresetDefinition } from "./types";
import { CleanupService } from "./cleanup";
import { CompileService } from "./compile";
import { SplitterService } from "./splitter";
import { StateService } from "./state";
import { TemplateService } from "./template";
import { exists } from "./utils";
import { generateVscodeSettingsIfMissing } from "./vscodeSettings";

export interface ToolkitServiceOptions {
  historyStorageDir?: string;
  additionalStylePresets?: StylePresetDefinition[];
}

export class ToolkitService {
  readonly state: StateService;
  readonly compile: CompileService;
  readonly cleanup: CleanupService;
  readonly splitter: SplitterService;
  readonly template: TemplateService;
  readonly history: ChangeHistoryService;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly rootDir: string, readonly extensionDir: string, options: ToolkitServiceOptions = {}) {
    this.state = new StateService(rootDir, options.additionalStylePresets ?? []);
    this.compile = new CompileService(rootDir, this.state);
    this.cleanup = new CleanupService(rootDir);
    this.splitter = new SplitterService(rootDir, this.state);
    this.template = new TemplateService(rootDir, extensionDir, this.state);
    this.history = new ChangeHistoryService(rootDir, options.historyStorageDir, this.state);
  }

  setAdditionalStylePresets(presets: StylePresetDefinition[]): void {
    this.state.setAdditionalStylePresets(presets);
  }

  async handle(command: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    switch (command) {
      case "state":
        return this.responseWithHistory(await this.state.buildResponseState());
      case "history-state":
        return this.history.historyState();
      case "undo-last-change":
        return this.runSerialized(async () => {
          await this.history.undo(Boolean(payload.force));
          return this.responseWithHistory(await this.state.buildResponseState());
        });
      case "redo-last-change":
        return this.runSerialized(async () => {
          await this.history.redo(Boolean(payload.force));
          return this.responseWithHistory(await this.state.buildResponseState());
        });
      case "autosave":
      case "save":
        return this.runSerialized(async () => {
          const rawState = command === "autosave" && isRecord(payload.state) ? payload.state : payload;
          const result = await this.history.runStateChange(command, "Edit Toolkit settings", async () => {
            const current = await this.state.loadState();
            const normalized = await this.state.normalizePayload(rawState, current);
            if (normalized.compile_target !== current.compile_target) await this.state.coerceClassModeOnTargetSwitch(normalized);
            await this.state.writeOverrideFiles(normalized);
            return this.state.buildResponseState();
          }, payload.record_history !== false);
          return { ...(await this.responseWithHistory(result)), revision: Number(payload.revision ?? 0) };
        });
      case "target":
        return this.runStateMutation(command, "Change compile target", payload, async () => {
          const current = await this.state.loadState();
          const normalized = await this.state.normalizePayload(payload, current);
          await this.state.applyCompilePreferences(current, { compile_target: normalized.compile_target });
          await this.state.writeOverrideFiles(current);
          return this.state.buildResponseState();
        });
      case "compile-config":
        return this.runStateMutation(command, "Change compile recipe", payload, async () => {
          const current = await this.state.loadState();
          const normalized = await this.state.normalizePayload(payload, current);
          await this.state.applyCompilePreferences(current, {
            compile_recipe: normalized.compile_recipe,
            compile_use_internal_fallback: normalized.compile_use_internal_fallback
          });
          await this.state.writeOverrideFiles(current);
          return this.state.buildResponseState();
        });
      case "template-bootstrap":
        return this.runSerialized(async () => {
          const output = this.template.normalizeOutputTarget(payload.output_target);
          const paths = [...this.workspaceAssetPaths(), output, "theme.ui.json", ".vscode/settings.json"];
          const result = await this.history.runFileChange(command, "Generate starter", paths, async () => {
            const created = await this.template.createStarter(payload.template_id, payload.output_target, Boolean(payload.overwrite));
            return { ...(created.response as ResponseState), generated_target: created.generated_target, overwrote_existing: created.overwrote_existing };
          }, payload.record_history !== false);
          return this.responseWithHistory(result);
        });
      case "vscode-settings-generate":
        return this.runFileMutation(command, "Generate VS Code settings", [".vscode", ".vscode/settings.json"], payload, async () => {
          const generated = await generateVscodeSettingsIfMissing(this.rootDir);
          return { ...(await this.state.buildResponseState()), ...generated };
        });
      case "split-preview": {
        return this.runSerialized(async () => {
          const result = await this.splitter.splitCompileTarget(String(payload.compile_target ?? ""), true, String(payload.sections_dir ?? "Sections"));
          return { ...(result.response as ResponseState), split: result.split };
        });
      }
      case "split":
        return this.runSerialized(async () => {
          if (Boolean(payload.dry_run)) {
            const result = await this.splitter.splitCompileTarget(String(payload.compile_target ?? ""), true, String(payload.sections_dir ?? "Sections"));
            return { ...(result.response as ResponseState), split: result.split };
          }
          const target = String(payload.compile_target ?? "");
          const preview = await this.splitter.splitCompileTarget(target, true, String(payload.sections_dir ?? "Sections"));
          const backup = await this.nextSplitBackupPath(path.resolve(this.rootDir, target));
          const generated = preview.split.generated_subfile_targets;
          const paths = [target, backup, ...generated, ...new Set(generated.map((item) => path.dirname(item)))];
          const result = await this.history.runFileChange(command, "Split LaTeX target", paths, async () => {
            const changed = await this.splitter.splitCompileTarget(target, false, String(payload.sections_dir ?? "Sections"));
            return { ...(changed.response as ResponseState), split: changed.split };
          }, payload.record_history !== false);
          return this.responseWithHistory(result);
        });
      case "renumber":
        return this.runSerialized(async () => {
          if (Boolean(payload.dry_run)) {
            const result = await this.splitter.renumberCompileTarget(String(payload.compile_target ?? ""), String(payload.mode ?? "add"), true);
            return { ...(result.response as ResponseState), renumber: result.renumber };
          }
          const target = String(payload.compile_target ?? "");
          const mode = String(payload.mode ?? "add");
          const preview = await this.splitter.renumberCompileTarget(target, mode, true);
          const paths = [target, ...Object.keys(preview.renumber.renamed), ...Object.values(preview.renumber.renamed)];
          const result = await this.history.runFileChange(command, "Renumber LaTeX units", paths, async () => {
            const changed = await this.splitter.renumberCompileTarget(target, mode, false);
            return { ...(changed.response as ResponseState), renumber: changed.renumber };
          }, payload.record_history !== false);
          return this.responseWithHistory(result);
        });
      case "unsplit":
        return this.runSerialized(async () => {
          if (Boolean(payload.dry_run)) {
            const result = await this.splitter.unsplitCompileTarget(String(payload.compile_target ?? ""), true, payload.delete_source !== false);
            return { ...(result.response as ResponseState), unsplit: result.unsplit };
          }
          const target = String(payload.compile_target ?? "");
          const preview = await this.splitter.unsplitCompileTarget(target, true, payload.delete_source !== false);
          const paths = [preview.unsplit.root_target, preview.unsplit.source_target];
          const result = await this.history.runFileChange(command, "Merge LaTeX unit", paths, async () => {
            const changed = await this.splitter.unsplitCompileTarget(target, false, payload.delete_source !== false);
            return { ...(changed.response as ResponseState), unsplit: changed.unsplit };
          }, payload.record_history !== false);
          return this.responseWithHistory(result);
        });
      case "style-preset":
        return this.runPresetMutation(command, "Change style", String(payload.style_preset ?? ""), payload, (state, preset) => this.state.applyStylePreset(state, preset));
      case "block-preset":
        return this.runPresetMutation(command, "Change style", String(payload.block_preset ?? ""), payload, (state, preset) => this.state.applyBlockPreset(state, preset));
      case "heading-toc-preset":
        return this.runPresetMutation(command, "Change style", String(payload.heading_toc_preset ?? ""), payload, (state, preset) => this.state.applyHeadingTocPreset(state, preset));
      case "reset":
        return this.runFileMutation(command, "Reset Toolkit overrides", ["theme.ui.json", "theme.overrides.tex", "theme.colors.tex"], payload, async () => {
          await this.state.deleteOverrideFiles();
          return this.state.buildResponseState();
        });
      case "clean":
        return this.runSerialized(async (): Promise<CleanResult> => this.cleanup.clean(Boolean(payload.dry_run)));
      case "compile":
        return this.runSerialized(async (): Promise<CompileResult> => this.compile.compileFromPayload(payload));
      case "initialize-workspace":
        return this.runFileMutation(command, "Initialize Toolkit workspace", [...this.workspaceAssetPaths(), ".vscode", ".vscode/settings.json"], payload, () => this.template.initializeWorkspace());
      case "upgrade-theme-assets":
        return this.runFileMutation(command, "Upgrade theme assets", ["theme.sty", "theorems.tex", "commands.tex", "theme.colors.tex", "theme.ui.json"], payload, async () => {
          const explicitPolicy = payload.color_policy;
          const colorPolicy = explicitPolicy === "default" || explicitPolicy === "preserve"
            ? explicitPolicy
            : payload.reset_color_overrides === true ? "default" : "preserve";
          return this.template.upgradeThemeAssets({ colorPolicy });
        });
      case "pdf-uri":
        return this.resolvePdfPath(String(payload.path ?? ""));
      default:
        throw new Error(`Unknown toolkit command: ${command}`);
    }
  }

  resolvePdfPath(rawPath: string): string {
    const rel = rawPath.trim() || "main.pdf";
    const resolved = path.resolve(this.rootDir, rel);
    if (!resolved.endsWith(".pdf")) throw new Error("PDF path must end with .pdf.");
    if (!resolved.startsWith(path.resolve(this.rootDir) + path.sep) && resolved !== path.resolve(this.rootDir)) throw new Error("PDF path is outside workspace.");
    return resolved;
  }

  async readPdfIfExists(rawPath: string): Promise<string> {
    const pdf = this.resolvePdfPath(rawPath);
    await fs.access(pdf);
    return pdf;
  }

  private async runStateMutation<T>(command: string, label: string, payload: Record<string, unknown>, task: () => Promise<T>): Promise<unknown> {
    return this.runSerialized(async () => this.responseWithHistory(await this.history.runStateChange(command, label, task, payload.record_history !== false)));
  }

  private async runFileMutation<T>(command: string, label: string, paths: string[], payload: Record<string, unknown>, task: () => Promise<T>): Promise<unknown> {
    return this.runSerialized(async () => this.responseWithHistory(await this.history.runFileChange(command, label, paths, task, payload.record_history !== false)));
  }

  private async runPresetMutation(command: string, label: string, preset: string, payload: Record<string, unknown>, apply: (state: Awaited<ReturnType<StateService["loadState"]>>, preset: string) => void): Promise<unknown> {
    return this.runStateMutation(command, label, payload, async () => {
      const current = await this.state.loadState();
      apply(current, preset || current.style_preset);
      await this.state.writeOverrideFiles(current);
      return this.state.buildResponseState();
    });
  }

  private async responseWithHistory<T>(value: T): Promise<T & { history: Awaited<ReturnType<ChangeHistoryService["historyState"]>> }> {
    const history = await this.history.historyState();
    if (isRecord(value)) return { ...value, history } as T & { history: typeof history };
    return { value, history } as unknown as T & { history: typeof history };
  }

  private workspaceAssetPaths(): string[] {
    return [
      "theme.sty", "theorems.tex", "commands.tex", "references.bib",
      "Fig", "Fig/cover.png", "templates",
      "templates/book-minimal.tex", "templates/article-minimal.tex", "templates/homework-assignment.tex"
    ];
  }

  private async nextSplitBackupPath(rootAbs: string): Promise<string> {
    let candidate = `${rootAbs}.bak`;
    let index = 1;
    while (await exists(candidate)) {
      candidate = `${rootAbs}.bak.${index}`;
      index += 1;
    }
    return candidate;
  }

  private runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
