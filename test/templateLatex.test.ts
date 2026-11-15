import { execFile, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Compiles small documents against the bundled template with the article starter's own
 * preamble, so these exercise the shipped theme.sty, theorems.tex, commands.tex and
 * homework.sty as a project gets them. Skipped where no TeX installation is available.
 */

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(repoRoot, "assets", "template");
const runs = (command: string, args: string[]) => spawnSync(command, args, { stdio: "ignore" }).status === 0;
const canCompile = runs("pdflatex", ["--version"]) && runs("pdftotext", ["-v"]);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

interface Built {
  ok: boolean;
  log: string;
  /** The PDF's text with whitespace collapsed. */
  text: string;
  pages: number;
}

/** `overrides` goes into theme.overrides.tex, which the starter reads before loading the theme. */
async function build(body: string, options: { overrides?: string; preamble?: string } = {}): Promise<Built> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-template-"));
  roots.push(root);
  for (const file of ["theme.sty", "theorems.tex", "commands.tex", "homework.sty"]) {
    await fs.copyFile(path.join(assets, file), path.join(root, file));
  }
  const starter = await fs.readFile(path.join(assets, "templates", "article-minimal.tex"), "utf8");
  const preamble = starter.slice(0, starter.indexOf("\\title{"));
  if (options.overrides) await fs.writeFile(path.join(root, "theme.overrides.tex"), options.overrides);
  await fs.writeFile(path.join(root, "main.tex"), `${preamble}${options.preamble ?? ""}\n\\begin{document}\n${body}\n\\end{document}\n`);
  const ok = await execFileAsync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "main.tex"], { cwd: root, timeout: 120_000 })
    .then(() => true, () => false);
  const log = await fs.readFile(path.join(root, "main.log"), "latin1").catch(() => "");
  const text = ok ? (await execFileAsync("pdftotext", ["main.pdf", "-"], { cwd: root })).stdout.replace(/\s+/g, " ") : "";
  const pages = Number(/Output written on main\.pdf \((\d+) pages?/.exec(log)?.[1] ?? 0);
  return { ok, log, text, pages };
}

function firstError(log: string): string {
  return log.split("\n").find((line) => line.startsWith("!")) ?? "no error line in the log";
}

const PLAIN_THEOREMS = "\\EnablePlainAmsthmTheoremtrue\n";

