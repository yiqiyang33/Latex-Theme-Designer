#!/usr/bin/env python3
"""Split a monolithic LaTeX root file into chapter/section unit files."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Sequence

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
    backup_path: Path
    sections_dir: Path
    include_macro: str
    units: List[SplitUnit]


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


def split_tex_file(
    root_tex_path: Path,
    sections_dir: Path,
    use_include: bool = False,
) -> SplitResult:
    root_path = root_tex_path.expanduser().resolve()
    if not root_path.exists():
        raise ValueError(f"Root file does not exist: {root_tex_path}")
    if not root_path.is_file():
        raise ValueError(f"Root path is not a file: {root_tex_path}")

    tex_text = root_path.read_text(encoding="utf-8")
    document_class = _extract_document_class(tex_text)
    split_command = _split_command_for_document_class(document_class)

    body_start, body_end = _find_document_body_bounds(tex_text)
    preamble_plus_begin = tex_text[:body_start]
    body_text = tex_text[body_start:body_end]
    end_document_and_tail = tex_text[body_end:]

    anchors = _find_top_level_anchors(body_text, split_command)
    if not anchors:
        raise ValueError(
            f"No top-level \\{split_command} anchors found in document body."
        )

    section_dir_path = sections_dir.expanduser()
    if not section_dir_path.is_absolute():
        section_dir_path = root_path.parent / section_dir_path
    section_dir_path = section_dir_path.resolve()

    units: List[SplitUnit] = []
    width = max(2, len(str(len(anchors))))
    for index, anchor in enumerate(anchors, start=1):
        chunk_start = anchor.start()
        chunk_end = anchors[index].start() if index < len(anchors) else len(body_text)
        chunk_text = body_text[chunk_start:chunk_end]
        title = _extract_heading_title(body_text, split_command, chunk_start)
        slug = _slugify_heading(title)
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
    rewritten_text = preamble_plus_begin + new_body + end_document_and_tail

    section_dir_path.mkdir(parents=True, exist_ok=True)
    backup_path = _next_backup_path(root_path)
    shutil.copy2(root_path, backup_path)

    for unit in units:
        unit.path.write_text(unit.content, encoding="utf-8")
    root_path.write_text(rewritten_text, encoding="utf-8")

    return SplitResult(
        document_class=document_class,
        split_command=split_command,
        root_path=root_path,
        backup_path=backup_path,
        sections_dir=section_dir_path,
        include_macro=include_macro,
        units=units,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Split a root LaTeX file into modular files by top-level "
            "chapter/section and rewrite root body with \\input/\\include."
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
        help="Use \\include{...} in rewritten root body (default uses \\input{...}).",
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

    try:
        result = split_tex_file(
            root_path,
            sections_dir,
            use_include=bool(args.use_include),
        )
    except ValueError as error:
        print(f"[tex-splitter] {error}", file=sys.stderr)
        return 2
    except OSError as error:
        print(f"[tex-splitter] filesystem error: {error}", file=sys.stderr)
        return 1

    cwd = Path.cwd()
    print(f"[tex-splitter] root: {_display_path(result.root_path, cwd)}")
    print(f"[tex-splitter] backup: {_display_path(result.backup_path, cwd)}")
    print(
        f"[tex-splitter] class={result.document_class} split-by=\\{result.split_command} "
        f"units={len(result.units)} macro={result.include_macro}"
    )
    for unit in result.units:
        title = unit.title.strip() or f"{result.split_command}-{unit.index}"
        print(f"  - {_display_path(unit.path, cwd)} :: {title}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
