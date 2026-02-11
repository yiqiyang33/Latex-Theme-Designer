#!/usr/bin/env python3
"""Document-class detection helpers extracted from theme_designer_core."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Optional, Tuple


def extract_documentclass_declaration(
    tex_path: Path,
    *,
    read_text_fn: Callable[[Path], str],
    documentclass_pattern: Any,
) -> Tuple[str, str]:
    text = read_text_fn(tex_path)
    match = documentclass_pattern.search(text)
    if not match:
        return "", ""
    raw_name = str(match.group("class") or "").strip()
    if "," in raw_name:
        raw_name = raw_name.split(",", 1)[0]
    class_name = raw_name.strip().lower()
    raw_options = str(match.group("options") or "").strip()
    return class_name, raw_options


def resolve_subfiles_parent_tex(
    tex_path: Path,
    class_options: str,
    *,
    root_dir: Path,
    is_subpath_fn: Callable[[Path, Path], bool],
) -> Optional[Path]:
    raw = str(class_options or "").strip()
    if not raw:
        return None
    root_hint = raw.split(",", 1)[0].strip()
    if not root_hint:
        return None

    hinted_path = Path(root_hint.replace("\\", "/"))
    if not hinted_path.suffix:
        hinted_path = hinted_path.with_suffix(".tex")
    if hinted_path.is_absolute():
        candidate = hinted_path.resolve()
    else:
        candidate = (tex_path.parent / hinted_path).resolve()
    if not candidate.exists() or not candidate.is_file():
        return None
    if not is_subpath_fn(candidate, root_dir.resolve()):
        return None
    return candidate


def extract_documentclass_name(
    tex_path: Path,
    *,
    extract_documentclass_declaration_fn: Callable[[Path], Tuple[str, str]],
    resolve_subfiles_parent_tex_fn: Callable[[Path, str], Optional[Path]],
    _visited: Optional[set[Path]] = None,
) -> str:
    visited: set[Path] = set(_visited or set())
    try:
        resolved_tex_path = tex_path.resolve()
    except OSError:
        resolved_tex_path = tex_path
    if resolved_tex_path in visited:
        return ""
    visited.add(resolved_tex_path)

    class_name, class_options = extract_documentclass_declaration_fn(resolved_tex_path)
    if class_name != "subfiles":
        return class_name
    parent_tex = resolve_subfiles_parent_tex_fn(resolved_tex_path, class_options)
    if parent_tex is None:
        return class_name
    resolved_parent = extract_documentclass_name(
        parent_tex,
        extract_documentclass_declaration_fn=extract_documentclass_declaration_fn,
        resolve_subfiles_parent_tex_fn=resolve_subfiles_parent_tex_fn,
        _visited=visited,
    )
    return resolved_parent or class_name


def extract_documentclass_name_raw(
    tex_path: Path,
    *,
    read_text_fn: Callable[[Path], str],
    documentclass_pattern: Any,
) -> str:
    text = read_text_fn(tex_path)
    match = documentclass_pattern.search(text)
    if not match:
        return ""
    raw_name = str(match.group("class") or "").strip()
    if "," in raw_name:
        raw_name = raw_name.split(",", 1)[0]
    return raw_name.strip().lower()


def detect_target_documentclass(
    compile_target: str,
    *,
    resolve_compile_context_fn: Callable[[str], Any],
    extract_documentclass_name_fn: Callable[[Path], str],
) -> str:
    if not compile_target:
        return ""
    try:
        target_abs = resolve_compile_context_fn(compile_target).target_abs
    except ValueError:
        return ""
    return extract_documentclass_name_fn(target_abs)


def has_documentclass(
    tex_path: Path,
    *,
    extract_documentclass_name_raw_fn: Callable[[Path], str],
) -> bool:
    return bool(extract_documentclass_name_raw_fn(tex_path))
