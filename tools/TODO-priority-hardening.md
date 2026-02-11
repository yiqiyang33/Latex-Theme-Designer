# Priority TODO: Structure + Robustness (2026-02-11)

This file is a fresh, execution-oriented backlog after auditing:
- `README.md`
- `tools/README-theme-designer.md`
- `tools/` implementation + tests

## Audit Snapshot

- Core features are largely implemented (theme editing, compile flow, splitter, UI integration).
- Test coverage is already strong (`tools/tests`), but test runner entry is fragile in current environment.
- `tools/theme_designer_core.py` is too large (2700+ lines), making future changes risky.
- UI is embedded as one giant Python string (`tools/theme_designer_ui.py`), which increases regression risk.
- Real project state shows a split misuse case (`Sections/01-overview.tex` currently points to `\subfile{Sections/01-overview}`), which can recursively create `Sections/Sections/...` paths.

## P0 (Critical): Stabilize Execution Baseline

### P0-1 Test entrypoint reliability

- [x] Make `tools` import stable for tests without custom env hacks.
  - Added `tools/__init__.py`.
  - Added minimal pytest config (`pytest.ini`) and test bootstrap (`tools/tests/conftest.py`) so `pytest -q tools/tests` works from repo root.
- [x] Document one canonical test command in README.

Acceptance:
- `pytest -q tools/tests` passes directly (no `PYTHONPATH=.` needed).

### P0-2 Prevent splitter misuse on subfiles target

- [x] Add guard in split API/core: reject or redirect when selected target is already a `subfiles` unit.
- [x] UI: show clear warning when selected split source is not root-like.
  - API now returns explicit `ValueError` text; existing UI error rendering surfaces it directly.
- [x] Add regression test reproducing nested `Sections/Sections` path issue.

Acceptance:
- Splitting a subfile target cannot produce recursive nested section references.

## P1 (High): Reduce Single-File Risk

### P1-1 Decompose `theme_designer_core.py`

- [x] Split by bounded context (example):
  - [x] Phase 1: extracted split orchestration to `tools/core_split.py`, and kept compatibility wrappers in `tools/theme_designer_core.py`.
  - [x] Phase 2: extracted compile orchestration to `tools/core_compile.py` (context/recipe/output-path/pipeline), and kept compatibility wrappers in `tools/theme_designer_core.py`.
  - [x] Phase 3: extracted workspace/path guard helpers to `tools/core_paths.py`, and kept compatibility wrappers in `tools/theme_designer_core.py`.
  - [x] Phase 4: extracted preset catalog/normalize/apply helpers to `tools/core_presets.py`, and kept compatibility wrappers in `tools/theme_designer_core.py`.
  - [x] Phase 5: extracted state normalize/persist helpers (`body font`, `class config`, `payload normalize`, `ui-state persist`) to `tools/core_state.py`, with compatibility wrappers in `tools/theme_designer_core.py`.
  - [x] Phase 6: extracted override file write/delete orchestration to `tools/core_state.py`, with compatibility wrappers in `tools/theme_designer_core.py`.
  - [x] Phase 7: extracted state load orchestration to `tools/core_state.py` via `_load_state` facade delegation in `tools/theme_designer_core.py`.
  - [x] Phase 8: extracted class-profile/derived-state helpers (`_is_chapter_capable_class`, `_effective_theme_class`, `_is_incompatible_forced_theme_class`, `_class_profile_for_state`, `_refresh_derived_state`) to `tools/core_state.py` with compatibility wrappers.
  - [x] Phase 9: extracted starter-template catalog/generate/bootstrap helpers to `tools/core_starter.py` with compatibility wrappers in `tools/theme_designer_core.py`.
  - [x] Phase 10: extracted compile-target discovery/normalize helpers (`_list_candidate_tex_files`, `_default_compile_target`, `_normalize_compile_target`, `_compile_output_pdf_relpath`) to `tools/core_compile.py` with compatibility wrappers.
  - [x] Phase 11: extracted documentclass detection helpers (`_extract_documentclass_declaration`, `_resolve_subfiles_parent_tex`, `_extract_documentclass_name`, `_extract_documentclass_name_raw`, `_detect_target_documentclass`, `_has_documentclass`) to `tools/core_docclass.py` with compatibility wrappers.
  - [x] Phase 12: extracted compile-state mutation helpers (`_extract_compile_preferences`, `_apply_compile_preferences`, `_apply_compile_result`) to `tools/core_state.py` with compatibility wrappers.
  - [x] Phase 13: extracted VSCode JSONC/settings/recipe-catalog parsing helpers (`_strip_jsonc_comments`, `_strip_json_trailing_commas`, `_parse_jsonc`, `_load_vscode_settings`, `_slugify`, `_load_vscode_recipe_catalog`) to `tools/core_vscode.py` with compatibility wrappers.
  - [x] Phase 14: extracted compile output finalization helpers (`_pick_fallback_pdf`, `_check_output_freshness`, `_finalize_compile_output`) to `tools/core_compile.py` with compatibility wrappers.
  - [x] Phase 15: extracted compile recipe helpers (`_default_compile_recipe`, `_normalize_compile_recipe`, `_recipe_name_by_id`) to `tools/core_compile.py` with compatibility wrappers.
  - [x] Phase 16: extracted override parsing helpers (`_parse_main_toggle_defaults`, `_parse_toggle_override_file`, `_parse_class_override_file`, `_parse_body_font_size_override`, `_parse_color_override_file`) to `tools/core_state.py` with compatibility wrappers.
  - [x] Phase 17: extracted runtime/IO helpers (`_read_text`, `_resolve_binary`, `_build_tex_env`, `_run_command`, `_iso8601_utc_from_epoch`, `_now_iso8601_utc`) to `tools/core_runtime.py` with compatibility wrappers.
  - [x] Phase 18: extracted theme/color parsing helpers (`_bool_from_str`, `_hex_from_rgb`, `_blend_rgb`, `_parse_hex_color`, `_format_body_font_size`, `_parse_theme_color_defaults`) to `tools/core_theme.py` with compatibility wrappers.
  - [x] Phase 19: extracted class target-switch coercion helper (`_coerce_class_mode_on_target_switch`) to `tools/core_state.py` with compatibility wrapper.
  - `core_state.py` (load/normalize/persist)
  - `core_compile.py` (compile context, recipe execution)
  - `core_docclass.py` (documentclass detection)
  - `core_vscode.py` (VSCode settings/recipe parsing)
  - `core_runtime.py` (runtime/io helpers)
  - `core_theme.py` (theme/color parsing)
  - `core_split.py` (split orchestration)
  - `core_presets.py` (theme preset catalogs)
  - `core_starter.py` (starter template catalog/bootstrap)
  - `core_paths.py` (path/security helpers)
