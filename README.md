# LaTeX Editing Toolkit 1.0.0

VS Code / Cursor extension for local-first LaTeX projects and fast mathematical writing. Toolkit 1.0 combines project creation, themes, compile and structure tools with the complete programmable `hsnips` engine, profiles, workspace snippets, Smart Enter/Tab, and a Monaco-powered snippet workbench.

## Build

```bash
npm install
npm test
npm run package
```

Install the generated `latex-editing-toolkit-*.vsix` in VS Code or Cursor, then run:

- `LaTeX Editing Toolkit: Open Toolkit`
- `LaTeX Editing Toolkit: Create Project`
- `LaTeX Editing Toolkit: Initialize Workspace`
- `LaTeX Editing Toolkit: Upgrade Workspace Theme Assets`

The extension also contributes a `LaTeX Toolkit` Activity Bar view with TreeView shortcuts
for project setup, build, structure, and theme actions.

Version 1.0 keeps the responsive Toolkit workbench and adds a first-class `Snippets` section. The
former Yiqi's LatexSnips engine now runs inside this extension; existing `hsnips.*` commands,
settings, shortcuts, profiles, and snippet directories continue to work without moving user data.
The Webview does not embed PDFs: compile results open through the native VS Code/Cursor PDF viewer.

## Upgrading from Yiqi's LatexSnips

Toolkit 1.0 is the single host for both products. After installing it:

1. Open the Snippets section and confirm that base, profile, and workspace snippets are present.
2. Disable or uninstall `Yiqi's LatexSnips` (`yiqiyang33.yiqis-latexsnips`).
3. Run `Developer: Reload Window`.

Keeping both extensions enabled may register duplicate completions and Smart Enter/Tab handlers.
Toolkit detects the old extension and shows a one-time warning, but it never disables or uninstalls
another extension automatically. Existing snippet data is reused in place:

- macOS: `~/Library/Application Support/Code/User/hsnips`
- Windows: `%APPDATA%/Code/User/hsnips`
- Linux: `$HOME/.config/Code/User/hsnips`
- Workspace: `.vscode/hsnips`
- Profiles: `hsnips/profiles/<name>/`

Custom `hsnips.windows`, `hsnips.mac`, and `hsnips.linux` paths remain supported.

## Programmable Snippets

Run `LaTeX Editing Toolkit: Snippets: Open Snippet Manager` or select `Snippets` in the Toolkit.
The same panel works without an open workspace for global and profile snippets. With a workspace,
it also shows that folder's `.vscode/hsnips` files. The manager provides:

- base, active-profile, and workspace file groups;
- search plus scope, language, and diagnostics filters;
- a lazily loaded Monaco `.hsnips` source editor with textarea fallback;
- parsed trigger, description, flags, priority, dynamic/regex status, and diagnostics;
- duplicate-trigger and duplicate-automatic-trigger warnings across loaded files;
- New, Delete, Reload, Open Source, and explicit Save operations;
- file hash, modification-time, dirty-editor, and allowed-directory checks before saving.

Snippet source uses explicit Save because it is executable user script, not Toolkit theme state. It
does not participate in project autosave or Toolkit Undo/Redo.

### Snippet files and profiles

Use language-named files such as `latex.hsnips`, `markdown.hsnips`, or `all.hsnips`. A profile is
loaded on top of base snippets, and the active workspace's snippets are added last before all
snippets are sorted by priority:

```text
hsnips/
  all.hsnips
  latex.hsnips
  profiles/
    notes/
      latex.hsnips

project/
  .vscode/
    hsnips/
      latex.hsnips
```

`hsnips.profiles.activeProfile` stores the current global profile. Multi-root workspaces resolve
workspace snippets from the folder that owns the active document.

### `.hsnips` syntax

```hsnips
global
// JavaScript shared by snippets in this file
endglobal

priority 10
snippet RR "Real numbers" iAm
\\mathbb{R}
endsnippet
```

Supported flags include:

- `A`: automatic expansion;
- `i`, `w`, `b`: inside-word, word-boundary, and line-beginning matching;
- `M`: multiline regex context;
- `m`: math-only expansion;
- `t`: text-only expansion.

Triggers may be literal or backtick-wrapped regular expressions. Snippet bodies support tabstops,
`${VISUAL}`, and JavaScript interpolation between double backticks. Interpolation receives `rv`,
`t`, `m`, `w`, and `path`, preserving the behavior of the original Snips extension.

### Mathematical editing

The shared LaTeX context engine recognizes `$...$`, `$$...$$`, `\\(...\\)`, `\\[...\\]`, common
math environments, comments, Markdown code fences, verbatim-like environments, and text-like
commands. It powers:

