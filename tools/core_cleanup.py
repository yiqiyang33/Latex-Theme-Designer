#!/usr/bin/env python3
"""Build artifact cleanup helpers for the toolkit UI/server."""

from __future__ import annotations

import fnmatch
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Sequence

DEFAULT_CLEAN_FILE_PATTERNS: List[str] = [
    "*.aux",
    "*.bbl",
    "*.blg",
    "*.idx",
    "*.ind",
    "*.lof",
    "*.lot",
    "*.out",
    "*.toc",
    "*.acn",
    "*.acr",
    "*.alg",
    "*.glg",
    "*.glo",
    "*.gls",
    "*.ist",
    "*.fls",
    "*.log",
    "*.fdb_latexmk",
]

DEFAULT_PROTECTED_PATTERNS: List[str] = [
    "*.pdf",
    "*.synctex.gz",
]


def _normalize_pattern_list(raw_patterns: Iterable[Any]) -> List[str]:
    normalized: List[str] = []
    seen: set[str] = set()
    for item in raw_patterns:
        if not isinstance(item, str):
            continue
        value = item.strip()
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def normalize_clean_patterns(
    raw_patterns: Any,
    *,
    fallback_patterns: Sequence[str],
) -> List[str]:
    if isinstance(raw_patterns, list):
        patterns = _normalize_pattern_list(raw_patterns)
        if patterns:
            return patterns
    return _normalize_pattern_list(list(fallback_patterns))


def clean_patterns_from_vscode_settings(
    vscode_settings: Dict[str, Any],
    *,
    fallback_patterns: Sequence[str] = DEFAULT_CLEAN_FILE_PATTERNS,
) -> List[str]:
    raw = vscode_settings.get("latex-workshop.latex.clean.fileTypes", [])
    return normalize_clean_patterns(raw, fallback_patterns=fallback_patterns)


def _normalize_scope_dirs(raw_scope_dirs: Sequence[Any]) -> List[str]:
    normalized: List[str] = []
    seen: set[str] = set()
    for item in raw_scope_dirs:
        raw = "." if item is None else str(item).strip()
        value = raw or "."
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized or ["."]


def _iter_scope_matches(scope_dir: Path, pattern: str, recursive: bool) -> Iterable[Path]:
    if recursive:
        yield from scope_dir.rglob(pattern)
    else:
        yield from scope_dir.glob(pattern)


def clean_build_artifacts(
    *,
    root_dir: Path,
    scope_dirs: Sequence[str],
    patterns: Sequence[str],
    protected_patterns: Sequence[str],
    dry_run: bool,
    is_subpath_fn: Callable[[Path, Path], bool],
) -> Dict[str, Any]:
    resolved_root = root_dir.resolve()
    normalized_scope = _normalize_scope_dirs(scope_dirs)
    clean_patterns = normalize_clean_patterns(patterns, fallback_patterns=DEFAULT_CLEAN_FILE_PATTERNS)
    protected = normalize_clean_patterns(
        protected_patterns,
        fallback_patterns=DEFAULT_PROTECTED_PATTERNS,
    )

    candidates: dict[str, Path] = {}
    errors: List[str] = []

    for scope in normalized_scope:
        scope_rel = scope
        scope_path = resolved_root if scope_rel == "." else (resolved_root / scope_rel).resolve()

        if not scope_path.exists() or not scope_path.is_dir():
            continue
        if not is_subpath_fn(scope_path, resolved_root):
            errors.append(f"Cleanup scope is outside workspace: {scope_rel}")
            continue

        recursive = scope_rel != "."
        for pattern in clean_patterns:
            try:
                for candidate in _iter_scope_matches(scope_path, pattern, recursive):
                    try:
                        resolved = candidate.resolve()
                    except OSError as err:
                        errors.append(f"Failed to resolve path: {candidate} ({err})")
                        continue
                    if not is_subpath_fn(resolved, resolved_root):
                        errors.append(f"Skipped path outside workspace: {candidate}")
                        continue
                    if not resolved.exists() or not resolved.is_file():
                        continue
                    rel = resolved.relative_to(resolved_root).as_posix()
                    candidates[rel] = resolved
            except OSError as err:
                errors.append(f"Failed to scan scope '{scope_rel}' for '{pattern}': {err}")

    deleted_files: List[str] = []
    skipped_protected_files: List[str] = []
    sorted_rel_paths = sorted(candidates.keys())
    for rel in sorted_rel_paths:
        abs_path = candidates[rel]
        filename = abs_path.name
        if any(fnmatch.fnmatch(filename, pattern) for pattern in protected):
            skipped_protected_files.append(rel)
            continue
        if dry_run:
            deleted_files.append(rel)
            continue
        try:
            abs_path.unlink()
            deleted_files.append(rel)
        except OSError as err:
            errors.append(f"Failed to delete {rel}: {err}")

    return {
        "success": len(errors) == 0,
        "dry_run": bool(dry_run),
        "scope": normalized_scope,
        "patterns": clean_patterns,
        "protected_patterns": protected,
        "deleted_files": deleted_files,
        "deleted_count": len(deleted_files),
        "skipped_protected_files": skipped_protected_files,
        "skipped_protected_count": len(skipped_protected_files),
        "errors": errors,
    }


