import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HistoryConflictError } from "../src/changeHistory";
import { beamerHooksEnabled, defaultBeamerSettings, detectTemplateFromSource, detectWorkspaceTemplate, readBeamerSettings, renderBeamerClassOptions, writeBeamerSettings, writeTemplateMetadata } from "../src/beamer";
import { assetsForTemplate, templateFilePlan, upgradableTemplateExtras } from "../src/templatePlan";
import { defaultHomeworkSettings, enableHomeworkHooks, homeworkHooksEnabled, homeworkMachineryIsInline, isHomeworkNumberPrefix, normalizeHomeworkSettings, readHomeworkSettings, renderHomeworkSettings, writeHomeworkSettings } from "../src/homework";
import { CONFIRM_ACTIONS, confirmationSpec, isConfirmAction } from "../src/confirmations";
import { CLASS_CONFIG_DEFAULTS, COLOR_ORDER, STARTER_TEMPLATE_DEFINITIONS, STYLE_PRESET_DEFINITIONS } from "../src/schema";
import { CleanupService } from "../src/cleanup";
import { detectBibliographyTool } from "../src/compile";
import { LOCAL_PROJECTS_MAX_ENTRIES, LOCAL_PROJECTS_STATE_KEY, LocalProjectRegistry, sanitizeRecentProjectParents, scopedLocalProjectsStateKey, scopedStateKey } from "../src/projectRegistry";
import { LocalResourceRegistry, scopedStateKey as genericScopedStateKey, stableResourceId, type LocalResourceAdapter } from "../src/localResourceRegistry";
import { PersonalStyleRegistry, PERSONAL_STYLES_STATE_KEY } from "../src/personalStyles";
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
  for (const file of ["book-minimal.tex", "article-minimal.tex", "homework-assignment.tex", "research-paper.tex"]) {
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
  it("keeps workspace-relative paths inside the workspace", () => {
    const root = path.join(os.tmpdir(), "latex-toolkit-diagnostics");
    expect(path.resolve(root, "Sections/main.tex").startsWith(`${root}${path.sep}`)).toBe(true);
    expect(path.resolve(root, "../../outside.tex").startsWith(`${root}${path.sep}`)).toBe(false);
  });

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
    // Derived, not pinned: this asserts the preset wiring resolves, and should not have
    // to be edited every time the palette is retuned.
    expect(midnight.state.colors["theorem-accent"])
      .toBe(STYLE_PRESET_DEFINITIONS.find((preset) => preset.id === "midnight")!.colors["theorem-accent"]);
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
    expect(await registry.findById(first.id)).toMatchObject({ rootPath: path.normalize(firstRoot), missing: false });
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

  it("uses opaque, distinct state keys for separate authorities", () => {
    const local = scopedLocalProjectsStateKey("local|machine-a|local");
    const remoteA = scopedLocalProjectsStateKey("ssh-remote|machine-a|ssh-remote+host-a");
    const remoteB = scopedLocalProjectsStateKey("ssh-remote|machine-a|ssh-remote+host-b");
    expect(local).not.toContain("machine-a");
    expect(remoteA).not.toBe(remoteB);
    expect(remoteA).not.toBe(local);
    expect(scopedStateKey("recent", "same")).toBe(scopedStateKey("recent", "same"));
  });

  it("sanitizes recent project parent history", () => {
    const roots = Array.from({ length: 10 }, (_, index) => path.join(os.tmpdir(), `recent-${index}`));
    expect(sanitizeRecentProjectParents(["relative", roots[0], roots[0], ...roots.slice(1), roots[0]]))
      .toEqual(roots.slice(0, 8).map((root) => path.normalize(root)));
    expect(sanitizeRecentProjectParents({ bad: true })).toEqual([]);
  });

  it("migrates legacy projects only into an explicitly opted-in scoped registry", async () => {
    const store = new MemoryProjectStateStore();
    const root = await tempWorkspace();
    await store.update(LOCAL_PROJECTS_STATE_KEY, [{ rootPath: root, label: "legacy" }]);
    const scopedKey = scopedLocalProjectsStateKey("local|machine|local");
    const registry = new LocalProjectRegistry(store, scopedKey, { legacyKey: LOCAL_PROJECTS_STATE_KEY, migrateLegacy: true });
    expect((await registry.list())[0]?.label).toBe("legacy");
    expect(store.get<unknown>(scopedKey)).toBeDefined();

    const remoteKey = scopedLocalProjectsStateKey("ssh-remote|machine|host");
    const remoteRegistry = new LocalProjectRegistry(store, remoteKey, { legacyKey: LOCAL_PROJECTS_STATE_KEY, migrateLegacy: false });
    expect(await remoteRegistry.list()).toEqual([]);
    expect(store.get<unknown>(remoteKey)).toBeUndefined();
  });

  it("bounds registry entries and explicitly clears only missing projects", async () => {
    const store = new MemoryProjectStateStore();
    const registry = new LocalProjectRegistry(store);
    const existingRoot = await tempWorkspace();
    const missingRoot = path.join(await tempWorkspace(), "gone");
    await registry.add(existingRoot, "book-minimal");
    await registry.add(missingRoot, "book-minimal");
    expect(await registry.removeMissing()).toBe(1);
    expect((await registry.list()).map((entry) => entry.rootPath)).toEqual([path.normalize(existingRoot)]);

    const oversized = Array.from({ length: LOCAL_PROJECTS_MAX_ENTRIES + 20 }, (_, index) => ({
      id: `id-${index}`,
      rootPath: path.join(existingRoot, `project-${index}`),
      label: `Project ${index}`,
      templateId: "book-minimal",
      createdAt: new Date(index).toISOString()
    }));
    await store.update(LOCAL_PROJECTS_STATE_KEY, oversized);
    expect((await new LocalProjectRegistry(store).list()).length).toBe(LOCAL_PROJECTS_MAX_ENTRIES);
  });

  it("reuses the generic registry for mirror-shaped records and custom presence checks", async () => {
    type MirrorShape = { id: string; root: string; name: string; createdAt: string; manifestValid: boolean };
    const adapter: LocalResourceAdapter<MirrorShape> = {
      parse(raw) {
        if (!raw || typeof raw !== "object") return undefined;
        const item = raw as Partial<MirrorShape>;
        if (typeof item.root !== "string" || typeof item.name !== "string" || typeof item.createdAt !== "string") return undefined;
        return {
          id: typeof item.id === "string" && item.id ? item.id : stableResourceId("mirror", item.root),
          root: item.root,
          name: item.name,
          createdAt: item.createdAt,
          manifestValid: item.manifestValid === true
        };
      },
      serialize(record) { return record; },
      base(record) { return { id: record.id, rootPath: record.root, label: record.name, createdAt: record.createdAt }; },
      async isPresent(record) { return record.manifestValid; }
    };
    const store = new MemoryProjectStateStore();
    const registry = new LocalResourceRegistry(store, { stateKey: "mirrors", adapter });
    const root = await tempWorkspace();
    const record = await registry.upsert({ id: "mirror-1", root, name: "Mirror", createdAt: new Date().toISOString(), manifestValid: false });
    expect((await registry.findById(record.id))?.missing).toBe(true);
    expect(await registry.removeMissing()).toBe(1);
    expect(await registry.records()).toEqual([]);
    expect(genericScopedStateKey("mirrors", "remote-a")).not.toBe(genericScopedStateKey("mirrors", "remote-b"));
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

  it("preflights every declared starter template", async () => {
    const parent = await tempWorkspace();
    for (const template of STARTER_TEMPLATE_DEFINITIONS) {
      const result = await preflightCreateProject({ parentPath: parent, projectName: template.id, templateId: template.id }, repoRoot);
      expect(result.errors, `${template.id} preflight`).toEqual([]);
      expect(result.plannedFiles).toContain("main.tex");
    }
  });

  it("migrates a personal style saved before a color token existed", async () => {
    const store = new MemoryProjectStateStore();
    const base = STYLE_PRESET_DEFINITIONS.find((preset) => preset.id === "default")!;
    const { "axiom-body-bg": _dropped, ...older } = base.colors;
    // A record written by an older Toolkit is missing only the tokens added since.
    // parseRecord discards whatever validateColors rejects, so without a backfill the
    // user's saved styles would silently disappear on the next launch.
    await store.update(PERSONAL_STYLES_STATE_KEY, [{
      version: 1,
      id: "personal:older",
      label: "Older",
      basePresetId: "default",
      colors: older,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }]);
    const registry = new PersonalStyleRegistry(store);
    const listed = registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].colors["axiom-body-bg"]).toBe(base.colors["axiom-body-bg"]);
    expect(Object.keys(listed[0].colors).sort()).toEqual([...COLOR_ORDER].sort());
  });

  it("defines the axiom block in both theorem rendering modes", async () => {
    const theorems = await fs.readFile(path.join(repoRoot, "assets", "template", "theorems.tex"), "utf8");
    const theme = await fs.readFile(path.join(repoRoot, "assets", "template", "theme.sty"), "utf8");
    // amsthm mode: its own counter, matching every other numbering branch.
    expect(theorems).toContain("\\newtheorem{axiom}{Axiom}");
    expect(theorems).toContain("\\newtheorem{axiom}{Axiom}[chapter]");
    expect(theorems).toContain("\\newtheorem{axiom}{Axiom}[section]");
    // tcolorbox mode: shares the definition counter like the rest of the family.
    expect(theorems).toContain("\\newtcbtheorem[use counter from=mydefinition]{myaxiom}{Axiom}");
    expect(theorems).toContain("\\ThemeRunTcbTheorem{myaxiom}{axiom}");
    for (const token of ["body-bg", "title-bg", "title-fg", "accent"]) {
      expect(theme, token).toContain(`\\colorlet{axiom-${token}}{theme-default-axiom-${token}}`);
    }
    // Every preset must carry the tokens, which the whole-catalog test also enforces.
    for (const preset of STYLE_PRESET_DEFINITIONS) {
      expect(preset.colors["axiom-accent"], preset.id).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
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
    // The machinery deliberately does NOT live in main.tex: a starter is copied verbatim
    // once and never touched again, so anything here can never reach an existing project.
    // homework.sty is replaced in place by an asset upgrade, so improvements do land.
    expect(text).toContain("\\usepackage{homework}");
    expect(text).toContain("\\InputIfFileExists{.latex-editing-toolkit/homework-settings.tex}");
    expect(text).not.toContain("\\NewDocumentEnvironment{homeworkProblem}");
    expect(await fs.readFile(path.join(root, "homework.sty"), "utf8")).toBeTruthy();

    const sty = await fs.readFile(path.join(root, "homework.sty"), "utf8");
    expect(sty).toContain("\\NewDocumentEnvironment{homeworkProblem}");
    expect(sty).toContain("\\NewDocumentEnvironment{homeworkSection}");
    expect(sty).toContain("\\NewDocumentEnvironment{solution}");
    // Heading word, numbering style, prefix and section mode are all configurable, and
    // the two levels are configured independently.
    expect(sty).toContain("\\providecommand{\\homeworkProblemName}");
    expect(sty).toMatch(/NewDocumentEnvironment\{homeworkProblem\}\{o o D<>/);
    expect(sty).toMatch(/NewDocumentEnvironment\{homeworkSection\}\{o o D<>/);
    for (const command of ["homeworkProblemNumbering", "homeworkSectionNumbering", "homeworkProblemPrefix", "homeworkSectionNested", "homeworkSectionStandalone"]) {
      expect(sty).toContain(`\\NewDocumentCommand \\${command}`);
    }

    // homework.sty ships only to the homework starter, never to a plain article.
    const articleRoot = await tempWorkspace();
    await new TemplateService(articleRoot, repoRoot, new StateService(articleRoot)).createStarter("article-minimal", "main.tex", false);
    await expect(fs.access(path.join(articleRoot, "homework.sty"))).rejects.toThrow();
  });

  it("exposes and creates the research paper starter, and splits it into subfiles", async () => {
    const root = await tempWorkspace();
    const state = new StateService(root);
    const service = new TemplateService(root, repoRoot, state);
    expect(STARTER_TEMPLATE_DEFINITIONS.map((entry) => entry.id)).toContain("research-paper");
    const result = await service.createStarter("research-paper", "main.tex", false);
    const text = await fs.readFile(path.join(root, result.generated_target), "utf8");
    const response = await state.buildResponseState();
    expect(result.generated_target).toBe("main.tex");
    expect(response.schema.starter_templates.map((entry) => entry.id)).toContain("research-paper");
    expect(text).toContain("\\documentclass[11pt]{article}");
    expect(text).toContain("\\usepackage{subfiles}");
    expect(text).toContain("\\newcommand{\\loadmainreferences}");
    expect(text).toContain("\\bibliography{references}");
    // The starter is self-contained and must not pull in the Theme Designer assets.
    expect(text).not.toContain("\\usepackage{theme}");

    const metadata = JSON.parse(await fs.readFile(path.join(root, ".latex-editing-toolkit", "template.json"), "utf8"));
    expect(metadata).toMatchObject({ kind: "article", templateId: "research-paper", target: "main.tex" });
    expect(response.state.workspace_template).toMatchObject({
      kind: "article",
      templateId: "research-paper",
      detectionSource: "metadata",
      confidence: "exact"
    });
    expect(response.state.workspace_template.warning).toBeUndefined();

    const splitter = new SplitterService(root, state);
    const split = await splitter.splitTexFile(path.join(root, "main.tex"), "Sections", false);
    expect(split.generated_subfile_targets.length).toBeGreaterThan(0);
    const firstUnit = await fs.readFile(path.join(root, split.generated_subfile_targets[0]), "utf8");
    expect(firstUnit.startsWith("\\documentclass[../main.tex]{subfiles}")).toBe(true);
  });

  it("picks the bibliography processor the document actually needs", () => {
    expect(detectBibliographyTool("\\addbibresource{refs.bib}")).toBe("biber");
    expect(detectBibliographyTool("\\usepackage[style=authoryear]{biblatex}")).toBe("biber");
    expect(detectBibliographyTool("\\bibliographystyle{plainnat}\n\\bibliography{references}")).toBe("bibtex");
    expect(detectBibliographyTool("\\bibliographystyle{plainnat}")).toBeNull();
    expect(detectBibliographyTool("\\documentclass{article}")).toBeNull();
    expect(detectBibliographyTool("% \\bibliography{references}")).toBeNull();
  });

  it("leaves the workspace untouched when a starter cannot be generated", async () => {
    const root = await tempWorkspace();
    const state = new StateService(root);
    const service = new TemplateService(root, repoRoot, state);
    // An unknown id used to fall back to book-minimal and silently produce a book.
    await expect(service.createStarter("beamer-nonexistent", "main.tex", false)).rejects.toThrow(/Unknown starter template/);
    expect(await fs.readdir(root)).toEqual([]);

    await service.createStarter("article-minimal", "main.tex", false);
    const before = (await fs.readdir(root)).sort();
    const originalText = await fs.readFile(path.join(root, "main.tex"), "utf8");
    // A rejected overwrite must not copy assets or touch the existing target either.
    await expect(service.createStarter("book-minimal", "main.tex", false)).rejects.toThrow(/already exists/);
    expect((await fs.readdir(root)).sort()).toEqual(before);
    expect(await fs.readFile(path.join(root, "main.tex"), "utf8")).toBe(originalText);
  });

  it("refuses a target that differs from an existing file only by case", async () => {
    const root = await tempWorkspace();
    const state = new StateService(root);
    const service = new TemplateService(root, repoRoot, state);
    await service.createStarter("article-minimal", "main.tex", false);
    const originalText = await fs.readFile(path.join(root, "main.tex"), "utf8");
    const caseInsensitive = await fs.access(path.join(root, "MAIN.TEX")).then(() => true, () => false);
    if (!caseInsensitive) return;
    // On APFS/NTFS this is the same file; it used to be overwritten and then reported as
    // a failure because the compile-target lookup could not find the requested casing.
    await expect(service.createStarter("book-minimal", "Main.tex", false)).rejects.toThrow(/only by case/);
    expect(await fs.readFile(path.join(root, "main.tex"), "utf8")).toBe(originalText);
  });

  it("refuses to follow a symlink when copying template assets", async () => {
    const root = await tempWorkspace();
    const outside = await tempWorkspace();
    const escaped = path.join(outside, "escaped.sty");
    await fs.symlink(escaped, path.join(root, "theme.sty"));
    await expect(ensureWorkspaceTemplateAssets(root, repoRoot, "article-minimal")).rejects.toThrow(/symlink/i);
    await expect(fs.access(escaped)).rejects.toThrow();
  });

  it("plans the files a starter actually writes", async () => {
    const article = templateFilePlan("article-minimal", "main.tex");
    // The old hand-written preview omitted everything under templates/.
    expect(article?.assets).toContain("templates/research-paper.tex");
    expect(article?.assets).toContain("theme.sty");
    const beamer = templateFilePlan("beamer-gotham", "slides/deck.tex");
    expect(beamer?.assets).toContain("slides/beamer/gotham/beamerthemegotham.sty");
    expect(beamer?.metadata).toContain("slides/.latex-editing-toolkit/beamer-settings.tex");
    expect(templateFilePlan("nope")).toBeUndefined();
  });

  it("round-trips Beamer presentation settings without corrupting them", async () => {
    const root = await tempWorkspace();
    await new TemplateService(root, repoRoot, new StateService(root)).createStarter("beamer-blei", "main.tex", false);
    // TeX specials must survive a write/read cycle unchanged; # used to be a hard
    // compile error and % came back with a stray backslash.
    const typed = { ...defaultBeamerSettings(), title: "Sprint #4: 100% Q&A_1", author: "A. Author" };
    await writeBeamerSettings(root, "main.tex", typed);
    const source = await fs.readFile(path.join(root, "main.tex"), "utf8");
    const readBack = await readBeamerSettings(root, "main.tex", source);
    expect(readBack.title).toBe("Sprint #4: 100% Q&A_1");
    // A backslash must pass through untouched: the default date is \today, and every
    // other command a user puts in these fields would break if it were escaped.
    expect(readBack.date).toBe("\\today");
    const runtimeAfterWrite = await fs.readFile(path.join(root, ".latex-editing-toolkit", "beamer-settings.tex"), "utf8");
    expect(runtimeAfterWrite).toContain("\\def\\ToolkitBeamerDate{\\today}");

    // With no runtime file the starter's own \title{\ToolkitBeamerTitle} must not be
    // mistaken for a value, or the next write emits \def\X{\X} and TeX loops forever.
    await fs.rm(path.join(root, ".latex-editing-toolkit", "beamer-settings.tex"));
    const fresh = await readBeamerSettings(root, "main.tex", source);
    expect(fresh.title).toBe(defaultBeamerSettings().title);
    await writeBeamerSettings(root, "main.tex", fresh);
    const runtime = await fs.readFile(path.join(root, ".latex-editing-toolkit", "beamer-settings.tex"), "utf8");
    expect(runtime).not.toContain("\\def\\ToolkitBeamerTitle{\\ToolkitBeamerTitle}");
  });

  it("reads Beamer metadata with optional arguments and keeps an unmanaged aspect ratio", async () => {
    const root = await tempWorkspace();
    const source = [
      "\\documentclass[aspectratio=1610]{beamer}",
      "\\title[Short]{My Real Title}",
      "\\author[JD]{Jane Doe}",
      "\\begin{document}\\end{document}"
    ].join("\n");
    await fs.writeFile(path.join(root, "main.tex"), source, "utf8");
    const settings = await readBeamerSettings(root, "main.tex", source);
    expect(settings.title).toBe("My Real Title");
    expect(settings.author).toBe("Jane Doe");
    // 16:10 is not one of the two the UI offers, but rewriting it to 169 would resize
    // the deck behind the user's back.
    expect(settings.aspectRatio).toBe("1610");
    expect(renderBeamerClassOptions(settings)).toContain("aspectratio=1610");
  });

  it("round-trips homework settings through the generated file without corrupting them", async () => {
    const root = await tempWorkspace();
    const settings = {
      ...defaultHomeworkSettings(),
      course: "Linear Programming 101 & Beyond",
      title: "Problem Set #1",
      author: "Yiqi",
      dueDate: "\\today",
      problemWord: "Question",
      sectionWord: "Part",
      problemStyle: "Roman" as const,
      sectionStyle: "arabic" as const,
      problemPrefix: "1",
      sectionMode: "nested" as const
    };
    await writeHomeworkSettings(root, "main.tex", settings);
    expect(await readHomeworkSettings(root, "main.tex")).toEqual(settings);

    // \today must survive: escaping the backslash is what broke the Beamer date once.
    expect(renderHomeworkSettings(settings)).toContain("\\def\\ToolkitHomeworkDueDate{\\today}");
    // TeX specials in free text are escaped rather than breaking the build.
    expect(renderHomeworkSettings(settings)).toContain("\\def\\ToolkitHomeworkTitle{Problem Set \\#1}");

    // An empty heading word is a real choice — it prints the bare number — so it must not
    // be coalesced back to the default on the next read.
    const bare = { ...settings, problemWord: "", sectionWord: "", problemPrefix: "", sectionMode: "standalone" as const };
    await writeHomeworkSettings(root, "main.tex", bare);
    expect(await readHomeworkSettings(root, "main.tex")).toEqual(bare);
  });

  it("rejects a homework number prefix that LaTeX could not use", () => {
    for (const good of ["", "1", "12", "2.3", "1.2.3"]) expect(isHomeworkNumberPrefix(good), good).toBe(true);
    // These are exactly the values homework.sty raises bad-number for; catching them here
    // is what keeps the panel from writing a file that only fails at compile time.
    for (const bad of ["V", "1.x", "abc", "1..2", "1.", "-"]) expect(isHomeworkNumberPrefix(bad), bad).toBe(false);
    // An unusable value falls back to the previous setting instead of being written through.
    const base = { ...defaultHomeworkSettings(), problemPrefix: "1" };
    expect(normalizeHomeworkSettings({ problemPrefix: "1.x" }, base).problemPrefix).toBe("1");
    expect(normalizeHomeworkSettings({ problemStyle: "sideways" }, base).problemStyle).toBe("arabic");
    expect(normalizeHomeworkSettings({ sectionMode: "elsewhere" }, base).sectionMode).toBe("standalone");
  });

  it("does not count a commented-out homework hook as enabled", () => {
    const enabled = [
      "\\usepackage{homework}",
      "\\InputIfFileExists{.latex-editing-toolkit/homework-settings.tex}{}{}"
    ].join("\n");
    expect(homeworkHooksEnabled(enabled)).toBe(true);
    expect(homeworkHooksEnabled(enabled.split("\n").map((line) => `% ${line}`).join("\n"))).toBe(false);
    // The package alone is not enough: without the settings file the panel would appear
    // to work while saving into a file nothing reads.
    expect(homeworkHooksEnabled("\\usepackage{homework}")).toBe(false);
  });

  it("adds the homework hooks to a target that lacks them, and refuses one that defines the environments itself", async () => {
    const preamble = [
      "\\documentclass[oneside]{article}",
      "\\usepackage{theme}",
      "\\input{theorems.tex}",
      "\\input{commands.tex}"
    ].join("\n");
    const body = "\n\\begin{document}\n\\makehomeworktitle\n\\end{document}\n";

    const root = await tempWorkspace();
    await fs.writeFile(path.join(root, "main.tex"), `${preamble}${body}`, "utf8");
    await enableHomeworkHooks(root, "main.tex");
    const updated = await fs.readFile(path.join(root, "main.tex"), "utf8");
    expect(homeworkHooksEnabled(updated)).toBe(true);
    // The package belongs with the other Toolkit includes, and the settings file has to be
    // read after it so the numbering commands exist by the time it calls them.
    expect(updated.indexOf("\\input{commands.tex}")).toBeLessThan(updated.indexOf("\\usepackage{homework}"));
    expect(updated.indexOf("\\usepackage{homework}")).toBeLessThan(updated.indexOf("homework-settings.tex"));
    expect(updated.indexOf("homework-settings.tex")).toBeLessThan(updated.indexOf("\\begin{document}"));
    // Idempotent: clicking Enable twice must not stack a second copy.
    await enableHomeworkHooks(root, "main.tex");
    expect(await fs.readFile(path.join(root, "main.tex"), "utf8")).toBe(updated);

    // A target generated before homework.sty existed carries its own definitions, and
    // \NewDocumentEnvironment refuses to redefine — retrofitting would break the build
    // outright, so it has to be refused with the file left alone.
    const legacyRoot = await tempWorkspace();
    const legacy = `${preamble}\n\\newcounter{homeworkProblemCounter}\n\\NewDocumentEnvironment{homeworkProblem}{o}{}{}\n${body}`;
    await fs.writeFile(path.join(legacyRoot, "main.tex"), legacy, "utf8");
    expect(homeworkMachineryIsInline(legacy)).toBe(true);
    await expect(enableHomeworkHooks(legacyRoot, "main.tex")).rejects.toThrow(/its own copy of the homework environments/);
    expect(await fs.readFile(path.join(legacyRoot, "main.tex"), "utf8")).toBe(legacy);

    // The current starter loads the package, so it is never mistaken for a legacy target.
    const current = await fs.readFile(path.join(repoRoot, "assets/template/templates/homework-assignment.tex"), "utf8");
    expect(homeworkMachineryIsInline(current)).toBe(false);
    expect(homeworkHooksEnabled(current)).toBe(true);
  });

  it("ships homework.sty only to the homework starter, and exposes it to upgrade", () => {
    const definition = (id: string) => STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === id);
    expect(assetsForTemplate(definition("homework-assignment"))).toContain("homework.sty");
    expect(assetsForTemplate(definition("article-minimal"))).not.toContain("homework.sty");
    expect(templateFilePlan("homework-assignment")!.assets).toContain("homework.sty");
    expect(templateFilePlan("article-minimal")!.assets).not.toContain("homework.sty");
    // The plan is also the undo snapshot, so a duplicate entry would be a real smell.
    const assets = templateFilePlan("book-minimal")!.assets;
    expect(new Set(assets).size).toBe(assets.length);
    // An upgrade replaces Toolkit-authored packages but never project-owned content.
    expect(upgradableTemplateExtras(definition("homework-assignment"))).toEqual(["homework.sty"]);
    expect(upgradableTemplateExtras(definition("book-minimal"))).not.toContain("Fig/cover.png");
  });

  it("applies the chosen style preset while generating, and leaves self-contained starters alone", async () => {
    const generate = async (templateId: string, stylePreset: string) => {
      const root = await tempWorkspace();
      const state = new StateService(root);
      await new TemplateService(root, repoRoot, state).createStarter(templateId, "main.tex", false, stylePreset);
      return { root, colors: await fs.readFile(path.join(root, "theme.colors.tex"), "utf8").catch(() => "") };
    };
    const hex = (preset: string) => STYLE_PRESET_DEFINITIONS.find((item) => item.id === preset)!.colors["theme-chapter"].replace("#", "").toUpperCase();

    // Generation never used to write theme.colors.tex at all, so a new project silently
    // took whatever was baked into theme.sty regardless of the choice.
    const themed = await generate("homework-assignment", "uchicago");
    expect(themed.colors).toContain(hex("uchicago"));
    expect(themed.colors).not.toContain(hex("ember"));

    // research-paper does not load theme.sty (asserted above), so writing colour overrides
    // for it would produce a file nothing reads.
    expect((await generate("research-paper", "uchicago")).colors).toBe("");

    // A homework project is generated ready to configure: package, hook and settings file.
    const state = new StateService(themed.root);
    const loaded = await state.loadState();
    expect(loaded.workspace_template.templateId).toBe("homework-assignment");
    expect(loaded.homework_hooks_enabled).toBe(true);
    expect(loaded.homework_settings).toEqual(defaultHomeworkSettings());
    expect((await state.buildResponseState()).schema.homework_capabilities).toContain("homework-numbering");
  });

  it("does not count commented-out Beamer hooks as enabled", () => {
    const enabled = [
      "\\IfFileExists{.latex-editing-toolkit/beamer-class-options.tex}{}{}",
      "\\IfFileExists{.latex-editing-toolkit/beamer-settings.tex}{}{}"
    ].join("\n");
    expect(beamerHooksEnabled(enabled)).toBe(true);
    expect(beamerHooksEnabled(enabled.split("\n").map((line) => `% ${line}`).join("\n"))).toBe(false);
  });

  it("keeps every tracked mirror copy of a shared asset or starter identical to the bundled one", async () => {
    // The repo root and examples/toolkit-guide are themselves Toolkit workspaces, so they
    // carry their own copies of the shared assets and starters. A project's templates/
    // copy shadows the bundled starter (StateService.templateSourcePath prefers it), so a
    // stale mirror silently regenerates an old template. Only commands.tex was guarded.
    const mirrors: Array<[string, string]> = [];
    for (const file of ["theme.sty", "theorems.tex", "commands.tex"]) {
      mirrors.push([`assets/template/${file}`, file], [`assets/template/${file}`, `examples/toolkit-guide/${file}`]);
    }
    for (const definition of STARTER_TEMPLATE_DEFINITIONS) {
      const mirror = `templates/${definition.filename}`;
      // The root workspace only keeps the non-Beamer starters.
      if (await fs.access(path.join(repoRoot, mirror)).then(() => true, () => false)) {
        mirrors.push([`assets/template/templates/${definition.filename}`, mirror]);
      }
    }
    expect(mirrors.length).toBeGreaterThan(6);
    for (const [bundled, mirror] of mirrors) {
      const [a, b] = await Promise.all([bundled, mirror].map((rel) => fs.readFile(path.join(repoRoot, rel), "utf8")));
      expect(b, `${mirror} has drifted from ${bundled}`).toBe(a);
    }
  });

  it("ships a line-breakable inline highlight in commands.tex", async () => {
    const canonical = await fs.readFile(path.join(repoRoot, "assets/template/commands.tex"), "utf8");
    // \tcbox is a single unbreakable hbox: a phrase longer than the space left on the
    // line used to overflow the margin instead of wrapping. The text highlights must
    // stay on the soulpos path.
    expect(canonical).toContain("\\ulposdef{\\thmi@underlay}");
    for (const command of ["key", "term", "warn", "todo"]) {
      expect(canonical, command).toMatch(new RegExp(`\\\\newcommand\\{\\\\${command}\\}\\[1\\]\\{\\\\themeInlineBox`));
    }
    // \code keeps the unbreakable chip on purpose: soul cannot scan \detokenize output,
    // and an identifier has no spaces to break at anyway.
    expect(canonical).toContain("\\themeInlineChip[fontupper=\\ttfamily\\footnotesize]");
  });

  it("creates bundled Beamer child templates with metadata and local theme assets", async () => {
    for (const template of STARTER_TEMPLATE_DEFINITIONS.filter((entry) => entry.kind === "beamer")) {
      const root = await tempWorkspace();
      const state = new StateService(root);
      const service = new TemplateService(root, repoRoot, state);
      const result = await service.createStarter(template.id, "main.tex", false);
      const source = await fs.readFile(path.join(root, "main.tex"), "utf8");
      const metadata = JSON.parse(await fs.readFile(path.join(root, ".latex-editing-toolkit", "template.json"), "utf8"));
      expect(result.generated_target).toBe("main.tex");
      expect(source).toContain("\\documentclass{beamer}");
      expect(metadata).toMatchObject({ kind: "beamer", templateId: template.id, target: "main.tex", assetVersion: "bundled" });
      for (const asset of template.assetManifest) await expect(fs.access(path.join(root, asset))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, ".latex-editing-toolkit", "beamer-class-options.tex"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, ".latex-editing-toolkit", "beamer-settings.tex"))).resolves.toBeUndefined();
      const response = await state.buildResponseState();
      expect(response.state.workspace_template).toMatchObject({ kind: "beamer", templateId: template.id, detectionSource: "metadata" });
      expect(response.state.workspace_template.assetsComplete).toBe(true);
      expect(response.schema.beamer_capabilities.length).toBeGreaterThan(0);
    }
  });

  it("detects Beamer child themes from source and preserves conflicting metadata as a warning", async () => {
    expect(detectTemplateFromSource("\\documentclass{beamer}\n\\usetheme{gotham}\n")).toMatchObject({ kind: "beamer", templateId: "beamer-gotham", confidence: "exact" });
    expect(detectTemplateFromSource("\\documentclass{beamer}\n\\usepackage{Ritsumeikan}\n")).toMatchObject({ kind: "beamer", templateId: "beamer-uchicago", confidence: "exact" });
    expect(detectTemplateFromSource("\\documentclass{beamer}\n")).toMatchObject({ kind: "beamer", templateId: "beamer-generic", confidence: "probable" });

    const root = await tempWorkspace();
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{beamer}\n\\usetheme{gotham}\n", "utf8");
    await writeTemplateMetadata(root, { kind: "beamer", templateId: "beamer-blei", target: "main.tex" });
    const state = await new StateService(root).loadState();
    expect(state.workspace_template).toMatchObject({ kind: "beamer", templateId: "beamer-blei", detectionSource: "metadata" });
    expect(state.workspace_template.warning).toContain("beamer-gotham");
  });

  it("applies template metadata only to the target it describes", async () => {
    const root = await tempWorkspace();
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{beamer}\n\\usetheme{blei}\n", "utf8");
    await fs.writeFile(path.join(root, "article.tex"), "\\documentclass{article}\n", "utf8");
    await writeTemplateMetadata(root, { kind: "beamer", templateId: "beamer-blei", target: "main.tex" });
    await expect(detectWorkspaceTemplate(root, "article.tex")).resolves.toMatchObject({ kind: "article", templateId: "article-minimal", detectionSource: "source" });
  });

  it("reads generated Beamer settings without changing the slide source", async () => {
    const root = await tempWorkspace();
    const state = new StateService(root);
    const service = new ToolkitService(root, repoRoot);
    await service.template.createStarter("beamer-gotham", "slides/main.tex", false);
    const before = await fs.readFile(path.join(root, "slides/main.tex"), "utf8");
    await expect(fs.access(path.join(root, "slides", "beamer", "gotham", "beamerthemegotham.sty"))).resolves.toBeUndefined();
    const result = await service.handle("beamer-settings", {
      target: "slides/main.tex",
      settings: { title: "A New Talk", author: "Ada", institute: "Lab", date: "2026", aspectRatio: "43", notesMode: "show-notes", sectionOutline: true }
    }) as { state: ToolkitState };
    const after = await fs.readFile(path.join(root, "slides/main.tex"), "utf8");
    expect(after).toBe(before);
    expect(result.state.beamer_settings).toMatchObject({ title: "A New Talk", aspectRatio: "43", notesMode: "show-notes", sectionOutline: true });
    expect((await readBeamerSettings(root, "slides/main.tex", after)).title).toBe("A New Talk");
    expect((await fs.readFile(path.join(root, "slides", ".latex-editing-toolkit", "beamer-settings.tex"), "utf8"))).toContain("show notes on second screen");
  });

  it("enables Beamer hooks explicitly for an existing presentation", async () => {
    const root = await tempWorkspace();
    await fs.writeFile(path.join(root, "main.tex"), [
      "\\documentclass{beamer}",
      "\\usetheme{gotham}",
      "\\title{Existing Talk}",
      "\\begin{document}",
      "\\begin{frame}{Hello}Hello\\end{frame}",
      "\\end{document}",
      ""
    ].join("\n"), "utf8");
    const service = new ToolkitService(root, repoRoot);
    const before = await service.handle("state", {}) as { state: ToolkitState };
    expect(before.state.beamer_hooks_enabled).toBe(false);
    const result = await service.handle("beamer-enable-hooks", {}) as { state: ToolkitState };
    const source = await fs.readFile(path.join(root, "main.tex"), "utf8");
    expect(result.state.beamer_hooks_enabled).toBe(true);
    expect(source).toContain("beamer-class-options.tex");
    expect(source).toContain("beamer-settings.tex");
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

  it("ignores history records that target files outside the workspace", async () => {
    const root = await tempWorkspace();
    const history = await tempWorkspace();
    await copyBaseAssets(root);
    await fs.writeFile(path.join(root, "main.tex"), "\\documentclass{article}\n", "utf8");
    await fs.writeFile(path.join(history, "last-change.json"), JSON.stringify({
      version: 1,
      rootPath: root,
      state: "applied",
      files: [{ path: "../outside.txt", before: { kind: "missing", fingerprint: "x" }, after: { kind: "missing", fingerprint: "x" } }]
    }));
    const service = new ToolkitService(root, repoRoot, { historyStorageDir: history });
    await expect(service.handle("undo-last-change", { force: true })).rejects.toThrow("No Toolkit change is available");
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
    const lockfile = JSON.parse(await fs.readFile(path.join(repoRoot, "package-lock.json"), "utf8"));
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
    expect(uiStateSource).toContain('version: 4');
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
    expect(source).toContain('data-section-target="snippets"');
    expect(source).toContain('id="snippetMonacoHost"');
    expect(source).toContain('request("snippets-save"');
    expect(source).toContain('loadSnippetState("snippets-state"');
    expect(styles).toContain(".snippet-manager-layout");
    expect(extension).toContain('command("hsnips.openSnippetManager"');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lockfile.version).toBe(manifest.version);
    expect(lockfile.packages[""].version).toBe(manifest.version);
    expect(manifest.icon).toBe("assets/icon.png");
    expect(manifest.activationEvents).toContain("onCommand:overleafCodex.compile");
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
    expect(readWorkspaceUiState(legacy, "/notes/a")).toEqual({ activeSection: "colors", activeStructureTask: "split", selectedSnippetFile: undefined, snippetSearch: undefined });
    const migrated = updateWorkspaceUiState(legacy, "/notes/a", "structure", "renumber", { selectedSnippetFile: "/notes/a/.vscode/hsnips/latex.hsnips", snippetSearch: "matrix" });
    expect(migrated).toEqual({
      version: 4,
      workspaces: {
        "/notes/a": { activeSection: "structure", activeStructureTask: "renumber", selectedSnippetFile: "/notes/a/.vscode/hsnips/latex.hsnips", snippetSearch: "matrix" },
        "/notes/b": { activeSection: "build", activeStructureTask: "split" }
      }
    });
    expect(readWorkspaceUiState(migrated, "/notes/a")).toEqual({ activeSection: "structure", activeStructureTask: "renumber", selectedSnippetFile: "/notes/a/.vscode/hsnips/latex.hsnips", snippetSearch: "matrix" });
    expect(readWorkspaceUiState({ version: 2, workspaces: { bad: { activeSection: "unknown", activeStructureTask: "bad" } } }, "bad"))
      .toEqual({ activeSection: "style", activeStructureTask: "split", selectedSnippetFile: undefined, snippetSearch: undefined });
    expect(readWorkspaceUiState({ version: 4, workspaces: { "global-snippets": { activeSection: "snippets", activeStructureTask: "split", snippetSearch: "align" } } }, "global-snippets"))
      .toEqual({ activeSection: "snippets", activeStructureTask: "split", selectedSnippetFile: undefined, snippetSearch: "align" });
  });

  it("keeps the full hsnips compatibility manifest and packages only the integrated manager", async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
    const commands = manifest.contributes.commands.map((entry: any) => entry.command);
    const expected = [
      "hsnips.openSnippetsDir", "hsnips.openWorkspaceSnippetsDir", "hsnips.openWorkspaceSnippetFile",
      "hsnips.openSnippetFile", "hsnips.openSnippetManager", "hsnips.selectProfile", "hsnips.openActiveProfile",
      "hsnips.reloadSnippets", "hsnips.convertEnvironment", "hsnips.renameMatchingEnvironment",
      "hsnips.wrapMathStructure", "hsnips.unwrapMathStructure", "hsnips.smartEnter", "hsnips.smartTab",
      "hsnips.matrixTab", "hsnips.leaveSnippet", "hsnips.nextPlaceholder", "hsnips.prevPlaceholder", "hsnips.expand"
    ];
    expect(expected.every((command) => commands.includes(command))).toBe(true);
    expect(expected.every((command) => manifest.activationEvents.includes(`onCommand:${command}`))).toBe(true);
    expect(Object.keys(manifest.contributes.configuration.properties)).toEqual(expect.arrayContaining([
      "hsnips.multiLineContext", "hsnips.windows", "hsnips.linux", "hsnips.mac",
      "hsnips.context.extraMathEnvironments", "hsnips.context.extraRowBreakEnvironments",
      "hsnips.context.extraAlignmentEnvironments", "hsnips.context.extraTextLikeCommands",
      "hsnips.profiles.activeProfile"
    ]));
    expect(manifest.contributes.languages).toContainEqual(expect.objectContaining({ id: "hsnips", extensions: [".hsnips"] }));
    expect(manifest.contributes.grammars).toContainEqual(expect.objectContaining({ language: "hsnips", scopeName: "source.hsnips" }));
    expect(await fs.access(path.join(repoRoot, "syntaxes", "hsnips.tmLanguage.json"))).toBeUndefined();
    const extension = await fs.readFile(path.join(repoRoot, "src", "extension.ts"), "utf8");
    expect(extension).toContain('const legacyId = "yiqiyang33.yiqis-latexsnips"');
    expect(extension).toContain('snippetsOnly: !this.folder');
    expect(extension).not.toContain("registerSnippetManager");
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
