# LaTeX Editing Toolkit UI

Local web UI for tuning template colors and on/off switches.

## Run

```bash
python3 tools/latex_toolkit.py --open-browser
```

One-click launcher script:

```bash
./scripts/start-ui.sh
```

macOS Finder double-click:

- `scripts/start-ui.command`

Default URL: `http://127.0.0.1:8765`

Lifecycle example (auto-stop after last tab expires):

```bash
python3 tools/latex_toolkit.py --lifecycle-mode shutdown-on-last-tab --session-timeout-sec 45 --idle-grace-sec 20
```

Compatibility alias (still supported):

```bash
python3 tools/theme_designer.py --open-browser
```

## Documentation Policy

- The canonical feature list is `Current Capabilities` in this file.
- Root `README.md` keeps only short project-level highlights and links here.
- When a feature changes, update this file first, then verify:
  - `Current Capabilities`
  - `Known Limitations`
  - related tests under `tools/tests/`

## Current Capabilities

- Adjust theme colors for document headers and theorem/callout blocks.
- Apply named block color preset themes (`default`, `midnight`, `meadow`, `ember`) in one click.
- Apply named heading/TOC preset themes (`default`, `inkstone`, `aurora`, `sunset`) in one click.
- Adjust base body font size with slider control (`9.0pt` to `14.0pt`, step `0.5pt`).
- Toggle feature switches:
  - heading theme
  - TOC theme
  - page header theme
  - enhanced environment style
  - block shadow
- Class-aware controls:
  - class mode: auto / force book / force article
  - chapter heading rule
  - page header rule
  - theorem numbering policy
- Save overrides to files and reload state from disk.
- Compile LaTeX from UI:
  - choose compile target `.tex` file from dropdown
  - choose compile mode:
    - internal fallback pipeline
    - VSCode recipe from `.vscode/settings.json`
  - compile preflight validates `\subfile{...}` references and blocks obvious recursive/missing-path corruption before TeX execution
  - recipe execution runs tool-by-tool and stops on first failure
  - compile log includes per-step command and exit code
- Preview current target PDF in the same UI page.
- Starter template bootstrap from UI:
  - choose built-in starter template (`book-minimal` / `article-minimal`)
  - set custom output filename (not limited to `main.tex`)
  - existing files require explicit overwrite confirmation
  - generated file is auto-selected as compile target
- Multi-instance-safe startup:
  - `--port 0` binds an OS-assigned free port
  - `--port auto` retries on the next free port if default/start port is occupied
  - startup URL reporting and `--open-browser` always use the resolved bound URL
- Lifecycle/session controls:
  - `manual` mode (default): stop with Ctrl+C
  - `shutdown-on-last-tab` mode: auto-stop after all heartbeat sessions expire + idle grace
  - UI sends heartbeat while page is open
- Standalone compile strategy is locked as `Split + subfiles standalone`.
- Existing wrapper-based standalone generation is retained as a legacy fallback during migration.

## Known Limitations

- Split source must be a root-like target; selecting a subfile unit (`\documentclass{subfiles}`) is rejected.
- Legacy wrapper standalone mode is transitional and kept only as compatibility fallback.
- Server shutdown can be fully controlled by the server itself, but force-closing browser tabs/windows is not guaranteed by browsers.

## Planned Improvements

- Multi-template profile architecture
  - profile-driven schema and defaults
  - compatibility strategy for existing projects

## Companion CLI: TeX Splitter

Use the splitter to modularize a long root `.tex` file:

```bash
python3 tools/tex_splitter.py main.tex
```

- Detects `\documentclass{...}` and picks split anchor automatically:
  - book/report-like classes split by top-level `\chapter{...}`
  - article-like classes split by top-level `\section{...}`
- Default mode keeps preamble in root, injects `\usepackage{subfiles}` when missing, and rewrites body with `\subfile{Sections/...}` entries.
- Generated units are standalone-compilable (`\documentclass[<relative-root>]{subfiles}` + document wrapper).
- Default naming mode writes slug unit files to `Sections/` (for example `overview.tex`).
- Legacy compatibility naming is available via `--naming-mode numbered` (for example `01-overview.tex`).
- Saves a backup before rewrite (`main.tex.bak`, then `.bak.1`, ...).
- Strategy lock (P0): default standalone model is `subfiles` ("Split + subfiles standalone").
- Compatibility policy:
  - keep wrapper mode available as explicit legacy fallback during migration
  - deprecate wrapper mode after subfiles output and UI flow are fully shipped
