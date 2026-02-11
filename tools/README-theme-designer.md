# Theme Designer UI

Local web UI for tuning template colors and on/off switches.

## Run

```bash
python3 tools/theme_designer.py --open-browser
```

Default URL: `http://127.0.0.1:8765`

Lifecycle example (auto-stop after last tab expires):

```bash
python3 tools/theme_designer.py --lifecycle-mode shutdown-on-last-tab --session-timeout-sec 45 --idle-grace-sec 20
```

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

## Planned Improvements

- Multi-template profile architecture
  - profile-driven schema and defaults
  - compatibility strategy for existing projects

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

- Chapter color appears unchanged:
  - `theme-chapter` only affects rendered chapter headings.
  - If target class is `article` (or override forces `ThemeClassMode=article`), chapter heading styling is inactive.
  - When you switch compile target across incompatible classes, Theme Designer auto-resets forced `theme_class_mode` to `auto` to avoid stale mismatch.
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

## Roadmap

See detailed plan and checkboxes in:

- `tools/TODO-theme-designer.md`
