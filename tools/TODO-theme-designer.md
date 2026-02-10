# Theme Designer TODO (Easy -> Hard)

This plan focuses on:

1. UI-configurable compile recipes (aligned with `.vscode/settings.json`)
2. UI button to choose compile target file
3. Adaptation for both `book` and `article` projects

---

## Phase 1 (Easy): Compile Target Selector

Goal: choose which `.tex` file to compile directly from UI.

### Tasks

- [x] Add backend API to list candidate tex files.
  - Rule: include project-root `.tex` files by default.
  - Rule: ignore generated files and temporary directories.
- [x] Add backend state key `compile_target` (default: `main.tex` if exists).
- [x] Add UI dropdown + button near `Compile PDF`.
- [x] Persist target to `theme.ui.json`.
- [x] Update compile function to use selected target instead of fixed `main.tex`.
- [x] Update PDF preview path logic for non-`main.pdf` outputs.

### Acceptance Criteria

- [x] Switching target in UI changes actual compiled file.
- [x] Reloading UI restores last selected target.
- [x] Compile log clearly shows selected target file.

---

## Phase 2 (Medium): Recipe System (VSCode-aligned)

Goal: compile behavior selectable in UI, compatible with `.vscode/settings.json`.

### Tasks

- [ ] Parse `.vscode/settings.json`:
  - `latex-workshop.latex.tools`
  - `latex-workshop.latex.recipes`
- [ ] Build internal tool/recipe model.
  - Keep `%DOCFILE%` and `%OUTDIR%` substitution support.
  - Add safe fallback when tokens are missing.
- [ ] Add UI controls:
  - recipe selector
  - "use internal fallback pipeline" option
- [ ] Persist selected recipe in `theme.ui.json`.
- [ ] Implement recipe executor:
  - run tools in sequence
  - stop on first failure
  - aggregate logs with step headers
- [ ] Keep current robust binary resolution and PATH injection.
- [ ] Fallback rules:
  - if selected recipe fails due missing command, show explicit message and suggest fallback recipe.

### Acceptance Criteria

- [ ] UI lists recipes from `.vscode/settings.json`.
- [ ] Choosing `xelatex -> bibtex -> xelatex*2` runs exactly that sequence.
- [ ] Logs show per-tool command and exit code.
- [ ] Missing tool errors are explicit and actionable.

---

## Phase 3 (Medium-Hard): Output and Target Robustness

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

### Acceptance Criteria

- [ ] PDF preview always points to the correct output file for current recipe+target.
- [ ] No stale preview after compile.

---

## Phase 4 (Hard): `book` / `article` Adaptation

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

## Documentation & UX (Cross-cutting)

- [ ] Update `tools/README-theme-designer.md` after each phase.
- [ ] Add a compact "Troubleshooting" section:
  - missing TeX binaries
  - missing recipe/tool
  - stale PDF preview
- [ ] Add inline help text in UI for each new control.

---

## Suggested Execution Order

- [ ] P1 compile target selector
- [ ] P2 recipe support from VSCode settings
- [ ] P3 output/preview robustness
- [ ] P4 book/article adaptation
