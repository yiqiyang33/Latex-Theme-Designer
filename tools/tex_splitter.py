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
    except Exception:
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


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Split a root LaTeX file into modular files by top-level "
            "chapter/section and rewrite root body with \\subfile "
            "(default mode: subfiles)."
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
            "Preview split result without writing files. "
            "Reports planned units and root rewrite mode only."
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

    root_path = Path(str(args.root)).expanduser()
    if not root_path.is_absolute():
        root_path = (Path.cwd() / root_path).resolve()
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

    try:
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
