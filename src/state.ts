import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  BODY_FONT_SIZE_CONFIG,
  CLASS_CONFIG_COMMANDS,
  CLASS_CONFIG_DEFAULTS,
  CLASS_CONFIG_IDS,
  CLASS_CONFIG_SCHEMA,
  CLASS_CONFIG_VALID_OPTIONS,
  COLOR_GROUPS,
  COLOR_ORDER,
  COLOR_SET,
  STYLE_PRESET_DEFINITIONS,
  STARTER_TEMPLATE_DEFINITIONS,
  TOGGLE_IDS,
  TOGGLE_SCHEMA
} from "./schema";
import type { PresetMeta, ResponseState, StylePresetDefinition, StylePresetSchema, ToolkitState } from "./types";
import {
  assertValidBodyFontSize,
  boolFromTex,
  compileOutputPdfRelpath,
  defaultCompileTarget,
  exists,
  extractDocumentclassName,
  formatBodyFontSize,
  isSubpath,
  isChapterCapableClass,
  normalizeBodyFontSize,
  normalizeCompileTarget,
  parseHexColor,
  parseThemeColorDefaults,
  safeWorkspaceRel,
  slugify,
  workspaceRel
} from "./utils";
import { loadRecipeCatalog } from "./vscodeSettings";

export class StateService {
  private additionalStylePresets: StylePresetDefinition[];

  constructor(private readonly rootDir: string, additionalStylePresets: StylePresetDefinition[] = []) {
    this.additionalStylePresets = additionalStylePresets.map((preset) => ({ ...preset, colors: { ...preset.colors } }));
  }

  setAdditionalStylePresets(presets: StylePresetDefinition[]): void {
    this.additionalStylePresets = presets.map((preset) => ({ ...preset, colors: { ...preset.colors } }));
  }

  configPath(): string {
    return path.join(this.rootDir, "theme.ui.json");
  }

  toggleOverridePath(): string {
    return path.join(this.rootDir, "theme.overrides.tex");
  }

  colorOverridePath(): string {
    return path.join(this.rootDir, "theme.colors.tex");
  }

  themePath(): string {
    return path.join(this.rootDir, "theme.sty");
  }

  mainTexPath(): string {
    return path.join(this.rootDir, "main.tex");
  }

  async buildResponseState(): Promise<ResponseState> {
    const state = await this.loadState();
    const starterTemplates = await this.starterTemplateMeta();
    return {
      state,
      schema: {
        toggles: TOGGLE_SCHEMA,
        groups: COLOR_GROUPS,
        class_config: CLASS_CONFIG_SCHEMA,
        style_presets: this.stylePresetSchema(),
        body_font_size: BODY_FONT_SIZE_CONFIG,
        starter_templates: starterTemplates,
        starter_default_template: starterTemplates.some((item) => item.id === "book-minimal") ? "book-minimal" : starterTemplates[0]?.id ?? "",
        starter_default_output_target: "main.tex"
      }
    };
  }

  async parseThemeDefaults(warnings: string[] = []): Promise<Record<string, string>> {
    if (!(await exists(this.themePath()))) {
      const fallback: Record<string, string> = {};
      for (const token of COLOR_ORDER) fallback[token] = "#808080";
      warnings.push("theme.sty is missing; placeholder colors are being used.");
      return fallback;
    }
    try {
      return await parseThemeColorDefaults(this.themePath(), COLOR_ORDER);
    } catch (err) {
      const fallback: Record<string, string> = {};
      for (const token of COLOR_ORDER) fallback[token] = "#808080";
      warnings.push(`Could not read theme.sty colors: ${(err as Error).message}`);
      return fallback;
    }
  }

  async loadState(): Promise<ToolkitState> {
    const configWarnings: string[] = [];
    const themeDefaults = await this.parseThemeDefaults(configWarnings);
    const styleCatalog = this.buildStylePresetCatalog();
    const compileTargets = await this.listCandidateTexFiles();
    const recipeCatalog = await loadRecipeCatalog(this.rootDir);
    const compileRecipes = recipeCatalog.recipes;

    const state: ToolkitState = {
      toggles: await this.parseMainToggleDefaults(),
      colors: { ...themeDefaults },
      style_preset: this.defaultPresetId(styleCatalog),
      style_base_preset: this.defaultPresetId(styleCatalog),
      style_presets: this.presetMeta(styleCatalog),
      config_warnings: configWarnings,
      body_font_size_pt: BODY_FONT_SIZE_CONFIG.default,
      class_config: { ...CLASS_CONFIG_DEFAULTS },
      compile_target: defaultCompileTarget(compileTargets),
      compile_targets: compileTargets,
      compile_recipe: compileRecipes[0]?.id ?? "",
      compile_recipe_name: "",
      compile_recipes: compileRecipes,
      compile_recipe_errors: recipeCatalog.errors,
      compile_use_internal_fallback: true,
      compile_output_pdf: "",
      compile_output_pdf_expected: "",
      compile_last_compile_at: "",
      compile_last_success: null,
      detected_document_class: "(unknown)",
      detected_document_class_has_chapter: false,
      effective_theme_class: "article"
    };

    await this.mergePersistedState(state);
    await this.mergeOverrideFiles(state);
    this.finishNormalization(state);
    await this.refreshDerivedState(state);
    state.compile_output_pdf = safeWorkspaceRel(this.rootDir, state.compile_output_pdf) || state.compile_output_pdf_expected || compileOutputPdfRelpath(state.compile_target);
    return state;
  }

