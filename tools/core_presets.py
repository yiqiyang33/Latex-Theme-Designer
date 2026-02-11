#!/usr/bin/env python3
"""Theme preset helpers extracted from theme_designer_core."""

from __future__ import annotations

from typing import Any, Callable, Dict, List


def build_block_preset_catalog(
    theme_defaults: Dict[str, str],
    *,
    block_preset_definitions: List[Dict[str, Any]],
    block_color_tokens: List[str],
    parse_hex_color_fn: Callable[[str], str | None],
) -> List[Dict[str, Any]]:
    catalog: List[Dict[str, Any]] = []
    for preset in block_preset_definitions:
        preset_id = str(preset.get("id", "")).strip()
        if not preset_id:
            continue
        token_map: Dict[str, str] = {
            token: parse_hex_color_fn(str(theme_defaults.get(token, "#808080"))) or "#808080"
            for token in block_color_tokens
        }
        raw_colors = preset.get("colors", {})
        if isinstance(raw_colors, dict):
            for token in block_color_tokens:
                if token not in raw_colors:
                    continue
                parsed = parse_hex_color_fn(str(raw_colors[token]))
                if parsed:
                    token_map[token] = parsed
        catalog.append(
            {
                "id": preset_id,
                "label": str(preset.get("label", preset_id)),
                "description": str(preset.get("description", "")),
                "tokens": token_map,
            }
        )
    return catalog


def build_heading_toc_preset_catalog(
    theme_defaults: Dict[str, str],
    *,
    heading_toc_preset_definitions: List[Dict[str, Any]],
    document_color_tokens: List[str],
    parse_hex_color_fn: Callable[[str], str | None],
) -> List[Dict[str, Any]]:
    catalog: List[Dict[str, Any]] = []
    for preset in heading_toc_preset_definitions:
        preset_id = str(preset.get("id", "")).strip()
        if not preset_id:
            continue
        token_map: Dict[str, str] = {
            token: parse_hex_color_fn(str(theme_defaults.get(token, "#808080"))) or "#808080"
            for token in document_color_tokens
        }
        raw_colors = preset.get("colors", {})
        if isinstance(raw_colors, dict):
            for token in document_color_tokens:
                if token not in raw_colors:
                    continue
                parsed = parse_hex_color_fn(str(raw_colors[token]))
                if parsed:
                    token_map[token] = parsed
        catalog.append(
            {
                "id": preset_id,
                "label": str(preset.get("label", preset_id)),
                "description": str(preset.get("description", "")),
                "tokens": token_map,
            }
        )
    return catalog