- [x] Keep compatibility facade (`theme_designer_core.py`) during migration.

Acceptance:
- All existing tests still pass.
- No behavior change in public CLI/API.

### P1-2 Externalize UI assets

- [x] Move HTML/CSS/JS from giant string to versioned files (`tools/ui/`).
- [x] Load UI file from server with explicit UTF-8 handling.
- [x] Keep JS syntax check in tests.

Acceptance:
- UI behavior unchanged; script syntax test remains green.

## P2 (High): Harden Runtime Error Model

### P2-1 API error consistency

- [x] Replace broad `except Exception` paths where avoidable with typed errors.
- [x] Standardize JSON error payload fields (`error`, `code`, `hint`).
- [x] Add endpoint-level tests for bad payloads/path traversal/invalid target.

Acceptance:
- API failures are deterministic and actionable.

### P2-2 Command execution safeguards

- [x] Add explicit command timeout policy for compile subprocesses.
- [x] Ensure logs always include command + cwd + exit code.
- [x] Preserve no-shell execution invariant.

Acceptance:
- Hanging/slow compile tasks are bounded and diagnosable.

## P3 (Medium): Delivery Engineering + Docs Hygiene

### P3-1 CI pipeline

- [x] Add CI workflow to run tests on clean environment.
- [x] Include JS syntax check and splitter/theme tests.

Acceptance:
- PR-level automatic regression signal exists.

### P3-2 README dedup + single source of truth

- [x] Reduce overlap between root README and `tools/README-theme-designer.md`.
- [x] Keep capability list generated from one place (or strict update checklist).
- [x] Add “known limitations” section (e.g., split source constraints).

Acceptance:
- Docs drift risk is reduced; onboarding path is clear.

## Suggested Execution Order

1. P0-1 test entrypoint reliability
2. P0-2 split misuse guard
3. P1-1 core modularization (incremental)
4. P1-2 UI asset extraction
5. P2 error model + command safeguards
6. P3 CI + docs cleanup