def prune_empty_directories(
    *,
    root_dir: Path,
    scope_dirs: Sequence[str],
    dry_run: bool,
    is_subpath_fn: Callable[[Path, Path], bool],
) -> Dict[str, Any]:
    resolved_root = root_dir.resolve()
    normalized_scope = _normalize_scope_dirs(scope_dirs)
    errors: List[str] = []
    removed_empty_dirs: List[str] = []
    planned_removed: set[Path] = set()

    def _would_be_empty(path: Path) -> bool:
        try:
            children = list(path.iterdir())
        except OSError as err:
            errors.append(f"Failed to inspect directory {path}: {err}")
            return False

        for child in children:
            try:
                child_resolved = child.resolve()
            except OSError as err:
                errors.append(f"Failed to resolve child path: {child} ({err})")
                return False
            if not is_subpath_fn(child_resolved, resolved_root):
                errors.append(f"Skipped path outside workspace: {child}")
                return False
            if child.is_dir() and child_resolved in planned_removed:
                continue
            return False
        return True

    for scope in normalized_scope:
        scope_rel = scope
        scope_path = resolved_root if scope_rel == "." else (resolved_root / scope_rel).resolve()

        if not scope_path.exists() or not scope_path.is_dir():
            continue
        if not is_subpath_fn(scope_path, resolved_root):
            errors.append(f"Cleanup scope is outside workspace: {scope_rel}")
            continue

        try:
            directories = [item for item in scope_path.rglob("*") if item.is_dir()]
        except OSError as err:
            errors.append(f"Failed to scan scope '{scope_rel}' for empty directories: {err}")
            continue

        for directory in sorted(directories, key=lambda item: len(item.parts), reverse=True):
            try:
                resolved = directory.resolve()
            except OSError as err:
                errors.append(f"Failed to resolve path: {directory} ({err})")
                continue
            if not is_subpath_fn(resolved, resolved_root):
                errors.append(f"Skipped path outside workspace: {directory}")
                continue
            if not _would_be_empty(resolved):
                continue
            rel = resolved.relative_to(resolved_root).as_posix()
            if dry_run:
                planned_removed.add(resolved)
                removed_empty_dirs.append(rel)
                continue
            try:
                resolved.rmdir()
                planned_removed.add(resolved)
                removed_empty_dirs.append(rel)
            except OSError as err:
                errors.append(f"Failed to remove empty directory {rel}: {err}")

    removed_empty_dirs = sorted(set(removed_empty_dirs))
    return {
        "success": len(errors) == 0,
        "dry_run": bool(dry_run),
        "scope": normalized_scope,
        "removed_empty_dirs": removed_empty_dirs,
        "removed_empty_dir_count": len(removed_empty_dirs),
        "errors": errors,
    }
