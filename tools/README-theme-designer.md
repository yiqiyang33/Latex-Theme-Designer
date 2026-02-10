# Theme Designer UI

Local web UI for tuning template colors and on/off switches.

## Run

```bash
python3 tools/theme_designer.py --open-browser
```

Default URL: `http://127.0.0.1:8765`

## Current Capabilities

- Adjust theme colors for document headers and theorem/callout blocks.
- Toggle feature switches:
  - heading theme
  - TOC theme
  - page header theme
  - enhanced environment style
  - block shadow
- Save overrides to files and reload state from disk.
- Compile LaTeX from UI:
  - choose compile target `.tex` file from dropdown
  - choose compile mode:
    - internal fallback pipeline
    - VSCode recipe from `.vscode/settings.json`
  - recipe execution runs tool-by-tool and stops on first failure
  - compile log includes per-step command and exit code
- Preview current target PDF in the same UI page.

## What it edits

- `theme.colors.tex`
  - Auto-generated color overrides.
- `theme.overrides.tex`
  - Auto-generated toggle overrides.
- `theme.ui.json`
  - UI state cache.

These files are loaded automatically by:
- `main.tex` (`theme.overrides.tex`)
- `theme.sty` (`theme.colors.tex`)

## Current Limitation

- Class-aware behavior (book vs article) is not yet exposed in UI.

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