  async listCandidateTexFiles(): Promise<string[]> {
    const { listTexCandidates } = await import("./utils");
    return listTexCandidates(this.rootDir);
  }

  async normalizePayload(payload: Record<string, unknown>, baseState?: ToolkitState): Promise<ToolkitState> {
    const base = baseState ?? await this.loadState();
    const normalized: ToolkitState = structuredClone(base);
    const rawToggles = payload.toggles;
    if (rawToggles && typeof rawToggles === "object" && !Array.isArray(rawToggles)) {
      for (const key of TOGGLE_IDS) {
        if (key in rawToggles) {
          const value = (rawToggles as Record<string, unknown>)[key];
          if (typeof value === "boolean") normalized.toggles[key] = value;
          else if (typeof value === "string") {
            const parsed = boolFromTex(value);
            if (parsed === null) throw new Error(`Invalid boolean value for ${key}: ${value}`);
            normalized.toggles[key] = parsed;
          } else {
            throw new Error(`Invalid boolean type for ${key}`);
          }
        }
      }
    }

    const rawColors = payload.colors;
    if (rawColors && typeof rawColors === "object" && !Array.isArray(rawColors)) {
      for (const key of COLOR_ORDER) {
        if (key in rawColors) {
          const parsed = parseHexColor(String((rawColors as Record<string, unknown>)[key]));
          if (!parsed) throw new Error(`Invalid hex color for ${key}: ${(rawColors as Record<string, unknown>)[key]}`);
          normalized.colors[key] = parsed;
        }
      }
    }

    if ("style_preset" in payload) {
      normalized.style_preset = this.normalizePreset(String(payload.style_preset ?? ""), normalized.style_presets);
      normalized.style_base_preset = this.styleDefinition(normalized.style_preset).base_preset_id ?? normalized.style_preset;
    } else if ("block_preset" in payload) {
      normalized.style_preset = this.styleIdFromBlockPreset(String(payload.block_preset ?? ""));
      normalized.style_base_preset = normalized.style_preset;
    } else if ("heading_toc_preset" in payload) {
      normalized.style_preset = this.styleIdFromHeadingPreset(String(payload.heading_toc_preset ?? ""));
      normalized.style_base_preset = normalized.style_preset;
    }
    if ("body_font_size_pt" in payload) normalized.body_font_size_pt = assertValidBodyFontSize(payload.body_font_size_pt);

    const rawClassConfig = payload.class_config;
    if (rawClassConfig && typeof rawClassConfig === "object" && !Array.isArray(rawClassConfig)) {
      for (const field of CLASS_CONFIG_IDS) {
        if (field in rawClassConfig) {
          normalized.class_config[field] = this.validateClassConfigValue(field, (rawClassConfig as Record<string, unknown>)[field]);
        }
      }
    }

    if ("compile_target" in payload) {
      normalized.compile_target = normalizeCompileTarget(this.rootDir, payload.compile_target, normalized.compile_targets);
    }
    if ("compile_recipe" in payload) {
      normalized.compile_recipe = this.normalizeCompileRecipe(payload.compile_recipe, normalized.compile_recipes);
    }
    if ("compile_use_internal_fallback" in payload) {
      const raw = payload.compile_use_internal_fallback;
      if (typeof raw === "boolean") normalized.compile_use_internal_fallback = raw;
      else if (typeof raw === "string") {
        const parsed = boolFromTex(raw);
        if (parsed === null) throw new Error(`Invalid boolean value for compile_use_internal_fallback: ${raw}`);
        normalized.compile_use_internal_fallback = parsed;
      } else {
        throw new Error("Invalid boolean type for compile_use_internal_fallback");
      }
    }

    await this.refreshDerivedState(normalized);
    return normalized;
  }

