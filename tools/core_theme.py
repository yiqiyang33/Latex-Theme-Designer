#!/usr/bin/env python3
"""Theme/color parsing helpers extracted from theme_designer_core."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Callable, Dict, Optional, Tuple


def bool_from_str(raw: str) -> Optional[bool]:
    lowered = raw.strip().lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    return None


def hex_from_rgb(rgb: Tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def blend_rgb(
    left: Tuple[int, int, int],
    right: Tuple[int, int, int],
    left_weight: float,
) -> Tuple[int, int, int]:
    lw = max(0.0, min(1.0, left_weight))
    rw = 1.0 - lw
    return (
        int(round(left[0] * lw + right[0] * rw)),
        int(round(left[1] * lw + right[1] * rw)),
        int(round(left[2] * lw + right[2] * rw)),
    )


def parse_hex_color(raw: str) -> Optional[str]:
    value = raw.strip()
    if re.fullmatch(r"#?[0-9A-Fa-f]{6}", value):
        return "#" + value.lstrip("#").upper()
    return None


def format_body_font_size(value: float) -> str:
    return f"{value:.1f}"


def parse_theme_color_defaults(
    *,
    theme_sty_path: Path,
    read_text_fn: Callable[[Path], str],
    color_set: set[str],
    color_order: list[str],
    base_colors: Dict[str, Tuple[int, int, int]],
    parse_hex_color_fn: Callable[[str], Optional[str]],
    blend_rgb_fn: Callable[[Tuple[int, int, int], Tuple[int, int, int], float], Tuple[int, int, int]],
    hex_from_rgb_fn: Callable[[Tuple[int, int, int]], str],
) -> Dict[str, str]:
    theme_text = read_text_fn(theme_sty_path)
    defined_colors = {
        name.lower(): (
            int(hex_value[0:2], 16),
            int(hex_value[2:4], 16),
            int(hex_value[4:6], 16),
        )
        for name, hex_value in re.findall(
            r"\\definecolor\{([^}]+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}",
            theme_text,
        )
    }
    colorlet_pairs = re.findall(r"\\colorlet\{([^}]+)\}\{([^}]+)\}", theme_text)
    expr_map: Dict[str, str] = {}
    for key, expr in colorlet_pairs:
        if key in color_set:
            expr_map[key] = expr.strip()

    cache: Dict[str, Tuple[int, int, int]] = {}

    def resolve_expr(expr: str, depth: int = 0) -> Tuple[int, int, int]:
        expr = expr.strip()
        if depth > 8:
            return (128, 128, 128)

        parsed_hex = parse_hex_color_fn(expr)
        if parsed_hex:
            h = parsed_hex.lstrip("#")
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

        lowered = expr.lower()
        if lowered in base_colors:
            return base_colors[lowered]
        if lowered in defined_colors:
            return defined_colors[lowered]

        if expr in expr_map:
            return resolve_token(expr, depth + 1)

        if "!" in expr:
            parts = [chunk.strip() for chunk in expr.split("!") if chunk.strip()]
            if len(parts) >= 3 and len(parts) % 2 == 1:
                mixed = resolve_expr(parts[0], depth + 1)
                for idx in range(1, len(parts), 2):
                    try:
                        percent = float(parts[idx]) / 100.0
                    except ValueError:
                        return (128, 128, 128)
                    right = resolve_expr(parts[idx + 1], depth + 1)
                    mixed = blend_rgb_fn(mixed, right, percent)
                return mixed

        return (128, 128, 128)

    def resolve_token(token: str, depth: int = 0) -> Tuple[int, int, int]:
        if token in cache:
            return cache[token]
        expr = expr_map.get(token)
        if expr is None:
            rgb = (128, 128, 128)
        else:
            rgb = resolve_expr(expr, depth + 1)
        cache[token] = rgb
        return rgb

    defaults: Dict[str, str] = {}
    for token in color_order:
        defaults[token] = hex_from_rgb_fn(resolve_token(token))
    return defaults
