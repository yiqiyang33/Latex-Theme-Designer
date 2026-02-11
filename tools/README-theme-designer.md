# Theme Designer UI

Local web UI for tuning template colors and on/off switches.

## Run

```bash
python3 tools/theme_designer.py --open-browser
```

Default URL: `http://127.0.0.1:8765`

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
- Multi-instance-safe startup:
  - `--port 0` binds an OS-assigned free port
  - `--port auto` retries on the next free port if default/start port is occupied
  - startup URL reporting and `--open-browser` always use the resolved bound URL

## Planned Improvements

- Lifecycle/session controls
  - optional server shutdown when last browser session closes
  - explicit Ctrl+C behavior and platform constraints
- Starter template bootstrap
  - one-click `main.tex` generation from built-in templates
  - safe overwrite rules
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

- Missing TeX binaries:
  - If commands like `xelatex`/`latexmk` are not found, install TeX binaries or enable internal fallback mode.
- Missing recipe/tool:
  - Check `.vscode/settings.json` for `latex-workshop.latex.tools` and `latex-workshop.latex.recipes`.
  - Use internal fallback pipeline if a recipe command is unavailable.
- Stale PDF preview:
  - Click `Refresh PDF Preview` after compile.
  - Confirm the target and compile mode shown in the UI info line.

## Reset

Use the UI button `Reset (Delete Overrides)`, or manually delete:

```bash
rm -f theme.colors.tex theme.overrides.tex theme.ui.json
```

## Roadmap

See detailed plan and checkboxes in:

- `tools/TODO-theme-designer.md`
