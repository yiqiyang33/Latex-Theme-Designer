#!/usr/bin/env python3
"""Starter-template helpers extracted from theme_designer_core."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple


def starter_template_catalog(
    *,
    template_definitions: List[Dict[str, str]],
    template_dir: Path,
) -> Dict[str, Dict[str, Any]]:
    catalog: Dict[str, Dict[str, Any]] = {}
    for entry in template_definitions:
        template_id = str(entry.get("id", "")).strip()
        label = str(entry.get("label", "")).strip()
        description = str(entry.get("description", "")).strip()
        filename = str(entry.get("filename", "")).strip()
        if not template_id or not filename:
            continue
        path = template_dir / filename
        if not path.exists() or not path.is_file():
            continue
        catalog[template_id] = {
            "id": template_id,
            "label": label or template_id,
            "description": description,
            "path": path,
            "filename": filename,
        }
    return catalog


def starter_template_meta(
    catalog: Dict[str, Dict[str, Any]],
    *,
    template_definitions: List[Dict[str, str]],
) -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    for entry in template_definitions:
        template_id = str(entry.get("id", "")).strip()
        if not template_id:
            continue
        meta = catalog.get(template_id)
        if not meta:
            continue
        items.append(
            {
                "id": template_id,
                "label": str(meta.get("label", template_id)),
                "description": str(meta.get("description", "")),
            }
        )
    return items


def default_starter_template_id(starter_templates: List[Dict[str, str]]) -> str:
    template_ids = {str(item.get("id", "")) for item in starter_templates}
    if "book-minimal" in template_ids:
        return "book-minimal"
    return str(starter_templates[0].get("id", "")) if starter_templates else ""


def normalize_starter_template(
    raw_template: Any,
    starter_templates: List[Dict[str, str]],
    *,
    default_starter_template_id_fn: Callable[[List[Dict[str, str]]], str],
) -> str:
    if not starter_templates:
        raise ValueError("No starter templates available under templates/.")

    selected = str(raw_template).strip() if raw_template is not None else ""
    if not selected:
        return default_starter_template_id_fn(starter_templates)

    valid_ids = {str(item.get("id", "")) for item in starter_templates}
    if selected in valid_ids:
        return selected
    raise ValueError(f"Unknown starter template: {selected}")


def normalize_starter_output_target(
    raw_target: Any,
    *,
    default_output_target: str,
    root_dir: Path,
    is_subpath_fn: Callable[[Path, Path], bool],
) -> str:
    target = str(raw_target).strip() if raw_target is not None else ""
    if not target:
        target = default_output_target
    target = target.replace("\\", "/")

    target_path = Path(target)
    if target_path.is_absolute():
        raise ValueError("Output target must be workspace-relative.")
    if target_path.suffix:
        if target_path.suffix.lower() != ".tex":
            raise ValueError("Output target must end with .tex.")
    else:
        target_path = target_path.with_suffix(".tex")

    resolved = (root_dir / target_path).resolve()
    if not is_subpath_fn(resolved, root_dir.resolve()):
        raise ValueError("Output target is outside workspace.")
    return resolved.relative_to(root_dir).as_posix()


def generate_starter_template_file(
    template_id: Any,
    output_target: Any,
    overwrite: bool,
    *,
    template_definitions: List[Dict[str, str]],
    template_dir: Path,
    root_dir: Path,
    default_output_target: str,
    is_subpath_fn: Callable[[Path, Path], bool],
    read_text_fn: Callable[[Path], str],
) -> Tuple[str, bool]:
    catalog = starter_template_catalog(
        template_definitions=template_definitions,
        template_dir=template_dir,
    )
    starter_templates = starter_template_meta(
        catalog,
        template_definitions=template_definitions,
    )
    selected = normalize_starter_template(
        template_id,
        starter_templates,
        default_starter_template_id_fn=default_starter_template_id,
    )
    normalized_target = normalize_starter_output_target(
        output_target,
        default_output_target=default_output_target,
        root_dir=root_dir,
        is_subpath_fn=is_subpath_fn,
    )
    target_abs = (root_dir / normalized_target).resolve()

    template_path = Path(str(catalog[selected]["path"]))
    template_text = read_text_fn(template_path)
    if not template_text.strip():
        raise ValueError(f"Starter template is empty: {template_path.name}")

    overwritten = False
    if target_abs.exists():
        if target_abs.is_dir():
            raise ValueError(f"Output target is a directory: {normalized_target}")
        if not overwrite:
            raise ValueError(
                f"Output target already exists: {normalized_target}. "
                "Set overwrite=true to replace it."
            )
        overwritten = True

    target_abs.parent.mkdir(parents=True, exist_ok=True)
    target_abs.write_text(template_text, encoding="utf-8")
    return normalized_target, overwritten


def bootstrap_starter_template(
    template_id: Any,
    output_target: Any,
    overwrite: bool,
    *,
    default_output_target: str,
    generate_starter_template_file_fn: Callable[[Any, Any, bool], Tuple[str, bool]],
    load_state_fn: Callable[[], Dict[str, Any]],
    apply_compile_preferences_fn: Callable[..., None],
    persist_ui_state_fn: Callable[[Dict[str, Any]], None],
    build_response_state_fn: Callable[[], Dict[str, Any]],
) -> Tuple[Dict[str, Any], str, bool]:
    generated_target, overwritten = generate_starter_template_file_fn(
        template_id,
        output_target if output_target is not None else default_output_target,
        overwrite,
    )
    state = load_state_fn()
    compile_targets = state.get("compile_targets", [])
    if generated_target not in compile_targets:
        raise ValueError(
            "Generated file is not discoverable as compile target. "
            "Ensure it contains a valid \\documentclass declaration."
        )
    apply_compile_preferences_fn(state, compile_target=generated_target)
    persist_ui_state_fn(state)
    return build_response_state_fn(), generated_target, overwritten
