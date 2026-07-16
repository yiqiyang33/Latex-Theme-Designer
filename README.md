# LaTeX Editing Toolkit

VS Code / Cursor extension for local-first LaTeX note projects. It provides starter templates, theme controls, compile workflows, build cleanup, split/renumber/unsplit commands, and PDF preview from a webview panel.

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

The Colors panel still allows advanced per-token adjustments. Applying a Style Preset again
intentionally restores every token in that preset's complete package. Older
`block_preset`/`heading_toc_preset` entries in `theme.ui.json` are read automatically, with
the legacy block value taking precedence, and are mirrored on the next save for compatibility.

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

## Main Features

- Centralized LaTeX theme module in `theme.sty`.
- Theorem and callout environments from `theorems.tex`.
- Note-writing helpers from `commands.tex`.
- Theme color, toggle, class mode, body font size, and compile target controls.
- Built-in color presets, including UChicago maroon/greystone.
- Safe workspace theme asset upgrade with local backups.
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

## Reset Theme Overrides

To reset generated theme overrides:

```bash
rm -f theme.colors.tex theme.overrides.tex theme.ui.json
```