  async applyCompilePreferences(state: ToolkitState, prefs: { compile_target?: string; compile_recipe?: string; compile_use_internal_fallback?: boolean }): Promise<void> {
    const previousTarget = state.compile_target;
    if (prefs.compile_target !== undefined) state.compile_target = prefs.compile_target;
    if (prefs.compile_recipe !== undefined) state.compile_recipe = prefs.compile_recipe;
    if (prefs.compile_use_internal_fallback !== undefined) state.compile_use_internal_fallback = prefs.compile_use_internal_fallback;
    if (prefs.compile_target !== undefined && prefs.compile_target !== previousTarget) {
      await this.coerceClassModeOnTargetSwitch(state);
    }
    await this.refreshDerivedState(state);
    state.compile_output_pdf = state.compile_output_pdf_expected || "main.pdf";
  }

  async applyCompileResult(state: ToolkitState, success: boolean, pdfPath: string): Promise<void> {
    await this.refreshDerivedState(state);
    state.compile_output_pdf = safeWorkspaceRel(this.rootDir, pdfPath) || state.compile_output_pdf_expected || "main.pdf";
    state.compile_last_compile_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    state.compile_last_success = success;
  }

  async persistUiState(state: ToolkitState): Promise<void> {
    const uiState = {
      toggles: state.toggles,
      colors: state.colors,
      style_preset: state.style_preset,
      style_base_preset: state.style_base_preset,
      // Keep legacy fields for older Toolkit versions reading this workspace cache.
      block_preset: this.styleDefinition(state.style_preset).block_source,
      heading_toc_preset: this.styleDefinition(state.style_preset).heading_source,
      body_font_size_pt: normalizeBodyFontSize(state.body_font_size_pt),
      class_config: this.normalizeClassConfigMap(state.class_config),
      compile_target: state.compile_target,
      compile_recipe: state.compile_recipe,
      compile_use_internal_fallback: state.compile_use_internal_fallback,
      compile_output_pdf: state.compile_output_pdf,
      compile_output_pdf_expected: state.compile_output_pdf_expected,
      compile_last_compile_at: state.compile_last_compile_at,
      compile_last_success: state.compile_last_success
    };
    await this.writeFileAtomic(this.configPath(), `${JSON.stringify(uiState, null, 2)}\n`);
  }

  async writeOverrideFiles(state: ToolkitState): Promise<void> {
    await this.prepareStateForWrite(state);
    await this.persistUiState(state);
    await this.writeToggleOverrideFile(state);
    await this.writeColorOverrideFile(state);
  }

