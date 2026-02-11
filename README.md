# LaTeX Theme Forge

Open-source LaTeX template for customizing note/book layout styles.

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

## Feature Overview

- Centralized theme layout (`theme.sty`) for document + theorem styles.
- Local Theme Designer UI for color/toggle/class/compile tuning.
- One-click split workflow (`tools/tex_splitter.py`) for modular `Sections/` authoring.
- Compile integration with internal fallback pipeline and VSCode recipe mode.

Canonical capability list lives in:

- `tools/README-theme-designer.md#current-capabilities`

## Theme Designer

Use the local UI tool:

```bash
python3 tools/theme_designer.py --open-browser
```

See full tool documentation in:

- `tools/README-theme-designer.md`

## TeX Splitter

Split a monolithic root `.tex` into modular files in `Sections/`:

```bash
python3 tools/tex_splitter.py main.tex
```

Preview split plan without writing files:

```bash
python3 tools/tex_splitter.py main.tex --dry-run
```

Optional legacy-wrapper fallback:

```bash
python3 tools/tex_splitter.py main.tex --standalone-mode legacy-wrapper
```

Note: split source must be a root `.tex` target. Subfile units (`\documentclass{subfiles}`) are rejected.
For full splitter details and migration notes, see `tools/README-theme-designer.md`.

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

## Roadmap

See:

- `tools/TODO-theme-designer.md`
