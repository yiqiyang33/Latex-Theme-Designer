import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HistoryConflictError } from "../src/changeHistory";
import { CONFIRM_ACTIONS, confirmationSpec, isConfirmAction } from "../src/confirmations";
import { CLASS_CONFIG_DEFAULTS, COLOR_ORDER, STARTER_TEMPLATE_DEFINITIONS, STYLE_PRESET_DEFINITIONS } from "../src/schema";
import { CleanupService } from "../src/cleanup";
import { LOCAL_PROJECTS_STATE_KEY, LocalProjectRegistry } from "../src/projectRegistry";
import { PersonalStyleRegistry } from "../src/personalStyles";
import { preflightCreateProject, runCreateProjectWorkflow } from "../src/projectWorkflow";
import { SplitterService } from "../src/splitter";
import { StateService, ensureWorkspaceTemplateAssets } from "../src/state";
import { TemplateService } from "../src/template";
import { ToolkitService } from "../src/toolkitService";
import type { LocalProjectStateStore, ToolkitState } from "../src/types";
import { parseThemeColorDefaults } from "../src/utils";
import { readWorkspaceUiState, updateWorkspaceUiState } from "../src/webview/uiState";
import { buildStructureSummary } from "../src/webview/structureSummary";
import { generateVscodeSettingsIfMissing, loadRecipeCatalog } from "../src/vscodeSettings";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function tempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-"));
}

async function copyBaseAssets(root: string): Promise<void> {
  for (const file of ["theme.sty", "theorems.tex", "commands.tex", "references.bib"]) {
    await fs.copyFile(path.join(repoRoot, "assets", "template", file), path.join(root, file));
  }
  await fs.mkdir(path.join(root, "templates"), { recursive: true });
  for (const file of ["book-minimal.tex", "article-minimal.tex", "homework-assignment.tex"]) {
    await fs.copyFile(path.join(repoRoot, "assets", "template", "templates", file), path.join(root, "templates", file));
  }
  await fs.mkdir(path.join(root, "Fig"), { recursive: true });
  await fs.copyFile(path.join(repoRoot, "assets", "template", "Fig", "cover.png"), path.join(root, "Fig", "cover.png"));
}

class MemoryProjectStateStore implements LocalProjectStateStore {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

describe("TypeScript Toolkit migration", () => {
  it("exposes five complete unified style presets with the documented pairings", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    const response = await new StateService(root).buildResponseState();
    expect(response.schema.style_presets.map((preset) => preset.id)).toEqual(["default", "midnight", "meadow", "ember", "uchicago"]);
    expect(STYLE_PRESET_DEFINITIONS.map((preset) => [preset.block_source, preset.heading_source])).toEqual([
      ["default", "default"],
      ["midnight", "inkstone"],
      ["meadow", "aurora"],
      ["ember", "sunset"],
      ["uchicago", "uchicago"]
    ]);
    expect(STYLE_PRESET_DEFINITIONS).toHaveLength(5);
    const boldColors: Record<string, string> = {
      default: "#334155", midnight: "#273B66", meadow: "#12727E", ember: "#A3422E", uchicago: "#800000"
    };
    for (const preset of STYLE_PRESET_DEFINITIONS) {
      expect(Object.keys(preset.colors).sort()).toEqual([...COLOR_ORDER].sort());
      expect(preset.colors["theme-bold"]).toBe(boldColors[preset.id]);
    }
  });

  it("applies complete style bundles including inline commands and bold text", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    const service = new StateService(root);
    const state = await service.loadState();
    service.applyStylePreset(state, "uchicago");
    expect(state.style_preset).toBe("uchicago");
    expect(state.colors["theme-bold"]).toBe("#800000");
    expect(state.colors["theme-section"]).toBe("#800000");
    expect(state.colors["inline-key-fg"]).toBe("#800000");
    expect(state.colors["inline-term-bg"]).toBe("#F6F4F2");

    service.applyStylePreset(state, "default");
    expect(state.style_preset).toBe("default");
    expect(state.colors["theme-bold"]).toBe("#334155");
    expect(state.colors["theme-section"]).toBe("#334155");
    expect(state.colors["inline-key-fg"]).toBe("#2F6F73");
    expect(state.colors["inline-term-bg"]).toBe("#EBF5F4");
  });

