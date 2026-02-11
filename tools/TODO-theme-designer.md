# Theme Designer TODO (Active Plan)

This file tracks pending work only.
Completed phases have been removed from this file.

---

## Phase 4: Multi-Instance Startup (Auto Host/Port)

Goal: allow multiple Theme Designer instances to run without manual port conflict handling.

### Tasks

- [ ] Add startup mode that auto-selects available bind endpoint.
  - `--port 0` should bind an OS-assigned free port.
  - Keep explicit `--host/--port` override behavior.
- [ ] Print resolved URL to terminal in all startup modes.
- [ ] Ensure `--open-browser` opens the resolved URL (not hardcoded default).
- [ ] Add collision fallback behavior when explicit port is occupied.
  - Clear error by default.
  - Optional `--port auto` fallback to next free port.
- [ ] Add tests for endpoint resolution and occupied-port scenarios.

### Acceptance Criteria

- [ ] Running two instances concurrently requires no manual port editing.
- [ ] Startup logs always show the exact URL that is actually bound.
- [ ] Browser auto-open targets the bound URL correctly.

---

## Phase 5: Lifecycle and Session Shutdown Behavior

Goal: improve server/browser lifecycle behavior around Ctrl+C and tab close.

### Tasks

- [ ] Define lifecycle mode options and defaults.
  - `manual`: current behavior.
  - `shutdown-on-last-tab`: stop server when no active UI session.
- [ ] Add lightweight heartbeat/session tracking endpoint.
  - UI sends periodic heartbeat while page is open.
  - Server expires inactive sessions by timeout.
- [ ] Add optional auto-shutdown when last active session expires.
  - Configurable idle grace period.
- [ ] Define Ctrl+C behavior contract.
  - Server shutdown is guaranteed.
  - Browser auto-close is best-effort only (browser security constraints).
- [ ] Document platform limitations and fallback behavior explicitly.
- [ ] Add tests for session timeout and shutdown trigger conditions.

### Acceptance Criteria

- [ ] In `shutdown-on-last-tab` mode, server exits after all sessions expire.
- [ ] Ctrl+C always terminates server cleanly without orphan processes.
- [ ] Lifecycle behavior is explicit and predictable from CLI options.

---

## Phase 6: Template Bootstrap (One-Click `main.tex` Creation)

Goal: initialize usable project files when no compile target exists.

### Tasks

- [ ] Add minimal starter templates under `templates/`.
  - At least `book-minimal.tex` and `article-minimal.tex`.
- [ ] Add backend/template registry for listing available starter templates.
- [ ] Add UI action to generate `main.tex` from selected starter template.
  - Default selection: `book-minimal`.
- [ ] Add safety behavior when target file already exists.
  - Require explicit overwrite confirmation.
- [ ] After generation, refresh compile target list and select generated file.
- [ ] Add tests for generation success, overwrite protection, and refresh behavior.

### Acceptance Criteria

- [ ] If no `main.tex` exists, user can create one from UI in one action.
- [ ] Generated file compiles with existing default pipeline.
- [ ] Existing files are not overwritten silently.

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

- [ ] P4 multi-instance startup (auto host/port)
- [ ] P5 lifecycle/session shutdown behavior
- [ ] P6 template bootstrap generation
- [ ] P7 multi-template architecture
