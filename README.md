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
