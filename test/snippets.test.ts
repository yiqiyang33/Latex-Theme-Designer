import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEnvironmentConversionPlan,
  createEnvironmentNameSyncPlan,
  createUnwrapMathStructurePlan,
  createWrapCurrentMathStructurePlan
} from "../src/snippets/engine/environmentConvert";
import {
  getLatexContext,
  getOpenLatexEnvironmentStack,
  getSmartEnterPlan,
  getSmartEnterRecoveryPlan,
  shouldInsertAlignmentSeparator,
  type SmartEnterPlan,
  type TextEdit
} from "../src/snippets/engine/latexEdit";
import { parse } from "../src/snippets/engine/parser";
import { getMathDelimiterStack } from "../src/snippets/engine/latexContext";

import {
  assertExpectedSnippetDocumentHash,
  appendSnippet,
  applySnippetUpdate,
  deleteSnippet,
  hashText,
  parseSnippetDocument
} from "../src/snippets/engine/snippetDocument";
import {
  discoverSnippetProfiles,
  getSnippetFiles,
  getSnippetFilesForProfile,
  getWorkspaceSnippetDir,
  getWorkspaceSnippetFiles,
  normalizeProfileName
} from "../src/snippets/engine/snippetProfiles";
import { assertSnippetPathAllowed } from "../src/snippets/pathPolicy";
import { readSnippetDocuments } from "../src/snippets/snippetManagerModel";

function marked(input: string): { text: string; offset: number } {
  const offset = input.indexOf("|");
  if (offset < 0) throw new Error("Test text requires a cursor marker.");
  return { text: input.slice(0, offset) + input.slice(offset + 1), offset };
}

function applyTextEdits(text: string, edits: TextEdit[]): string {
  return edits.slice().sort((a, b) => b.start - a.start)
    .reduce((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), text);
}

