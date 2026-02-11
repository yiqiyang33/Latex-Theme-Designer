# Theme/System TODO (Active Plan)

This file tracks pending work only.
Ordered from easy to hard.

---

## P1 (Easy): Chapter Color Update Triage + Repro Matrix

Goal: make chapter color behavior diagnosable in 1 minute.

### Tasks

- [x] Add a short troubleshooting section in `tools/README-theme-designer.md`:
  - chapter color only applies when chapter heading style is active.
  - `article` class or `ThemeClassMode=article` disables chapter heading styling.
- [x] Add explicit repro checklist:
  - compile target = `templates/book-minimal.tex`
  - `theme_class_mode=auto` or `book`
  - `theme_heading_chapter_mode=auto` or `on`
  - `enable_heading_theme=true`
- [x] Add a quick command-based sanity check doc snippet for local debug.

### Acceptance Criteria

- [ ] New users can self-diagnose "chapter color not changing" without reading source code.

---

## P2 (Easy-Medium): UI Guardrails for Inactive Chapter Styling

Goal: remove ambiguity in Theme Designer when chapter styling is inactive.

### Tasks

- [x] In `targetInfo`, append a clear status when chapter styling is inactive.
  - Example: `chapter-style: inactive (effective class article)`.
- [x] In color token panel, add hint beside `theme-chapter` when inactive.
- [x] Optional: disable `theme-chapter` picker while inactive (or keep editable but warn).
- [x] Add tests for derived-state combinations:
  - detected class `book` + forced `article`
  - detected class `article` + forced `book`
  - auto mode for both.

### Acceptance Criteria

- [ ] UI always explains why chapter color changes may have no visible effect.

---

## P3 (Medium): Chapter Theme Behavior Consistency Fix

Goal: make class-mode persistence and compile-target switching less error-prone.

### Tasks

- [x] Audit persistence flow for stale class config when target file disappears.
- [x] Decide policy:
  - keep explicit forced class forever, or
  - auto-fallback to `auto` when compile target changes to incompatible class.
- [x] Implement selected policy in `tools/theme_designer_core.py`.
- [x] Add regression tests for state reload + target switch + save roundtrip.

### Acceptance Criteria

- [x] Switching compile targets cannot silently trap users in wrong class behavior.

---

## P4 (Medium): One-Click `main.tex` Splitter (Core Engine)

Goal: split a long root `.tex` into modular files by structural unit.

### Tasks

- [ ] Create `tools/tex_splitter.py` CLI.
- [ ] Detect root document class from `\\documentclass{...}`.
- [ ] Split rule:
  - `book`/`report`-like: split by top-level `\\chapter{...}`
  - `article`-like: split by top-level `\\section{...}`
- [ ] Keep preamble in root file; rewrite body to `\\input{...}` or `\\include{...}`.
- [ ] Write unit files into `Sections/` with stable ordered names.
- [ ] Keep original file backup before rewrite.

### Acceptance Criteria

- [ ] Running once transforms monolithic file into root + unit files with same compile result.

---

## P5 (Hard): Standalone-Compilable Units

Goal: each split unit can compile independently while sharing theme/preamble.

### Tasks

- [ ] Choose strategy:
  - `subfiles`-based units, or
  - generated wrapper files per unit.
- [ ] Implement one-command generation for standalone wrappers.
- [ ] Ensure each unit supports:
  - theorem environments
  - bibliography references
  - theme overrides (`theme.colors.tex`, `theme.overrides.tex`)
- [ ] Add compile target discovery support for wrappers (if needed).

### Acceptance Criteria

- [ ] Root compile works and each unit compiles independently via CLI/Theme Designer.

---

## P6 (Hard): Splitter Safety, Idempotency, and Tests

Goal: make splitter safe for repeated use in large evolving notes.

### Tasks

- [ ] Idempotent behavior:
  - re-run updates changed units without duplicating structure.
- [ ] Add dry-run mode showing planned file operations.
- [ ] Add collision-safe naming (slug + index).
- [ ] Add tests for:
  - nested sections
  - starred headings (`\\section*`)
  - files with no split anchors
  - mixed Chinese/English headings.

### Acceptance Criteria

- [ ] Repeated runs are predictable and safe in real projects.

---

## Suggested Execution Order

- [ ] P1 chapter-color repro/troubleshooting
- [ ] P2 UI inactive-state guardrails
- [ ] P3 class-mode consistency fix
- [ ] P4 splitter core engine
- [ ] P5 standalone-compile support
- [ ] P6 safety + idempotency + tests