def preset_meta(catalog: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    return [
        {
            "id": str(entry.get("id", "")),
            "label": str(entry.get("label", entry.get("id", ""))),
            "description": str(entry.get("description", "")),
        }
        for entry in catalog
        if str(entry.get("id", "")).strip()
    ]


def default_preset_id(presets: List[Dict[str, Any]], *, default_id: str = "default") -> str:
    if not isinstance(presets, list):
        return default_id
    for item in presets:
        if str(item.get("id", "")).strip() == default_id:
            return default_id
    if presets:
        return str(presets[0].get("id", default_id))
    return default_id


def normalize_block_preset(raw_preset: Any, block_presets: List[Dict[str, Any]]) -> str:
    if not isinstance(block_presets, list):
        block_presets = []
    valid_ids = {
        str(item.get("id", "")).strip()
        for item in block_presets
        if str(item.get("id", "")).strip()
    }
    default_id = default_preset_id(block_presets)
    if not valid_ids:
        return default_id
    preset_id = str(raw_preset).strip() if raw_preset is not None else ""
    if not preset_id:
        return default_id
    if preset_id in valid_ids:
        return preset_id
    raise ValueError(
        f"Unknown block preset: {preset_id}. Expected one of: {', '.join(sorted(valid_ids))}"
    )


def normalize_heading_toc_preset(
    raw_preset: Any,
    heading_toc_presets: List[Dict[str, Any]],
) -> str:
    if not isinstance(heading_toc_presets, list):
        heading_toc_presets = []
    valid_ids = {
        str(item.get("id", "")).strip()
        for item in heading_toc_presets
        if str(item.get("id", "")).strip()
    }
    default_id = default_preset_id(heading_toc_presets)
    if not valid_ids:
        return default_id
    preset_id = str(raw_preset).strip() if raw_preset is not None else ""
    if not preset_id:
        return default_id
    if preset_id in valid_ids:
        return preset_id
    raise ValueError(
        "Unknown heading/TOC preset: "
        f"{preset_id}. Expected one of: {', '.join(sorted(valid_ids))}"
    )


def block_preset_tokens_by_id(
    preset_id: str,
    catalog: List[Dict[str, Any]],
    *,
    block_color_tokens: List[str],
    parse_hex_color_fn: Callable[[str], str | None],
) -> Dict[str, str]:
    for item in catalog:
        if str(item.get("id", "")).strip() != preset_id:
            continue
        raw_tokens = item.get("tokens", {})
        if not isinstance(raw_tokens, dict):
            break
        parsed: Dict[str, str] = {}
        for token in block_color_tokens:
            maybe = parse_hex_color_fn(str(raw_tokens.get(token, "")))
            if maybe:
                parsed[token] = maybe
        if len(parsed) == len(block_color_tokens):
            return parsed
    raise ValueError(f"Block preset token map not found for: {preset_id}")


def heading_toc_preset_tokens_by_id(
    preset_id: str,
    catalog: List[Dict[str, Any]],
    *,
    document_color_tokens: List[str],
    parse_hex_color_fn: Callable[[str], str | None],
) -> Dict[str, str]:
    for item in catalog:
        if str(item.get("id", "")).strip() != preset_id:
            continue
        raw_tokens = item.get("tokens", {})
        if not isinstance(raw_tokens, dict):
            break
        parsed: Dict[str, str] = {}
        for token in document_color_tokens:
            maybe = parse_hex_color_fn(str(raw_tokens.get(token, "")))
            if maybe:
                parsed[token] = maybe
        if len(parsed) == len(document_color_tokens):
            return parsed
    raise ValueError(f"Heading/TOC preset token map not found for: {preset_id}")


def apply_block_preset(
    state: Dict[str, Any],
    preset_id: Any,
    *,
    parse_theme_color_defaults_fn: Callable[[], Dict[str, str]],
    build_block_preset_catalog_fn: Callable[[Dict[str, str]], List[Dict[str, Any]]],
    block_preset_meta_fn: Callable[[List[Dict[str, Any]]], List[Dict[str, str]]],
    normalize_block_preset_fn: Callable[[Any, List[Dict[str, Any]]], str],
    block_preset_tokens_by_id_fn: Callable[[str, List[Dict[str, Any]]], Dict[str, str]],
) -> None:
    theme_defaults = parse_theme_color_defaults_fn()
    catalog = build_block_preset_catalog_fn(theme_defaults)
    block_presets = block_preset_meta_fn(catalog)
    normalized_preset = normalize_block_preset_fn(preset_id, block_presets)
    token_map = block_preset_tokens_by_id_fn(normalized_preset, catalog)
    state.setdefault("colors", {})
    for token, value in token_map.items():
        state["colors"][token] = value
    state["block_preset"] = normalized_preset
    state["block_presets"] = block_presets


def apply_heading_toc_preset(
    state: Dict[str, Any],
    preset_id: Any,
    *,
    parse_theme_color_defaults_fn: Callable[[], Dict[str, str]],
    build_heading_toc_preset_catalog_fn: Callable[[Dict[str, str]], List[Dict[str, Any]]],
    heading_toc_preset_meta_fn: Callable[[List[Dict[str, Any]]], List[Dict[str, str]]],
    normalize_heading_toc_preset_fn: Callable[[Any, List[Dict[str, Any]]], str],
    heading_toc_preset_tokens_by_id_fn: Callable[[str, List[Dict[str, Any]]], Dict[str, str]],
) -> None:
    theme_defaults = parse_theme_color_defaults_fn()
    catalog = build_heading_toc_preset_catalog_fn(theme_defaults)
    heading_toc_presets = heading_toc_preset_meta_fn(catalog)
    normalized_preset = normalize_heading_toc_preset_fn(preset_id, heading_toc_presets)
    token_map = heading_toc_preset_tokens_by_id_fn(normalized_preset, catalog)
    state.setdefault("colors", {})
    for token, value in token_map.items():
        state["colors"][token] = value
    state["heading_toc_preset"] = normalized_preset
    state["heading_toc_presets"] = heading_toc_presets

