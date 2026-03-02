# LaTeX Editing Toolkit

Open-source LaTeX toolkit for theme tuning, project splitting, and compile workflow orchestration.

## Run

Compile the default entry:

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

Run tests:

```bash
pytest -q tools/tests
```

## Sync Template Updates (Keep Local Notes)

Use the sync helper to update toolkit/template code without overwriting local note content.
It works even when your notes folder has no `.git` repository.

Preview changes first:

```bash
tools/sync_template.sh --dry-run
```

Apply sync:

```bash
tools/sync_template.sh
```

Defaults:
- source: `https://github.com/yiqiyang33/Latex-Theme-Designer`
- branch: `main`
- target: current directory

Sync scope is controlled by `.template-sync-include` (only listed paths are synced).
Extra excludes inside those synced paths can be configured in `.template-sync-ignore`.

## Feature Overview

- Centralized theme layout (`theme.sty`) for document + theorem styles.
- Local toolkit UI for color/toggle/class/compile tuning.
- One-click split workflow (`tools/tex_splitter.py`) for modular `Sections/` authoring.
- Compile integration with internal fallback pipeline and VSCode recipe mode.
- One-click compile artifact cleanup with dual policy: root conservative cleanup + auto-discovered subfile directory aggressive cleanup (`.tex/.pdf` preserved in subfile dirs).

Canonical capability list lives in:

- `tools/README-theme-designer.md#current-capabilities`

## Toolkit UI

Use the local UI tool:

```bash
python3 tools/latex_toolkit.py --open-browser
```

See full tool documentation in:

- `tools/README-theme-designer.md`

Compatibility alias (still supported during transition):

```bash
python3 tools/theme_designer.py --open-browser
```

## TeX Splitter

Split a monolithic root `.tex` into modular files in `Sections/`:

```bash
python3 tools/tex_splitter.py main.tex
```

Preview split plan without writing files:

```bash
python3 tools/tex_splitter.py main.tex --dry-run
```

Add missing numeric prefixes (`01-`, `02-`, ...) to referenced unit files:

```bash
python3 tools/tex_splitter.py main.tex --renumber-mode add
```

Remove numeric prefixes from referenced unit files:

```bash
python3 tools/tex_splitter.py main.tex --renumber-mode remove
```

Merge one split unit back into its original root position (deletes source by default):

```bash
python3 tools/tex_splitter.py --unsplit-target Sections/02-variational-inference.tex
```

Keep source file after merge:

```bash
python3 tools/tex_splitter.py --unsplit-target Sections/02-variational-inference.tex --keep-source
```

Optional legacy-wrapper fallback:

```bash
python3 tools/tex_splitter.py main.tex --standalone-mode legacy-wrapper
```

Note: split source must be a root `.tex` target. Subfile units (`\documentclass{subfiles}`) are rejected.
Renumber only processes files referenced by the selected root.
Unsplit supports `--dry-run` and defaults to deleting the merged source unit.
If root already has `\subfile{...}` references and you insert new top-level `\chapter/\section` blocks,
splitter now performs incremental insertion: existing refs are preserved and only new blocks are extracted.
Top-level `\appendix` stays in root (not moved into generated section files).
For full splitter details and migration notes, see `tools/README-theme-designer.md`.

## Quick Troubleshooting

- UI compile fails with `Sections/Sections/... not found`:
  - This usually means a section file accidentally contains a recursive `\subfile{Sections/...}` reference.
  - The toolkit compile flow now runs a preflight check and reports the offending file path before TeX compile.
  - Fix the listed section file to contain real section content, then re-run compile.
- Recipe mode fails but internal mode works:
  - Check `.vscode/settings.json` tool/recipe definitions and command availability in `PATH`.
  - Switch `Compile` mode to internal fallback in UI for a known-good baseline.

## What it edits

- `theme.colors.tex`
  - Color overrides.
- `theme.overrides.tex`
  - Feature toggle, class-aware, and body-font-size overrides.
- `theme.ui.json`
  - UI state cache.

These files are loaded automatically by:

- `main.tex` (`theme.overrides.tex`)
- `theme.sty` (`theme.colors.tex`)

## What to keep in Git

Keep source files:

- `main.tex`
- `theme.sty`
- `theme.colors.tex`
- `theme.overrides.tex` (optional)
- `commands.tex`
- `theorems.tex`
- `references.bib`
- `tools/`
- `Fig/` (when used)

Ignore LaTeX build artifacts via `.gitignore`.

## Reset

To reset generated theme overrides:

```bash
rm -f theme.colors.tex theme.overrides.tex theme.ui.json
```

## Active TODO

See:

- `tools/TODO-priority-hardening.md`
- `tools/TODO-theme-designer.md`

## Naming Migration

- New primary name: `LaTeX Editing Toolkit`.
- New preferred UI entrypoint: `tools/latex_toolkit.py`.
- Legacy alias is retained: `tools/theme_designer.py`.
