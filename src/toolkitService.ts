import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { CleanResult, CompileResult, ResponseState } from "./types";
import { CleanupService } from "./cleanup";
import { CompileService } from "./compile";
import { SplitterService } from "./splitter";
import { StateService } from "./state";
import { TemplateService } from "./template";
import { generateVscodeSettingsIfMissing } from "./vscodeSettings";

export class ToolkitService {
  readonly state: StateService;
  readonly compile: CompileService;
  readonly cleanup: CleanupService;
  readonly splitter: SplitterService;
  readonly template: TemplateService;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly rootDir: string, readonly extensionDir: string) {
    this.state = new StateService(rootDir);
    this.compile = new CompileService(rootDir, this.state);
    this.cleanup = new CleanupService(rootDir);
    this.splitter = new SplitterService(rootDir, this.state);
    this.template = new TemplateService(rootDir, extensionDir, this.state);
  }

  async handle(command: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    switch (command) {
      case "state":
        return this.state.buildResponseState();
      case "save":
        return this.runSerialized(async () => {
          const normalized = await this.state.normalizePayload(payload);
          await this.state.writeOverrideFiles(normalized);
          return this.state.buildResponseState();
        });
      case "target":
        return this.runSerialized(async () => {
          const current = await this.state.loadState();
          const normalized = await this.state.normalizePayload(payload, current);
          await this.state.applyCompilePreferences(current, { compile_target: normalized.compile_target });
          await this.state.persistUiState(current);
          return this.state.buildResponseState();
        });
      case "compile-config":
        return this.runSerialized(async () => {
          const current = await this.state.loadState();
          const normalized = await this.state.normalizePayload(payload, current);
          await this.state.applyCompilePreferences(current, {
            compile_recipe: normalized.compile_recipe,
            compile_use_internal_fallback: normalized.compile_use_internal_fallback
          });
          await this.state.persistUiState(current);
          return this.state.buildResponseState();
        });
      case "template-bootstrap":
        return this.runSerialized(async () => {
          const result = await this.template.createStarter(payload.template_id, payload.output_target, Boolean(payload.overwrite));
          return { ...(result.response as ResponseState), generated_target: result.generated_target, overwrote_existing: result.overwrote_existing };
        });
      case "vscode-settings-generate":
        return this.runSerialized(async () => {
          const generated = await generateVscodeSettingsIfMissing(this.rootDir);
          return { ...(await this.state.buildResponseState()), ...generated };
        });
      case "split":
      case "split-preview":
        return this.runSerialized(async () => {
          const result = await this.splitter.splitCompileTarget(String(payload.compile_target ?? ""), command === "split-preview" ? true : Boolean(payload.dry_run), String(payload.sections_dir ?? "Sections"));
          return { ...(result.response as ResponseState), split: result.split };
        });
      case "renumber":
        return this.runSerialized(async () => {
          const result = await this.splitter.renumberCompileTarget(String(payload.compile_target ?? ""), String(payload.mode ?? "add"), Boolean(payload.dry_run));
          return { ...(result.response as ResponseState), renumber: result.renumber };
        });
      case "unsplit":
        return this.runSerialized(async () => {
          const result = await this.splitter.unsplitCompileTarget(String(payload.compile_target ?? ""), Boolean(payload.dry_run), payload.delete_source !== false);
          return { ...(result.response as ResponseState), unsplit: result.unsplit };
        });
      case "block-preset":
        return this.runSerialized(async () => {
          const current = await this.state.loadState();
          this.state.applyBlockPreset(current, String(payload.block_preset ?? current.block_preset));
          await this.state.writeOverrideFiles(current);
          return this.state.buildResponseState();
        });
      case "heading-toc-preset":
        return this.runSerialized(async () => {
          const current = await this.state.loadState();
          this.state.applyHeadingTocPreset(current, String(payload.heading_toc_preset ?? current.heading_toc_preset));
          await this.state.writeOverrideFiles(current);
          return this.state.buildResponseState();
        });
      case "reset":
        return this.runSerialized(async () => {
          await this.state.deleteOverrideFiles();
          return this.state.buildResponseState();
        });
      case "clean":
        return this.runSerialized(async (): Promise<CleanResult> => this.cleanup.clean(Boolean(payload.dry_run)));
      case "compile":
        return this.runSerialized(async (): Promise<CompileResult> => this.compile.compileFromPayload(payload));
      case "initialize-workspace":
        return this.runSerialized(async () => this.template.initializeWorkspace());
      case "upgrade-theme-assets":
        return this.runSerialized(async () => this.template.upgradeThemeAssets(Boolean(payload.reset_color_overrides)));
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
    if (!resolved.startsWith(path.resolve(this.rootDir) + path.sep) && resolved !== path.resolve(this.rootDir)) {
      throw new Error("PDF path is outside workspace.");
    }
    return resolved;
  }

  async readPdfIfExists(rawPath: string): Promise<string> {
    const pdf = this.resolvePdfPath(rawPath);
    await fs.access(pdf);
    return pdf;
  }

  private runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
