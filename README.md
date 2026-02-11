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

## Current Capabilities

- Structured template with centralized theme system (`theme.sty`).
- Color and visual toggle customization through override files.
- Block preset themes for theorem/callout colors (`default`, `midnight`, `meadow`, `ember`), with one-click apply in Theme Designer.
- Heading/TOC preset themes (`default`, `inkstone`, `aurora`, `sunset`) with one-click apply in Theme Designer.
- Body text size control in Theme Designer (`9.0pt` to `14.0pt`, step `0.5pt`).
- Class-aware theme behavior (`book` / `article`) with auto-detect and override controls.
- Bibliography support with `biblatex` + `biber`.
- Theorem/callout styling with switchable enhanced environment style.
- Optional local Theme Designer UI for tuning styles and compiling.
  - Supports compile target selection and VSCode recipe-based compile mode.
  - Supports starter `.tex` generation from built-in templates with custom output filename.
  - Existing files require explicit overwrite confirmation before replacement.
- Multi-instance-safe Theme Designer startup:
  - `--port 0` for OS-assigned free port
  - `--port auto` to fallback to next free port when default is occupied
  - startup logs and `--open-browser` use the resolved bound URL
- Lifecycle/session controls for local UI server:
  - `--lifecycle-mode manual` (default) or `--lifecycle-mode shutdown-on-last-tab`
  - heartbeat-based active tab tracking with session timeout and idle grace
  - predictable Ctrl+C shutdown; browser tab close is best-effort only
- One-click root `.tex` splitter CLI (`tools/tex_splitter.py`):
  - class-aware split (`chapter` for book/report-like, `section` for article-like)
  - default mode rewrites root body to `\subfile{...}` entries
  - generated unit files are standalone-compilable via `subfiles`
  - auto backup before rewrite (`.bak`, `.bak.1`, ...)
  - standalone direction is locked as `Split + subfiles standalone` (migration in progress)
  - legacy wrapper compile targets remain available during transition (`--standalone-mode legacy-wrapper`)

## Planned Next

- Profile-based multi-template Theme Designer architecture.

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

In legacy-wrapper mode, use `\include{...}` instead of `\input{...}`:

```bash
python3 tools/tex_splitter.py main.tex --standalone-mode legacy-wrapper --use-include
```

Strategy lock (P0): default standalone model is `subfiles` ("Split + subfiles standalone").

Current compatibility policy during migration:

- keep wrapper-based standalone compile as an explicit legacy fallback
- mark wrapper mode as transitional and deprecate it after subfiles mode is fully shipped

Legacy fallback command (wrapper files under `Sections/_standalone/`):

```bash
python3 tools/tex_splitter.py main.tex --standalone-mode legacy-wrapper
```

Preview split plan without writing files:

```bash
python3 tools/tex_splitter.py main.tex --dry-run
```

Rerunning splitter on an already-split subfiles root is handled as no-op (prevents duplicate `\subfile{...}` injection).

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
