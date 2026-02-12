#!/usr/bin/env python3
"""Split orchestration helpers extracted from theme_designer_core."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional


def normalize_split_mode(
    raw_mode: Any,
    *,
    default_mode: str,
    allowed_modes: Iterable[str],
) -> str:
    parsed = str(raw_mode or default_mode).strip().lower()
    if not parsed:
        parsed = default_mode
    allowed = set(allowed_modes)
    if parsed in allowed:
        return parsed
    options = ", ".join(sorted(allowed))
    raise ValueError(f"Unsupported split standalone mode: {raw_mode}. Expected: {options}")


def normalize_split_sections_dir(raw_dir: Any, *, default_sections_dir: str) -> str:
    parsed = str(raw_dir or "").strip()
    if not parsed:
        return default_sections_dir
    return parsed


def normalize_split_naming_mode(
    raw_mode: Any,
    *,
    default_mode: str,
    allowed_modes: Iterable[str],
) -> str:
    parsed = str(raw_mode or default_mode).strip().lower()
    if not parsed:
        parsed = default_mode
    allowed = set(allowed_modes)
    if parsed in allowed:
        return parsed
    options = ", ".join(sorted(allowed))
    raise ValueError(f"Unsupported split naming mode: {raw_mode}. Expected: {options}")


def normalize_split_prune_unreferenced(raw_value: Any) -> bool:
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, str):
        lowered = raw_value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off", ""}:
            return False
    raise ValueError("prune_unreferenced must be a boolean.")


def validate_split_source_target(
    target_rel: str,
    target_abs: Path,
    *,
    extract_documentclass_declaration: Callable[[Path], tuple[str, str]],
    resolve_subfiles_parent_tex: Callable[[Path, str], Optional[Path]],
    safe_workspace_relpath: Callable[[Optional[Path]], str],
) -> None:
    class_name, class_options = extract_documentclass_declaration(target_abs)
    if class_name != "subfiles":
        return

    parent_tex = resolve_subfiles_parent_tex(target_abs, class_options)
    parent_rel = safe_workspace_relpath(parent_tex)
    if parent_rel:
        raise ValueError(
            f"Split source '{target_rel}' is a subfile unit "
            f"(\\documentclass{{subfiles}}). Select root target '{parent_rel}' instead."
        )
    raise ValueError(
        f"Split source '{target_rel}' is a subfile unit "
        "(\\documentclass{subfiles}). Select a root .tex target instead."
    )


def split_compile_target(
    compile_target: str,
    *,
    standalone_mode: Any,
    sections_dir: Any,
    naming_mode: Any,
    prune_unreferenced: Any,
    dry_run: bool,
    default_mode: str,
    allowed_modes: Iterable[str],
    default_sections_dir: str,
    default_naming_mode: str,
    allowed_naming_modes: Iterable[str],
    resolve_compile_context: Callable[[str], Any],
    extract_documentclass_declaration: Callable[[Path], tuple[str, str]],
    resolve_subfiles_parent_tex: Callable[[Path, str], Optional[Path]],
    safe_workspace_relpath: Callable[[Optional[Path]], str],
    splitter: Any,
) -> Dict[str, Any]:
    mode = normalize_split_mode(
        standalone_mode,
        default_mode=default_mode,
        allowed_modes=allowed_modes,
    )
    section_dir_value = normalize_split_sections_dir(
        sections_dir,
        default_sections_dir=default_sections_dir,
    )
    naming_mode_value = normalize_split_naming_mode(
        naming_mode,
        default_mode=default_naming_mode,
        allowed_modes=allowed_naming_modes,
    )
    prune_unreferenced_value = normalize_split_prune_unreferenced(prune_unreferenced)
    ctx = resolve_compile_context(compile_target)
    validate_split_source_target(
        ctx.target_rel,
        ctx.target_abs,
        extract_documentclass_declaration=extract_documentclass_declaration,
        resolve_subfiles_parent_tex=resolve_subfiles_parent_tex,
        safe_workspace_relpath=safe_workspace_relpath,
    )
    result = splitter.split_tex_file(
        ctx.target_abs,
        Path(section_dir_value),
        standalone_mode=mode,
        naming_mode=naming_mode_value,
        prune_unreferenced=prune_unreferenced_value,
        dry_run=bool(dry_run),
    )

    generated_targets = [safe_workspace_relpath(unit.path) for unit in result.units]
    updated_files: List[str] = []
    if not result.already_split:
        updated_files = [safe_workspace_relpath(result.root_path), *generated_targets]

    warnings: List[str] = []
    if result.already_split:
        warnings.append(
            "Target already appears split with \\subfile entries; no rewrite was applied."
        )
    if result.dry_run:
        warnings.append("Dry-run mode enabled; no files were written.")
    if result.standalone_wrappers:
        warnings.append(
            "Legacy wrapper files were generated. "
            "Subfiles mode should normally not produce wrappers."
        )
    if result.renamed_units:
        warnings.append(
            f"Renamed {len(result.renamed_units)} unit file(s) to match current heading slugs."
        )
    if result.unreferenced_existing_units and not result.pruned_unreferenced_units:
        warnings.append(
            f"Found {len(result.unreferenced_existing_units)} unreferenced existing unit file(s). "
            "They were kept."
        )
    if result.pruned_unreferenced_units:
        warnings.append(
            f"Pruned {len(result.pruned_unreferenced_units)} unreferenced existing unit file(s)."
        )

    return {
        "standalone_mode": mode,
        "naming_mode": naming_mode_value,
        "prune_unreferenced": prune_unreferenced_value,
        "source_target": safe_workspace_relpath(result.root_path),
        "sections_dir": safe_workspace_relpath(result.sections_dir),
        "backup_path": safe_workspace_relpath(result.backup_path),
        "split_command": result.split_command,
        "document_class": result.document_class,
        "subfiles_package_injected": bool(result.subfiles_package_injected),
        "dry_run": bool(result.dry_run),
        "already_split": bool(result.already_split),
        "generated_subfile_targets": generated_targets,
        "renamed_units": [
            {
                "from": safe_workspace_relpath(old_path),
                "to": safe_workspace_relpath(new_path),
            }
            for old_path, new_path in result.renamed_units
        ],
        "unchanged_units": [
            safe_workspace_relpath(path) for path in result.unchanged_units
        ],
        "unreferenced_existing_units": [
            safe_workspace_relpath(path) for path in result.unreferenced_existing_units
        ],
        "pruned_unreferenced_units": [
            safe_workspace_relpath(path) for path in result.pruned_unreferenced_units
        ],
        "updated_files": updated_files,
        "warnings": warnings,
        "standalone_wrappers": [safe_workspace_relpath(path) for path in result.standalone_wrappers],
        "suggested_compile_target": generated_targets[0] if generated_targets else "",
    }
