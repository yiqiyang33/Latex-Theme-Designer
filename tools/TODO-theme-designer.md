# Theme Designer TODO (Active Plan)

This file tracks pending work only.
Completed phases have been removed.

---

## Phase 2: Header and TOC Preset Themes

Goal: provide fixed style bundles for heading and TOC visuals.

### Tasks

- [x] Add heading/TOC preset model in backend.
  - Include `default` preset matching current behavior.
- [x] Define preset token mapping for:
  - chapter/section/subsection heading colors
  - TOC title/chapter/section colors
  - header rule style tokens (if needed)
- [x] Add preset selector in UI with live preview impact.
- [x] Persist selected header/TOC preset in `theme.ui.json`.
- [x] Add tests for preset mapping and state roundtrip.

### Acceptance Criteria

- [x] User can switch heading/TOC style bundle from UI.
- [x] Existing `default` output remains backward-compatible.
- [x] Preset switch is reflected in generated override files and compiled PDF.

---

## Phase 3: Body Font Size UI Control

Goal: support direct body text size tuning from Theme Designer.

### Tasks

- [x] Add backend config key for base body font size.
  - Define valid range (example: 9pt to 14pt) and step.
  - Define default matching current template behavior.
- [x] Add UI control (slider preferred) with numeric display.
- [x] Write font size override to `theme.overrides.tex`.
- [x] Apply override in `main.tex`/`theme.sty` compatibility-safe way.
- [x] Add tests for range validation and override file generation.

### Acceptance Criteria

- [x] User can drag slider and compile to see body font size changes.
- [x] Value is persisted and restored after reload.
- [x] Out-of-range values are rejected with clear error.

---

## Suggested Execution Order

- [x] P2 header/TOC preset themes
- [x] P3 body font size UI control
