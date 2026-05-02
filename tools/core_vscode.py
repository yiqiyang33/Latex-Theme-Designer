#!/usr/bin/env python3
"""VSCode settings/recipe parsing helpers extracted from theme_designer_core."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable, Dict, List


def strip_jsonc_comments(raw: str) -> str:
    result: List[str] = []
    in_string = False
    escaped = False
    index = 0
    length = len(raw)

    while index < length:
        char = raw[index]

        if in_string:
            result.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue

        if char == '"':
            in_string = True
            result.append(char)
            index += 1
            continue

        if char == "/" and index + 1 < length:
            nxt = raw[index + 1]
            if nxt == "/":
                index += 2
                while index < length and raw[index] not in "\r\n":
                    index += 1
                continue
            if nxt == "*":
                index += 2
                while index + 1 < length and not (raw[index] == "*" and raw[index + 1] == "/"):
                    index += 1
                index = min(index + 2, length)
                continue

        result.append(char)
        index += 1

    return "".join(result)


def strip_json_trailing_commas(raw: str) -> str:
    result: List[str] = []
    in_string = False
    escaped = False
    index = 0
    length = len(raw)

    while index < length:
        char = raw[index]

        if in_string:
            result.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue

        if char == '"':
            in_string = True
            result.append(char)
            index += 1
            continue

        if char == ",":
            lookahead = index + 1
            while lookahead < length and raw[lookahead] in " \t\r\n":
                lookahead += 1
            if lookahead < length and raw[lookahead] in "}]":
                index += 1
                continue

        result.append(char)
        index += 1

    return "".join(result)


def parse_jsonc(raw: str) -> Dict[str, Any]:
    """Parse VSCode-style JSONC into a dict."""

    cleaned = strip_json_trailing_commas(strip_jsonc_comments(raw))
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("JSONC content must be a top-level object.")
    return data


def load_vscode_settings(
    *,
    vscode_settings_path: Path,
    read_text_fn: Callable[[Path], str],
    parse_jsonc_fn: Callable[[str], Dict[str, Any]],
) -> Dict[str, Any]:
    text = read_text_fn(vscode_settings_path)
    if not text.strip():
        return {}
    try:
        return parse_jsonc_fn(text)
    except json.JSONDecodeError as err:
        raise ValueError(f"Failed to parse {vscode_settings_path}: {err}") from err


def slugify(raw: str) -> str:
    lowered = raw.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slug or "unnamed"


def load_vscode_recipe_catalog(
    *,
    load_vscode_settings_fn: Callable[[], Dict[str, Any]],
    slugify_fn: Callable[[str], str],
) -> Dict[str, Any]:
    """Load latex-workshop tools/recipes from .vscode/settings.json."""

    catalog: Dict[str, Any] = {
        "tools": {},
        "recipes": [],
        "errors": [],
    }
    try:
        settings = load_vscode_settings_fn()
    except ValueError as err:
        catalog["errors"].append(str(err))
        return catalog

    raw_tools = settings.get("latex-workshop.latex.tools", [])
    if not isinstance(raw_tools, list):
        catalog["errors"].append("latex-workshop.latex.tools must be a list.")
        raw_tools = []

    tools: Dict[str, Dict[str, Any]] = {}
    for index, entry in enumerate(raw_tools):
        if not isinstance(entry, dict):
            catalog["errors"].append(f"Tool entry at index {index} is not an object.")
            continue

        name = str(entry.get("name", "")).strip()
        command = str(entry.get("command", "")).strip()
        raw_args = entry.get("args", [])
        if not isinstance(raw_args, list):
            catalog["errors"].append(f"Tool '{name or index}' args must be a list.")
            continue

        args = [str(item) for item in raw_args]
        if not name:
            catalog["errors"].append(f"Tool entry at index {index} is missing 'name'.")
            continue
        if not command:
            catalog["errors"].append(f"Tool '{name}' is missing 'command'.")
            continue

        tools[name] = {
            "name": name,
            "command": command,
            "args": args,
        }

    raw_recipes = settings.get("latex-workshop.latex.recipes", [])
    if not isinstance(raw_recipes, list):
        catalog["errors"].append("latex-workshop.latex.recipes must be a list.")
        raw_recipes = []

    recipes: List[Dict[str, Any]] = []
    for index, entry in enumerate(raw_recipes):
        if not isinstance(entry, dict):
            catalog["errors"].append(f"Recipe entry at index {index} is not an object.")
            continue

        name = str(entry.get("name", "")).strip()
        raw_tool_names = entry.get("tools", [])
        if not isinstance(raw_tool_names, list):
            catalog["errors"].append(f"Recipe '{name or index}' tools must be a list.")
            continue

        tool_names = [str(item).strip() for item in raw_tool_names if str(item).strip()]
        if not name:
            catalog["errors"].append(f"Recipe entry at index {index} is missing 'name'.")
            continue
        if not tool_names:
            catalog["errors"].append(f"Recipe '{name}' has no tools.")
            continue

        recipe_id = f"vscode-{index + 1}-{slugify_fn(name)}"
        recipes.append(
            {
                "id": recipe_id,
                "name": name,
                "tools": tool_names,
            }
        )

    catalog["tools"] = tools
    catalog["recipes"] = recipes
    return catalog


def toolkit_vscode_settings_template() -> Dict[str, Any]:
    """Return standard Toolkit VSCode settings payload."""

    return {
        "latex-workshop.latex.autoBuild.run": "onSave",
        "latex-workshop.showContextMenu": True,
        "latex-workshop.intellisense.package.enabled": True,
        "latex-workshop.message.error.show": False,
        "latex-workshop.message.warning.show": False,
        "latex-workshop.latex.rootFile.useSubFile": True,
        "latex-workshop.latex.rootFile.doNotPrompt": False,
        "latex-workshop.latex.build.enableMagicComments": False,
        "latex-workshop.latex.tools": [
            {
                "name": "xelatex",
                "command": "xelatex",
                "args": [
                    "-synctex=1",
                    "-interaction=nonstopmode",
                    "-file-line-error",
                    "%DOCFILE%",
                ],
            },
            {
                "name": "latexmk",
                "command": "latexmk",
                "args": [
                    "-synctex=1",
                    "-interaction=nonstopmode",
                    "-file-line-error",
                    "-xelatex",
                    "-outdir=%OUTDIR%",
                    "%DOCFILE%",
                ],
            },
            {
                "name": "biber",
                "command": "biber",
                "args": ["%DOCFILE%"],
            },
        ],
        "latex-workshop.latex.recipes": [
            {"name": "XeLaTeX", "tools": ["xelatex"]},
            {"name": "Biber", "tools": ["biber"]},
            {"name": "LaTeXmk", "tools": ["latexmk"]},
            {
                "name": "xelatex -> biber -> xelatex*2",
                "tools": ["xelatex", "biber", "xelatex", "xelatex"],
            },
        ],
        "latex-workshop.latex.clean.fileTypes": [
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
        ],
        "latex-workshop.latex.autoClean.run": "onFailed",
        "latex-workshop.latex.recipe.default": "LaTeXmk",
        "latex-workshop.view.pdf.internal.synctex.keybinding": "double-click",
        "[latex]": {"editor.defaultFormatter": "James-Yu.latex-workshop"},
    }


def generate_vscode_settings_if_missing(
    *,
    vscode_settings_path: Path,
    root_dir: Path,
    settings_template_fn: Callable[[], Dict[str, Any]],
) -> Dict[str, Any]:
    """Create .vscode/settings.json when missing; never overwrite existing file."""

    target = vscode_settings_path.resolve()
    root = root_dir.resolve()
    try:
        display_path = target.relative_to(root).as_posix()
    except ValueError:
        display_path = target.as_posix()

    if target.exists():
        if target.is_dir():
            raise ValueError(f"VSCode settings path is a directory: {display_path}")
        return {
            "created": False,
            "skipped_existing": True,
            "generated_path": display_path,
            "message": f"Skipped: {display_path} already exists.",
        }

    target.parent.mkdir(parents=True, exist_ok=True)
    content = settings_template_fn()
    target.write_text(
        json.dumps(content, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return {
        "created": True,
        "skipped_existing": False,
        "generated_path": display_path,
        "message": f"Generated: {display_path}",
    }