- math-only and text-only snippet flags;
- Smart Enter row breaks in `align`, matrices, `cases`, `array`, and table environments;
- Smart Tab alignment separators with normal placeholder fallback;
- environment conversion and matching `\\begin`/`\\end` renaming;
- wrapping and unwrapping supported math structures.

Extra environments and text-like commands can be configured with the existing
`hsnips.context.*` settings.

## Create Project Wizard

`Create Project` now chooses a parent location, project name, and starter template. The extension
creates the project folder automatically. It remembers recent parent locations and checks write
access, project-name safety, template validity, and file conflicts before writing anything.

- A missing target folder is created automatically.
- An existing empty folder requires explicit confirmation.
- A non-empty folder is rejected with a conflict summary.
- Failed creation leaves partial resources available for inspection but does not register the
  project in Local Notes.

## Local Notes Registry

The Activity Bar includes a `Local Notes` group that remembers projects created with
`LaTeX Editing Toolkit: Create Project`, even when they live outside the current workspace.
The registry is stored in the extension's local global state and is available after switching
workspaces or restarting VS Code/Cursor.

- Click a valid entry to open its project folder in the current window.
- Missing project folders remain visible with a warning status.
- Use `Relocate Local Project` on a missing entry to select its new folder. The selected folder
  must contain `main.tex`.
- Use `Forget Local Project` to remove an entry from the Activity Bar without deleting files.
- The list refreshes when the VS Code/Cursor window regains focus, so folders moved or deleted
  outside the editor are marked `Missing` without polling.
- Existing folders are compared using their real path. Registering the same project through a
  symbolic link or differently-cased macOS/Windows path updates the existing record instead of
  creating a duplicate.

The extension does not scan arbitrary directories and does not automatically register files
created with `Generate Starter In Workspace`.

## Style Presets

Toolkit now exposes one unified `Style Preset` selector instead of separate block,
heading/TOC, and bold-color selectors. The five presets are `Default`, `Midnight`,
`Meadow`, `Ember`, and `UChicago`.

Applying a preset updates the complete visual token package together: chapter and section
headings, TOC and page-header colors, theorem/definition/note/callout blocks, inline
commands (`\\hl`, `\\key`, `\\term`, `\\warn`, `\\todo`, and `\\code`), sidenotes,
chapter overviews, and `\\textbf`. `\\hl` remains a background highlight while `\\key`
remains a bold rounded emphasis box; they share the selected preset's color system without
losing their different semantics.

The Toolkit displays styles as keyboard-accessible miniature document cards. Hovering or focusing
a card temporarily updates the live Style preview without writing project files; clicking applies
its complete color package and saves automatically. The preview demonstrates headings, inline
commands, theorem/note/callout blocks, sidenotes, and chapter overviews. A card shows `Customized`
when any current color differs from its baseline.

`View Changes` groups changed tokens and shows baseline/current swatches. Individual tokens or the
whole style can be reverted. Customized colors can be saved into a global `My Styles` library.
Personal styles are available in every workspace in the current VS Code/Cursor profile and can be
renamed, updated, deleted, imported, or exported as JSON.

The Colors panel still allows advanced per-token adjustments. Clicking a Style Preset again
intentionally restores every token in that preset's complete package. Older
`block_preset`/`heading_toc_preset` entries in `theme.ui.json` are read automatically, with
the legacy block value taking precedence, and are mirrored on the next save for compatibility.

## Automatic Saving and Undo

There are no separate Apply Style, Apply Target, Apply Recipe, or Save Overrides steps in the main
Toolkit. Toggles, class rules, targets, recipes, colors, body size, and styles save automatically.
The header reports `Saving`, `Saved`, or `Could not save`, and failed drafts remain available for
Retry instead of being discarded.

Each project keeps one persistent Toolkit change with both Undo and Redo. Supported changes include
settings, theme upgrades and resets, workspace initialization, VS Code settings generation,
starters, Split, Renumber, and Unsplit. Compile, Clean, Local Notes registry operations, and whole
project creation do not replace the Undo record. File conflicts caused by external edits are
detected before restore and require explicit Force Restore.

Undo history is stored in the extension's global storage rather than inside the LaTeX repository.

## Safe Theme Asset Upgrades

`Upgrade Workspace Theme Assets` always backs up files before replacing `theme.sty`,
`theorems.tex`, and `commands.tex`. It offers two color policies:

- `Preserve Colors` (default) upgrades only the bundled TeX assets and leaves
  `theme.colors.tex`, `theme.ui.json`, `theme.overrides.tex`, and every Toolkit setting unchanged.
- `Reset to Default` applies the complete Default color package while preserving toggles, body
  size, class rules, compile target, recipe, fallback mode, and compile status. It rewrites only
  color/style state in `theme.colors.tex` and `theme.ui.json`; `theme.overrides.tex` is untouched.

Replacement uses temporary files and atomic renames. If any step fails, already-modified files
are restored from the operation backup and files that did not previously exist are removed.

## Configuration Recovery and Logs

Configuration is loaded field by field. A broken JSON file or one invalid toggle, color, preset,
font size, class option, target, recipe, or compile-status field no longer prevents the Toolkit
from opening. Valid fields continue to load, invalid fields fall back locally, and warnings appear
in the Activity Bar Diagnostics group and the Toolkit Diagnostics section. Warnings are diagnostic
only and are not saved into `theme.ui.json`; the next successful automatic save writes normalized state.

Extension commands share a `LaTeX Editing Toolkit` Output channel. Errors include timestamp,
command, workspace, and stack information, and notifications offer `Show Log`. Compile output is
also written there in full. If `Create Project` fails, the selected directory is not removed and
is not added to Local Notes; it may contain partial generated resources and can be opened directly
from the failure notification.

## Workspace Files

The extension reads and writes these project files:

- `theme.ui.json`
- `theme.overrides.tex`
- `theme.colors.tex`
- `.vscode/settings.json`

Template assets live under `assets/template/` and are copied into a workspace only when missing.

## Starter Templates

Available starters:

- `book-minimal`
- `article-minimal`
- `homework-assignment`

The default starter remains `book-minimal`.

## Visual Workbench

The Toolkit Webview uses a responsive three-part layout:

- Section navigation for Style, Build, Document, Colors, Project Setup, Structure, and Diagnostics.
- A task-focused center panel that shows only the active tool.
- A contextual panel that shows the live Style preview or the current build/setup/operation summary.

Wide editor tabs use three columns, medium tabs use horizontal navigation with two columns, and
narrow tabs stack the active task above its context. The selected section is remembered per project.
The interface follows VS Code theme colors, high-contrast mode, reduced-motion preferences, and
keyboard tab navigation.

## Compile and PDF

`Compile PDF` flushes pending automatic saves and runs the selected target and recipe. The Toolkit
shows the last result, expected output path, and whether the PDF currently exists. `Open PDF` opens
the generated file through the native VS Code/Cursor viewer. The Toolkit does not embed, reload, or
automatically compile a PDF when Style or document settings change.

## Main Features

- Centralized LaTeX theme module in `theme.sty`.
- Theorem and callout environments from `theorems.tex`.
- Note-writing helpers from `commands.tex`.
- Theme color, toggle, class mode, body font size, and compile target controls.
- Built-in color presets, including UChicago maroon/greystone.
- Global personal styles with difference inspection and JSON import/export.
- Automatic saving with persistent one-step Undo and Redo.
- Responsive Style, Build, Document, Colors, Setup, Structure, Snippets, and Diagnostics workspace.
- Programmable `.hsnips` completion engine with profiles and per-workspace snippets.
- Smart mathematical Enter/Tab, environment conversion, matching-name sync, and wrap/unwrap tools.
- Transactional workspace theme asset upgrades with Preserve Colors as the safe default.
- Internal fallback compile pipeline plus optional VS Code recipe mode.
- Generate `.vscode/settings.json` for LaTeX Workshop-compatible recipes.
- Clean build artifacts while preserving source files and PDFs.
- Split root documents into `Sections/`, renumber referenced units, and merge a unit back into the root.

## Local Compile

Compile the guide document directly:

```bash
latexmk -xelatex -bibtex main.tex
```

Fallback compile flow:

```bash
xelatex main.tex
biber main
xelatex main.tex
xelatex main.tex
```

## Reset All Toolkit Overrides

`Reset All Toolkit Overrides` is intentionally destructive: it removes theme, class, toggle,
compile, and status settings stored in all three generated files. The equivalent shell command is:

```bash
rm -f theme.colors.tex theme.overrides.tex theme.ui.json
```

## Acknowledgements

The programmable snippet engine was developed in
[Yiqi's LatexSnips](https://github.com/yiqiyang33/Yiqi-s-LatexSnips), itself based on the ideas and
syntax of HyperSnips/UltiSnips-style programmable snippets. Toolkit 1.0 preserves that project's
commands, configuration keys, data layout, and `.hsnips` language while making this repository the
single maintained extension and user interface.
