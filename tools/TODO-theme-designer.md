# Theme Designer TODO (Active Plan)

This file tracks pending work only.
Completed phases have been removed.

---

## Phase 1: Block Preset Themes

Goal: provide fixed, reusable color combinations for theorem/callout blocks.

### Tasks

- [ ] Add block preset model in backend.
  - Include `default` preset matching current colors.
  - Keep current manual color overrides as highest priority.
- [ ] Add preset selector in UI.
  - Show preset name and description.
  - Add `Apply Preset` action.
- [ ] Persist selected block preset in `theme.ui.json`.
- [ ] Generate explicit color overrides to `theme.colors.tex` after preset apply.
- [ ] Add tests for preset apply + persist + reload consistency.

### Acceptance Criteria

- [ ] User can switch block theme to `default` or other named presets in one click.
- [ ] Preset change updates all related block tokens deterministically.
- [ ] Reloading UI preserves selected preset and resulting colors.

---

## Phase 2: Header and TOC Preset Themes

Goal: provide fixed style bundles for heading and TOC visuals.

### Tasks

- [ ] Add heading/TOC preset model in backend.
  - Include `default` preset matching current behavior.
- [ ] Define preset token mapping for:
  - chapter/section/subsection heading colors
  - TOC title/chapter/section colors
  - header rule style tokens (if needed)
- [ ] Add preset selector in UI with live preview impact.
- [ ] Persist selected header/TOC preset in `theme.ui.json`.
- [ ] Add tests for preset mapping and state roundtrip.

### Acceptance Criteria

- [ ] User can switch heading/TOC style bundle from UI.
- [ ] Existing `default` output remains backward-compatible.
- [ ] Preset switch is reflected in generated override files and compiled PDF.

---

## Phase 3: Body Font Size UI Control

Goal: support direct body text size tuning from Theme Designer.

### Tasks

- [ ] Add backend config key for base body font size.
  - Define valid range (example: 9pt to 14pt) and step.
  - Define default matching current template behavior.
- [ ] Add UI control (slider preferred) with numeric display.
- [ ] Write font size override to `theme.overrides.tex`.
- [ ] Apply override in `main.tex`/`theme.sty` compatibility-safe way.
- [ ] Add tests for range validation and override file generation.

### Acceptance Criteria

- [ ] User can drag slider and compile to see body font size changes.
- [ ] Value is persisted and restored after reload.
- [ ] Out-of-range values are rejected with clear error.

---

## Suggested Execution Order

- [ ] P1 block preset themes
- [ ] P2 header/TOC preset themes
- [ ] P3 body font size UI control