function applySmartEnter(text: string, plan: SmartEnterPlan): string {
  const result = applyTextEdits(text, plan.edits);
  if (!plan.handled || typeof plan.cursorOffset !== "number") throw new Error("Expected a handled Smart Enter plan.");
  return result.slice(0, plan.cursorOffset) + "|" + result.slice(plan.cursorOffset);
}

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("merged hsnips engine", () => {
  it("recognizes LaTeX math, comments, code, text commands, and custom environments", () => {
    const inline = marked(String.raw`before $x + y|$ after`);
    expect(getLatexContext(inline.text, inline.offset)).toMatchObject({ inMath: true, mathKind: "inlineDollar" });

    const label = marked(String.raw`\begin{align}
\label{eq:test|}
\end{align}`);
    expect(getLatexContext(label.text, label.offset).inMath).toBe(false);

    const comment = marked(String.raw`\begin{align}
a &= b % x|
\end{align}`);
    expect(getLatexContext(comment.text, comment.offset).canSmartEnter).toBe(false);

    const fenced = marked(["```tex", String.raw`\begin{align}`, "a &= b|", "```"].join("\n"));
    expect(getLatexContext(fenced.text, fenced.offset).canSmartEnter).toBe(false);

    const custom = marked(String.raw`\begin{myalign}
a &= b|
\end{myalign}`);
    expect(getLatexContext(custom.text, custom.offset, {
      extraMathEnvironments: ["myalign"],
      extraRowBreakEnvironments: ["myalign"],
      extraAlignmentEnvironments: ["myalign"]
    })).toMatchObject({ canExpandMathSnippet: true, canSmartEnter: true, canSmartTab: true });
    expect(getOpenLatexEnvironmentStack(custom.text, custom.offset)).toEqual(["myalign"]);
  });

  it("plans Smart Enter, recovery, and alignment Tab without touching unsafe lines", () => {
    const align = marked(String.raw`\begin{align}
  a &= b|
\end{align}`);
    expect(applySmartEnter(align.text, getSmartEnterPlan(align.text, align.offset))).toBe(String.raw`\begin{align}
  a &= b \\
  |
\end{align}`);

    const afterPlainEnter = marked(String.raw`\begin{align}
  a &= b
  |
\end{align}`);
    expect(applySmartEnter(afterPlainEnter.text, getSmartEnterRecoveryPlan(align.text, align.offset, afterPlainEnter.text)))
      .toContain(String.raw`a &= b \\`);

    expect(shouldInsertAlignmentSeparator(...Object.values(marked(String.raw`\begin{bmatrix}
a|
\end{bmatrix}`)) as [string, number])).toBe(true);
    const rowEnd = marked(String.raw`\begin{bmatrix}
a \\|
\end{bmatrix}`);
    expect(shouldInsertAlignmentSeparator(rowEnd.text, rowEnd.offset)).toBe(false);
  });

  it("converts, synchronizes, wraps, and unwraps mathematical environments", () => {
    const align = marked(String.raw`\begin{align}
a &= b|
\end{align}`);
    expect(applyTextEdits(align.text, createEnvironmentConversionPlan(align.text, align.offset, "aligned").edits))
      .toContain(String.raw`\begin{aligned}`);

    const before = String.raw`\begin{align}
a &= b
\end{align}`;
    const insertion = before.indexOf("align") + "align".length;
    const after = before.slice(0, insertion) + "ed" + before.slice(insertion);
    expect(applyTextEdits(after, createEnvironmentNameSyncPlan(before, after, { rangeOffset: insertion, rangeLength: 0, text: "ed" }).edits))
      .toBe(String.raw`\begin{aligned}
a &= b
\end{aligned}`);

    const display = marked(String.raw`\[
a &= b|
\]`);
    const wrapped = applyTextEdits(display.text, createWrapCurrentMathStructurePlan(display.text, display.offset, "aligned").edits);
    expect(wrapped).toContain(String.raw`\begin{aligned}`);
    expect(applyTextEdits(wrapped, createUnwrapMathStructurePlan(wrapped, wrapped.indexOf("a &= b") + 2).edits)).toContain("a &= b");
  });

  it("parses flags and protects snippet document updates with hashes", () => {
    const content = [
      "priority 10",
      'snippet foo "Foo" wA',
      String.raw`\foo{$0}`,
      "endsnippet",
      "",
      'snippet foo "Duplicate" A',
      String.raw`\bar`,
      "endsnippet",
      "",
      'snippet `x+` "Dynamic" rmA',
      '``rv = "x";``',
      "endsnippet"
    ].join("\n");
    const document = parseSnippetDocument(content, "/tmp/latex.hsnips", "latex");
    expect(document.snippets).toHaveLength(3);
    expect(document.snippets[0]).toMatchObject({ priority: 10, isSimple: true });
    expect(document.snippets[2]).toMatchObject({ isRegex: true, isDynamic: true, isSimple: false });
    expect(document.snippets[0].diagnostics.some((item) => item.message.includes("Duplicate"))).toBe(true);

    const updated = applySnippetUpdate(content, document.snippets[0], {
      trigger: "foo2", description: "Foo 2", flags: "iAm", priority: 5, body: String.raw`\fooTwo{$0}`
    });
    expect(updated).toContain('priority 5\nsnippet foo2 "Foo 2" iAm');
    expect(deleteSnippet(updated, parseSnippetDocument(updated).snippets[0])).not.toContain("foo2");
    expect(appendSnippet("", { trigger: "new", description: "New", flags: "wAt", priority: 0, body: "$0" }).trim())
      .toBe('snippet new "New" wAt\n$0\nendsnippet');
    expect(() => assertExpectedSnippetDocumentHash(content, hashText(content))).not.toThrow();
    expect(() => assertExpectedSnippetDocumentHash(content, hashText(content + "changed"))).toThrow(/changed on disk/);

    const textOnly = parse(['snippet align "align" wAt', String.raw`\begin{align}`, "$0", String.raw`\end{align}`, "endsnippet"].join("\n"));
    expect(textOnly[0]).toMatchObject({ automatic: true, wordboundary: true, text: true, math: false });
  });

  it("combines base, profile, and workspace files and diagnoses cross-file duplicates", async () => {
    const snippets = await tempDir("toolkit-snips-");
    const workspace = await tempDir("toolkit-workspace-");
    try {
      await fs.writeFile(path.join(snippets, "latex.hsnips"), 'snippet dup "Base" A\n\\base\nendsnippet\n', "utf8");
      await fs.mkdir(path.join(snippets, "profiles", "notes"), { recursive: true });
      await fs.writeFile(path.join(snippets, "profiles", "notes", "latex.hsnips"), 'priority 10\nsnippet prof "Profile" A\n\\prof\nendsnippet\n', "utf8");
      const workspaceSnippets = getWorkspaceSnippetDir(workspace);
      await fs.mkdir(workspaceSnippets, { recursive: true });
      await fs.writeFile(path.join(workspaceSnippets, "latex.hsnips"), 'priority 20\nsnippet dup "Workspace" A\n\\work\nendsnippet\n', "utf8");

      expect(discoverSnippetProfiles(snippets)).toEqual(["notes"]);
      expect(normalizeProfileName("../outside")).toBe("");
      expect(getSnippetFilesForProfile(snippets, "notes").map((entry) => entry.scope)).toEqual(["base", "profile"]);
      expect(getWorkspaceSnippetFiles(workspace).map((entry) => entry.scope)).toEqual(["workspace"]);
      expect(getSnippetFiles(snippets, "notes", workspaceSnippets, workspace).map((entry) => entry.scope))
        .toEqual(["base", "profile", "workspace"]);

      const documents = readSnippetDocuments(snippets, "notes", workspaceSnippets, workspace);
      const duplicateDiagnostics = documents.flatMap((document) => document.diagnostics).filter((item) => item.message.includes("across loaded snippet files"));
      expect(duplicateDiagnostics.length).toBeGreaterThanOrEqual(2);
    } finally {
      await fs.rm(snippets, { recursive: true, force: true });
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects traversal, wrong extensions, and symlink escapes from managed roots", async () => {
    const root = await tempDir("toolkit-snippet-root-");
    const outside = await tempDir("toolkit-snippet-outside-");
    try {
      const valid = path.join(root, "latex.hsnips");
      await fs.writeFile(valid, "", "utf8");
      await expect(assertSnippetPathAllowed(valid, [root], true)).resolves.toBeUndefined();
      await expect(assertSnippetPathAllowed(path.join(root, "latex.txt"), [root], false)).rejects.toThrow(/Only .hsnips/);
      await expect(assertSnippetPathAllowed(path.join(outside, "latex.hsnips"), [root], false)).rejects.toThrow(/outside/);
      const externalFile = path.join(outside, "external.hsnips");
      await fs.writeFile(externalFile, "", "utf8");
      const link = path.join(root, "linked.hsnips");
      await fs.symlink(externalFile, link);
      await expect(assertSnippetPathAllowed(link, [root], true)).rejects.toThrow(/outside/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
  // --- Regressions from the 2026-09 engine review -------------------------------------

  it("keeps snippet bodies loadable when they contain quotes or backslashes", () => {
    const snippets = parse([
      'snippet quoted "Quotes" A',
      String.raw`He said "hello" and \emph{"bye"}`,
      "endsnippet"
    ].join("\n"));
    expect(snippets).toHaveLength(1);
    // Before the fix escapeString escaped quotes first, so the backslash pass reopened
    // them and new Function() rejected the whole file, dropping every snippet in it.
    const [parts] = snippets[0].generator([], [], "", "");
    expect(parts.join("")).toContain(String.raw`He said "hello" and \emph{"bye"}`);
  });

  it("expands a snippet with an empty body instead of throwing", () => {
    const snippets = parse(['snippet empty "Empty" A', "endsnippet"].join("\n"));
    expect(snippets).toHaveLength(1);
    // The unconditional script.pop() used to remove the blockResults declaration.
    expect(() => snippets[0].generator([], [], "", "")).not.toThrow();
  });

  it("anchors a multiline regex trigger at the cursor, not at every line end", () => {
    const [snippet] = parse(['snippet `foo` "Regex" MA', "bar", "endsnippet"].join("\n"));
    expect(snippet.regexp?.test("foo")).toBe(true);
    // "foo\nbar" ends with bar: the trigger must not match the earlier line.
    expect(snippet.regexp?.test("foo\nbar")).toBe(false);
  });

  it("ignores a byte order mark before the first snippet header", () => {
    const snippets = parse('\uFEFFsnippet bom "BOM" A\nbody\nendsnippet');
    expect(snippets.map((snippet) => snippet.trigger)).toEqual(["bom"]);
  });

  it("does not treat $$ inside open inline math as display math", () => {
    // `text $a$$b$ X`: the $$ closes the inline span and opens a new one, so after the
    // final $ nothing is open and the cursor is in text mode.
    const stack = getMathDelimiterStack("text $a$$b$ X", "text $a$$b$ X".length);
    expect(stack).toHaveLength(0);
    expect(getLatexContext("text $a$$b$ X", "text $a$$b$ X".length).inMath).toBe(false);
    // A genuine display block still registers.
    expect(getLatexContext("text $$a", "text $$a".length).mathKind).toBe("displayDollar");
  });

  it("treats backticks as quotes in LaTeX and as code spans in Markdown", () => {
    const text = "He said `hello' and $x=1$, then `bye'.";
    const offset = text.indexOf("$x=1$") + 3;
    expect(getLatexContext(text, offset, { languageId: "latex" }).inMath).toBe(true);
    expect(getLatexContext(text, offset, { languageId: "markdown" }).inMath).toBe(false);
  });

  it("keeps a brace group that opens the environment body during conversion", () => {
    const text = "\\begin{aligned}\n{\\bf x} = 1\n\\end{aligned}";
    const plan = createEnvironmentConversionPlan(text, text.indexOf("= 1"), "align");
    expect(plan.handled).toBe(true);
    // parseBracedArguments used to cross the newline and claim {\bf x} as a \begin
    // argument, after which the conversion dropped it.
    expect(applyTextEdits(text, plan.edits)).toContain("{\\bf x} = 1");
  });

  it("preserves CRLF line endings when Smart Enter splits a line", () => {
    const text = "\\begin{align}\r\nx = 1\r\n\\end{align}";
    const plan = getSmartEnterPlan(text, text.indexOf("x = 1") + "x = 1".length);
    expect(plan.handled).toBe(true);
    const result = applyTextEdits(text, plan.edits);
    expect(result).not.toMatch(/[^\r]\n/);
    expect(result).toContain("x = 1 \\\\\r\n");
  });

  it("tracks a range across an edit that joins two lines", async () => {
    const { DynamicRange, GrowthType } = await import("../src/snippets/engine/dynamicRange");
    const { Position, Range } = await import("./mocks/vscode");
    // Document "hello\nworld" with a tracked range at (1,3)-(1,5); backspace at the start
    // of line 1 joins it onto the 5-character line 0, so the range must land at column 8.
    const tracked = new DynamicRange(new Position(1, 3) as never, new Position(1, 5) as never);
    tracked.update([
      {
        change: { range: new Range(0, 5, 1, 0), rangeOffset: 5, rangeLength: 1, text: "" } as never,
        growth: GrowthType.Grow
      }
    ]);
    expect({ line: tracked.range.start.line, character: tracked.range.start.character })
      .toEqual({ line: 0, character: 8 });
  });

  it("unescapes every escaped dollar when measuring a snippet section", async () => {
    // A string pattern replaced only the first occurrence, so a section with two escaped
    // dollars measured one character too wide and every later range drifted.
    const { applyOffset } = await import("../src/snippets/engine/utils");
    const { Position } = await import("./mocks/vscode");
    const origin = new Position(0, 0);
    const single = applyOffset(origin as never, String.raw`\$`, 0);
    const double = applyOffset(origin as never, String.raw`\$\$`, 0);
    expect(double.character - single.character).toBe(1);
  });
});
