import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOCK_PRESET_DEFINITIONS, CLASS_CONFIG_DEFAULTS, COLOR_ORDER, HEADING_TOC_PRESET_DEFINITIONS, STARTER_TEMPLATE_DEFINITIONS, STYLE_PRESET_DEFINITIONS } from "../src/schema";
import { CleanupService } from "../src/cleanup";
import { LOCAL_PROJECTS_STATE_KEY, LocalProjectRegistry } from "../src/projectRegistry";
import { SplitterService } from "../src/splitter";
import { StateService, ensureWorkspaceTemplateAssets } from "../src/state";
import { TemplateService } from "../src/template";
import type { LocalProjectStateStore } from "../src/types";
import { parseThemeColorDefaults } from "../src/utils";
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
    for (const preset of STYLE_PRESET_DEFINITIONS) {
      expect(Object.keys(preset.colors).sort()).toEqual([...COLOR_ORDER].sort());
      expect(preset.colors["theme-bold"]).toBe(preset.bold_color);
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

  it("normalizes a style-only payload to the complete bundle while preserving explicit color edits", async () => {
    const root = await tempWorkspace();
    await copyBaseAssets(root);
    const service = new StateService(root);
    const state = await service.loadState();

    const applied = await service.normalizePayload({ style_preset: "uchicago" }, state);
    expect(applied.style_preset).toBe("uchicago");
    expect(applied.colors["theme-bold"]).toBe("#800000");
    expect(applied.colors["inline-key-fg"]).toBe("#800000");

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

  it("parses theme color defaults from theme.sty", async () => {
    const defaults = await parseThemeColorDefaults(path.join(repoRoot, "theme.sty"), COLOR_ORDER);
    expect(defaults["theme-bold"]).toBe("#3F6F9F");
    expect(defaults["definition-body-bg"]).toMatch(/^#[0-9A-F]{6}$/);
    expect(defaults["question-accent"]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("exposes UChicago block and heading presets", () => {
    expect(BLOCK_PRESET_DEFINITIONS.find((preset) => preset.id === "uchicago")?.colors?.["theorem-accent"]).toBe("#800000");
    expect(BLOCK_PRESET_DEFINITIONS.find((preset) => preset.id === "uchicago")?.colors?.["inline-key-fg"]).toBe("#800000");
    expect(HEADING_TOC_PRESET_DEFINITIONS.find((preset) => preset.id === "uchicago")?.colors?.["theme-chapter"]).toBe("#800000");
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

  it("backs up and upgrades workspace theme assets, optionally resetting color overrides", async () => {
    const root = await tempWorkspace();
    const state = new StateService(root);
    const service = new TemplateService(root, repoRoot, state);
    await fs.writeFile(path.join(root, "theme.sty"), "% old theme\n", "utf8");
    await fs.writeFile(path.join(root, "theorems.tex"), "% old theorems\n", "utf8");
    await fs.writeFile(path.join(root, "commands.tex"), "% old commands\n", "utf8");
    await fs.writeFile(path.join(root, "theme.colors.tex"), "% old colors\n", "utf8");
    await fs.writeFile(path.join(root, "theme.ui.json"), "{\"colors\":{}}\n", "utf8");

    const result = await service.upgradeThemeAssets(true);
    const upgradedTheme = await fs.readFile(path.join(root, "theme.sty"), "utf8");
    const backupTheme = await fs.readFile(path.join(root, result.backup_dir, "theme.sty"), "utf8");
    const backupColors = await fs.readFile(path.join(root, result.backup_dir, "theme.colors.tex"), "utf8");

    expect(result.upgraded_files).toEqual(["theme.sty", "theorems.tex", "commands.tex"]);
    expect(result.reset_files).toEqual(["theme.colors.tex", "theme.ui.json"]);
    expect(upgradedTheme).toContain("\\ProvidesPackage{theme}");
    expect(backupTheme).toBe("% old theme\n");
    expect(backupColors).toBe("% old colors\n");
    await expect(fs.access(path.join(root, "theme.colors.tex"))).rejects.toThrow();
    await expect(fs.access(path.join(root, "theme.ui.json"))).rejects.toThrow();
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
