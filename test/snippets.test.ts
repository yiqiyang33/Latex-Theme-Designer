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
});