describe.runIf(canCompile)("the bundled LaTeX template", () => {
  it("compiles every themed starter as shipped", async () => {
    for (const starter of ["article-minimal.tex", "book-minimal.tex", "homework-assignment.tex"]) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-starter-"));
      roots.push(root);
      for (const file of ["theme.sty", "theorems.tex", "commands.tex", "homework.sty", "references.bib"]) {
        await fs.copyFile(path.join(assets, file), path.join(root, file));
      }
      await fs.mkdir(path.join(root, "Fig"));
      await fs.copyFile(path.join(assets, "Fig", "cover.png"), path.join(root, "Fig", "cover.png"));
      await fs.copyFile(path.join(assets, "templates", starter), path.join(root, "main.tex"));
      const ok = await execFileAsync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "main.tex"], { cwd: root, timeout: 120_000 })
        .then(() => true, () => false);
      const log = await fs.readFile(path.join(root, "main.log"), "latin1").catch(() => "");
      expect(ok, `${starter}: ${firstError(log)}`).toBe(true);
    }
  }, 180_000);

  it("compiles homework problems and parts whose names use \\emph or \\textbf", async () => {
    const built = await build([
      "\\begin{homeworkProblem}[Show that \\emph{every} bounded sequence converges]",
      "x",
      "\\end{homeworkProblem}",
      "\\begin{homeworkProblem}[A \\textbf{bold} name]",
      "\\begin{homeworkSection}[Part \\emph{one}]",
      "y",
      "\\end{homeworkSection}",
      "\\end{homeworkProblem}"
    ].join("\n"), { preamble: "\\usepackage{homework}" });
    expect(built.ok, firstError(built.log)).toBe(true);
    expect(built.text).toContain("Show that every bounded sequence converges");
    expect(built.text).toContain("A bold name");
    expect(built.text).toContain("Part one");
  }, 60_000);

  it("breaks a long styled example or remark across pages instead of running off the page", async () => {
    const sentence = "A chain that is irreducible and aperiodic on a finite state space has a unique stationary distribution. ";
    const long = sentence.repeat(60);
    const built = await build(`Intro.\n\\ex{${long}End of example.}\n\\rmkb{${long}End of remark.}\nAfter.`);
    expect(built.ok, firstError(built.log)).toBe(true);
    expect(built.log).not.toMatch(/Overfull \\vbox/);
    expect(built.pages).toBeGreaterThan(2);
    for (const marker of ["End of example.", "End of remark.", "After."]) expect(built.text).toContain(marker);
  }, 60_000);

  it("keeps \\begin{assumption}, \\begin{fact} and \\begin{axiom} whole, beside their commands, in both theorem modes", async () => {
    const body = [
      "\\begin{assumption}",
      "The demand function is bounded.",
      "\\end{assumption}",
      "\\begin{fact}[Known]",
      "Every finite chain has a recurrent class.",
      "\\end{fact}",
      "\\begin{axiom}",
      "Choice holds.",
      "\\end{axiom}",
      "\\assumption{Regularity}{reg}{Utilities are finite.}",
      "\\fact{Closure}{}{Closed sets stay closed.}",
      "\\axiom{Order}{}{Every set can be well ordered.}"
    ].join("\n");
    for (const overrides of ["", PLAIN_THEOREMS]) {
      const built = await build(body, { overrides });
      expect(built.ok, firstError(built.log)).toBe(true);
      for (const text of [
        "The demand function is bounded.",
        "Every finite chain has a recurrent class.",
        "Choice holds.",
        "Regularity",
        "Utilities are finite.",
        "Closed sets stay closed.",
        "Every set can be well ordered."
      ]) {
        expect(built.text, `${overrides ? "plain" : "styled"} mode: ${text}`).toContain(text);
      }
    }
  }, 120_000);

  it("takes a note's braced title only from a brace group right after \\begin{note}", async () => {
    const built = await build([
      "\\begin{note}",
      "{\\bfseries Warning}: the bound is loose.",
      "\\end{note}",
      "\\begin{note}{Tip}",
      "Use the panel.",
      "\\end{note}"
    ].join("\n"), { overrides: PLAIN_THEOREMS });
    expect(built.ok, firstError(built.log)).toBe(true);
    expect(built.text).toContain("Note. Warning: the bound is loose.");
    expect(built.text).not.toContain("Note (Warning)");
    expect(built.text).toContain("Note (Tip). Use the panel.");
  }, 60_000);

  it("scales every size with the body font size, floats and footnotes included", async () => {
    const probe = [
      "\\makeatletter",
      "\\typeout{SIZE body=\\f@size}",
      "\\begin{figure}[h]\\typeout{SIZE float=\\f@size}x\\caption{c}\\end{figure}",
      "\\begin{minipage}{3cm}\\typeout{SIZE minipage=\\f@size}y\\end{minipage}",
      "Text\\footnote{\\typeout{SIZE footnote=\\f@size}z}",
      "{\\small\\typeout{SIZE small=\\f@size}}",
      "\\thm{T}{}{\\typeout{SIZE theorem=\\f@size}w}",
      "\\makeatother"
    ].join("\n");
    const sizes = (log: string) => Object.fromEntries([...log.matchAll(/SIZE (\w+)=([\d.]+)/g)].map((match) => [match[1], Number(match[2])]));

    const scaled = sizes((await build(probe, { overrides: "\\def\\ThemeBodyFontSizePt{14}\n" })).log);
    for (const where of ["body", "float", "minipage", "theorem"]) expect(scaled[where], where).toBeCloseTo(14, 1);
    // The class's 8pt footnotes and 9pt \small, scaled by 14/10.
    expect(scaled.footnote).toBeCloseTo(11.2, 1);
    expect(scaled.small).toBeCloseTo(12.6, 1);

    const unscaled = sizes((await build(probe)).log);
    expect(unscaled).toMatchObject({ body: 10, float: 10, footnote: 8, small: 9 });
  }, 120_000);

  it("colours bold text with the theme only over the default colour, and keeps \\textbf robust", async () => {
    const built = await build([
      "\\textbf{plain} \\textcolor{red}{\\textbf{red}}",
      "\\thm{T}{}{In a box: \\textbf{boxed}}",
      "\\edef\\probe{\\textbf{x}}",
      "\\section{The \\textbf{key} idea}"
    ].join("\n"), {
      // Records the colour in force when the kernel's \textbf runs.
      preamble: "\\makeatletter\\let\\probe@bold\\theme@originaltextbf\\protected\\def\\theme@originaltextbf#1{\\typeout{BOLD #1=\\current@color}\\probe@bold{#1}}\\makeatother"
    });
    expect(built.ok, firstError(built.log)).toBe(true);
    const colour = (word: string) => new RegExp(`BOLD ${word}=([^\\n]*)`).exec(built.log)?.[1];
    expect(colour("red")).toBe("1 0 0 rg 1 0 0 RG");
    expect(colour("plain")).not.toBe("0 g 0 G");
    expect(colour("plain")).not.toBe(colour("red"));
    expect(colour("boxed")).toBe(colour("plain"));
  }, 60_000);

  it("shows \\code arguments as written, special characters included", async () => {
    const built = await build("\\code{x#1} \\code{50\\%} \\code{my_var} \\code{a\\&b} \\code{\\{k\\}} \\code{\\alpha}");
    expect(built.ok, firstError(built.log)).toBe(true);
    for (const shown of ["x#1", "50%", "my_var", "a&b", "{k}", "\\alpha"]) expect(built.text).toContain(shown);
    expect(built.text).not.toContain("##");
  }, 60_000);
});

describe("the bundled starters", () => {
  it("label their sample definition with the defn: prefix \\defn adds", async () => {
    for (const starter of ["article-minimal.tex", "book-minimal.tex"]) {
      const text = await fs.readFile(path.join(assets, "templates", starter), "utf8");
      // A label without the prefix is written as defn:<label>, so \ref{<label>} would fail.
      for (const match of text.matchAll(/\\defn\{[^}]*\}\{([^}]*)\}/g)) expect(match[1], starter).toMatch(/^(defn:|$)/);
    }
  });
});
