# LaTeX Editing Toolkit TODO (Subfiles-First Plan)

This plan is reset around `subfiles` as the primary standalone compile strategy.

Core goals:

1. Every split unit compiles independently via `subfiles`.
2. Split workflow is integrated into Theme Designer UI.
3. Product positioning shifts from "Theme Designer" to a broader LaTeX editing toolkit.

## Hotfix (Urgent): UI Selector Interactivity Regression

Goal: fix all broken dropdown interactivity in UI (`Template`, `Source`, `Compile`, `Recipe`) with reproducible verification.

### Phase A: Repro + Root Cause (Highest Priority)

- [x] Reproduce on fresh server start and hard-refresh browser (no stale JS cache).
- [x] Add temporary runtime diagnostics:
  - log `disabled` state changes for affected `<select>` controls
  - log rerender sequence (`init`, target/recipe apply, split, save, compile)
  - implemented via `DEBUG_SELECTOR_DIAGNOSTICS` hooks in `tools/theme_designer_ui.py`
- [x] Identify exact blocker category:
  - DOM state logic issue (`disabled=true` set by JS), or
  - UI overlay/CSS pointer event interception, or
  - event handler replaced/cleared after rerender.
  - Actual root cause found: embedded UI script had JS syntax error (`lines.join("\n")` emitted as broken multiline string), so `init()` aborted and all selectors stayed empty.

### Phase B: Minimal-Risk Fix

- [x] Fix JS escaping bug in `tools/theme_designer_ui.py` (`lines.join("\\n")`) and verify `init()` completes.
- [x] Verify all impacted selectors are populated and selectable after startup (`Template`, `Source`, `Compile`, `Recipe`).
- [x] Keep selector state in one source of truth and restore after rerender.
- [x] Ensure only true empty-catalog cases can disable controls.
- [x] Ensure fallback mode does not lock recipe dropdown selection.
- [x] Remove/guard any render path that forces unintended selector reset.

### Phase C: Regression Protection

- [x] Add regression test that embedded UI `<script>` passes JS syntax check (`node --check`) to prevent init-break regressions.
- [x] Add tests for selector enabled/disabled logic in render functions.
- [x] Add server/API level test for state refresh not removing selectable targets/recipes.
- [x] Add manual verification script/checklist for:
  - startup
  - target switch
  - split run
  - compile run
  - save/reset flow
  - checklist file: `tools/HOTFIX-selector-checklist.md`

### Acceptance Criteria

- [x] All four dropdowns are clickable/selectable after startup.
- [x] Selection remains stable after `save`, `split`, `compile`, and `apply target/recipe`.
- [x] No control is disabled unless corresponding options list is empty.

---

## P0 (Decision): Subfiles as Default Strategy

Goal: remove ambiguity and lock implementation direction.

### Tasks

- [x] Choose `subfiles` as default standalone approach.
- [x] Define compatibility policy for existing wrapper mode:
  - keep wrapper mode as an explicit legacy fallback during migration
  - migrate to subfiles-first output and deprecate wrapper mode after subfiles flow ships end-to-end
- [x] Define UX wording (UI + docs): "Split + subfiles standalone".

### Acceptance Criteria

- [x] Team/docs consistently describe standalone compile as `subfiles`-based.

---

## P1 (Must): Splitter Output for Subfiles

Goal: splitting a monolithic root file yields subfiles-compatible units immediately.

### Tasks

- [x] Update `tools/tex_splitter.py` to support `subfiles` mode output.
- [x] For each generated unit file:
  - prepend `\\documentclass[<relative-root>]{subfiles}`
  - wrap content with `\\begin{document}` / `\\end{document}`
- [x] Root rewrite strategy:
  - replace body anchors with `\\subfile{Sections/...}` entries
  - keep preamble and existing theme/theorem config in root
- [x] Ensure root preamble includes `\\usepackage{subfiles}` (inject if missing, avoid duplicates).
- [x] Preserve class-aware split rule:
  - book/report-like: split by top-level `\\chapter`
  - article-like: split by top-level `\\section`
- [x] Keep backup policy before rewrite (`.bak`, `.bak.1`, ...).
- [x] Add/rename CLI flags:
  - `--standalone-mode subfiles` (default)
  - optional legacy mode flag if wrapper fallback is retained

### Acceptance Criteria

- [x] One splitter run creates root + subfiles units that compile both as root and individually.

---

## P2 (Must): Compiler/Environment Support for Subfiles Targets

Goal: compile pipeline handles section targets and root targets consistently.

### Tasks

- [x] Verify compile target discovery includes generated subfiles units.
- [x] Ensure internal compile mode works when compile target is under `Sections/`.
- [x] Ensure recipe mode works for subfiles targets (`%DOCFILE%`, `%DOC%`, outdir cases).
- [x] Validate bibliography/theorem behavior in subfile compile path.
- [x] Add regression tests for:
  - compile context resolution on subfile targets
  - output PDF path expectation for subfile targets

### Acceptance Criteria

- [x] Picking a subfile target in existing compile flow yields correct PDF output path and successful compile.

---

## P3 (Must): Theme Designer UI Integration

Goal: user can split and compile subfiles directly from UI.

### Tasks

- [x] Core API in `tools/theme_designer_core.py` for split orchestration (subfiles mode).
- [x] Server endpoints in `tools/theme_designer_server.py`:
  - `POST /api/split`
  - optional `POST /api/split-preview` for dry-run plan
- [x] UI controls in `tools/theme_designer_ui.py`:
  - split source target selector (default current compile target)
  - standalone mode display (`subfiles`)
  - action button (`Split Current Target`)
- [x] Split result panel:
  - backup path
  - generated/updated files
  - warnings/errors
- [x] After split success:
  - refresh compile target list
  - allow one-click switch to generated subfile target
- [x] Add integration tests for endpoint + state refresh.

### Acceptance Criteria

- [x] User can split + select one subfile + compile to PDF without leaving Theme Designer UI.

---

## P4 (Must): Safety, Idempotency, and Edge Cases

Goal: repeated runs are predictable in real note projects.

### Tasks

- [x] Add dry-run mode (CLI + API).
- [x] Prevent duplicate `\\subfile{...}` injection on rerun.
- [x] Stable naming and collision handling:
  - index prefix + slug
  - deterministic fallback for duplicate/empty/non-ASCII headings
- [x] Edge-case tests:
  - starred headings (`\\section*`, `\\chapter*`)
  - nested headings
  - no split anchors
  - mixed Chinese/English titles
- [x] Failure safety:
  - no partial overwrite when split fails mid-run.

### Acceptance Criteria

- [x] Rerunning splitter does not corrupt structure and produces deterministic file layout.

---

## P5 (Should): Naming and Product Surface Refresh

Goal: reflect toolkit scope beyond theme color tuning.

### Tasks

- [ ] Finalize naming:
  - repo title
  - UI title
  - CLI naming/aliases
- [ ] Update docs:
  - `README.md`
  - `tools/README-theme-designer.md`
  - migration notes from old naming
- [ ] Keep backward-compatible entrypoint aliases during transition window.

### Acceptance Criteria

- [ ] First-time users can quickly understand the project covers theming + structure/splitting + compile workflow.

---

## Execution Order

- [x] P0 strategy lock + compatibility decision
- [x] P1 subfiles splitter output
- [x] P2 compile pipeline support
- [x] P3 UI integration
- [x] P4 safety/idempotency hardening
- [ ] P5 naming/docs refresh
