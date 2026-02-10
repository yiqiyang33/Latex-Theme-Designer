# Theme Designer TODO (Active Plan)

This file tracks remaining work only.
Completed phase P1 (compile target selector) has been removed from active TODO.

---

## Phase 0 (Now): Stability Hotfixes

Goal: remove known runtime risks before larger feature work.

### Tasks

- [x] Fix compile API tuple consistency in no-TeX-engine path.
  - `_compile_tex_target` must always return `(success, output, pdf_path)`.
- [x] Add regression check for "no latexmk/xelatex/pdflatex" branch.
  - Verify `/api/compile` responds with clear error instead of server exception.
- [x] Add pre-work helper for JSONC parsing of `.vscode/settings.json`.
  - Must tolerate comments and trailing commas used by VSCode settings.

### Acceptance Criteria

- [x] Missing TeX engines no longer cause tuple-unpack/runtime errors.
- [x] Compile endpoint returns actionable error message when tools are missing.
- [x] JSONC settings can be parsed into internal data model safely.

---

## Phase 1 (Done): Recipe System (VSCode-aligned)

Goal: compile behavior selectable in UI, compatible with `.vscode/settings.json`.

### Tasks

- [x] Parse `.vscode/settings.json`:
  - `latex-workshop.latex.tools`
  - `latex-workshop.latex.recipes`
- [x] Build internal tool/recipe model.
  - Keep `%DOCFILE%` and `%OUTDIR%` substitution support.
  - Add safe fallback when tokens are missing.
- [x] Add UI controls:
  - recipe selector
  - "use internal fallback pipeline" option
- [x] Persist selected recipe in `theme.ui.json`.
- [x] Implement recipe executor:
  - run tools in sequence
  - stop on first failure
  - aggregate logs with step headers
- [x] Keep current robust binary resolution and PATH injection.
- [x] Fallback rules:
  - if selected recipe fails due missing command, show explicit message and suggest fallback recipe.

### Acceptance Criteria

- [x] UI lists recipes from `.vscode/settings.json`.
- [x] Choosing `xelatex -> bibtex -> xelatex*2` runs exactly that sequence.
- [x] Logs show per-tool command and exit code.
- [x] Missing tool errors are explicit and actionable.

---

## Phase 1.5: Codebase Split and Cleanup

Goal: split `tools/theme_designer.py` into clear modules without behavior changes.

### Tasks

- [x] Split backend/core logic into dedicated module.
- [x] Split embedded UI HTML into dedicated module.
- [x] Split HTTP server/entry logic into dedicated module.
- [x] Keep `tools/theme_designer.py` as compatibility entrypoint.
- [x] Update tests/imports to keep regression coverage green after split.
- [x] Add section-level comments/docstrings in new modules for navigation.

### Acceptance Criteria

- [x] `python3 tools/theme_designer.py --help` works as before.
- [x] Existing tests pass without functional regressions.
- [x] API endpoints and UI behavior remain unchanged.

---

## Phase 2: Output and Preview Robustness

Goal: make compile/output behavior reliable across recipes and targets.

### Tasks

- [ ] Track expected output PDF path per recipe/target.
  - Handle `%OUTDIR%`.
  - Handle target basename changes.
- [ ] Add UI output indicator:
  - current output PDF path
  - last compile timestamp
- [ ] Add backend check for "PDF exists and newer than source".
- [ ] Improve `Refresh PDF Preview` to follow dynamic PDF path.
- [ ] Add stale-preview diagnostics in compile log.

### Acceptance Criteria

- [ ] PDF preview always points to the correct output file for current recipe+target.
- [ ] No stale preview after compile.
- [ ] UI clearly reports where latest PDF was read from.

---

## Phase 3: `book` / `article` Adaptation

Goal: make theme behavior class-aware and configurable.

### Tasks

- [ ] Detect document class from selected target (`\\documentclass{...}`).
- [ ] Add class mode in UI:
  - Auto (detect)
  - Force book
  - Force article
- [ ] Extend theme configuration model with class-aware keys:
  - heading rules (`chapter` only for book)
  - page style differences
  - theorem numbering policy options
- [ ] Ensure article mode works without chapter styling assumptions.
- [ ] Add compatibility layer in `theme.sty`:
  - guard chapter-specific formatting when class has no `\\chapter`.
- [ ] Add compile smoke tests:
  - one minimal `book` target
  - one minimal `article` target

### Acceptance Criteria

- [ ] `article` target compiles cleanly with UI-selected settings.
- [ ] `book` target behavior stays backward-compatible.
- [ ] Heading/TOC/page styles do not reference unavailable sectioning commands.

---

## Documentation and UX (Cross-cutting)

- [x] Update `tools/README-theme-designer.md` for the completed phase.
- [x] Add a compact troubleshooting section:
  - missing TeX binaries
  - missing recipe/tool
  - stale PDF preview
- [x] Add inline help text in UI for each new control.
- [x] Keep `README.md` and tool README in sync for compile workflow description.

---

## Suggested Execution Order

- [x] P0 stability hotfixes
- [x] P1 recipe support from VSCode settings
- [x] P1.5 codebase split and cleanup
- [ ] P2 output/preview robustness
- [ ] P3 book/article adaptation
