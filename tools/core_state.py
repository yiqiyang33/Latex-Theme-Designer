#!/usr/bin/env python3
"""State normalize/persist helpers extracted from theme_designer_core."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


def parse_body_font_size_value(raw_value: Any) -> Optional[float]:
    if isinstance(raw_value, bool):
        return None
    try:
        parsed = float(raw_value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def normalize_body_font_size_value(
    raw_value: Any,
    *,
    min_value: float,
    max_value: float,
    step: float,
    default_value: float,
) -> float:
    parsed = parse_body_font_size_value(raw_value)
    if parsed is None:
        return default_value
    clamped = min(max_value, max(min_value, parsed))
    snapped_steps = round((clamped - min_value) / step)
    snapped = min_value + snapped_steps * step
    bounded = min(max_value, max(min_value, snapped))
    return round(bounded, 1)


def validate_body_font_size_value(
    raw_value: Any,
    *,
    field_id: str,
    min_value: float,
    max_value: float,
    step: float,
    normalize_body_font_size_value_fn: Callable[[Any], float],
) -> float:
    parsed = parse_body_font_size_value(raw_value)
    if parsed is None:
        raise ValueError(
            f"Invalid value for {field_id}: {raw_value}. Expected a number."
        )
    if parsed < min_value or parsed > max_value:
        raise ValueError(
            f"Invalid value for {field_id}: {raw_value}. "
            f"Expected {min_value:.1f} to {max_value:.1f}."
        )
    normalized = normalize_body_font_size_value_fn(parsed)
    if abs(normalized - parsed) > 1e-9:
        raise ValueError(
            f"Invalid value for {field_id}: {raw_value}. "
            f"Expected increments of {step:.1f}."
        )
    return normalized


def normalize_class_config_value(
    field_id: str,
    raw_value: Any,
    *,
    class_config_valid_options: Dict[str, set[str]],
    class_config_defaults: Dict[str, str],
) -> str:
    valid = class_config_valid_options.get(field_id, set())
    parsed = str(raw_value or "").strip().lower()
    if parsed in valid:
        return parsed
    return class_config_defaults[field_id]


def validate_class_config_value(
    field_id: str,
    raw_value: Any,
    *,
    class_config_valid_options: Dict[str, set[str]],
) -> str:
    parsed = str(raw_value or "").strip().lower()
    valid = class_config_valid_options.get(field_id, set())
    if parsed in valid:
        return parsed
    options = ", ".join(sorted(valid))
    raise ValueError(f"Invalid value for {field_id}: {raw_value}. Expected one of: {options}")


def normalize_class_config_map(
    raw_map: Dict[str, Any],
    *,
    class_config_defaults: Dict[str, str],
    class_config_ids: List[str],
    normalize_class_config_value_fn: Callable[[str, Any], str],
) -> Dict[str, str]:
    config = dict(class_config_defaults)
    if not isinstance(raw_map, dict):
        return config
    for field_id in class_config_ids:
        if field_id in raw_map:
            config[field_id] = normalize_class_config_value_fn(field_id, raw_map[field_id])
    return config


def is_chapter_capable_class(class_name: str, *, chapter_class_names: set[str]) -> bool:
    name = (class_name or "").strip().lower()
    if not name:
        return False
    if name in chapter_class_names:
        return True
    return name.endswith("book") or name.endswith("report")


def effective_theme_class(
    theme_class_mode: str,
    detected_document_class: str,
    *,
    normalize_class_config_value_fn: Callable[[str, Any], str],
    is_chapter_capable_class_fn: Callable[[str], bool],
) -> str:
    mode = normalize_class_config_value_fn("theme_class_mode", theme_class_mode)
    if mode in {"book", "article"}:
        return mode
    if is_chapter_capable_class_fn(detected_document_class):
        return "book"
    return "article"


def is_incompatible_forced_theme_class(
    theme_class_mode: str,
    detected_document_class: str,
    *,
    normalize_class_config_value_fn: Callable[[str, Any], str],
    is_chapter_capable_class_fn: Callable[[str], bool],
) -> bool:
    mode = normalize_class_config_value_fn("theme_class_mode", theme_class_mode)
    if mode not in {"book", "article"}:
        return False
    detected_has_chapter = is_chapter_capable_class_fn(detected_document_class)
    if mode == "book":
        return not detected_has_chapter
    return detected_has_chapter


def class_profile_for_state(
    state: Dict[str, Any],
    *,
    normalize_class_config_map_fn: Callable[[Dict[str, Any]], Dict[str, str]],
    detect_target_documentclass_fn: Callable[[str], str],
    is_chapter_capable_class_fn: Callable[[str], bool],
    effective_theme_class_fn: Callable[[str, str], str],
) -> Dict[str, Any]:
    class_config = normalize_class_config_map_fn(state.get("class_config", {}))
    detected = detect_target_documentclass_fn(str(state.get("compile_target", "")))
    detected_has_chapter = is_chapter_capable_class_fn(detected)
    effective = effective_theme_class_fn(
        class_config.get("theme_class_mode", "auto"),
        detected,
    )
    return {
        "class_config": class_config,
        "detected_document_class": detected or "(unknown)",
        "detected_document_class_has_chapter": detected_has_chapter,
        "effective_theme_class": effective,
    }


def refresh_derived_state(
    state: Dict[str, Any],
    recipe_catalog: Optional[Dict[str, Any]] = None,
    *,
    recipe_name_by_id_fn: Callable[[str, List[Dict[str, Any]]], str],
    expected_output_pdf_for_selection_fn: Callable[
        [str, str, bool, Optional[Dict[str, Any]]],
        str,
    ],
    class_profile_for_state_fn: Callable[[Dict[str, Any]], Dict[str, Any]],
) -> None:
    compile_target_value = str(state.get("compile_target", ""))
    compile_recipe_value = str(state.get("compile_recipe", ""))
    use_internal_value = bool(state.get("compile_use_internal_fallback", True))
    compile_recipes = state.get("compile_recipes", [])
    if isinstance(compile_recipes, list):
        state["compile_recipe_name"] = recipe_name_by_id_fn(
            compile_recipe_value,
            compile_recipes,
        )
    state["compile_output_pdf_expected"] = expected_output_pdf_for_selection_fn(
        compile_target_value,
        compile_recipe_value,
        use_internal_value,
        recipe_catalog,
    )

    profile = class_profile_for_state_fn(state)
    state["class_config"] = profile["class_config"]
    state["detected_document_class"] = profile["detected_document_class"]
    state["detected_document_class_has_chapter"] = profile["detected_document_class_has_chapter"]
    state["effective_theme_class"] = profile["effective_theme_class"]


def extract_compile_preferences(normalized: Dict[str, Any]) -> tuple[str, str, bool]:
    """Read compile target/recipe/mode from normalized state payload."""
    selected = str(normalized.get("compile_target", ""))
    selected_recipe = str(normalized.get("compile_recipe", ""))
    use_internal = bool(normalized.get("compile_use_internal_fallback", True))
    return selected, selected_recipe, use_internal


def apply_compile_preferences(
    state: Dict[str, Any],
    compile_target: Optional[str] = None,
    compile_recipe: Optional[str] = None,
    use_internal_fallback: Optional[bool] = None,
    *,
    normalize_class_config_map_fn: Callable[[Dict[str, Any]], Dict[str, str]],
    coerce_class_mode_on_target_switch_fn: Callable[[Dict[str, Any], str, str], bool],
    refresh_derived_state_fn: Callable[[Dict[str, Any]], None],
) -> None:
    """Mutate in-memory state for compile preferences and derived fields."""

    changed = False
    previous_target = str(state.get("compile_target", ""))
    target_changed = False
    if compile_target is not None:
        state["compile_target"] = compile_target
        target_changed = str(compile_target) != previous_target
        changed = True
    if compile_recipe is not None:
        state["compile_recipe"] = compile_recipe
        changed = True
    if use_internal_fallback is not None:
        state["compile_use_internal_fallback"] = use_internal_fallback
        changed = True

    if changed:
        if target_changed:
            class_config = normalize_class_config_map_fn(state.get("class_config", {}))
            state["class_config"] = class_config
            coerce_class_mode_on_target_switch_fn(
                state,
                previous_target,
                str(state.get("compile_target", "")),
            )
        refresh_derived_state_fn(state)
        state["compile_output_pdf"] = str(state.get("compile_output_pdf_expected", "main.pdf"))


def apply_compile_result(
    state: Dict[str, Any],
    success: bool,
    pdf_path: str,
    *,
    refresh_derived_state_fn: Callable[[Dict[str, Any]], None],
    safe_workspace_pdf_relpath_fn: Callable[[Any], str],
    now_iso8601_utc_fn: Callable[[], str],
) -> None:
    """Persist compile output metadata in in-memory state."""

    refresh_derived_state_fn(state)
    expected_output = str(state.get("compile_output_pdf_expected", "main.pdf"))
    resolved_pdf_path = safe_workspace_pdf_relpath_fn(pdf_path)
    state["compile_output_pdf"] = resolved_pdf_path or expected_output
    state["compile_last_compile_at"] = now_iso8601_utc_fn()
    state["compile_last_success"] = bool(success)


def normalize_payload(
    payload: Dict[str, Any],
    base_state: Dict[str, Any],
    *,
    toggle_ids: List[str],
    color_order: List[str],
    class_config_ids: List[str],
    body_font_size_id: str,
    body_font_size_default: float,
    normalize_block_preset_fn: Callable[[Any, List[Dict[str, Any]]], str],
    normalize_heading_toc_preset_fn: Callable[[Any, List[Dict[str, Any]]], str],
    normalize_body_font_size_value_fn: Callable[[Any], float],
    validate_body_font_size_value_fn: Callable[[Any], float],
    normalize_class_config_map_fn: Callable[[Dict[str, Any]], Dict[str, str]],
    validate_class_config_value_fn: Callable[[str, Any], str],
    bool_from_str_fn: Callable[[str], Any],
    parse_hex_color_fn: Callable[[str], str | None],
    normalize_compile_target_fn: Callable[[Any, List[str]], str],
    list_candidate_tex_files_fn: Callable[[], List[str]],
    normalize_compile_recipe_fn: Callable[[Any, List[Dict[str, Any]]], str],
) -> Dict[str, Any]:
    """Validate and normalize API payload using current state as baseline."""

    normalized = {
        "toggles": dict(base_state["toggles"]),
        "colors": dict(base_state["colors"]),
        "block_preset": normalize_block_preset_fn(
            base_state.get("block_preset"),
            base_state.get("block_presets", []),
        ),
        "block_presets": list(base_state.get("block_presets", [])),
        "heading_toc_preset": normalize_heading_toc_preset_fn(
            base_state.get("heading_toc_preset"),
            base_state.get("heading_toc_presets", []),
        ),
        "heading_toc_presets": list(base_state.get("heading_toc_presets", [])),
        body_font_size_id: normalize_body_font_size_value_fn(
            base_state.get(body_font_size_id, body_font_size_default)
        ),
        "class_config": normalize_class_config_map_fn(base_state.get("class_config", {})),
        "compile_target": base_state.get("compile_target", ""),
        "compile_recipe": base_state.get("compile_recipe", ""),
        "compile_use_internal_fallback": bool(
            base_state.get("compile_use_internal_fallback", True)
        ),
    }

    raw_toggles = payload.get("toggles", {})
    if isinstance(raw_toggles, dict):
        for key in toggle_ids:
            if key in raw_toggles:
                value = raw_toggles[key]
                if isinstance(value, bool):
                    normalized["toggles"][key] = value
                elif isinstance(value, str):
                    parsed = bool_from_str_fn(value)
                    if parsed is None:
                        raise ValueError(f"Invalid boolean value for {key}: {value}")
                    normalized["toggles"][key] = parsed
                else:
                    raise ValueError(f"Invalid boolean type for {key}")

    raw_colors = payload.get("colors", {})
    if isinstance(raw_colors, dict):
        for key in color_order:
            if key in raw_colors:
                parsed_hex = parse_hex_color_fn(str(raw_colors[key]))
                if not parsed_hex:
                    raise ValueError(f"Invalid hex color for {key}: {raw_colors[key]}")
                normalized["colors"][key] = parsed_hex

    if "block_preset" in payload:
        normalized["block_preset"] = normalize_block_preset_fn(
            payload.get("block_preset"),
            base_state.get("block_presets", []),
        )
    if "heading_toc_preset" in payload:
        normalized["heading_toc_preset"] = normalize_heading_toc_preset_fn(
            payload.get("heading_toc_preset"),
            base_state.get("heading_toc_presets", []),
        )
    if body_font_size_id in payload:
        normalized[body_font_size_id] = validate_body_font_size_value_fn(
            payload.get(body_font_size_id)
        )

    raw_class_config = payload.get("class_config", {})
    if isinstance(raw_class_config, dict):
        for field_id in class_config_ids:
            if field_id in raw_class_config:
                normalized["class_config"][field_id] = validate_class_config_value_fn(
                    field_id,
                    raw_class_config[field_id],
                )

    if "compile_target" in payload:
        normalized["compile_target"] = normalize_compile_target_fn(
            payload.get("compile_target"),
            base_state.get("compile_targets", list_candidate_tex_files_fn()),
        )
    if "compile_recipe" in payload:
        normalized["compile_recipe"] = normalize_compile_recipe_fn(
            payload.get("compile_recipe"),
            base_state.get("compile_recipes", []),
        )
    if "compile_use_internal_fallback" in payload:
        raw_mode = payload.get("compile_use_internal_fallback")
        if isinstance(raw_mode, bool):
            normalized["compile_use_internal_fallback"] = raw_mode
        elif isinstance(raw_mode, str):
            parsed = bool_from_str_fn(raw_mode)
            if parsed is None:
                raise ValueError(
                    f"Invalid boolean value for compile_use_internal_fallback: {raw_mode}"
                )
            normalized["compile_use_internal_fallback"] = parsed
        else:
            raise ValueError("Invalid boolean type for compile_use_internal_fallback")

    return normalized


def load_state(
    *,
    parse_theme_color_defaults_fn: Callable[[], Dict[str, str]],
    build_block_preset_catalog_fn: Callable[[Dict[str, str]], List[Dict[str, Any]]],
    block_preset_meta_fn: Callable[[List[Dict[str, Any]]], List[Dict[str, str]]],
    default_block_preset_id_fn: Callable[[List[Dict[str, Any]]], str],
    build_heading_toc_preset_catalog_fn: Callable[[Dict[str, str]], List[Dict[str, Any]]],
    heading_toc_preset_meta_fn: Callable[[List[Dict[str, Any]]], List[Dict[str, str]]],
    default_heading_toc_preset_id_fn: Callable[[List[Dict[str, Any]]], str],
    list_candidate_tex_files_fn: Callable[[], List[str]],
    load_vscode_recipe_catalog_fn: Callable[[], Dict[str, Any]],
    parse_main_toggle_defaults_fn: Callable[[], Dict[str, bool]],
    body_font_size_id: str,
    body_font_size_default: float,
    class_config_defaults: Dict[str, str],
    default_compile_target_fn: Callable[[List[str]], str],
    default_compile_recipe_fn: Callable[[List[Dict[str, Any]]], str],
    config_path: Path,
    parse_hex_color_fn: Callable[[str], str | None],
    normalize_block_preset_fn: Callable[[Any, List[Dict[str, Any]]], str],
    normalize_heading_toc_preset_fn: Callable[[Any, List[Dict[str, Any]]], str],
    normalize_body_font_size_value_fn: Callable[[Any], float],
    normalize_class_config_map_fn: Callable[[Dict[str, Any]], Dict[str, str]],
    normalize_compile_target_fn: Callable[[Any, List[str]], str],
    normalize_compile_recipe_fn: Callable[[Any, List[Dict[str, Any]]], str],
    bool_from_str_fn: Callable[[str], Any],
    toggle_override_path: Path,
    parse_toggle_override_file_fn: Callable[[Path], Dict[str, bool]],
    parse_class_override_file_fn: Callable[[Path], Dict[str, str]],
    parse_body_font_size_override_fn: Callable[[Path], Optional[float]],
    color_override_path: Path,
    parse_color_override_file_fn: Callable[[Path], Dict[str, str]],
    toggle_ids: List[str],
    color_order: List[str],
    class_config_ids: List[str],
    normalize_class_config_value_fn: Callable[[str, Any], str],
    coerce_class_mode_on_target_switch_fn: Callable[[Dict[str, Any], str, str], bool],
    refresh_derived_state_fn: Callable[[Dict[str, Any], Optional[Dict[str, Any]]], None],
    safe_workspace_pdf_relpath_fn: Callable[[Any], str],
) -> Dict[str, Any]:
    """Build runtime state from defaults + persisted UI state + override files."""

    theme_defaults = parse_theme_color_defaults_fn()
    block_preset_catalog = build_block_preset_catalog_fn(theme_defaults)
    block_presets = block_preset_meta_fn(block_preset_catalog)
    default_block_preset = default_block_preset_id_fn(block_presets)
    heading_toc_preset_catalog = build_heading_toc_preset_catalog_fn(theme_defaults)
    heading_toc_presets = heading_toc_preset_meta_fn(heading_toc_preset_catalog)
    default_heading_toc_preset = default_heading_toc_preset_id_fn(heading_toc_presets)
    compile_targets = list_candidate_tex_files_fn()
    recipe_catalog = load_vscode_recipe_catalog_fn()
    compile_recipes = recipe_catalog.get("recipes", [])
    state = {
        "toggles": parse_main_toggle_defaults_fn(),
        "colors": dict(theme_defaults),
        "block_preset": default_block_preset,
        "block_presets": block_presets,
        "heading_toc_preset": default_heading_toc_preset,
        "heading_toc_presets": heading_toc_presets,
        body_font_size_id: body_font_size_default,
        "class_config": dict(class_config_defaults),
        "compile_target": default_compile_target_fn(compile_targets),
        "compile_recipe": default_compile_recipe_fn(compile_recipes),
        "compile_use_internal_fallback": True,
        "compile_output_pdf": "",
        "compile_output_pdf_expected": "",
        "compile_last_compile_at": "",
        "compile_last_success": None,
    }
    persisted_output_pdf = ""
    persisted_output_pdf_expected = ""
    persisted_last_compile_at = ""
    persisted_last_success: Optional[bool] = None
    persisted_compile_target_raw = ""
    compile_target_recovered = False

    if config_path.exists():
        try:
            persisted = json.loads(config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            persisted = {}
        if isinstance(persisted, dict):
            for key, value in persisted.get("toggles", {}).items():
                if key in state["toggles"]:
                    state["toggles"][key] = bool(value)
            for key, value in persisted.get("colors", {}).items():
                if key in state["colors"]:
                    parsed = parse_hex_color_fn(str(value))
                    if parsed:
                        state["colors"][key] = parsed
            if "block_preset" in persisted:
                try:
                    state["block_preset"] = normalize_block_preset_fn(
                        persisted.get("block_preset"),
                        block_presets,
                    )
                except ValueError:
                    state["block_preset"] = default_block_preset
            if "heading_toc_preset" in persisted:
                try:
                    state["heading_toc_preset"] = normalize_heading_toc_preset_fn(
                        persisted.get("heading_toc_preset"),
                        heading_toc_presets,
                    )
                except ValueError:
                    state["heading_toc_preset"] = default_heading_toc_preset
            if body_font_size_id in persisted:
                state[body_font_size_id] = normalize_body_font_size_value_fn(
                    persisted.get(body_font_size_id)
                )
            state["class_config"] = normalize_class_config_map_fn(
                persisted.get("class_config", state["class_config"])
            )
            if "compile_target" in persisted:
                persisted_compile_target_raw = str(persisted.get("compile_target", ""))
                try:
                    state["compile_target"] = normalize_compile_target_fn(
                        persisted.get("compile_target"),
                        compile_targets,
                    )
                except ValueError:
                    state["compile_target"] = default_compile_target_fn(compile_targets)
                    compile_target_recovered = True
            if "compile_recipe" in persisted:
                try:
                    state["compile_recipe"] = normalize_compile_recipe_fn(
                        persisted.get("compile_recipe"),
                        compile_recipes,
                    )
                except ValueError:
                    state["compile_recipe"] = default_compile_recipe_fn(compile_recipes)
            if "compile_use_internal_fallback" in persisted:
                raw_mode = persisted.get("compile_use_internal_fallback")
                if isinstance(raw_mode, bool):
                    state["compile_use_internal_fallback"] = raw_mode
                elif isinstance(raw_mode, str):
                    parsed = bool_from_str_fn(raw_mode)
                    if parsed is not None:
                        state["compile_use_internal_fallback"] = parsed
            if isinstance(persisted.get("compile_output_pdf"), str):
                persisted_output_pdf = persisted.get("compile_output_pdf", "")
            if isinstance(persisted.get("compile_output_pdf_expected"), str):
                persisted_output_pdf_expected = persisted.get("compile_output_pdf_expected", "")
            if isinstance(persisted.get("compile_last_compile_at"), str):
                persisted_last_compile_at = persisted.get("compile_last_compile_at", "")
            if isinstance(persisted.get("compile_last_success"), bool):
                persisted_last_success = persisted.get("compile_last_success")

    if toggle_override_path.exists():
        state["toggles"].update(parse_toggle_override_file_fn(toggle_override_path))
        state["class_config"].update(parse_class_override_file_fn(toggle_override_path))
        parsed_body_font_size = parse_body_font_size_override_fn(toggle_override_path)
        if parsed_body_font_size is not None:
            state[body_font_size_id] = parsed_body_font_size
    if color_override_path.exists():
        state["colors"].update(parse_color_override_file_fn(color_override_path))

    for key in toggle_ids:
        state["toggles"].setdefault(key, True)
    for key in color_order:
        state["colors"].setdefault(key, "#808080")
    state["block_preset"] = normalize_block_preset_fn(
        state.get("block_preset"),
        block_presets,
    )
    state["heading_toc_preset"] = normalize_heading_toc_preset_fn(
        state.get("heading_toc_preset"),
        heading_toc_presets,
    )
    state[body_font_size_id] = normalize_body_font_size_value_fn(
        state.get(body_font_size_id, body_font_size_default)
    )

    state["compile_targets"] = compile_targets
    state["compile_recipes"] = compile_recipes
    state["compile_recipe_errors"] = recipe_catalog.get("errors", [])
    for field_id in class_config_ids:
        state["class_config"][field_id] = normalize_class_config_value_fn(
            field_id,
            state["class_config"].get(field_id, class_config_defaults[field_id]),
        )
    if compile_target_recovered:
        coerce_class_mode_on_target_switch_fn(
            state,
            persisted_compile_target_raw,
            str(state.get("compile_target", "")),
        )

    refresh_derived_state_fn(state, recipe_catalog)
    expected_output_pdf = str(state.get("compile_output_pdf_expected", "main.pdf"))
    state["compile_output_pdf"] = expected_output_pdf
    maybe_persisted_output = safe_workspace_pdf_relpath_fn(persisted_output_pdf)
    maybe_persisted_expected = safe_workspace_pdf_relpath_fn(persisted_output_pdf_expected)
    if maybe_persisted_output and maybe_persisted_expected == expected_output_pdf:
        state["compile_output_pdf"] = maybe_persisted_output
    state["compile_last_compile_at"] = persisted_last_compile_at
    state["compile_last_success"] = persisted_last_success

    return state


def persist_ui_state(
    state: Dict[str, Any],
    *,
    config_path: Path,
    body_font_size_id: str,
    body_font_size_default: float,
    normalize_body_font_size_value_fn: Callable[[Any], float],
    normalize_class_config_map_fn: Callable[[Dict[str, Any]], Dict[str, str]],
) -> None:
    ui_state = {
        "toggles": state.get("toggles", {}),
        "colors": state.get("colors", {}),
        "block_preset": state.get("block_preset", "default"),
        "heading_toc_preset": state.get("heading_toc_preset", "default"),
        body_font_size_id: normalize_body_font_size_value_fn(
            state.get(body_font_size_id, body_font_size_default)
        ),
        "class_config": normalize_class_config_map_fn(state.get("class_config", {})),
        "compile_target": state.get("compile_target", ""),
        "compile_recipe": state.get("compile_recipe", ""),
        "compile_use_internal_fallback": bool(
            state.get("compile_use_internal_fallback", True)
        ),
        "compile_output_pdf": state.get("compile_output_pdf", ""),
        "compile_output_pdf_expected": state.get("compile_output_pdf_expected", ""),
        "compile_last_compile_at": state.get("compile_last_compile_at", ""),
        "compile_last_success": state.get("compile_last_success"),
    }
    config_path.write_text(
        json.dumps(ui_state, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def write_override_files(
    state: Dict[str, Any],
    *,
    body_font_size_id: str,
    body_font_size_default: float,
    parse_theme_color_defaults_fn: Callable[[], Dict[str, str]],
    block_preset_meta_fn: Callable[[List[Dict[str, Any]]], List[Dict[str, str]]],
    build_block_preset_catalog_fn: Callable[[Dict[str, str]], List[Dict[str, Any]]],
    normalize_block_preset_fn: Callable[[Any, List[Dict[str, Any]]], str],
    heading_toc_preset_meta_fn: Callable[[List[Dict[str, Any]]], List[Dict[str, str]]],
    build_heading_toc_preset_catalog_fn: Callable[[Dict[str, str]], List[Dict[str, Any]]],
    normalize_heading_toc_preset_fn: Callable[[Any, List[Dict[str, Any]]], str],
    normalize_body_font_size_value_fn: Callable[[Any], float],
    normalize_class_config_map_fn: Callable[[Dict[str, Any]], Dict[str, str]],
    refresh_derived_state_fn: Callable[[Dict[str, Any]], None],
    persist_ui_state_fn: Callable[[Dict[str, Any]], None],
    format_body_font_size_fn: Callable[[float], str],
    toggle_schema: List[Dict[str, str]],
    toggle_override_path: Path,
    class_config_ids: List[str],
    class_config_commands: Dict[str, str],
    color_order: List[str],
    color_override_path: Path,
) -> None:
    block_presets = state.get("block_presets", [])
    if not isinstance(block_presets, list) or not block_presets:
        block_presets = block_preset_meta_fn(
            build_block_preset_catalog_fn(parse_theme_color_defaults_fn())
        )
    state["block_presets"] = block_presets
    state["block_preset"] = normalize_block_preset_fn(
        state.get("block_preset"),
        block_presets,
    )
    heading_toc_presets = state.get("heading_toc_presets", [])
    if not isinstance(heading_toc_presets, list) or not heading_toc_presets:
        heading_toc_presets = heading_toc_preset_meta_fn(
            build_heading_toc_preset_catalog_fn(parse_theme_color_defaults_fn())
        )
    state["heading_toc_presets"] = heading_toc_presets
    state["heading_toc_preset"] = normalize_heading_toc_preset_fn(
        state.get("heading_toc_preset"),
        heading_toc_presets,
    )
    state[body_font_size_id] = normalize_body_font_size_value_fn(
        state.get(body_font_size_id, body_font_size_default)
    )
    state["class_config"] = normalize_class_config_map_fn(state.get("class_config", {}))
    refresh_derived_state_fn(state)
    persist_ui_state_fn(state)

    toggle_lines = [
        "% Auto-generated by tools/theme_designer.py",
        "% Delete this file to return to defaults in main.tex.",
    ]
    for entry in toggle_schema:
        value = "true" if state["toggles"][entry["id"]] else "false"
        toggle_lines.append(f"\\{entry['command']}{value}")
    toggle_lines.append("")
    toggle_lines.append("% Class-aware options for theme.sty and theorems.tex.")
    for field_id in class_config_ids:
        command = class_config_commands[field_id]
        value = state["class_config"][field_id]
        toggle_lines.append(f"\\def\\{command}{{{value}}}")
    toggle_lines.append("")
    toggle_lines.append("% Base body font size in pt.")
    toggle_lines.append(
        f"\\def\\ThemeBodyFontSizePt{{{format_body_font_size_fn(state[body_font_size_id])}}}"
    )
    toggle_override_path.write_text("\n".join(toggle_lines) + "\n", encoding="utf-8")

    color_lines = [
        "% Auto-generated by tools/theme_designer.py",
        "% Delete this file to return to defaults in theme.sty.",
    ]
    for token in color_order:
        alias = "themeui" + re.sub(r"[^A-Za-z0-9]+", "", token)
        hex_value = state["colors"][token].lstrip("#").upper()
        color_lines.append(f"\\definecolor{{{alias}}}{{HTML}}{{{hex_value}}}")
        color_lines.append(f"\\colorlet{{{token}}}{{{alias}}}")
    color_override_path.write_text("\n".join(color_lines) + "\n", encoding="utf-8")


def delete_override_files(
    *,
    config_path: Path,
    toggle_override_path: Path,
    color_override_path: Path,
) -> None:
    for path in (config_path, toggle_override_path, color_override_path):
        if path.exists():
            path.unlink()
