import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLOR_ORDER, STARTER_TEMPLATE_DEFINITIONS } from "../src/schema";
import { CleanupService } from "../src/cleanup";
import { SplitterService } from "../src/splitter";
import { StateService, ensureWorkspaceTemplateAssets } from "../src/state";
import { TemplateService } from "../src/template";
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

describe("TypeScript Toolkit migration", () => {
  it("parses theme color defaults from theme.sty", async () => {
    const defaults = await parseThemeColorDefaults(path.join(repoRoot, "theme.sty"), COLOR_ORDER);
    expect(defaults["theme-bold"]).toBe("#3F6F9F");
    expect(defaults["definition-body-bg"]).toMatch(/^#[0-9A-F]{6}$/);
    expect(defaults["question-accent"]).toMatch(/^#[0-9A-F]{6}$/);
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
