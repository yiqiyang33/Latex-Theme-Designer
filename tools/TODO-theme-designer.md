# Theme Designer TODO (Active Plan)

This file tracks pending work only.
Completed phases have been removed from this file.

---

## Phase 6: Template Bootstrap (One-Click Starter `.tex` Creation)

Goal: initialize usable project files when no compile target exists.

### Tasks

- [x] Add minimal starter templates under `templates/`.
  - At least `book-minimal.tex` and `article-minimal.tex`.
- [x] Add backend/template registry for listing available starter templates.
- [x] Add UI action to generate a starter `.tex` target from selected template.
  - Default selection: `book-minimal`.
- [x] Add custom output filename support for generated target.
- [x] Add safety behavior when target file already exists.
  - Require explicit overwrite confirmation.
- [x] After generation, refresh compile target list and select generated file.
- [x] Add tests for generation success, overwrite protection, and refresh behavior.

### Acceptance Criteria

- [x] If no `main.tex` exists, user can create one from UI in one action.
- [x] Generated file compiles with existing default pipeline.
- [x] Existing files are not overwritten silently.

---

## Phase 7: Multi-Template Architecture Plan

Goal: support different template families with their own Theme Designer schema and defaults.

### Tasks

- [ ] Define template profile spec (data model).
  - Example: colors/toggles/class-config/body-font-size availability.
  - Compile defaults and supported environment tokens.
- [ ] Define project-level profile selection file.
  - Proposed file: `theme.project.json`.
  - Includes selected template profile ID and version.
- [ ] Add profile loader and capability negotiation in backend schema API.
- [ ] Plan migration/compatibility strategy for existing projects.
  - Default profile should match current behavior.
- [ ] Draft extension mechanism for future custom template packs.
  - Local folder convention and metadata schema.
- [ ] Document phased rollout to avoid breaking current users.

### Acceptance Criteria

- [ ] Backend can expose profile-specific schema without hardcoded single-template assumptions.
- [ ] Existing single-template projects continue working unchanged.
- [ ] Profile-selection and migration behavior are documented with examples.

---

## Suggested Execution Order

- [x] P6 template bootstrap generation
- [ ] P7 multi-template architecture