- Optional include mode:

```bash
python3 tools/tex_splitter.py main.tex --standalone-mode legacy-wrapper --use-include
```

- Optional legacy wrapper generation (fallback only; each unit gets a compile target under `Sections/_standalone/`):

```bash
python3 tools/tex_splitter.py main.tex --standalone-mode legacy-wrapper
```

- Dry-run preview (no file writes):

```bash
python3 tools/tex_splitter.py main.tex --dry-run
```

- Force legacy numbered filenames:

```bash
python3 tools/tex_splitter.py main.tex --naming-mode numbered
```

- Prune unreferenced existing units discovered from current root `\subfile{...}` list:

```bash
python3 tools/tex_splitter.py main.tex --prune-unreferenced
```

- Rerun safety:
  - `main.tex` remains split source of truth.
  - existing root `\subfile{...}` list is used as index-based incremental mapping hint.
  - heading/title changes can auto-rename generated unit filenames to updated slugs.
  - unreferenced existing units are kept by default (explicit `--prune-unreferenced` to delete).

- Toolkit UI split flow:
  - use `Split + Subfiles Standalone` panel
  - choose source target, optional dry-run, then click `Split Current Target`
  - after success, use `Switch To First Subfile` for one-click compile-target switch

## What it edits

- `theme.colors.tex`
  - Auto-generated color overrides.
- `theme.overrides.tex`
  - Auto-generated toggle, class-aware, and body-font-size overrides.
- `theme.ui.json`
  - UI state cache.

These files are loaded automatically by:
- `main.tex` (`theme.overrides.tex`)
- `theme.sty` (`theme.colors.tex`)

## Troubleshooting

- Compile blocked before TeX execution (`[preflight] Compile blocked due to invalid \subfile references`):
  - Read the listed offending path(s) from compile output.
  - Typical corruption pattern: section unit contains `\subfile{Sections/...}` and causes `Sections/Sections/...` recursion.
  - Fix that section file to real content (for example `\section{...}` + body text) and re-run compile.

- Chapter color appears unchanged:
  - `theme-chapter` only affects rendered chapter headings.
  - If target class is `article` (or override forces `ThemeClassMode=article`), chapter heading styling is inactive.
  - When you switch compile target across incompatible classes, Toolkit UI auto-resets forced `theme_class_mode` to `auto` to avoid stale mismatch.
  - Repro checklist for chapter color changes:
    - compile target is a chapter-capable file (for example `templates/book-minimal.tex`)
    - `theme_class_mode` is `auto` or `book`
    - `theme_heading_chapter_mode` is `auto` or `on`
    - `enable_heading_theme` is `true`
  - Quick sanity check (prints detected/effective class and chapter capability):

```bash
python3 - <<'PY'
from tools import theme_designer_core as td
state = td._load_state()
print("compile_target =", state.get("compile_target"))
print("detected_document_class =", state.get("detected_document_class"))
print("detected_has_chapter =", state.get("detected_document_class_has_chapter"))
print("theme_class_mode =", state.get("class_config", {}).get("theme_class_mode"))
print("effective_theme_class =", state.get("effective_theme_class"))
PY
```

- Missing TeX binaries:
  - If commands like `xelatex`/`latexmk` are not found, install TeX binaries or enable internal fallback mode.
- Missing recipe/tool:
  - Check `.vscode/settings.json` for `latex-workshop.latex.tools` and `latex-workshop.latex.recipes`.
  - Use internal fallback pipeline if a recipe command is unavailable.
- Stale PDF preview:
  - Click `Refresh PDF Preview` after compile.
  - Confirm the target and compile mode shown in the UI info line.
- Browser close behavior:
  - Server can always stop itself.
  - Force-closing browser tabs/windows from the server is not guaranteed due browser security constraints.

## Reset

Use the UI button `Reset (Delete Overrides)`, or manually delete:

```bash
rm -f theme.colors.tex theme.overrides.tex theme.ui.json
```

## Active TODO

See detailed plan and checkboxes in:

- `tools/TODO-priority-hardening.md`
- `tools/TODO-theme-designer.md`

## Naming Migration

- New primary name: `LaTeX Editing Toolkit UI`.
- New preferred UI entrypoint: `tools/latex_toolkit.py`.
- Legacy alias is retained: `tools/theme_designer.py`.