  async writeColorState(state: ToolkitState): Promise<void> {
    state.style_preset = this.normalizePreset(state.style_preset, state.style_presets);
    for (const token of COLOR_ORDER) {
      const parsed = parseHexColor(state.colors[token] ?? "");
      if (!parsed) throw new Error(`Invalid hex color for ${token}: ${String(state.colors[token])}`);
      state.colors[token] = parsed;
    }
    let uiState: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(await fs.readFile(this.configPath(), "utf8"));
      if (this.isRecord(parsed)) uiState = parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" && !(err instanceof SyntaxError)) throw err;
    }
    uiState.colors = { ...state.colors };
    uiState.style_preset = state.style_preset;
    uiState.style_base_preset = state.style_base_preset;
    uiState.block_preset = this.styleDefinition(state.style_preset).block_source;
    uiState.heading_toc_preset = this.styleDefinition(state.style_preset).heading_source;
    await this.writeFileAtomic(this.configPath(), `${JSON.stringify(uiState, null, 2)}\n`);
    await this.writeColorOverrideFile(state);
    state.config_warnings = [];
  }

  async writeToggleOverrideFile(state: ToolkitState): Promise<void> {
    const toggleLines = [
      "% Auto-generated by LaTeX Editing Toolkit VS Code extension",
      "% Delete this file to return to defaults in main.tex."
    ];
    for (const entry of TOGGLE_SCHEMA) {
      toggleLines.push(`\\${entry.command}${state.toggles[entry.id] ? "true" : "false"}`);
    }
    toggleLines.push("", "% Class-aware options for theme.sty and theorems.tex.");
    for (const field of CLASS_CONFIG_IDS) {
      toggleLines.push(`\\def\\${CLASS_CONFIG_COMMANDS[field]}{${state.class_config[field]}}`);
    }
    toggleLines.push("", "% Base body font size in pt.");
    toggleLines.push(`\\def\\ThemeBodyFontSizePt{${formatBodyFontSize(state.body_font_size_pt)}}`);
    await this.writeFileAtomic(this.toggleOverridePath(), `${toggleLines.join("\n")}\n`);
  }

  async writeColorOverrideFile(state: ToolkitState): Promise<void> {
    const colorLines = [
      "% Auto-generated by LaTeX Editing Toolkit VS Code extension",
      "% Delete this file to return to defaults in theme.sty."
    ];
    for (const token of COLOR_ORDER) {
      const alias = `themeui${token.replace(/[^A-Za-z0-9]+/g, "")}`;
      const hex = (state.colors[token] ?? "#808080").replace(/^#/, "").toUpperCase();
      colorLines.push(`\\definecolor{${alias}}{HTML}{${hex}}`);
      colorLines.push(`\\colorlet{${token}}{${alias}}`);
    }
    await this.writeFileAtomic(this.colorOverridePath(), `${colorLines.join("\n")}\n`);
  }

  private async prepareStateForWrite(state: ToolkitState): Promise<void> {
    state.style_preset = this.normalizePreset(state.style_preset, state.style_presets);
    state.body_font_size_pt = normalizeBodyFontSize(state.body_font_size_pt);
    state.class_config = this.normalizeClassConfigMap(state.class_config);
    state.config_warnings = [];
    await this.refreshDerivedState(state);
  }

  async deleteOverrideFiles(): Promise<void> {
    for (const file of [this.configPath(), this.toggleOverridePath(), this.colorOverridePath()]) {
      try {
        await fs.unlink(file);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
  }

  applyStylePreset(state: ToolkitState, presetId: string): void {
    const catalog = this.buildStylePresetCatalog();
    const selected = this.normalizePreset(presetId, this.presetMeta(catalog));
    const preset = catalog.find((item) => item.id === selected);
    if (!preset) throw new Error(`Unknown style preset: ${presetId}`);
    for (const token of COLOR_ORDER) {
      state.colors[token] = preset.colors[token] ?? "#808080";
    }
    state.style_preset = selected;
    state.style_base_preset = preset.base_preset_id ?? preset.id;
    state.style_presets = this.presetMeta(catalog);
  }

  // Compatibility helpers for callers using the pre-unified API.
  applyBlockPreset(state: ToolkitState, presetId: string): void {
    this.applyStylePreset(state, this.styleIdFromBlockPreset(presetId));
  }

  applyHeadingTocPreset(state: ToolkitState, presetId: string): void {
    this.applyStylePreset(state, this.styleIdFromHeadingPreset(presetId));
  }

  async starterTemplateMeta(): Promise<PresetMeta[]> {
    const templateDir = path.join(this.rootDir, "templates");
    const assetTemplateDir = path.resolve(__dirname, "..", "assets", "template", "templates");
    const out: PresetMeta[] = [];
    for (const entry of STARTER_TEMPLATE_DEFINITIONS) {
      if (await exists(path.join(templateDir, entry.filename)) || await exists(path.join(assetTemplateDir, entry.filename))) {
        out.push({ id: entry.id, label: entry.label, description: entry.description });
      }
    }
    return out;
  }

  async templateSourcePath(filename: string): Promise<string> {
    const workspaceTemplate = path.join(this.rootDir, "templates", filename);
    if (await exists(workspaceTemplate)) return workspaceTemplate;
    return path.resolve(__dirname, "..", "assets", "template", "templates", filename);
  }

  async refreshDerivedState(state: ToolkitState): Promise<void> {
    state.compile_recipe_name = state.compile_recipes.find((item) => item.id === state.compile_recipe)?.name ?? "";
    state.compile_output_pdf_expected = await this.expectedOutputPdfForSelection(state);
    const detected = await this.detectTargetDocumentClass(state.compile_target);
    const hasChapter = isChapterCapableClass(detected);
    const mode = this.normalizeClassConfigValue("theme_class_mode", state.class_config.theme_class_mode);
    state.detected_document_class = detected || "(unknown)";
    state.detected_document_class_has_chapter = hasChapter;
    state.effective_theme_class = mode === "book" || mode === "article" ? mode : hasChapter ? "book" : "article";
  }

  private async expectedOutputPdfForSelection(state: ToolkitState): Promise<string> {
    if (!state.compile_target) return "main.pdf";
    if (state.compile_use_internal_fallback || !state.compile_recipe) {
      return compileOutputPdfRelpath(state.compile_target);
    }
    try {
      const catalog = await loadRecipeCatalog(this.rootDir);
      const recipe = catalog.recipes.find((item) => item.id === state.compile_recipe);
      if (!recipe) return compileOutputPdfRelpath(state.compile_target);
      const targetAbs = path.resolve(this.rootDir, state.compile_target);
      const targetDir = path.dirname(targetAbs);
      const stem = path.basename(targetAbs, ".tex");
      for (const toolName of recipe.tools) {
        const tool = catalog.tools[toolName];
        if (!tool) continue;
        const outdir = this.extractRecipeOutdir(tool.args);
        if (!outdir) continue;
        const normalizedOutdir = outdir === "%OUTDIR%" ? "." : outdir
          .replace(/%DOCFILE_NOEXT%/g, stem)
          .replace(/%DOCFILE%/g, path.basename(targetAbs))
          .replace(/%DOC%/g, targetAbs);
        const outAbs = path.isAbsolute(normalizedOutdir) ? path.resolve(normalizedOutdir) : path.resolve(targetDir, normalizedOutdir);
        if (!isSubpath(outAbs, this.rootDir)) return compileOutputPdfRelpath(state.compile_target);
        return workspaceRel(this.rootDir, path.join(outAbs, `${stem}.pdf`));
      }
    } catch {
      return compileOutputPdfRelpath(state.compile_target);
    }
    return compileOutputPdfRelpath(state.compile_target);
  }

  private extractRecipeOutdir(args: string[]): string | null {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg.startsWith("-outdir=")) return arg.slice("-outdir=".length);
      if (arg === "-outdir" && args[i + 1]) return args[i + 1];
      if (arg.startsWith("--output-directory=")) return arg.slice("--output-directory=".length);
      if (arg === "--output-directory" && args[i + 1]) return args[i + 1];
    }
    return null;
  }

  async detectTargetDocumentClass(targetRel: string): Promise<string> {
    if (!targetRel) return "";
    try {
      const abs = path.resolve(this.rootDir, targetRel);
      return await extractDocumentclassName(abs, this.rootDir);
    } catch {
      return "";
    }
  }

  private async parseMainToggleDefaults(): Promise<Record<string, boolean>> {
    const defaults: Record<string, boolean> = {};
    let text = "";
    try {
      text = await fs.readFile(this.mainTexPath(), "utf8");
    } catch {
      // New extension projects may not have main.tex yet.
    }
    for (const entry of TOGGLE_SCHEMA) {
      const regex = new RegExp(`\\\\${entry.command}(true|false)`, "g");
      const matches = Array.from(text.matchAll(regex));
      if (matches.length > 0) {
        defaults[entry.id] = boolFromTex(matches.at(-1)?.[1] ?? "true") ?? true;
      } else {
        defaults[entry.id] = entry.default ?? true;
      }
    }
    return defaults;
  }

  private async mergePersistedState(state: ToolkitState): Promise<void> {
    let raw: Record<string, unknown>;
    try {
      const parsed = JSON.parse(await fs.readFile(this.configPath(), "utf8"));
      if (!this.isRecord(parsed)) {
        this.addWarning(state, "theme.ui.json must contain a JSON object; defaults were used.");
        return;
      }
      raw = parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.addWarning(state, `Could not read theme.ui.json: ${(err as Error).message}`);
      }
      return;
    }

    if (this.isRecord(raw.toggles)) {
      for (const [key, value] of Object.entries(raw.toggles)) {
        if (!(key in state.toggles)) continue;
        if (typeof value === "boolean") state.toggles[key] = value;
        else if (typeof value === "string") {
          const parsed = boolFromTex(value);
          if (parsed === null) this.addWarning(state, `Ignored invalid toggle '${key}' in theme.ui.json.`);
          else state.toggles[key] = parsed;
        } else {
          this.addWarning(state, `Ignored invalid toggle '${key}' in theme.ui.json.`);
        }
      }
    } else if (raw.toggles !== undefined) {
      this.addWarning(state, "Ignored invalid toggles in theme.ui.json.");
    }

    if (this.isRecord(raw.colors)) {
      for (const [key, value] of Object.entries(raw.colors)) {
        if (!(key in state.colors)) continue;
        const parsed = parseHexColor(String(value));
        if (parsed) state.colors[key] = parsed;
        else this.addWarning(state, `Ignored invalid color '${key}' in theme.ui.json.`);
      }
    } else if (raw.colors !== undefined) {
      this.addWarning(state, "Ignored invalid colors in theme.ui.json.");
    }

    if (typeof raw.style_preset === "string") {
      try {
        state.style_preset = this.normalizePreset(raw.style_preset, state.style_presets);
        state.style_base_preset = this.styleDefinition(state.style_preset).base_preset_id ?? state.style_preset;
      } catch {
        const fallback = typeof raw.style_base_preset === "string" && this.isKnownBuiltInPreset(raw.style_base_preset)
          ? raw.style_base_preset
          : "default";
        state.style_preset = fallback;
        state.style_base_preset = fallback;
        this.addWarning(state, `Personal style '${raw.style_preset}' is unavailable; saved colors were preserved using '${fallback}' as the base.`);
      }
    } else if (raw.style_preset !== undefined) {
      this.addWarning(state, "Ignored invalid style_preset in theme.ui.json.");
    } else if (typeof raw.block_preset === "string") {
      if (this.isKnownBlockPreset(raw.block_preset)) {
        state.style_preset = this.styleIdFromBlockPreset(raw.block_preset);
        state.style_base_preset = state.style_preset;
      } else {
        this.addWarning(state, `Ignored unknown legacy block preset '${raw.block_preset}'.`);
      }
    }

    if ("body_font_size_pt" in raw) {
      try {
        state.body_font_size_pt = assertValidBodyFontSize(raw.body_font_size_pt);
      } catch {
        this.addWarning(state, "Ignored invalid body_font_size_pt in theme.ui.json.");
      }
    }

    if (this.isRecord(raw.class_config)) {
      for (const field of CLASS_CONFIG_IDS) {
        if (!(field in raw.class_config)) continue;
        try {
          state.class_config[field] = this.validateClassConfigValue(field, raw.class_config[field]);
        } catch {
          this.addWarning(state, `Ignored invalid class config '${field}'.`);
        }
      }
    } else if (raw.class_config !== undefined) {
      this.addWarning(state, "Ignored invalid class_config in theme.ui.json.");
    }

    if ("compile_target" in raw) {
      try {
        state.compile_target = normalizeCompileTarget(this.rootDir, raw.compile_target, state.compile_targets);
      } catch {
        this.addWarning(state, `Ignored unavailable compile target '${String(raw.compile_target)}'.`);
      }
    }
    if ("compile_recipe" in raw) {
      try {
        if (state.compile_recipes.length === 0 && String(raw.compile_recipe ?? "").trim()) {
          throw new Error("No compile recipes are available.");
        }
        state.compile_recipe = this.normalizeCompileRecipe(raw.compile_recipe, state.compile_recipes);
      } catch {
        this.addWarning(state, `Ignored unavailable compile recipe '${String(raw.compile_recipe)}'.`);
      }
    }
    if ("compile_use_internal_fallback" in raw) {
      const value = raw.compile_use_internal_fallback;
      const parsed = typeof value === "boolean" ? value : typeof value === "string" ? boolFromTex(value) : null;
      if (parsed === null) this.addWarning(state, "Ignored invalid compile_use_internal_fallback in theme.ui.json.");
      else state.compile_use_internal_fallback = parsed;
    }
    if (typeof raw.compile_output_pdf === "string") state.compile_output_pdf = raw.compile_output_pdf;
    else if (raw.compile_output_pdf !== undefined) this.addWarning(state, "Ignored invalid compile_output_pdf in theme.ui.json.");
    if (typeof raw.compile_output_pdf_expected === "string") state.compile_output_pdf_expected = raw.compile_output_pdf_expected;
    else if (raw.compile_output_pdf_expected !== undefined) this.addWarning(state, "Ignored invalid compile_output_pdf_expected in theme.ui.json.");
    if (typeof raw.compile_last_compile_at === "string") state.compile_last_compile_at = raw.compile_last_compile_at;
    else if (raw.compile_last_compile_at !== undefined) this.addWarning(state, "Ignored invalid compile_last_compile_at in theme.ui.json.");
    if (typeof raw.compile_last_success === "boolean" || raw.compile_last_success === null) state.compile_last_success = raw.compile_last_success;
    else if (raw.compile_last_success !== undefined) this.addWarning(state, "Ignored invalid compile_last_success in theme.ui.json.");
  }

  private async mergeOverrideFiles(state: ToolkitState): Promise<void> {
    try {
      const text = await fs.readFile(this.toggleOverridePath(), "utf8");
      for (const entry of TOGGLE_SCHEMA) {
        const matches = Array.from(text.matchAll(new RegExp(`\\\\${entry.command}(true|false)`, "g")));
        if (matches.length > 0) state.toggles[entry.id] = boolFromTex(matches.at(-1)?.[1] ?? "") ?? state.toggles[entry.id];
      }
      for (const field of CLASS_CONFIG_IDS) {
        const command = CLASS_CONFIG_COMMANDS[field];
        const matches = Array.from(text.matchAll(new RegExp(`\\\\def\\\\${command}\\{([^}]+)\\}`, "g")));
        if (matches.length > 0) {
          try {
            state.class_config[field] = this.validateClassConfigValue(field, matches.at(-1)?.[1]);
          } catch {
            this.addWarning(state, `Ignored invalid class config '${field}' in theme.overrides.tex.`);
          }
        }
      }
      const fontMatch = Array.from(text.matchAll(/\\def\\ThemeBodyFontSizePt\{([^}]+)\}/g));
      if (fontMatch.length > 0) {
        try {
          state.body_font_size_pt = assertValidBodyFontSize(fontMatch.at(-1)?.[1]);
        } catch {
          this.addWarning(state, "Ignored invalid body font size in theme.overrides.tex.");
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.addWarning(state, `Could not read theme.overrides.tex: ${(err as Error).message}`);
      }
    }

    try {
      const text = await fs.readFile(this.colorOverridePath(), "utf8");
      const defines = new Map<string, string>();
      for (const match of text.matchAll(/\\definecolor\{([^}]+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/g)) {
        defines.set(match[1], `#${match[2].toUpperCase()}`);
      }
      for (const match of text.matchAll(/\\colorlet\{([^}]+)\}\{([^}]+)\}/g)) {
        const token = match[1];
        const mapped = match[2];
        if (!COLOR_SET.has(token)) continue;
        const defined = defines.get(mapped);
        const parsed = defined ?? parseHexColor(mapped);
        if (parsed) state.colors[token] = parsed;
        else this.addWarning(state, `Ignored invalid color mapping for '${token}' in theme.colors.tex.`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.addWarning(state, `Could not read theme.colors.tex: ${(err as Error).message}`);
      }
    }
  }

  private finishNormalization(state: ToolkitState): void {
    for (const key of TOGGLE_IDS) state.toggles[key] = Boolean(state.toggles[key]);
    for (const key of COLOR_ORDER) state.colors[key] = parseHexColor(state.colors[key] ?? "") ?? "#808080";
    state.class_config = this.normalizeClassConfigMap(state.class_config);
    state.body_font_size_pt = normalizeBodyFontSize(state.body_font_size_pt);
    state.compile_output_pdf = safeWorkspaceRel(this.rootDir, state.compile_output_pdf) || state.compile_output_pdf_expected || compileOutputPdfRelpath(state.compile_target);
  }

  private buildStylePresetCatalog(): StylePresetDefinition[] {
    return this.allStylePresetDefinitions().map((definition) => ({
      ...definition,
      colors: { ...definition.colors }
    }));
  }

  private stylePresetSchema(): StylePresetSchema[] {
    return this.allStylePresetDefinitions().map(({ id, label, description, colors, source, base_preset_id, editable }) => ({
      id,
      label,
      description,
      colors: { ...colors },
      source: source ?? "builtin",
      base_preset_id: base_preset_id ?? id,
      editable: editable ?? false
    }));
  }

  private addWarning(state: ToolkitState, message: string): void {
    if (!state.config_warnings.includes(message)) state.config_warnings.push(message);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isKnownBlockPreset(raw: string): boolean {
    const value = raw.trim();
    return STYLE_PRESET_DEFINITIONS.some((preset) => preset.id === value || preset.block_source === value);
  }

  private isKnownBuiltInPreset(raw: string): boolean {
    return STYLE_PRESET_DEFINITIONS.some((preset) => preset.id === raw.trim());
  }

  private allStylePresetDefinitions(): StylePresetDefinition[] {
    return [
      ...STYLE_PRESET_DEFINITIONS.map((preset) => ({ ...preset, source: "builtin" as const, base_preset_id: preset.id, editable: false })),
      ...this.additionalStylePresets
    ];
  }

  private async writeFileAtomic(targetPath: string, text: string): Promise<void> {
    const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    try {
      await fs.writeFile(tempPath, text, "utf8");
      await fs.rename(tempPath, targetPath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw err;
    }
  }

  private styleDefinition(styleId: string): StylePresetDefinition {
    return this.allStylePresetDefinitions().find((item) => item.id === styleId) ?? STYLE_PRESET_DEFINITIONS[0];
  }

  private styleIdFromBlockPreset(presetId: string): string {
    const normalized = presetId.trim();
    return STYLE_PRESET_DEFINITIONS.find((item) => item.id === normalized || item.block_source === normalized)?.id ?? "default";
  }

  private styleIdFromHeadingPreset(presetId: string): string {
    const normalized = presetId.trim();
    return STYLE_PRESET_DEFINITIONS.find((item) => item.id === normalized || item.heading_source === normalized)?.id ?? "default";
  }

  private presetMeta(catalog: StylePresetDefinition[]): PresetMeta[] {
    return catalog.map(({ id, label, description }) => ({ id, label, description }));
  }

  private defaultPresetId(catalog: StylePresetDefinition[]): string {
    return catalog.some((item) => item.id === "default") ? "default" : catalog[0]?.id ?? "";
  }

  private normalizePreset(raw: string, presets: PresetMeta[]): string {
    const value = raw.trim();
    const ids = new Set(presets.map((item) => item.id));
    if (!value) return ids.has("default") ? "default" : presets[0]?.id ?? "";
    if (ids.has(value)) return value;
    throw new Error(`Unknown preset: ${value}`);
  }

  private normalizeClassConfigValue(field: string, raw: unknown): string {
    const parsed = String(raw ?? "").trim().toLowerCase();
    const valid = CLASS_CONFIG_VALID_OPTIONS[field] as Set<string> | undefined;
    if (valid?.has(parsed)) return parsed;
    return CLASS_CONFIG_DEFAULTS[field] ?? "auto";
  }

  private validateClassConfigValue(field: string, raw: unknown): string {
    const parsed = String(raw ?? "").trim().toLowerCase();
    const valid = CLASS_CONFIG_VALID_OPTIONS[field] as Set<string> | undefined;
    if (valid?.has(parsed)) return parsed;
    throw new Error(`Invalid value for ${field}: ${String(raw)}.`);
  }

  private normalizeClassConfigMap(raw: Record<string, unknown>): Record<string, string> {
    const config = { ...CLASS_CONFIG_DEFAULTS };
    for (const field of CLASS_CONFIG_IDS) {
      if (field in raw) config[field] = this.normalizeClassConfigValue(field, raw[field]);
    }
    return config;
  }

  private normalizeCompileRecipe(raw: unknown, recipes: Array<{ id: string }>): string {
    if (recipes.length === 0) return "";
    const value = String(raw ?? "").trim();
    if (!value) return recipes[0]?.id ?? "";
    if (recipes.some((item) => item.id === value)) return value;
    throw new Error(`Unknown compile recipe: ${value}`);
  }

  async coerceClassModeOnTargetSwitch(state: ToolkitState): Promise<void> {
    const mode = this.normalizeClassConfigValue("theme_class_mode", state.class_config.theme_class_mode);
    if (mode !== "book" && mode !== "article") return;
    const detected = await this.detectTargetDocumentClass(state.compile_target);
    if (!detected) return;
    const hasChapter = isChapterCapableClass(detected);
    if ((mode === "book" && !hasChapter) || (mode === "article" && hasChapter)) {
      state.class_config.theme_class_mode = "auto";
    }
  }
}

export async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDirectory(srcPath, destPath);
    else if (entry.isFile()) await fs.copyFile(srcPath, destPath);
  }
}

