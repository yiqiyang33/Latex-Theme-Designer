#!/usr/bin/env python3
"""Split a monolithic LaTeX root file into chapter/section unit files.

Standalone compile direction is `subfiles`; wrapper generation in this file is
kept as a temporary legacy fallback during migration.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

CHAPTER_CLASS_NAMES = {
    "book",
    "report",
    "memoir",
    "scrbook",
    "scrreprt",
    "ctexbook",
    "ctexrep",
    "bxjsbook",
}

DOCUMENTCLASS_PATTERN = re.compile(
    r"\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}",
    flags=re.IGNORECASE,
)
BEGIN_DOCUMENT_PATTERN = re.compile(r"\\begin\s*\{document\}")
END_DOCUMENT_PATTERN = re.compile(r"\\end\s*\{document\}")
SUBFILES_PACKAGE_PATTERN = re.compile(
    r"\\usepackage(?:\[[^\]]*\])?\{[^}]*\bsubfiles\b[^}]*\}",
    flags=re.IGNORECASE,
)

STANDALONE_MODE_SUBFILES = "subfiles"
STANDALONE_MODE_LEGACY_WRAPPER = "legacy-wrapper"
STANDALONE_MODES = {
    STANDALONE_MODE_SUBFILES,
    STANDALONE_MODE_LEGACY_WRAPPER,
}
RENUMBER_MODE_ADD = "add"
RENUMBER_MODE_REMOVE = "remove"
RENUMBER_MODES = {
    RENUMBER_MODE_ADD,
    RENUMBER_MODE_REMOVE,
}
TOP_LEVEL_REFERENCE_PATTERN = re.compile(
    r"(?m)^[ \t]*\\(?P<macro>subfile|input|include)"
    r"(?:[ \t]*\[[^\]\n]*\])?[ \t]*\{(?P<ref>[^}\n]+)\}"
)
NUMERIC_PREFIX_PATTERN = re.compile(r"^(?P<number>\d+)-(?P<rest>.+)$")
DOCUMENTCLASS_DECLARATION_PATTERN = re.compile(
    r"\\documentclass(?:\[(?P<options>[^\]]*)\])?\{(?P<class>[^}]+)\}",
    flags=re.IGNORECASE,
)


@dataclass
class SplitUnit:
    """One generated body unit."""

    index: int
    title: str
    slug: str
    path: Path
    content: str


@dataclass
class SplitResult:
    """Summary for one splitter run."""

    document_class: str
    split_command: str
    root_path: Path
    backup_path: Optional[Path]
    sections_dir: Path
    standalone_mode: str
    include_macro: str
    subfiles_package_injected: bool
    dry_run: bool
    already_split: bool
    units: List[SplitUnit]
    standalone_dir: Optional[Path]
    standalone_wrappers: List[Path]


@dataclass
class RootReference:
    """One top-level root include/subfile reference in document body."""

    macro: str
    reference_raw: str
    reference_start: int
    reference_end: int
    match_start: int
    match_end: int
    target_abs: Path
    target_reference_no_suffix: str


@dataclass
class RenumberResult:
    """Summary for one renumber operation over root references."""

    root_path: Path
    backup_path: Optional[Path]
    mode: str
    dry_run: bool
    renamed: Dict[Path, Path]
    updated_files: List[Path]
    warnings: List[str]


@dataclass
class UnsplitResult:
    """Summary for one unsplit operation that inlines one unit back into root."""

    root_path: Path
    unit_path: Path
    backup_path: Optional[Path]
    dry_run: bool
    deleted_source: bool
    updated_files: List[Path]
    warnings: List[str]


def _extract_document_class(tex_text: str) -> str:
    match = DOCUMENTCLASS_PATTERN.search(tex_text)
    if not match:
        raise ValueError("Missing \\documentclass{...} in root file.")
    raw_name = match.group(1).strip()
    if "," in raw_name:
        raw_name = raw_name.split(",", 1)[0].strip()
    class_name = raw_name.lower()
    if not class_name:
        raise ValueError("Detected empty document class name.")
    return class_name


def _is_subfiles_unit_class(class_name: str) -> bool:
    return str(class_name or "").strip().lower() == "subfiles"


def _is_chapter_capable_class(class_name: str) -> bool:
    normalized = str(class_name or "").strip().lower()
    if not normalized:
        return False
    if normalized in CHAPTER_CLASS_NAMES:
        return True
    return normalized.endswith("book") or normalized.endswith("report")


def _split_command_for_document_class(class_name: str) -> str:
    return "chapter" if _is_chapter_capable_class(class_name) else "section"


def _find_document_body_bounds(tex_text: str) -> tuple[int, int]:
    begin_match = BEGIN_DOCUMENT_PATTERN.search(tex_text)
    if not begin_match:
        raise ValueError("Missing \\begin{document} in root file.")
    end_match = END_DOCUMENT_PATTERN.search(tex_text, begin_match.end())
    if not end_match:
        raise ValueError("Missing \\end{document} in root file.")
    if end_match.start() < begin_match.end():
        raise ValueError("Invalid document body region.")
    return begin_match.end(), end_match.start()


def _build_anchor_pattern(command_name: str) -> re.Pattern[str]:
    command = re.escape(command_name)
    pattern = (
        r"(?m)^[ \t]*\\"
        + command
        + r"\*?(?:[ \t]*\[[^\]\n]*\])?[ \t]*\{"
    )
    return re.compile(pattern)


def _find_top_level_anchors(body_text: str, command_name: str) -> List[re.Match[str]]:
    return list(_build_anchor_pattern(command_name).finditer(body_text))


def _parse_balanced_group(
    text: str,
    start_index: int,
    opening_char: str,
    closing_char: str,
) -> tuple[str, int]:
    if start_index < 0 or start_index >= len(text) or text[start_index] != opening_char:
        raise ValueError("Expected balanced group opening character.")
    depth = 0
    cursor = start_index
    collected: List[str] = []
    while cursor < len(text):
        char = text[cursor]
        if char == "\\" and cursor + 1 < len(text):
            if depth > 0:
                collected.append(char)
                collected.append(text[cursor + 1])
            cursor += 2
            continue
        if char == opening_char:
            depth += 1
            if depth > 1:
                collected.append(char)
            cursor += 1
            continue
        if char == closing_char:
            depth -= 1
            if depth < 0:
                raise ValueError("Unbalanced group while parsing heading title.")
            if depth == 0:
                return "".join(collected), cursor + 1
            collected.append(char)
            cursor += 1
            continue
        if depth > 0:
            collected.append(char)
        cursor += 1
    raise ValueError("Unterminated group while parsing heading title.")


def _extract_heading_title(body_text: str, command_name: str, anchor_start: int) -> str:
    cursor = anchor_start
    while cursor < len(body_text) and body_text[cursor] in (" ", "\t"):
        cursor += 1
    command = "\\" + command_name
    if not body_text.startswith(command, cursor):
        return ""
    cursor += len(command)
    if cursor < len(body_text) and body_text[cursor] == "*":
        cursor += 1
    while cursor < len(body_text) and body_text[cursor].isspace():
        cursor += 1
    if cursor < len(body_text) and body_text[cursor] == "[":
        _, cursor = _parse_balanced_group(body_text, cursor, "[", "]")
    while cursor < len(body_text) and body_text[cursor].isspace():
        cursor += 1
    if cursor >= len(body_text) or body_text[cursor] != "{":
        return ""
    title, _ = _parse_balanced_group(body_text, cursor, "{", "}")
    return re.sub(r"\s+", " ", title).strip()


def _slugify_heading(title: str) -> str:
    candidate = str(title or "").strip().lower()
    candidate = re.sub(r"\\[a-zA-Z@]+\*?", " ", candidate)
    candidate = candidate.replace("{", " ").replace("}", " ")
    candidate = re.sub(r"[^0-9a-z]+", "-", candidate)
    candidate = re.sub(r"-{2,}", "-", candidate)
    candidate = candidate.strip("-")
    return candidate or "unit"


def _stable_slug_for_title(title: str, seen_counts: Dict[str, int]) -> str:
    base = _slugify_heading(title)
    count = seen_counts.get(base, 0) + 1
    seen_counts[base] = count
    if count == 1:
        return base
    return f"{base}-dup-{count}"


def _next_backup_path(root_tex_path: Path) -> Path:
    base = Path(str(root_tex_path) + ".bak")
    if not base.exists():
        return base
    suffix = 1
    while True:
        candidate = Path(f"{root_tex_path}.bak.{suffix}")
        if not candidate.exists():
            return candidate
        suffix += 1


def _relative_tex_reference(root_dir: Path, target_tex_path: Path) -> str:
    relative = os.path.relpath(target_tex_path, start=root_dir)
    return Path(relative).with_suffix("").as_posix()


def _resolve_output_dir(raw_dir: Path, root_parent: Path) -> Path:
    resolved = raw_dir.expanduser()
    if not resolved.is_absolute():
        resolved = root_parent / resolved
    return resolved.resolve()


def _extract_existing_subfile_refs(body_text: str) -> List[str]:
    pattern = re.compile(
        r"(?m)^[ \t]*\\subfile(?:[ \t]*\[[^\]\n]*\])?[ \t]*\{([^}\n]+)\}"
    )
    refs: List[str] = []
    for match in pattern.finditer(body_text):
        ref = str(match.group(1)).strip()
        if ref:
            refs.append(ref)
    return refs


def _path_from_tex_reference(base_dir: Path, reference: str) -> Path:
    ref_path = Path(reference.strip().replace("\\", "/"))
    if not ref_path.suffix:
        ref_path = ref_path.with_suffix(".tex")
    if ref_path.is_absolute():
        return ref_path.resolve()
    return (base_dir / ref_path).resolve()


def _extract_documentclass_declaration(tex_text: str) -> Tuple[str, str]:
    match = DOCUMENTCLASS_DECLARATION_PATTERN.search(tex_text)
    if not match:
        return "", ""
    raw_class = str(match.group("class") or "").strip()
    if "," in raw_class:
        raw_class = raw_class.split(",", 1)[0].strip()
    raw_options = str(match.group("options") or "").strip()
    return raw_class.lower(), raw_options


def _resolve_subfiles_parent_tex(unit_path: Path, class_options: str) -> Path:
    raw = str(class_options or "").strip()
    if not raw:
        raise ValueError(
            "Subfiles unit does not declare parent root in "
            "\\documentclass[<root>]{subfiles} options."
        )
    hint = raw.split(",", 1)[0].strip()
    if not hint:
        raise ValueError(
            "Subfiles unit declares empty parent root option in \\documentclass."
        )
    hinted_path = Path(hint.replace("\\", "/"))
    if not hinted_path.suffix:
        hinted_path = hinted_path.with_suffix(".tex")
    if hinted_path.is_absolute():
        candidate = hinted_path.resolve()
    else:
        candidate = (unit_path.parent / hinted_path).resolve()
    if not candidate.exists() or not candidate.is_file():
        raise ValueError(
            f"Resolved parent root does not exist for subfiles unit: {candidate}"
        )
    return candidate


def _extract_top_level_references(base_dir: Path, body_text: str) -> List[RootReference]:
    refs: List[RootReference] = []
    for match in TOP_LEVEL_REFERENCE_PATTERN.finditer(body_text):
        raw_ref = str(match.group("ref") or "").strip()
        if not raw_ref:
            continue
        target_abs = _path_from_tex_reference(base_dir, raw_ref)
        target_no_suffix = _relative_tex_reference(base_dir, target_abs)
        refs.append(
            RootReference(
                macro=str(match.group("macro") or "").strip().lower(),
                reference_raw=raw_ref,
                reference_start=match.start("ref"),
                reference_end=match.end("ref"),
                match_start=match.start(),
                match_end=match.end(),
                target_abs=target_abs,
                target_reference_no_suffix=target_no_suffix,
            )
        )
    return refs


def _build_text_with_reference_replacements(
    body_text: str,
    replacements: Dict[Tuple[int, int], str],
) -> str:
    if not replacements:
        return body_text
    pieces: List[str] = []
    cursor = 0
    for start, end in sorted(replacements.keys()):
        pieces.append(body_text[cursor:start])
        pieces.append(replacements[(start, end)])
        cursor = end
    pieces.append(body_text[cursor:])
    return "".join(pieces)


def _extract_numeric_prefix(stem: str) -> Tuple[Optional[int], str]:
    match = NUMERIC_PREFIX_PATTERN.match(stem)
    if not match:
        return None, stem
    number_raw = str(match.group("number") or "").strip()
    rest = str(match.group("rest") or "").strip()
    if not number_raw or not rest:
        return None, stem
    try:
        number = int(number_raw)
    except ValueError:
        return None, stem
    if number <= 0:
        return None, stem
    return number, rest


def _normalize_renumber_mode(mode: str) -> str:
    normalized = str(mode or "").strip().lower()
    if normalized in RENUMBER_MODES:
        return normalized
    options = ", ".join(sorted(RENUMBER_MODES))
    raise ValueError(f"Unsupported renumber mode: {mode}. Expected one of: {options}.")


def _rename_paths_transaction(rename_map: List[Tuple[Path, Path]]) -> None:
    if not rename_map:
        return

    sources = [src.resolve() for src, dst in rename_map if src.resolve() != dst.resolve()]
    targets = [dst.resolve() for src, dst in rename_map if src.resolve() != dst.resolve()]
    if len(set(sources)) != len(sources):
        raise ValueError("Duplicate source path detected in renaming transaction.")
    if len(set(targets)) != len(targets):
        raise ValueError("Duplicate destination path detected in renaming transaction.")

    source_set = set(sources)
    for src, dst in rename_map:
        src_resolved = src.resolve()
        dst_resolved = dst.resolve()
        if src_resolved == dst_resolved:
            continue
        if not src_resolved.exists():
            raise ValueError(f"Source file does not exist for renaming: {src_resolved}")
        if dst_resolved.exists() and dst_resolved not in source_set:
            raise ValueError(
                f"Renaming target already exists and is not part of transaction: {dst_resolved}"
            )

    stage_one: List[Path] = []
    stage_two: List[Tuple[Path, Path]] = []
    temp_map: Dict[Path, Path] = {}
    try:
        for src, dst in rename_map:
            src_resolved = src.resolve()
            dst_resolved = dst.resolve()
            if src_resolved == dst_resolved:
                continue
            temp_path = src_resolved.with_name(
                f"{src_resolved.name}.tmp-rename-{uuid.uuid4().hex[:8]}"
            )
            os.replace(src_resolved, temp_path)
            temp_map[src_resolved] = temp_path
            stage_one.append(src_resolved)

        for src, dst in rename_map:
            src_resolved = src.resolve()
            dst_resolved = dst.resolve()
            if src_resolved == dst_resolved:
                continue
            temp_path = temp_map[src_resolved]
            dst_resolved.parent.mkdir(parents=True, exist_ok=True)
            os.replace(temp_path, dst_resolved)
            stage_two.append((src_resolved, dst_resolved))
    except (OSError, UnicodeError, ValueError):
        for src_resolved, dst_resolved in reversed(stage_two):
            try:
                if dst_resolved.exists():
                    os.replace(dst_resolved, src_resolved)
            except OSError:
                pass
        for src_resolved in reversed(stage_one):
            temp_path = temp_map.get(src_resolved)
            if not temp_path:
                continue
            try:
                if temp_path.exists():
                    os.replace(temp_path, src_resolved)
            except OSError:
                pass
        raise


def _extract_unit_document_body(unit_text: str) -> Tuple[str, bool]:
    begin_match = BEGIN_DOCUMENT_PATTERN.search(unit_text)
    if not begin_match:
        return unit_text, False
    end_match = END_DOCUMENT_PATTERN.search(unit_text, begin_match.end())
    if not end_match:
        return unit_text, False
    if end_match.start() < begin_match.end():
        return unit_text, False
    return unit_text[begin_match.end() : end_match.start()], True


def _title_slug_from_filename(filename: str) -> Tuple[str, str]:
    stem = Path(filename).stem
    match = re.match(r"^\d+-(.+)$", stem)
    slug = (match.group(1) if match else stem).strip()
    slug = slug or "unit"
    title = slug.replace("-", " ").strip() or "unit"
    return title, slug


def _build_units_from_existing_subfiles(root_path: Path, refs: List[str]) -> List[SplitUnit]:
    units: List[SplitUnit] = []
    for idx, ref in enumerate(refs, start=1):
        unit_path = _path_from_tex_reference(root_path.parent, ref)
        title, slug = _title_slug_from_filename(unit_path.name)
        unit_content = ""
        if unit_path.exists() and unit_path.is_file():
            unit_content = unit_path.read_text(encoding="utf-8")
        units.append(
            SplitUnit(
                index=idx,
                title=title,
                slug=slug,
                path=unit_path,
                content=unit_content,
            )
        )
    return units


def _write_text_transaction(write_map: List[Tuple[Path, str]]) -> None:
    if not write_map:
        return

    original_texts: Dict[Path, Optional[str]] = {}
    for path, _ in write_map:
        if path.exists() and path.is_file():
            original_texts[path] = path.read_text(encoding="utf-8")
        else:
            original_texts[path] = None

    temp_paths: Dict[Path, Path] = {}
    applied_paths: List[Path] = []
    try:
        for path, text in write_map:
            path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = path.with_name(
                f"{path.name}.tmp-split-{uuid.uuid4().hex[:8]}"
            )
            temp_path.write_text(text, encoding="utf-8")
            temp_paths[path] = temp_path

        for path, _ in write_map:
            temp_path = temp_paths[path]
            os.replace(temp_path, path)
            applied_paths.append(path)
    except (OSError, UnicodeError, ValueError):
        for temp_path in temp_paths.values():
            if temp_path.exists():
                temp_path.unlink()
        for path in reversed(applied_paths):
            original = original_texts.get(path)
            if original is None:
                if path.exists():
                    path.unlink()
            else:
                path.write_text(original, encoding="utf-8")
        raise


def _normalize_standalone_mode(mode: str) -> str:
    normalized = str(mode or "").strip().lower()
    if normalized in STANDALONE_MODES:
        return normalized
    raise ValueError(
        "Unsupported standalone mode. "
        f"Expected one of: {', '.join(sorted(STANDALONE_MODES))}."
    )


def _contains_subfiles_package(preamble_text: str) -> bool:
    return bool(SUBFILES_PACKAGE_PATTERN.search(preamble_text))


def _inject_subfiles_package(preamble_plus_begin: str) -> tuple[str, bool]:
    begin_match = BEGIN_DOCUMENT_PATTERN.search(preamble_plus_begin)
    if not begin_match:
        raise ValueError("Missing \\begin{document} in root file preamble.")
    preamble_text = preamble_plus_begin[: begin_match.start()]
    begin_document = preamble_plus_begin[begin_match.start() :]
    if _contains_subfiles_package(preamble_text):
        return preamble_plus_begin, False
    if preamble_text and not preamble_text.endswith("\n"):
        preamble_text += "\n"
    preamble_text += "\\usepackage{subfiles}\n"
    return preamble_text + begin_document, True


def _build_subfile_unit_text(root_path: Path, unit_path: Path, content: str) -> str:
    root_reference = os.path.relpath(root_path, start=unit_path.parent)
    root_reference = Path(root_reference).as_posix()
    body = content
    if body and not body.startswith("\n"):
        body = "\n" + body
    if body and not body.endswith("\n"):
        body += "\n"
    return (
        f"\\documentclass[{root_reference}]{{subfiles}}\n"
        "\\begin{document}\n"
        f"{body}"
        "\\end{document}\n"
    )


def _standalone_wrapper_filename(unit: SplitUnit) -> str:
    return f"{unit.path.stem}-standalone.tex"


def _build_standalone_wrapper_text(
    preamble_plus_begin: str,
    end_document_and_tail: str,
    unit_reference: str,
) -> str:
    before = preamble_plus_begin
    if before and not before.endswith("\n"):
        before += "\n"
    return before + f"\n\\input{{{unit_reference}}}\n" + end_document_and_tail


def split_tex_file(
    root_tex_path: Path,
    sections_dir: Path,
    standalone_mode: str = STANDALONE_MODE_SUBFILES,
    use_include: bool = False,
    with_standalone: bool = False,
    standalone_dir: Optional[Path] = None,
    dry_run: bool = False,
) -> SplitResult:
    root_path = root_tex_path.expanduser().resolve()
    if not root_path.exists():
        raise ValueError(f"Root file does not exist: {root_tex_path}")
    if not root_path.is_file():
        raise ValueError(f"Root path is not a file: {root_tex_path}")

    mode = _normalize_standalone_mode(standalone_mode)
    if with_standalone:
        mode = STANDALONE_MODE_LEGACY_WRAPPER
    if mode == STANDALONE_MODE_SUBFILES and use_include:
        raise ValueError(
            "--use-include is not supported in standalone-mode=subfiles. "
            "Use standalone-mode=legacy-wrapper to keep \\include output."
        )

    tex_text = root_path.read_text(encoding="utf-8")
    document_class = _extract_document_class(tex_text)
    if _is_subfiles_unit_class(document_class):
        raise ValueError(
            "Selected file uses \\documentclass{subfiles} and is a standalone unit. "
            "Please split the parent root .tex file instead."
        )
    split_command = _split_command_for_document_class(document_class)

    body_start, body_end = _find_document_body_bounds(tex_text)
    preamble_plus_begin = tex_text[:body_start]
    body_text = tex_text[body_start:body_end]
    end_document_and_tail = tex_text[body_end:]

    anchors = _find_top_level_anchors(body_text, split_command)
    section_dir_path = _resolve_output_dir(sections_dir, root_path.parent)
    if not anchors:
        if mode == STANDALONE_MODE_SUBFILES:
            existing_refs = _extract_existing_subfile_refs(body_text)
            if existing_refs:
                existing_units = _build_units_from_existing_subfiles(
                    root_path,
                    existing_refs,
                )
                if existing_units:
                    section_dir_path = existing_units[0].path.parent
                return SplitResult(
                    document_class=document_class,
                    split_command=split_command,
                    root_path=root_path,
                    backup_path=None,
                    sections_dir=section_dir_path,
                    standalone_mode=mode,
                    include_macro="\\subfile",
                    subfiles_package_injected=False,
                    dry_run=bool(dry_run),
                    already_split=True,
                    units=existing_units,
                    standalone_dir=None,
                    standalone_wrappers=[],
                )
        raise ValueError(
            f"No top-level \\{split_command} anchors found in document body."
        )

    units: List[SplitUnit] = []
    width = max(2, len(str(len(anchors))))
    seen_slugs: Dict[str, int] = {}
    for index, anchor in enumerate(anchors, start=1):
        chunk_start = anchor.start()
        chunk_end = anchors[index].start() if index < len(anchors) else len(body_text)
        chunk_text = body_text[chunk_start:chunk_end]
        title = _extract_heading_title(body_text, split_command, chunk_start)
        slug = _stable_slug_for_title(title, seen_slugs)
        filename = f"{index:0{width}d}-{slug}.tex"
        units.append(
            SplitUnit(
                index=index,
                title=title or f"{split_command}-{index}",
                slug=slug,
                path=section_dir_path / filename,
                content=chunk_text,
            )
        )

    leading_body = body_text[:anchors[0].start()]
    include_macro = "\\subfile"
    if mode == STANDALONE_MODE_LEGACY_WRAPPER:
        include_macro = "\\include" if use_include else "\\input"
    include_lines = [
        f"{include_macro}{{{_relative_tex_reference(root_path.parent, unit.path)}}}"
        for unit in units
    ]

    new_body = leading_body
    if new_body and not new_body.endswith("\n"):
        new_body += "\n"
    if new_body and not new_body.endswith("\n\n"):
        new_body += "\n"
    new_body += "\n".join(include_lines) + "\n"
    subfiles_package_injected = False
    rewritten_preamble_plus_begin = preamble_plus_begin
    if mode == STANDALONE_MODE_SUBFILES:
        rewritten_preamble_plus_begin, subfiles_package_injected = _inject_subfiles_package(
            preamble_plus_begin
        )
    rewritten_text = rewritten_preamble_plus_begin + new_body + end_document_and_tail

    standalone_dir_path: Optional[Path] = None
    standalone_wrappers: List[Path] = []
    if mode == STANDALONE_MODE_LEGACY_WRAPPER:
        raw_standalone_dir = standalone_dir or (section_dir_path / "_standalone")
        standalone_dir_path = _resolve_output_dir(raw_standalone_dir, root_path.parent)
    write_map: List[Tuple[Path, str]] = []
    for unit in units:
        unit_content = unit.content
        if mode == STANDALONE_MODE_SUBFILES:
            unit_content = _build_subfile_unit_text(root_path, unit.path, unit_content)
        write_map.append((unit.path, unit_content))

    if mode == STANDALONE_MODE_LEGACY_WRAPPER and standalone_dir_path is not None:
        for unit in units:
            wrapper_name = _standalone_wrapper_filename(unit)
            wrapper_path = standalone_dir_path / wrapper_name
            unit_reference = _relative_tex_reference(wrapper_path.parent, unit.path)
            wrapper_text = _build_standalone_wrapper_text(
                preamble_plus_begin,
                end_document_and_tail,
                unit_reference,
            )
            write_map.append((wrapper_path, wrapper_text))
            standalone_wrappers.append(wrapper_path)

    write_map.append((root_path, rewritten_text))

    backup_path: Optional[Path] = _next_backup_path(root_path)
    if not dry_run:
        shutil.copy2(root_path, backup_path)
        _write_text_transaction(write_map)

    return SplitResult(
        document_class=document_class,
        split_command=split_command,
        root_path=root_path,
        backup_path=backup_path,
        sections_dir=section_dir_path,
        standalone_mode=mode,
        include_macro=include_macro,
        subfiles_package_injected=subfiles_package_injected,
        dry_run=bool(dry_run),
        already_split=False,
        units=units,
        standalone_dir=standalone_dir_path,
        standalone_wrappers=standalone_wrappers,
    )


def renumber_references(
    root_tex_path: Path,
    mode: str = RENUMBER_MODE_ADD,
    dry_run: bool = False,
) -> RenumberResult:
    root_path = root_tex_path.expanduser().resolve()
    if not root_path.exists():
        raise ValueError(f"Root file does not exist: {root_tex_path}")
    if not root_path.is_file():
        raise ValueError(f"Root path is not a file: {root_tex_path}")

    normalized_mode = _normalize_renumber_mode(mode)
    tex_text = root_path.read_text(encoding="utf-8")
    class_name = _extract_document_class(tex_text)
    if _is_subfiles_unit_class(class_name):
        raise ValueError(
            "Renumber source must be a root document, not a subfiles unit target."
        )

    body_start, body_end = _find_document_body_bounds(tex_text)
    body_text = tex_text[body_start:body_end]
    refs = _extract_top_level_references(root_path.parent, body_text)
    if not refs:
        raise ValueError(
            "No top-level \\subfile/\\input/\\include references found in root body."
        )

    unique_targets: List[Path] = []
    seen_targets: set[Path] = set()
    for ref in refs:
        target = ref.target_abs.resolve()
        if not target.exists() or not target.is_file():
            raise ValueError(f"Referenced target does not exist: {target}")
        if target not in seen_targets:
            seen_targets.add(target)
            unique_targets.append(target)

    renamed_map: Dict[Path, Path] = {}
    used_numbers: set[int] = set()
    for target in unique_targets:
        number, _ = _extract_numeric_prefix(target.stem)
        if number is not None:
            used_numbers.add(number)

    if normalized_mode == RENUMBER_MODE_ADD:
        assigned_numbers: Dict[Path, int] = {}
        next_number = 1
        for target in unique_targets:
            number, _ = _extract_numeric_prefix(target.stem)
            if number is not None:
                continue
            while next_number in used_numbers:
                next_number += 1
            assigned_numbers[target] = next_number
            used_numbers.add(next_number)
            next_number += 1

        max_number = max(used_numbers) if used_numbers else 0
        width = max(2, len(str(max_number if max_number > 0 else 1)))
        for target in unique_targets:
            assigned = assigned_numbers.get(target)
            if assigned is None:
                continue
            new_name = f"{assigned:0{width}d}-{target.stem}{target.suffix}"
            renamed_map[target] = target.with_name(new_name)
    else:
        for target in unique_targets:
            _, rest = _extract_numeric_prefix(target.stem)
            if rest == target.stem:
                continue
            renamed_map[target] = target.with_name(f"{rest}{target.suffix}")

    rename_pairs: List[Tuple[Path, Path]] = []
    for src, dst in renamed_map.items():
        if src.resolve() != dst.resolve():
            rename_pairs.append((src, dst))

    replacement_map: Dict[Tuple[int, int], str] = {}
    for ref in refs:
        renamed_target = renamed_map.get(ref.target_abs.resolve())
        if renamed_target is None:
            continue
        replacement_map[(ref.reference_start, ref.reference_end)] = _relative_tex_reference(
            root_path.parent,
            renamed_target,
        )
    rewritten_body = _build_text_with_reference_replacements(body_text, replacement_map)
    rewritten_root = tex_text[:body_start] + rewritten_body + tex_text[body_end:]

    has_changes = bool(rename_pairs) or rewritten_root != tex_text
    warnings: List[str] = []
    if not has_changes:
        warnings.append("No referenced targets required renumbering changes.")
        return RenumberResult(
            root_path=root_path,
            backup_path=None,
            mode=normalized_mode,
            dry_run=bool(dry_run),
            renamed=renamed_map,
            updated_files=[],
            warnings=warnings,
        )

    backup_path = _next_backup_path(root_path)
    updated_files: List[Path] = [root_path]
    updated_files.extend([dst for _, dst in rename_pairs])
    if dry_run:
        warnings.append("Dry-run mode enabled; no files were written.")
        return RenumberResult(
            root_path=root_path,
            backup_path=backup_path,
            mode=normalized_mode,
            dry_run=True,
            renamed=renamed_map,
            updated_files=updated_files,
            warnings=warnings,
        )

    shutil.copy2(root_path, backup_path)
    renamed_applied = False
    try:
        if rename_pairs:
            _rename_paths_transaction(rename_pairs)
            renamed_applied = True
        if rewritten_root != tex_text:
            _write_text_transaction([(root_path, rewritten_root)])
    except (OSError, UnicodeError, ValueError):
        if renamed_applied:
            reverse_pairs = [(dst, src) for src, dst in rename_pairs if dst.exists()]
            if reverse_pairs:
                try:
                    _rename_paths_transaction(reverse_pairs)
                except (OSError, UnicodeError, ValueError):
                    pass
        try:
            shutil.copy2(backup_path, root_path)
        except OSError:
            pass
        raise

    return RenumberResult(
        root_path=root_path,
        backup_path=backup_path,
        mode=normalized_mode,
        dry_run=False,
        renamed=renamed_map,
        updated_files=updated_files,
        warnings=warnings,
    )


def unsplit_one_unit(
    unit_tex_path: Path,
    dry_run: bool = False,
    delete_source: bool = True,
) -> UnsplitResult:
    unit_path = unit_tex_path.expanduser().resolve()
    if not unit_path.exists():
        raise ValueError(f"Unsplit target does not exist: {unit_tex_path}")
    if not unit_path.is_file():
        raise ValueError(f"Unsplit target is not a file: {unit_tex_path}")

    unit_text = unit_path.read_text(encoding="utf-8")
    class_name, class_options = _extract_documentclass_declaration(unit_text)
    if class_name != "subfiles":
        raise ValueError(
            "Unsplit target must be a subfiles unit with "
            "\\documentclass[<root>]{subfiles}."
        )

    root_path = _resolve_subfiles_parent_tex(unit_path, class_options)
    root_text = root_path.read_text(encoding="utf-8")
    body_start, body_end = _find_document_body_bounds(root_text)
    body_text = root_text[body_start:body_end]
    refs = _extract_top_level_references(root_path.parent, body_text)

    matched_ref: Optional[RootReference] = None
    for ref in refs:
        if ref.target_abs.resolve() == unit_path:
            matched_ref = ref
            break
    if matched_ref is None:
        raise ValueError(
            f"Root file does not reference target unit: {unit_path}"
        )

    unit_body, wrapped = _extract_unit_document_body(unit_text)
    warnings: List[str] = []
    if not wrapped:
        warnings.append(
            "Unit file has no document wrapper; inlining full file content as fallback."
        )
    if unit_body.startswith("\n"):
        unit_body = unit_body[1:]
    if unit_body and not unit_body.endswith("\n"):
        unit_body += "\n"

    rewritten_body = _build_text_with_reference_replacements(
        body_text,
        {(matched_ref.match_start, matched_ref.match_end): unit_body},
    )
    rewritten_root = root_text[:body_start] + rewritten_body + root_text[body_end:]

    should_write_root = rewritten_root != root_text
    should_delete_source = bool(delete_source)
    if not should_write_root and not should_delete_source:
        warnings.append("No changes were required for unsplit operation.")
        return UnsplitResult(
            root_path=root_path,
            unit_path=unit_path,
            backup_path=None,
            dry_run=bool(dry_run),
            deleted_source=False,
            updated_files=[],
            warnings=warnings,
        )

    backup_path = _next_backup_path(root_path)
    updated_files: List[Path] = [root_path]
    if should_delete_source:
        updated_files.append(unit_path)

    if dry_run:
        warnings.append("Dry-run mode enabled; no files were written.")
        return UnsplitResult(
            root_path=root_path,
            unit_path=unit_path,
            backup_path=backup_path,
            dry_run=True,
            deleted_source=False,
            updated_files=updated_files,
            warnings=warnings,
        )

    shutil.copy2(root_path, backup_path)
    deleted_source = False
    try:
        if should_write_root:
            _write_text_transaction([(root_path, rewritten_root)])
        if should_delete_source and unit_path.exists():
            unit_path.unlink()
            deleted_source = True
    except (OSError, UnicodeError, ValueError):
        try:
            shutil.copy2(backup_path, root_path)
        except OSError:
            pass
        if deleted_source:
            try:
                unit_path.write_text(unit_text, encoding="utf-8")
            except OSError:
                pass
        raise

    return UnsplitResult(
        root_path=root_path,
        unit_path=unit_path,
        backup_path=backup_path,
        dry_run=False,
        deleted_source=deleted_source,
        updated_files=updated_files,
        warnings=warnings,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Split or refactor LaTeX subfile layouts. "
            "Default action is split root by top-level chapter/section."
        )
    )
    parser.add_argument(
        "root",
        nargs="?",
        default="main.tex",
        help="Root .tex file to split (default: main.tex).",
    )
    parser.add_argument(
        "--sections-dir",
        default="Sections",
        help="Directory for generated unit files (default: Sections).",
    )
    parser.add_argument(
        "--use-include",
        action="store_true",
        help=(
            "Use \\include{...} in rewritten root body. "
            "Only valid for --standalone-mode legacy-wrapper."
        ),
    )
    parser.add_argument(
        "--standalone-mode",
        default=STANDALONE_MODE_SUBFILES,
        choices=sorted(STANDALONE_MODES),
        help=(
            "Standalone generation mode (default: subfiles). "
            "Use legacy-wrapper only as migration fallback."
        ),
    )
    parser.add_argument(
        "--with-standalone",
        action="store_true",
        help=(
            "Deprecated compatibility alias for "
            "--standalone-mode legacy-wrapper."
        ),
    )
    parser.add_argument(
        "--standalone-dir",
        default="",
        help=(
            "Directory for legacy standalone wrapper files. "
            "Default when enabled: <sections-dir>/_standalone."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Preview operation result without writing files."
        ),
    )
    parser.add_argument(
        "--renumber-mode",
        choices=sorted(RENUMBER_MODES),
        default="",
        help=(
            "Renumber referenced section/chapter unit files in selected root. "
            "Modes: add (fill missing numeric prefixes), remove (strip prefixes)."
        ),
    )
    parser.add_argument(
        "--unsplit-target",
        default="",
        help=(
            "Inline one subfiles unit back into its parent root at the reference position."
        ),
    )
    parser.add_argument(
        "--keep-source",
        action="store_true",
        help=(
            "When used with --unsplit-target, keep the unit file after inlining. "
            "Default is to delete the source file."
        ),
    )
    return parser


def _display_path(path: Path, start: Path) -> str:
    try:
        return path.resolve().relative_to(start.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    renumber_mode = str(args.renumber_mode or "").strip().lower()
    unsplit_target = str(args.unsplit_target or "").strip()

    selected_actions = int(bool(renumber_mode)) + int(bool(unsplit_target))
    if selected_actions > 1:
        parser.error("--renumber-mode and --unsplit-target are mutually exclusive.")
    if args.keep_source and not unsplit_target:
        parser.error("--keep-source requires --unsplit-target.")

    root_path = Path(str(args.root)).expanduser()
    if not root_path.is_absolute():
        root_path = (Path.cwd() / root_path).resolve()

    try:
        if renumber_mode:
            renumber_result = renumber_references(
                root_path,
                mode=renumber_mode,
                dry_run=bool(args.dry_run),
            )
            cwd = Path.cwd()
            print(f"[tex-splitter] renumber mode: {renumber_result.mode}")
            print(f"[tex-splitter] root: {_display_path(renumber_result.root_path, cwd)}")
            if renumber_result.backup_path is not None:
                backup_display = _display_path(renumber_result.backup_path, cwd)
                if renumber_result.dry_run:
                    print(f"[tex-splitter] backup (dry-run preview): {backup_display}")
                else:
                    print(f"[tex-splitter] backup: {backup_display}")
            else:
                print("[tex-splitter] backup: (not created)")
            print(
                f"[tex-splitter] renamed targets: {len(renumber_result.renamed)} "
                f"updated files: {len(renumber_result.updated_files)}"
            )
            for source, target in sorted(
                renumber_result.renamed.items(),
                key=lambda item: _display_path(item[0], cwd),
            ):
                print(
                    f"  - {_display_path(source, cwd)} -> {_display_path(target, cwd)}"
                )
            if renumber_result.warnings:
                print("[tex-splitter] warnings:")
                for warning in renumber_result.warnings:
                    print(f"  - {warning}")
            return 0

        if unsplit_target:
            unit_path = Path(unsplit_target).expanduser()
            if not unit_path.is_absolute():
                unit_path = (Path.cwd() / unit_path).resolve()
            unsplit_result = unsplit_one_unit(
                unit_path,
                dry_run=bool(args.dry_run),
                delete_source=not bool(args.keep_source),
            )
            cwd = Path.cwd()
            print(f"[tex-splitter] unsplit source: {_display_path(unsplit_result.unit_path, cwd)}")
            print(f"[tex-splitter] root: {_display_path(unsplit_result.root_path, cwd)}")
            if unsplit_result.backup_path is not None:
                backup_display = _display_path(unsplit_result.backup_path, cwd)
                if unsplit_result.dry_run:
                    print(f"[tex-splitter] backup (dry-run preview): {backup_display}")
                else:
                    print(f"[tex-splitter] backup: {backup_display}")
            else:
                print("[tex-splitter] backup: (not created)")
            print(
                f"[tex-splitter] deleted source: {'yes' if unsplit_result.deleted_source else 'no'}"
            )
            if unsplit_result.warnings:
                print("[tex-splitter] warnings:")
                for warning in unsplit_result.warnings:
                    print(f"  - {warning}")
            return 0

        sections_dir = Path(str(args.sections_dir)).expanduser()
        standalone_dir: Optional[Path] = None
        standalone_mode = _normalize_standalone_mode(str(args.standalone_mode))
        if args.with_standalone:
            standalone_mode = STANDALONE_MODE_LEGACY_WRAPPER
        with_standalone = standalone_mode == STANDALONE_MODE_LEGACY_WRAPPER
        if str(args.standalone_dir).strip():
            if not with_standalone:
                parser.error("--standalone-dir requires --standalone-mode legacy-wrapper.")
            standalone_dir = Path(str(args.standalone_dir)).expanduser()
        if args.use_include and not with_standalone:
            parser.error("--use-include requires --standalone-mode legacy-wrapper.")

        result = split_tex_file(
            root_path,
            sections_dir,
            standalone_mode=standalone_mode,
            use_include=bool(args.use_include),
            with_standalone=with_standalone,
            standalone_dir=standalone_dir,
            dry_run=bool(args.dry_run),
        )
    except ValueError as error:
        print(f"[tex-splitter] {error}", file=sys.stderr)
        return 2
    except OSError as error:
        print(f"[tex-splitter] filesystem error: {error}", file=sys.stderr)
        return 1

    cwd = Path.cwd()
    print(f"[tex-splitter] root: {_display_path(result.root_path, cwd)}")
    if result.backup_path is not None:
        backup_display = _display_path(result.backup_path, cwd)
        if result.dry_run:
            print(f"[tex-splitter] backup (dry-run preview): {backup_display}")
        else:
            print(f"[tex-splitter] backup: {backup_display}")
    else:
        print("[tex-splitter] backup: (not created)")
    print(
        f"[tex-splitter] class={result.document_class} split-by=\\{result.split_command} "
        f"units={len(result.units)} mode={result.standalone_mode} "
        f"macro={result.include_macro}"
    )
    if result.already_split:
        print("[tex-splitter] detected existing subfile layout; no rewrite applied.")
    if result.dry_run:
        print("[tex-splitter] dry-run: no files were written.")
    if result.subfiles_package_injected:
        print("[tex-splitter] injected: \\usepackage{subfiles}")
    for unit in result.units:
        title = unit.title.strip() or f"{result.split_command}-{unit.index}"
        print(f"  - {_display_path(unit.path, cwd)} :: {title}")
    if result.standalone_wrappers:
        standalone_dir_display = (
            _display_path(result.standalone_dir, cwd)
            if result.standalone_dir is not None
            else "(unknown)"
        )
        print(
            f"[tex-splitter] legacy standalone wrappers: {len(result.standalone_wrappers)} "
            f"under {standalone_dir_display}"
        )
        for wrapper_path in result.standalone_wrappers:
            print(f"  - {_display_path(wrapper_path, cwd)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
