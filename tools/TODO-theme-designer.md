# LaTeX Editing Toolkit TODO (Active Plan)

This plan is re-scoped around three must-have goals:

1. Every split section must compile to PDF independently.
2. Splitter workflow must be integrated into Theme Designer UI.
3. Project naming/docs should evolve from "Theme Designer" toward a broader LaTeX editing toolkit.

Ordered by delivery priority (must first, then should-have).

---

## M1 (Must): Standalone-Compilable Sections

Goal: after splitting root file, each unit can compile independently without manual preamble copy.

### Tasks

- [ ] Finalize standalone strategy:
  - preferred: generated wrapper `.tex` per unit
  - fallback: `subfiles` mode (only if wrapper approach proves too fragile)
- [ ] Extend splitter core (`tools/tex_splitter.py`) with standalone wrapper generation.
- [ ] Wrapper requirements:
  - reuse root preamble/theme/theorems/commands
  - compile exactly one section unit per wrapper
  - preserve bibliography behavior (`biblatex` + `biber`) where available
- [ ] Define output layout:
  - unit sources: `Sections/*.tex`
  - standalone wrappers: `Sections/_standalone/*.tex`
- [ ] Add CLI flags:
  - `--with-standalone`
  - `--standalone-dir`
- [ ] Add tests:
  - wrapper generation for article-like split
  - wrapper generation for book/report-like split
  - wrapper filenames stable across repeated runs

### Acceptance Criteria

- [ ] Running splitter once can produce root + units + standalone wrapper files.
- [ ] Compiling one wrapper emits a PDF for that unit without manual edits.

---

## M2 (Must): Theme Designer UI Integration for Splitter

Goal: splitter/standalone workflow is fully usable from local web UI, not only CLI.

### Tasks

- [ ] Core integration in `tools/theme_designer_core.py`:
  - splitter orchestration API
  - response payload for generated files, warnings, and backup path
- [ ] Server endpoints in `tools/theme_designer_server.py`:
  - `POST /api/split`
  - optional `POST /api/split-preview` (dry-run summary)
- [ ] UI controls in `tools/theme_designer_ui.py`:
  - root target selector (default current compile target)
  - split mode display (chapter/section auto-detected)
  - options: `use include`, `with standalone wrappers`
  - action button: `Split Current Target`
- [ ] After split success:
  - refresh compile target catalog
  - keep/auto-switch compile target policy explicit in UI
  - show operation log with touched files
- [ ] Add integration tests:
  - endpoint success path
  - validation error path (no anchors / missing documentclass)
  - state refresh after split

### Acceptance Criteria

- [ ] User can complete split + compile a generated unit wrapper without leaving UI.
- [ ] UI shows clear error messages and never silently rewrites files.

---

## M3 (Must): Splitter Safety and Idempotency

Goal: repeated usage in real projects is predictable and safe.

### Tasks

- [ ] Add dry-run mode in CLI and API (planned operations only).
- [ ] Detect already-split root bodies and avoid duplicate `\\input`/`\\include` injection.
- [ ] Stable collision-safe naming:
  - ordered index prefix + slug
  - deterministic fallback for duplicate/empty titles
- [ ] Backup policy hardening:
  - incremental backups (`.bak`, `.bak.1`, ...)
  - include backup path in result payload/log
- [ ] Expand tests:
  - rerun on previously split file
  - starred headings (`\\section*`, `\\chapter*`)
  - nested headings
  - mixed Chinese/English titles
  - file without split anchors

### Acceptance Criteria

- [ ] Second run on same file does not corrupt structure or produce uncontrolled duplicates.
- [ ] Dry-run output is sufficient for users to understand exactly what will change.

---

## S1 (Should): Product Naming and Documentation Refresh

Goal: align project positioning with broader "LaTeX editing toolkit" scope.

### Tasks

- [ ] Decide naming:
  - repo display name
  - UI product name
  - CLI naming consistency (`theme_designer.py` compatibility kept during transition)
- [ ] Update docs:
  - `README.md`
  - `tools/README-theme-designer.md`
  - migration notes for old naming/entrypoints
- [ ] Optional compatibility layer:
  - keep old command aliases for one release window
  - mark deprecation schedule

### Acceptance Criteria

- [ ] New users can understand in under 1 minute that this is not only theme tuning but also LaTeX structure/editing tooling.

---

## Execution Order (Reset)

- [ ] M1 standalone-compile foundation
- [ ] M2 UI/API integration
- [ ] M3 safety + idempotency hardening
- [ ] S1 naming/docs refresh