  it("does not leave custom colors behind when switching presets", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    const service = new StateService(root);
    const state = await service.loadState();
    state.colors["question-accent"] = "#123456";
    state.colors["theme-bold"] = "#654321";

    service.applyStylePreset(state, "midnight");
    expect(state.colors["question-accent"]).toBe(STYLE_PRESET_DEFINITIONS.find((preset) => preset.id === "midnight")?.colors["question-accent"]);
    expect(state.colors["theme-bold"]).toBe("#273B66");

    service.applyStylePreset(state, "default");
    expect(state.colors["question-accent"]).toBe(STYLE_PRESET_DEFINITIONS.find((preset) => preset.id === "default")?.colors["question-accent"]);
    expect(state.colors["theme-bold"]).toBe("#334155");
  });

  it("keeps ordinary save normalization separate from complete preset application", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    const service = new StateService(root);
    const state = await service.loadState();

    const applied = await service.normalizePayload({ style_preset: "uchicago" }, state);
    expect(applied.style_preset).toBe("uchicago");
    expect(applied.colors["theme-bold"]).toBe(state.colors["theme-bold"]);
    expect(applied.colors["inline-key-fg"]).toBe(state.colors["inline-key-fg"]);

    const edited = await service.normalizePayload({ style_preset: "uchicago", colors: { "inline-key-fg": "#123456" } }, state);
    expect(edited.style_preset).toBe("uchicago");
    expect(edited.colors["inline-key-fg"]).toBe("#123456");
  });

  it("migrates legacy preset ids by block precedence without replacing saved colors", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{book}\n", "utf8");
    await fs.writeFile(path.join(root, "theme.ui.json"), JSON.stringify({
      colors: { "inline-key-fg": "#123456" },
      block_preset: "uchicago",
      heading_toc_preset: "default"
    }), "utf8");
    const service = new StateService(root);
    const state = await service.loadState();
    expect(state.style_preset).toBe("uchicago");
    expect(state.colors["inline-key-fg"]).toBe("#123456");

    await service.writeOverrideFiles(state);
    const persisted = JSON.parse(await fs.readFile(path.join(root, "theme.ui.json"), "utf8"));
    expect(persisted.style_preset).toBe("uchicago");
    expect(persisted.block_preset).toBe("uchicago");
    expect(persisted.heading_toc_preset).toBe("uchicago");
  });

  it("applies legacy block and heading requests as complete unified styles", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{book}\n", "utf8");
    const service = new ToolkitService(root, repoRoot);

    const ember = await service.handle("block-preset", { block_preset: "ember" }) as { state: ToolkitState };
    expect(ember.state.style_preset).toBe("ember");
    expect(ember.state.colors["theme-section"]).toBe("#A3422E");
    expect(ember.state.colors["inline-key-fg"]).toBe("#9A4B33");

    const midnight = await service.handle("heading-toc-preset", { heading_toc_preset: "inkstone" }) as { state: ToolkitState };
    expect(midnight.state.style_preset).toBe("midnight");
    expect(midnight.state.colors["theorem-accent"]).toBe("#1B7286");
    expect(midnight.state.colors["theme-bold"]).toBe("#273B66");
  });

  it("loads malformed configuration field by field and exposes non-persistent warnings", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{book}\n", "utf8");
    await generateVscodeSettingsIfMissing(root);
    await fs.writeFile(path.join(root, "theme.ui.json"), JSON.stringify({
      toggles: { enable_block_shadow: "false", enable_heading_theme: "not-a-boolean" },
      colors: { "inline-key-fg": "#123456", "inline-term-bg": "not-a-color" },
      style_preset: "unknown-style",
      body_font_size_pt: 99,
      class_config: { theme_class_mode: "book", theme_heading_chapter_mode: "sometimes" },
      compile_target: "missing.tex",
      compile_recipe: "missing-recipe",
      compile_use_internal_fallback: "false",
      compile_last_success: "yes",
      future_field: { preservedByFutureVersion: true }
    }), "utf8");

    const service = new StateService(root);
    const state = await service.loadState();
    expect(state.toggles.enable_block_shadow).toBe(false);
    expect(state.toggles.enable_heading_theme).toBe(true);
    expect(state.colors["inline-key-fg"]).toBe("#123456");
    expect(state.style_preset).toBe("default");
    expect(state.body_font_size_pt).toBe(10);
    expect(state.class_config.theme_class_mode).toBe("book");
    expect(state.compile_target).toBe("main.tex");
    expect(state.compile_use_internal_fallback).toBe(false);
    expect(state.config_warnings.join("\n")).toContain("enable_heading_theme");
    expect(state.config_warnings.join("\n")).toContain("inline-term-bg");
    expect(state.config_warnings.join("\n")).toContain("unknown-style");
    expect(state.config_warnings.join("\n")).toContain("missing.tex");
    expect(state.config_warnings.join("\n")).toContain("missing-recipe");

    await service.writeOverrideFiles(state);
    const persisted = JSON.parse(await fs.readFile(path.join(root, "theme.ui.json"), "utf8"));
    expect(persisted.config_warnings).toBeUndefined();
    expect(state.config_warnings).toEqual([]);
  });

  it("recovers from broken theme.ui.json without making Toolkit state unavailable", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{article}\n", "utf8");
    await fs.writeFile(path.join(root, "theme.ui.json"), "{ broken json", "utf8");
    const state = await new StateService(root).loadState();
    expect(state.compile_target).toBe("main.tex");
    expect(state.style_preset).toBe("default");
    expect(state.config_warnings.join("\n")).toContain("Could not read theme.ui.json");
  });

  it("registers local note projects globally and deduplicates normalized paths", async () => {
    const store = new MemoryProjectStateStore();
    const registry = new LocalProjectRegistry(store);
    const firstRoot = await tempWorkspace();
    const secondRoot = await tempWorkspace();
    await fs.writeFile(path.join(firstRoot, "main.tex"), "\\documentclass{book}\n", "utf8");
    await fs.writeFile(path.join(secondRoot, "main.tex"), "\\documentclass{article}\n", "utf8");

    const first = await registry.add(firstRoot, "book-minimal");
    const duplicate = await registry.add(path.join(firstRoot, "."), "article-minimal");
    await registry.add(secondRoot, "article-minimal");
    const projects = await registry.list();

    expect(projects).toHaveLength(2);
    expect(duplicate.id).toBe(first.id);
    expect(projects.find((entry) => entry.id === first.id)?.templateId).toBe("article-minimal");
    expect(projects.every((entry) => entry.missing === false)).toBe(true);
  });

  it("serializes concurrent registry changes without losing unrelated projects", async () => {
    const store = new MemoryProjectStateStore();
    const registry = new LocalProjectRegistry(store);
    const firstRoot = await tempWorkspace();
    const secondRoot = await tempWorkspace();
    await Promise.all([
      registry.add(firstRoot, "book-minimal"),
      registry.add(secondRoot, "article-minimal"),
      registry.remove(firstRoot)
    ]);
    const projects = await registry.list();
    expect(projects.map((entry) => entry.rootPath)).toEqual([path.normalize(secondRoot)]);
    expect(await registry.find(secondRoot)).toMatchObject({ templateId: "article-minimal", missing: false });
  });

  it.runIf(process.platform !== "win32")("deduplicates symlinked project paths while preserving the original display record", async () => {
    const store = new MemoryProjectStateStore();
    const registry = new LocalProjectRegistry(store);
    const realRoot = await tempWorkspace();
    const linkParent = await tempWorkspace();
    const linkedRoot = path.join(linkParent, "linked-note");
    await fs.writeFile(path.join(realRoot, "main.tex"), "\\documentclass{book}\n", "utf8");
    await fs.symlink(realRoot, linkedRoot, "dir");

    const first = await registry.add(realRoot, "book-minimal");
    const duplicate = await registry.add(linkedRoot, "article-minimal");
    const projects = await registry.list();
    expect(projects).toHaveLength(1);
    expect(duplicate.id).toBe(first.id);
    expect(projects[0]?.rootPath).toBe(path.normalize(realRoot));
    expect(projects[0]?.createdAt).toBe(first.createdAt);
    expect(projects[0]?.templateId).toBe("article-minimal");
    expect((await registry.find(linkedRoot))?.id).toBe(first.id);
  });

  it("cleans corrupt and canonical duplicate registry entries by keeping the newest timestamp", async () => {
    const store = new MemoryProjectStateStore();
    const root = await tempWorkspace();
    await store.update(LOCAL_PROJECTS_STATE_KEY, [
      null,
      { id: "old", rootPath: root, label: "Old", templateId: "book-minimal", createdAt: "2024-01-01T00:00:00.000Z" },
      { id: "new", root_path: path.join(root, "."), template_id: "article-minimal", created_at: "2025-01-01T00:00:00.000Z" }
    ]);
    const registry = new LocalProjectRegistry(store);
    const projects = await registry.list();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe("new");
    expect(store.get<unknown[]>(LOCAL_PROJECTS_STATE_KEY)).toHaveLength(1);
  });

  it("keeps missing projects until they are explicitly removed", async () => {
    const store = new MemoryProjectStateStore();
    const registry = new LocalProjectRegistry(store);
    const missingRoot = path.join(await tempWorkspace(), "moved-note");
    await registry.add(missingRoot, "book-minimal");

    expect((await registry.list())[0]?.missing).toBe(true);
    expect(await registry.remove(missingRoot)).toBe(true);
    expect(await registry.list()).toEqual([]);
    expect(await registry.remove(missingRoot)).toBe(false);
  });

  it("relocates a missing project only to a directory containing main.tex", async () => {
    const store = new MemoryProjectStateStore();
    const registry = new LocalProjectRegistry(store);
    const missingRoot = path.join(await tempWorkspace(), "old-note");
    const invalidRoot = await tempWorkspace();
    const validRoot = await tempWorkspace();
    await registry.add(missingRoot, "book-minimal");
    await fs.writeFile(path.join(validRoot, "main.tex"), "\\documentclass{book}\n", "utf8");

    await expect(registry.relocate(missingRoot, invalidRoot)).rejects.toThrow("does not contain main.tex");
    const relocated = await registry.relocate(missingRoot, validRoot);
    const projects = await registry.list();

    expect(relocated.rootPath).toBe(path.normalize(validRoot));
    expect(projects).toHaveLength(1);
    expect(projects[0]?.missing).toBe(false);
    expect(projects[0]?.label).toBe(path.basename(validRoot));
  });

  it("ignores malformed registry data and migrates partial legacy entries", async () => {
    const store = new MemoryProjectStateStore();
    const root = await tempWorkspace();
    await store.update(LOCAL_PROJECTS_STATE_KEY, [null, { root_path: "relative/path" }, { root_path: root }]);
    const projects = await new LocalProjectRegistry(store).list();

    expect(projects).toHaveLength(1);
    expect(projects[0]?.rootPath).toBe(path.normalize(root));
    expect(projects[0]?.templateId).toBe("unknown");
    expect(projects[0]?.label).toBe(path.basename(root));
  });

  it("rejects non-local project paths", async () => {
    const registry = new LocalProjectRegistry(new MemoryProjectStateStore());
    await expect(registry.add("https://example.com/note", "book-minimal")).rejects.toThrow("absolute local path");
  });

  it("registers a created project only after assets and main.tex succeed", async () => {
    const calls: string[] = [];
    const service = {
      async handle(command: string): Promise<unknown> {
        calls.push(command);
        if (command === "template-bootstrap") throw new Error("starter failed");
        return {};
      }
    };
    let registrations = 0;
    const registry = {
      async add(): Promise<any> {
        registrations += 1;
        return {};
      }
    };
    await expect(runCreateProjectWorkflow(service, registry, "/tmp/note", "book-minimal")).rejects.toThrow("starter failed");
    expect(calls).toEqual(["initialize-workspace", "template-bootstrap"]);
    expect(registrations).toBe(0);
  });

  it("preflights an automatically-created project folder and rejects non-empty or invalid targets", async () => {
    const parent = await tempWorkspace();
    const fresh = await preflightCreateProject({ parentPath: parent, projectName: "New Notes", templateId: "book-minimal" }, repoRoot);
    expect(fresh.ok).toBe(true);
    expect(fresh.rootPath).toBe(path.join(parent, "New Notes"));
    expect(fresh.targetExists).toBe(false);

    await fs.mkdir(fresh.rootPath);
    const empty = await preflightCreateProject({ parentPath: parent, projectName: "New Notes", templateId: "book-minimal" }, repoRoot);
    expect(empty.ok).toBe(true);
    expect(empty.targetEmpty).toBe(true);

    await fs.writeFile(path.join(fresh.rootPath, "existing.txt"), "occupied", "utf8");
    const occupied = await preflightCreateProject({ parentPath: parent, projectName: "New Notes", templateId: "book-minimal" }, repoRoot);
    expect(occupied.ok).toBe(false);
    expect(occupied.errors.join(" ")).toContain("not empty");
    expect((await preflightCreateProject({ parentPath: parent, projectName: "../escape", templateId: "book-minimal" }, repoRoot)).ok).toBe(false);
  });

  it("stores complete personal styles globally and falls back without changing project colors", async () => {
    const store = new MemoryProjectStateStore();
    const registry = new PersonalStyleRegistry(store);
    const base = STYLE_PRESET_DEFINITIONS.find((preset) => preset.id === "uchicago")!;
    const saved = await registry.add("My Maroon", "uchicago", base.colors);
    expect(saved.id).toMatch(/^personal:/);
    expect(registry.definitions()[0]).toMatchObject({ source: "personal", base_preset_id: "uchicago", editable: true });

    const root = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{book}\n", "utf8");
    const withLibrary = new StateService(root, registry.definitions());
    const state = await withLibrary.loadState();
    withLibrary.applyStylePreset(state, saved.id);
    state.colors["inline-key-fg"] = "#123456";
    await withLibrary.writeOverrideFiles(state);

    const withoutLibrary = await new StateService(root).loadState();
    expect(withoutLibrary.style_preset).toBe("uchicago");
    expect(withoutLibrary.style_base_preset).toBe("uchicago");
    expect(withoutLibrary.colors["inline-key-fg"]).toBe("#123456");
    expect(withoutLibrary.config_warnings.join(" ")).toContain("unavailable");
  });

  it("imports personal style libraries with validation and reports skipped entries", async () => {
    const registry = new PersonalStyleRegistry(new MemoryProjectStateStore());
    const result = await registry.importLibrary({
      version: 1,
      styles: [
        {
          version: 1,
          id: "personal:imported",
          label: "Imported",
          description: "Imported style",
          basePresetId: "default",
          colors: STYLE_PRESET_DEFINITIONS[0].colors,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        { version: 1, id: "personal:broken", label: "Broken", basePresetId: "default", colors: {} }
      ]
    });
    expect(result).toEqual({ imported: 1, skipped: 1 });
    expect(registry.list()).toHaveLength(1);
  });

  it("parses theme color defaults from theme.sty", async () => {
    const defaults = await parseThemeColorDefaults(path.join(repoRoot, "theme.sty"), COLOR_ORDER);
    expect(defaults["theme-bold"]).toBe("#334155");
    expect(defaults["definition-body-bg"]).toMatch(/^#[0-9A-F]{6}$/);
    expect(defaults["question-accent"]).toMatch(/^#[0-9A-F]{6}$/);
    expect(defaults).toEqual(STYLE_PRESET_DEFINITIONS.find((preset) => preset.id === "default")?.colors);
  });

  it("exposes UChicago as one complete style preset", () => {
    const uchicago = STYLE_PRESET_DEFINITIONS.find((preset) => preset.id === "uchicago");
    expect(uchicago?.colors["theorem-accent"]).toBe("#800000");
    expect(uchicago?.colors["inline-key-fg"]).toBe("#800000");
    expect(uchicago?.colors["theme-chapter"]).toBe("#800000");
  });

  it("renders inline helpers through theme-aware box styling", async () => {
    const commands = await fs.readFile(path.join(repoRoot, "assets", "template", "commands.tex"), "utf8");
    expect(commands).toContain("\\NewDocumentCommand{\\themeInlineBox}");
    expect(commands).toContain("\\tcbox");
    expect(commands).toContain("\\newcommand{\\term}[1]{\\themeInlineBox{inline-term-bg}{inline-term-fg}{#1}}");
    expect(commands).toContain("\\newcommand{\\todo}[1]{\\themeInlineBox");
    expect(commands).toContain("\\newcommand{\\code}[1]");
  });

  it("defaults theorem numbering to no hierarchy while keeping styled shortcuts optional", async () => {
    const theorems = await fs.readFile(path.join(repoRoot, "assets", "template", "theorems.tex"), "utf8");
    expect(CLASS_CONFIG_DEFAULTS.theme_theorem_numbering_policy).toBe("none");
    expect(theorems).toContain("\\newtheorem{definition}{Definition}");
    expect(theorems).toContain("\\newtheorem{theorem}{Theorem}");
    expect(theorems).toContain("\\newtcbtheorem[number within=\\ThemeTheoremCounterWithin]{mydefinition}{Definition}");
    expect(theorems).toContain("\\ThemeBeginDefinition{#1}");
    expect(theorems).not.toContain("\\begin{definition}\\ThemeOptionalTheoremTitle");
    expect(theorems).not.toContain("\\ThemeOptionalTheoremTitle");
    expect(theorems).toContain("\\NewDocumentCommand{\\defn}{mm+m}");
    expect(theorems).toContain("\\ThemeRunTcbTheorem{mydefinition}{defn}{#1}{#2}{#3}");
  });

  it("derives inline helper colors when applying a block preset", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    const stateService = new StateService(root);
    const state = await stateService.loadState();
    stateService.applyBlockPreset(state, "ember");
    expect(state.colors["inline-key-fg"]).toBe("#9A4B33");
    expect(state.colors["inline-warn-fg"]).toBe("#A44C33");
    expect(state.colors["inline-code-bg"]).toBe("#F2F3FD");
  });

  it("loads VS Code JSONC recipes and generates settings only when missing", async () => {
    const root = await tempWorkspace();
    const first = await generateVscodeSettingsIfMissing(root);
    const second = await generateVscodeSettingsIfMissing(root);
    const catalog = await loadRecipeCatalog(root);
    expect(first.generated).toBe(true);
    expect(second.generated).toBe(false);
    expect(catalog.recipes.map((recipe) => recipe.name)).toContain("LaTeXmk");
  });

  it("initializes template assets and creates a starter target", async () => {
    const root = await tempWorkspace();
    const state = new StateService(root);
    const service = new TemplateService(root, repoRoot, state);
    const copied = await ensureWorkspaceTemplateAssets(root, repoRoot);
    const result = await service.createStarter("article-minimal", "notes", false);
    const response = await state.buildResponseState();
    expect(copied).toContain("theme.sty");
    expect(result.generated_target).toBe("notes.tex");
    expect(response.state.compile_targets).toContain("notes.tex");
  });

  it("undoes and redoes workspace initialization and starter generation", async () => {
    const root = await tempWorkspace();
    const history = await tempWorkspace();
    const service = new ToolkitService(root, repoRoot, { historyStorageDir: history });
    await service.handle("initialize-workspace", {});
    await expect(fs.access(path.join(root, "theme.sty"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, ".vscode", "settings.json"))).resolves.toBeUndefined();
    await service.handle("undo-last-change", {});
    await expect(fs.access(path.join(root, "theme.sty"))).rejects.toThrow();
    await expect(fs.access(path.join(root, ".vscode", "settings.json"))).rejects.toThrow();
    await service.handle("redo-last-change", {});
    await expect(fs.access(path.join(root, "theme.sty"))).resolves.toBeUndefined();

    await service.handle("template-bootstrap", { template_id: "article-minimal", output_target: "notes.tex", overwrite: false });
    await expect(fs.access(path.join(root, "notes.tex"))).resolves.toBeUndefined();
    await service.handle("undo-last-change", {});
    await expect(fs.access(path.join(root, "notes.tex"))).rejects.toThrow();
    await service.handle("redo-last-change", {});
    await expect(fs.access(path.join(root, "notes.tex"))).resolves.toBeUndefined();
  });

  it("exposes and creates the homework assignment starter", async () => {
    const root = await tempWorkspace();
    const state = new StateService(root);
    const service = new TemplateService(root, repoRoot, state);
    const templates = STARTER_TEMPLATE_DEFINITIONS.map((entry) => entry.id);
    expect(templates).toContain("homework-assignment");
    const result = await service.createStarter("homework-assignment", "homework", false);
    const text = await fs.readFile(path.join(root, result.generated_target), "utf8");
    const response = await state.buildResponseState();
    const starterIds = response.schema.starter_templates.map((entry) => entry.id);
    expect(result.generated_target).toBe("homework.tex");
    expect(starterIds).toContain("homework-assignment");
    expect(text).toContain("\\documentclass[oneside]{article}");
    expect(text).toContain("\\NewDocumentEnvironment{homeworkProblem}");
    expect(text).toContain("\\NewDocumentEnvironment{homeworkSection}");
    expect(text).toContain("\\NewDocumentEnvironment{solution}");
  });

  it("adds missing built-in starter templates without overwriting existing workspace templates", async () => {
    const root = await tempWorkspace();
    const state = new StateService(root);
    await fs.mkdir(path.join(root, "templates"), { recursive: true });
    await fs.writeFile(path.join(root, "templates", "article-minimal.tex"), "% custom article\n", "utf8");
    const beforeInit = await state.starterTemplateMeta();
    const copied = await ensureWorkspaceTemplateAssets(root, repoRoot);
    const article = await fs.readFile(path.join(root, "templates", "article-minimal.tex"), "utf8");
    expect(beforeInit.map((entry) => entry.id)).toContain("homework-assignment");
    expect(article).toBe("% custom article\n");
    expect(copied).toContain("templates/homework-assignment.tex");
    await expect(fs.access(path.join(root, "templates", "homework-assignment.tex"))).resolves.toBeUndefined();
  });

  it("backs up and upgrades workspace theme assets while resetting only the color package", async () => {
    const root = await tempWorkspace();
    const state = new StateService(root);
    const service = new TemplateService(root, repoRoot, state);
    await fs.writeFile(path.join(root, "theme.sty"), "% old theme\n", "utf8");
    await fs.writeFile(path.join(root, "theorems.tex"), "% old theorems\n", "utf8");
    await fs.writeFile(path.join(root, "commands.tex"), "% old commands\n", "utf8");
    await fs.writeFile(path.join(root, "theme.colors.tex"), "% old colors\n", "utf8");
    await fs.writeFile(path.join(root, "theme.overrides.tex"), "% existing class and toggle overrides\n", "utf8");
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{book}\n", "utf8");
    await fs.writeFile(path.join(root, "theme.ui.json"), JSON.stringify({
      colors: { "theme-bold": "#123456" },
      toggles: { enable_block_shadow: false },
      class_config: { theme_class_mode: "book" },
      body_font_size_pt: 11.5,
      compile_target: "main.tex",
      compile_use_internal_fallback: false,
      compile_last_compile_at: "2026-07-16T12:00:00Z",
      compile_last_success: true,
      future_field: { keep: true }
    }), "utf8");

    const result = await service.upgradeThemeAssets({ colorPolicy: "default" });
    const upgradedTheme = await fs.readFile(path.join(root, "theme.sty"), "utf8");
    const backupTheme = await fs.readFile(path.join(root, result.backup_dir, "theme.sty"), "utf8");
    const backupColors = await fs.readFile(path.join(root, result.backup_dir, "theme.colors.tex"), "utf8");

    expect(result.upgraded_files).toEqual(["theme.sty", "theorems.tex", "commands.tex"]);
    expect(result.color_policy).toBe("default");
    expect(result.updated_override_files).toEqual(["theme.colors.tex", "theme.ui.json"]);
    expect(upgradedTheme).toContain("\\ProvidesPackage{theme}");
    expect(backupTheme).toBe("% old theme\n");
    expect(backupColors).toBe("% old colors\n");
    const persisted = JSON.parse(await fs.readFile(path.join(root, "theme.ui.json"), "utf8"));
    expect(persisted.colors["theme-bold"]).toBe("#334155");
    expect(persisted.toggles.enable_block_shadow).toBe(false);
    expect(persisted.class_config.theme_class_mode).toBe("book");
    expect(persisted.body_font_size_pt).toBe(11.5);
    expect(persisted.compile_target).toBe("main.tex");
    expect(persisted.compile_use_internal_fallback).toBe(false);
    expect(persisted.compile_last_success).toBe(true);
    expect(persisted.future_field).toEqual({ keep: true });
    expect(await fs.readFile(path.join(root, "theme.overrides.tex"), "utf8")).toBe("% existing class and toggle overrides\n");
    await expect(fs.access(path.join(root, "theme.colors.tex"))).resolves.toBeUndefined();
  });

  it("preserves every existing config file when upgrading assets with Preserve Colors", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{book}\n", "utf8");
    const stateService = new StateService(root);
    const state = await stateService.loadState();
    stateService.applyStylePreset(state, "uchicago");
    state.toggles.enable_block_shadow = false;
    state.class_config.theme_class_mode = "book";
    state.compile_use_internal_fallback = false;
    await stateService.writeOverrideFiles(state);
    await fs.writeFile(path.join(root, "theme.sty"), "% old theme\n", "utf8");
    const beforeColors = await fs.readFile(path.join(root, "theme.colors.tex"), "utf8");
    const beforeUi = await fs.readFile(path.join(root, "theme.ui.json"), "utf8");
    const beforeToggles = await fs.readFile(path.join(root, "theme.overrides.tex"), "utf8");

    const result = await new TemplateService(root, repoRoot, stateService).upgradeThemeAssets({ colorPolicy: "preserve" });
    expect(result.color_policy).toBe("preserve");
    expect(result.updated_override_files).toEqual([]);
    expect(await fs.readFile(path.join(root, "theme.colors.tex"), "utf8")).toBe(beforeColors);
    expect(await fs.readFile(path.join(root, "theme.ui.json"), "utf8")).toBe(beforeUi);
    expect(await fs.readFile(path.join(root, "theme.overrides.tex"), "utf8")).toBe(beforeToggles);
  });

  it("maps the legacy reset_color_overrides upgrade payload to the new policies", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{article}\n", "utf8");
    const service = new ToolkitService(root, repoRoot);
    const preserve = await service.handle("upgrade-theme-assets", { reset_color_overrides: false }) as { color_policy: string };
    const reset = await service.handle("upgrade-theme-assets", { reset_color_overrides: true }) as { color_policy: string };
    expect(preserve.color_policy).toBe("preserve");
    expect(reset.color_policy).toBe("default");
  });

  it("rolls back replaced and newly-created theme assets when a reset write fails", async () => {
    class FailingStateService extends StateService {
      override async writeColorState(_state: ToolkitState): Promise<void> {
        throw new Error("simulated color write failure");
      }
    }
    const root = await tempWorkspace();
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{book}\n", "utf8");
    await fs.writeFile(path.join(root, "theme.sty"), "% original theme\n", "utf8");
    await fs.writeFile(path.join(root, "commands.tex"), "% original commands\n", "utf8");
    const service = new TemplateService(root, repoRoot, new FailingStateService(root));
    await expect(service.upgradeThemeAssets({ colorPolicy: "default" })).rejects.toThrow("simulated color write failure");
    expect(await fs.readFile(path.join(root, "theme.sty"), "utf8")).toBe("% original theme\n");
    expect(await fs.readFile(path.join(root, "commands.tex"), "utf8")).toBe("% original commands\n");
    await expect(fs.access(path.join(root, "theorems.tex"))).rejects.toThrow();
    await expect(fs.access(path.join(root, "theme.ui.json"))).rejects.toThrow();
    await expect(fs.access(path.join(root, "theme.colors.tex"))).rejects.toThrow();
  });

  it("autosaves editable state with persistent one-step undo and redo while preserving compile status", async () => {
    const root = await tempWorkspace();
    const history = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{book}\n", "utf8");
    const service = new ToolkitService(root, repoRoot, { historyStorageDir: history });
    const initial = await service.handle("state", {}) as { state: ToolkitState };
    const draft = structuredClone(initial.state);
    draft.colors["inline-key-fg"] = "#123456";
    const saved = await service.handle("autosave", { revision: 7, state: draft }) as { revision: number; history: { canUndo: boolean } };
    expect(saved.revision).toBe(7);
    expect(saved.history.canUndo).toBe(true);

    const compiled = await service.state.loadState();
    await service.state.applyCompileResult(compiled, true, "main.pdf");
    await service.state.persistUiState(compiled);
    const undone = await service.handle("undo-last-change", {}) as { state: ToolkitState; history: { canRedo: boolean } };
    expect(undone.state.colors["inline-key-fg"]).not.toBe("#123456");
    expect(undone.state.compile_last_success).toBe(true);
    expect(undone.history.canRedo).toBe(true);
    const redone = await service.handle("redo-last-change", {}) as { state: ToolkitState };
    expect(redone.state.colors["inline-key-fg"]).toBe("#123456");
  });

  it("detects external editable-state conflicts before undo", async () => {
    const root = await tempWorkspace();
    const history = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{article}\n", "utf8");
    const service = new ToolkitService(root, repoRoot, { historyStorageDir: history });
    const response = await service.handle("state", {}) as { state: ToolkitState };
    const draft = structuredClone(response.state);
    draft.body_font_size_pt = 11;
    await service.handle("autosave", { revision: 1, state: draft });
    const external = await service.state.loadState();
    external.colors["theme-bold"] = "#654321";
    await service.state.writeOverrideFiles(external);
    await expect(service.handle("undo-last-change", {})).rejects.toBeInstanceOf(HistoryConflictError);
    await expect(service.handle("undo-last-change", { force: true })).resolves.toBeDefined();
  });

  it("restores deleted override files through file-based undo and redo", async () => {
    const root = await tempWorkspace();
    const history = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{book}\n", "utf8");
    const service = new ToolkitService(root, repoRoot, { historyStorageDir: history });
    const state = await service.state.loadState();
    await service.state.writeOverrideFiles(state);
    await service.handle("reset", {});
    await expect(fs.access(path.join(root, "theme.ui.json"))).rejects.toThrow();
    await service.handle("undo-last-change", {});
    await expect(fs.access(path.join(root, "theme.ui.json"))).resolves.toBeUndefined();
    await service.handle("redo-last-change", {});
    await expect(fs.access(path.join(root, "theme.ui.json"))).rejects.toThrow();
  });

  it("ships the visual workbench, live style preview, and external PDF workflow without legacy controls", async () => {
    const source = await fs.readFile(path.join(repoRoot, "src", "webview", "index.ts"), "utf8");
    const styles = await fs.readFile(path.join(repoRoot, "src", "webview", "styles.css"), "utf8");
    const uiStateSource = await fs.readFile(path.join(repoRoot, "src", "webview", "uiState.ts"), "utf8");
    const extension = await fs.readFile(path.join(repoRoot, "src", "extension.ts"), "utf8");
    const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
    expect(source).toContain("previewStylePresetId");
    expect(source).toContain('request("autosave"');
    expect(source).toContain('className = "style-card"');
    expect(source).toContain('className = "style-miniature"');
    expect(source).toContain('setAttribute("aria-pressed"');
    expect(source).toContain('addEventListener("mouseenter"');
    expect(source).toContain('data-section-target="style"');
    expect(source).toContain('data-context-panel="style"');
    expect(source).toContain('request("pdf-status"');
    expect(source).toContain('request("open-pdf"');
    expect(source).toContain('request("confirm-action"');
    expect(source).not.toMatch(/\bconfirm\s*\(/);
    expect(uiStateSource).toContain('version: 2');
    expect(source).toContain("activeStructureTask");
    expect(source).toContain('id="loadingState"');
    expect(source).toContain('id="notice"');
    expect(source).toContain('id="structureResultState"');
    expect(source).toContain("chapter-overview-bg");
    expect(source).toContain("sidenote-accent");
    expect(source).not.toContain('id="pdfFrame"');
    expect(source).not.toContain("refreshPdf()");
    expect(source).not.toContain('request("pdf-uri"');
    expect(source).not.toContain("<iframe");
    expect(source).not.toContain('id="stylePresetSelect"');
    expect(source).not.toContain('id="applyStylePresetBtn"');
    expect(source).not.toContain('id="applyTargetBtn"');
    expect(source).not.toContain('id="applyRecipeBtn"');
    expect(source).not.toContain('id="saveBtn"');
    expect(source).not.toContain('class="major-section"');
    expect(source).toContain("Save as Personal Style");
    expect(source).toContain('id="upgradeColorPolicy"');
    expect(styles).toContain(".workbench {");
    expect(styles).toMatch(/grid-template-columns:\s*\d+px minmax\(\d+px, 1fr\) minmax\(330px, \d+px\)/);
    expect(styles).toContain("@media (max-width: 1179px)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain(".loading-state");
    expect(styles).toContain(".empty-state");
    expect(styles).toContain(".inline-notice");
    expect(styles).not.toContain("iframe");
    expect(extension).toContain('request.command === "pdf-status"');
    expect(extension).toContain('request.command === "confirm-action"');
    expect(extension).toContain('request.command === "show-log"');
    expect(extension).not.toContain('request.command === "pdf-uri"');
    expect(extension).toContain('"Appearance"');
    expect(extension).toContain('"Project Tools"');
    expect(manifest.version).toBe("0.4.1");
    expect(manifest.devDependencies["@vscode/codicons"]).toBeTruthy();
    expect(manifest.contributes.menus["view/item/context"].every((item: any) => !String(item.group).startsWith("inline"))).toBe(true);
    const build = await fs.readFile(path.join(repoRoot, "esbuild.mjs"), "utf8");
    expect(build).toContain("dist/codicon.css");
    expect(build).toContain("dist/codicon.ttf");
  });

  it("defines fixed native confirmation copy for every destructive Webview action", () => {
    expect(CONFIRM_ACTIONS).toEqual([
      "starter-overwrite",
      "upgrade-theme-assets",
      "reset-overrides",
      "clean-artifacts",
      "unsplit-delete-source"
    ]);
    for (const action of CONFIRM_ACTIONS) {
      expect(isConfirmAction(action)).toBe(true);
      const spec = confirmationSpec(action, action === "upgrade-theme-assets" ? "default" : "main.tex");
      expect(spec.message.length).toBeGreaterThan(10);
      expect(spec.detail.length).toBeGreaterThan(10);
      expect(spec.confirmLabel.length).toBeGreaterThan(2);
    }
    expect(isConfirmAction("arbitrary-action")).toBe(false);
    expect(confirmationSpec("starter-overwrite", "notes.tex").detail).toContain("notes.tex");
    expect(confirmationSpec("upgrade-theme-assets", "default").detail).toContain("Default color package");
    expect(confirmationSpec("upgrade-theme-assets", "preserve").detail).toContain("preserved");
  });

  it("migrates Webview UI state from v1 while preserving per-workspace navigation", () => {
    const legacy = {
      version: 1,
      workspaces: {
        "/notes/a": { activeSection: "colors" },
        "/notes/b": { activeSection: "build" }
      }
    };
    expect(readWorkspaceUiState(legacy, "/notes/a")).toEqual({ activeSection: "colors", activeStructureTask: "split" });
    const migrated = updateWorkspaceUiState(legacy, "/notes/a", "structure", "renumber");
    expect(migrated).toEqual({
      version: 2,
      workspaces: {
        "/notes/a": { activeSection: "structure", activeStructureTask: "renumber" },
        "/notes/b": { activeSection: "build", activeStructureTask: "split" }
      }
    });
    expect(readWorkspaceUiState(migrated, "/notes/a")).toEqual({ activeSection: "structure", activeStructureTask: "renumber" });
    expect(readWorkspaceUiState({ version: 2, workspaces: { bad: { activeSection: "unknown", activeStructureTask: "bad" } } }, "bad"))
      .toEqual({ activeSection: "style", activeStructureTask: "split" });
  });

  it("summarizes split, renumber, and merge results without double-counting deleted files", () => {
    expect(buildStructureSummary("split", {
      generated_subfile_targets: ["Sections/a.tex", "Sections/b.tex"],
      updated_files: ["main.tex", "Sections/a.tex"],
      warnings: ["Review appendix"]
    })).toMatchObject({ created: 2, updated: 2, renamed: 0, deleted: 0, warnings: 1 });
    expect(buildStructureSummary("renumber", {
      renamed: { "Sections/a.tex": "Sections/01-a.tex" },
      updated_files: ["main.tex"],
      warnings: []
    })).toMatchObject({ created: 0, updated: 1, renamed: 1, deleted: 0, warnings: 0 });
    const merged = buildStructureSummary("unsplit", {
      delete_source: true,
      source_target: "Sections/01-a.tex",
      updated_files: ["main.tex", "Sections/01-a.tex"],
      warnings: []
    });
    expect(merged).toMatchObject({ created: 0, updated: 1, renamed: 0, deleted: 1, warnings: 0 });
    expect(merged.entries).toEqual([
      { kind: "Updated", value: "main.tex" },
      { kind: "Deleted", value: "Sections/01-a.tex" }
    ]);
  });

  it("splits a book root into subfiles and preserves appendix in root", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    const main = path.join(root, "main.tex");
    await fs.writeFile(main, [
      "\\documentclass{book}",
      "\\begin{document}",
      "\\chapter{Main Part}",
      "Main body.",
      "\\appendix",
      "\\chapter{Proofs}",
      "Proof text.",
      "\\end{document}",
      ""
    ].join("\n"), "utf8");
    const splitter = new SplitterService(root, new StateService(root));
    const result = await splitter.splitTexFile(main, "Sections", false);
    const rewritten = await fs.readFile(main, "utf8");
    const unit = await fs.readFile(path.join(root, "Sections", "01-main-part.tex"), "utf8");
    expect(result.generated_subfile_targets).toEqual(["Sections/01-main-part.tex"]);
    expect(rewritten).toContain("\\subfile{Sections/01-main-part}");
    expect(rewritten).toContain("\\appendix");
    expect(unit).toContain("\\chapter{Main Part}");
    expect(unit).not.toContain("\\appendix");
  });

  it("undoes and redoes split-created files and the root rewrite", async () => {
    const root = await tempWorkspace();
    const history = await tempWorkspace();
    await copyBaseAssets(root);
    const original = ["\\documentclass{book}", "\\begin{document}", "\\chapter{Intro}", "Body.", "\\end{document}", ""].join("\n");
    await fs.writeFile(path.join(root, "main.tex"), original, "utf8");
    const service = new ToolkitService(root, repoRoot, { historyStorageDir: history });
    const result = await service.handle("split", { compile_target: "main.tex", sections_dir: "Sections" }) as { split: { generated_subfile_targets: string[] } };
    const generated = path.join(root, result.split.generated_subfile_targets[0]);
    await expect(fs.access(generated)).resolves.toBeUndefined();
    await service.handle("undo-last-change", {});
    expect(await fs.readFile(path.join(root, "main.tex"), "utf8")).toBe(original);
    await expect(fs.access(generated)).rejects.toThrow();
    await service.handle("redo-last-change", {});
    await expect(fs.access(generated)).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(root, "main.tex"), "utf8")).toContain("\\subfile");
  });

  it("renumbers referenced units and merges a subfile back to root", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.mkdir(path.join(root, "Sections"), { recursive: true });
    await fs.writeFile(path.join(root, "main.tex"), [
      "\\documentclass{book}",
      "\\usepackage{subfiles}",
      "\\begin{document}",
      "\\subfile{Sections/intro}",
      "\\end{document}",
      ""
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, "Sections", "intro.tex"), [
      "\\documentclass[../main.tex]{subfiles}",
      "\\begin{document}",
      "\\chapter{Intro}",
      "Body.",
      "\\end{document}",
      ""
    ].join("\n"), "utf8");
    const splitter = new SplitterService(root, new StateService(root));
    const renumber = await splitter.renumberReferences(path.join(root, "main.tex"), "add", false);
    expect(renumber.renamed).toEqual({ "Sections/intro.tex": "Sections/01-intro.tex" });
    const unsplit = await splitter.unsplitOneUnit(path.join(root, "Sections", "01-intro.tex"), false, true);
    const rootText = await fs.readFile(path.join(root, "main.tex"), "utf8");
    expect(unsplit.source_target).toBe("Sections/01-intro.tex");
    expect(rootText).toContain("\\chapter{Intro}");
    await expect(fs.access(path.join(root, "Sections", "01-intro.tex"))).rejects.toThrow();
  });

  it("undoes renumber and unsplit filesystem changes", async () => {
    const root = await tempWorkspace();
    const history = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.mkdir(path.join(root, "Sections"));
    await fs.writeFile(path.join(root, "main.tex"), ["\\documentclass{book}", "\\usepackage{subfiles}", "\\begin{document}", "\\subfile{Sections/intro}", "\\end{document}", ""].join("\n"), "utf8");
    await fs.writeFile(path.join(root, "Sections", "intro.tex"), ["\\documentclass[../main.tex]{subfiles}", "\\begin{document}", "\\chapter{Intro}", "Body.", "\\end{document}", ""].join("\n"), "utf8");
    const service = new ToolkitService(root, repoRoot, { historyStorageDir: history });
    await service.handle("renumber", { compile_target: "main.tex", mode: "add" });
    await expect(fs.access(path.join(root, "Sections", "01-intro.tex"))).resolves.toBeUndefined();
    await service.handle("undo-last-change", {});
    await expect(fs.access(path.join(root, "Sections", "intro.tex"))).resolves.toBeUndefined();
    await service.handle("redo-last-change", {});
    await expect(fs.access(path.join(root, "Sections", "01-intro.tex"))).resolves.toBeUndefined();

    await service.handle("unsplit", { compile_target: "Sections/01-intro.tex", delete_source: true });
    await expect(fs.access(path.join(root, "Sections", "01-intro.tex"))).rejects.toThrow();
    await service.handle("undo-last-change", {});
    await expect(fs.access(path.join(root, "Sections", "01-intro.tex"))).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(root, "main.tex"), "utf8")).toContain("\\subfile{Sections/01-intro}");
  });

  it("cleans root build artifacts while preserving PDFs", async () => {
    const root = await tempWorkspace();
    await fs.writeFile(path.join(root, "main.aux"), "", "utf8");
    await fs.writeFile(path.join(root, "main.pdf"), "", "utf8");
    const result = await new CleanupService(root).clean(false);
    expect(result.deleted_files).toContain("main.aux");
    expect(result.skipped_protected_files).not.toContain("main.pdf");
    await expect(fs.access(path.join(root, "main.aux"))).rejects.toThrow();
    await expect(fs.access(path.join(root, "main.pdf"))).resolves.toBeUndefined();
  });
});
