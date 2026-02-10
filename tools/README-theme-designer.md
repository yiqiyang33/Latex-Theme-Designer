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
  - uses `latexmk` when available
  - falls back to `xelatex/pdflatex (+ biber if available)` when `latexmk` is unavailable
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

- Compile pipeline is currently internal to the tool and not yet configurable from VSCode recipes.
- Class-aware behavior (book vs article) is not yet exposed in UI.

## Reset

Use the UI button `Reset (Delete Overrides)`, or manually delete:

```bash
rm -f theme.colors.tex theme.overrides.tex theme.ui.json
```

## Roadmap

See detailed plan and checkboxes in:

- `tools/TODO-theme-designer.md`
