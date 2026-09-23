# Vendored hsnips engine — local patches

`src/snippets/engine/` originates from the [hsnips](https://github.com/draivin/hsnips) extension
and is maintained in-tree. Every local divergence is listed here so a future upstream sync can be
replayed deliberately instead of silently reverting a fix.

**Upstream status is unverified.** These patches were found by reviewing this tree, not by diffing
against upstream. Before pulling a newer hsnips, check each row: some of these are very likely
upstream bugs worth reporting, others may already be fixed there.

Files under `src/snippets/` but *outside* `engine/` (`snippetService.ts`, `pathPolicy.ts`,
`snippetManagerModel.ts`) are Toolkit-authored and are not vendored.

Regression tests live in `test/snippets.test.ts` unless noted.

## Correctness

| File | What changed | Why | Test |
|---|---|---|---|
| `parser.ts` `escapeString` | Escape `\` before `"`, not after | The original order re-broke every quote it had just escaped, so one `"` anywhere in a body made the generated function unparseable and **every snippet in that file was silently dropped** | "keeps snippet bodies loadable when they contain quotes or backslashes" |
| `parser.ts` `parseSnippet` | Guard the trailing `script.pop()` | With an empty body it popped the `blockResults` declaration, producing a `ReferenceError` at expansion time, past the per-file catch | "expands a snippet with an empty body instead of throwing" |
| `parser.ts` `parseSnippetHeader` | Append `$(?![\s\S])` instead of a bare `$` | Under the `m` flag a bare `$` matches before every newline, so a multiline trigger fired against text above the cursor and replaced it | "anchors a multiline regex trigger at the cursor, not at every line end" |
| `parser.ts` `parse` | Strip a leading BOM | A BOM glued itself to the first `snippet` keyword, dropping that snippet | "ignores a byte order mark before the first snippet header" |
| `dynamicRange.ts` `getRangeDelta` | Gate the start-column term on `textLines.length == 1`, not `lineDelta == 0` | Wrong in both directions: a backspace joining two lines skipped a term it needed, and replacing N lines with N lines added one it did not. Every tracked placeholder drifted afterwards | "tracks a range across an edit that joins two lines" |
| `completion.ts` `matchSnippet` | `beginningofline` matches with `==`, not `endsWith` | The matcher and the range disagreed, so `xxfoo` matched trigger `foo` and the expansion deleted the `xx` too | — (needs a TextDocument mock) |
| `completion.ts` | Require the regex match to end at the context end | Defence in depth for hand-written triggers that defeat the anchor | — |
| `latexContext.ts` `getMathDelimiterStackFromSanitized` | `$$` is display math only when no inline `$` is open | `text $a$$b$` left a phantom frame on the stack and the document read as "in math" forever after | "does not treat $$ inside open inline math as display math" |
| `latexContext.ts` `sanitizeLatexForParsing`, `isInsideMarkdownCodeInPrefix` | Backtick code spans only for non-TeX languages (`LatexContextOptions.languageId`) | In LaTeX a backtick is an opening quote, so two quotes on one line masked everything between them — including real math | "treats backticks as quotes in LaTeX and as code spans in Markdown" |
| `latexEdit.ts` `getLineBounds` | Exclude `\r` from the line and carry the detected EOL | Smart Enter hardcoded `\n` and its replace range covered the `\r`, converting CRLF documents to mixed endings | "preserves CRLF line endings when Smart Enter splits a line" |
| `environmentConvert.ts` `parseBracedArguments` | Stop at a newline; only parse arguments for table-like environments | A brace group opening the body (`{\bf x}`) was taken as a `\begin` argument and then **deleted** by the conversion | "keeps a brace group that opens the environment body during conversion" |
| `environmentConvert.ts` `findDisplayMathDelimiterAt` | Same `$$` rule as `latexContext.ts` | Duplicated logic, duplicated bug | — |
| `environmentConvert.ts` `enumerateLatexEnvironmentPairs` | Honour the `options` argument | It was received as `_options` and ignored while `latexContext.ts` honoured it, so the two scanners disagreed about verbatim-like environments | — |
| `hsnippetInstance.ts` module scope | `registerVisualSelectionTracker()` called from `registerSnippetHost`, and the capture is cleared when the selection collapses | The listener was registered at import time, never disposed, and only ever overwritten — so `${VISUAL}` could pull a stale selection from another document | — |
| `hsnippetInstance.ts` `${VISUAL}` | Replacement **function** instead of a replacement string | `$&`, `$$`, `` $` `` and `$'` in the selected text were expanded by `replace()`; selecting `$$E=mc^2$$` inserted `$E=mc^2$` | — |
| `hsnippetInstance.ts` constructor | `placeholderIds.sort((a, b) => a - b)` | The default comparator is lexicographic, so a snippet with ten or more tab stops desynced `selectedPlaceholder` from the caret and dynamic blocks stopped regenerating | — |
| `hsnippetInstance.ts` `update` | Bound the inner `while (part.range.contains(...))` walk | Clicking into a tab stop instead of tabbing threw `TypeError: ... reading 'range'` inside an async listener with no catch, aborting the rest of the keystroke handler | — |
| `hsnippetInstance.ts` `update` | `try/catch` around the re-generation call; `await` the edit and only then record block content | Snippet bodies are user scripts and can throw on later input; the constructor already guarded its call. The unawaited edit let the model claim text the document never received | — |
| `host.ts` `expandSnippet` | `insertingSnippet` reset in `finally` | A rejected edit (editor closed mid-expansion) left the flag set, and the bail in `onDidChangeTextDocument` then disabled the entire change pipeline for the session | — |
| `host.ts` | `expandSnippet` awaited / `.then(undefined, console.error)` at both call sites | Rejections were invisible | — |
| `host.ts` | `e.contentChanges.length == 1` guard on the Smart Enter recovery branch | With multi-cursor Enter the handler rebuilt a "before" text that never existed and wrote it back, deleting real characters | — |
| `utils.ts` `applyOffset` | `replace(/\\\$/g, '$')` instead of a string pattern | Only the first escaped dollar was unescaped, so sections with two measured one character too wide and every later range drifted | "unescapes every escaped dollar when measuring a snippet section" |
| `snippetProfiles.ts` `readSnippetFileEntries` | Strip the extension case-insensitively | `LaTeX.HSnips` passed the filter but produced language id `latex.hsnips`, which nothing matches | — |
| `snippetProfiles.ts` `discoverSnippetProfiles` | Guard `statSync` | One broken symlink under `profiles/` threw out of profile discovery entirely | — |

## Performance and cleanup

| File | What changed | Why |
|---|---|---|
| `host.ts` | Removed `DOCUMENT_TEXT_CACHE` | Its only read fell back to `getTextBeforeChange`, which reconstructs the identical string under the guard that already applied. Cost a full `getText()` per keystroke plus a retained copy per open document |
| `host.ts` | `currentText` materialized only in the branch that uses it | Most changes bail out before needing it |
| `latexContext.ts` | Memoized `resolveLatexContextOptions`; cached the text-like-command regex per resolved options; explicit `lastIndex` reset | Both ran on every keystroke, rebuilding five arrays and recompiling a pattern each time |
| `environmentConvert.ts` | Split `findLatexEnvironmentPairAt` into `enumerateLatexEnvironmentPairs` + `selectLatexEnvironmentPairAt`; the keystroke path enumerates once | It scanned and sanitized the whole document twice per change event |
| `environmentConvert.ts` | Imports `findMatchingBrace` from `latexContext.ts` | It was a byte-identical copy apart from a `limit` parameter |
| `latexContext.ts`, `latexEdit.ts` | Deleted `stripLatexComments`, the `LatexContext` alias, and twelve unused re-exports | Zero consumers anywhere in `src/` or `test/` |

## Not done

`enumerateLatexEnvironmentPairs` (`environmentConvert.ts`) and
`getOpenLatexEnvironmentFramesFromSanitized` (`latexContext.ts`) still walk `\begin`/`\end` with
two separate verbatim-aware stack loops. They return different shapes — matched pairs versus the
frames open at an offset — so merging them means reworking the tokenizer rather than deleting a
copy. The shared leaf helpers were extracted instead; the loops were left alone.
