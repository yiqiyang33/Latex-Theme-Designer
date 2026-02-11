#!/usr/bin/env python3
"""Path guard and workspace path normalization helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Optional, Tuple


def is_subpath(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def resolve_workspace_pdf(
    rel_path: str,
    *,
    root_dir: Path,
    is_subpath_fn: Callable[[Path, Path], bool],
) -> Tuple[Path, str]:
    path_obj = Path(rel_path)
    if path_obj.suffix.lower() != ".pdf":
        raise ValueError("PDF path must end with .pdf")

    if path_obj.is_absolute():
        resolved = path_obj.resolve()
    else:
        resolved = (root_dir / path_obj).resolve()
    if not is_subpath_fn(resolved, root_dir.resolve()):
        raise ValueError("PDF path is outside workspace.")

    return resolved, resolved.relative_to(root_dir).as_posix()


def safe_workspace_pdf_relpath(
    raw_path: Any,
    *,
    resolve_workspace_pdf_fn: Callable[[str], Tuple[Path, str]],
) -> str:
    """Best-effort normalize of workspace-relative PDF path."""

    try:
        _, rel = resolve_workspace_pdf_fn(str(raw_path))
        return rel
    except (TypeError, ValueError):
        return ""


def safe_workspace_relpath(
    path: Optional[Path],
    *,
    root_dir: Path,
    is_subpath_fn: Callable[[Path, Path], bool],
) -> str:
    if path is None:
        return ""
    try:
        resolved = path.resolve()
    except OSError:
        resolved = path
    if is_subpath_fn(resolved, root_dir.resolve()):
        return resolved.relative_to(root_dir).as_posix()
    return resolved.as_posix()