async function copyMissingDirectory(src: string, dest: string, relLabel: string, copied: string[]): Promise<void> {
  if (!(await exists(dest))) {
    await copyDirectory(src, dest);
    copied.push(`${relLabel}/`);
    return;
  }
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const source = path.join(src, entry.name);
    const target = path.join(dest, entry.name);
    if (await exists(target)) continue;
    if (entry.isDirectory()) {
      await copyDirectory(source, target);
      copied.push(`${relLabel}/${entry.name}/`);
    } else if (entry.isFile()) {
      await fs.copyFile(source, target);
      copied.push(`${relLabel}/${entry.name}`);
    }
  }
}

export async function ensureWorkspaceTemplateAssets(rootDir: string, extensionDir: string): Promise<string[]> {
  const assetRoot = path.join(extensionDir, "assets", "template");
  const copied: string[] = [];
  const files = ["theme.sty", "theorems.tex", "commands.tex", "references.bib"];
  for (const file of files) {
    const target = path.join(rootDir, file);
    if (!(await exists(target))) {
      await fs.copyFile(path.join(assetRoot, file), target);
      copied.push(file);
    }
  }
  await copyMissingDirectory(path.join(assetRoot, "Fig"), path.join(rootDir, "Fig"), "Fig", copied);
  await copyMissingDirectory(path.join(assetRoot, "templates"), path.join(rootDir, "templates"), "templates", copied);
  return copied.map((item) => item.endsWith("/") ? item : workspaceRel(rootDir, path.join(rootDir, item)));
}

export function presetIdForColorMap(prefix: string, colors: Record<string, string>): string {
  return `${prefix}-${slugify(Object.entries(colors).map(([key, value]) => `${key}-${value}`).join("-")).slice(0, 20)}`;
}
