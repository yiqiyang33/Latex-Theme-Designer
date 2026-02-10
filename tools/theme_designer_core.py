#!/usr/bin/env python3
"""Core state and compile logic for Theme Designer."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT_DIR / "theme.ui.json"
TOGGLE_OVERRIDE_PATH = ROOT_DIR / "theme.overrides.tex"
COLOR_OVERRIDE_PATH = ROOT_DIR / "theme.colors.tex"
MAIN_TEX_PATH = ROOT_DIR / "main.tex"
THEME_STY_PATH = ROOT_DIR / "theme.sty"
VSCODE_SETTINGS_PATH = ROOT_DIR / ".vscode" / "settings.json"

IGNORE_TEX_FILENAMES = {
    "theme.colors.tex",
    "theme.overrides.tex",
}
IGNORE_DIR_NAMES = {
    ".git",
    ".vscode",
    "__pycache__",
    "build",
    "dist",
    "out",
    ".venv",
    "venv",
    "node_modules",
}

STATE_LOCK = threading.Lock()


@dataclass
class CompileContext:
    """Resolved paths/filenames for one compile target."""

    target_rel: str
    target_abs: Path
    compile_cwd: Path
    docfile: str
    docstem: str
    default_pdf_abs: Path
    default_pdf_rel: str


TOGGLE_SCHEMA: List[Dict[str, str]] = [
    {
        "id": "enable_heading_theme",
        "command": "EnableHeadingTheme",
        "label": "Heading Theme",
        "help": "Style chapter/section/subsection headings.",
    },
    {
        "id": "enable_toc_theme",
        "command": "EnableTOCTheme",
        "label": "TOC Theme",
        "help": "Style table of contents typography and spacing.",
    },
    {
        "id": "enable_page_theme",
        "command": "EnablePageTheme",
        "label": "Page Header Theme",
        "help": "Enable custom header/footer with chapter marker.",
    },
    {
        "id": "enable_enhanced_env_style",
        "command": "EnableEnhancedEnvStyle",
        "label": "Enhanced Block Style",
        "help": "Use richer theorem/callout box styling.",
    },
    {
        "id": "enable_block_shadow",
        "command": "EnableBlockShadow",
        "label": "Block Shadow",
        "help": "Add subtle right/bottom shadow lines on blocks.",
    },
]


COLOR_GROUPS: List[Dict[str, Any]] = [
    {
        "title": "Document",
        "items": [
            {"id": "theme-chapter", "label": "Chapter title"},
            {"id": "theme-section", "label": "Section title"},
            {"id": "theme-subsection", "label": "Subsection title"},
            {"id": "theme-toc-title", "label": "TOC title"},
            {"id": "theme-toc-chapter", "label": "TOC chapter"},
            {"id": "theme-toc-section", "label": "TOC section"},
            {"id": "theme-header-rule", "label": "Header rule"},
        ],
    },
    {
        "title": "Definition",
        "items": [
            {"id": "definition-body-bg", "label": "Body bg"},
            {"id": "definition-title-bg", "label": "Title bg"},
            {"id": "definition-title-fg", "label": "Title fg"},
            {"id": "definition-accent", "label": "Accent"},
        ],
    },
    {
        "title": "Theorem",
        "items": [
            {"id": "theorem-body-bg", "label": "Body bg"},
            {"id": "theorem-title-bg", "label": "Title bg"},
            {"id": "theorem-title-fg", "label": "Title fg"},
            {"id": "theorem-accent", "label": "Accent"},
        ],
    },
    {
        "title": "Lemma",
        "items": [
            {"id": "lemma-body-bg", "label": "Body bg"},
            {"id": "lemma-title-bg", "label": "Title bg"},
            {"id": "lemma-title-fg", "label": "Title fg"},
            {"id": "lemma-accent", "label": "Accent"},
        ],
    },
    {
        "title": "Corollary",
        "items": [
            {"id": "corollary-body-bg", "label": "Body bg"},
            {"id": "corollary-title-bg", "label": "Title bg"},
            {"id": "corollary-title-fg", "label": "Title fg"},
            {"id": "corollary-accent", "label": "Accent"},
        ],
    },
    {
        "title": "Proposition",
        "items": [
            {"id": "proposition-body-bg", "label": "Body bg"},
            {"id": "proposition-title-bg", "label": "Title bg"},
            {"id": "proposition-title-fg", "label": "Title fg"},
            {"id": "proposition-accent", "label": "Accent"},
        ],
    },
    {
        "title": "Claim",
        "items": [
            {"id": "claim-body-bg", "label": "Body bg"},
            {"id": "claim-title-bg", "label": "Title bg"},
            {"id": "claim-title-fg", "label": "Title fg"},
            {"id": "claim-accent", "label": "Accent"},
        ],
    },
    {
        "title": "Fact",
        "items": [
            {"id": "fact-body-bg", "label": "Body bg"},
            {"id": "fact-title-bg", "label": "Title bg"},
            {"id": "fact-title-fg", "label": "Title fg"},
            {"id": "fact-accent", "label": "Accent"},
        ],
    },
    {
        "title": "Assumption",
        "items": [
            {"id": "assumption-body-bg", "label": "Body bg"},
            {"id": "assumption-title-bg", "label": "Title bg"},
            {"id": "assumption-title-fg", "label": "Title fg"},
            {"id": "assumption-accent", "label": "Accent"},
        ],
    },
    {
        "title": "Note",
        "items": [
            {"id": "note-bg", "label": "Body bg"},
            {"id": "note-title-bg", "label": "Title bg"},
            {"id": "note-title-fg", "label": "Title fg"},
            {"id": "note-accent", "label": "Accent"},
            {"id": "note-frame", "label": "Frame"},
        ],
    },
    {
        "title": "Example / Remark / Assump",
        "items": [
            {"id": "example-bg", "label": "Example bg"},
            {"id": "example-label-fg", "label": "Example label"},
            {"id": "example-accent", "label": "Example accent"},
            {"id": "remark-bg", "label": "Remark bg"},
            {"id": "remark-label-fg", "label": "Remark label"},
            {"id": "remark-inline-fg", "label": "Remark inline"},
            {"id": "remark-accent", "label": "Remark accent"},
            {"id": "assump-bg", "label": "Assump bg"},
            {"id": "assump-label-fg", "label": "Assump label"},
            {"id": "assump-accent", "label": "Assump accent"},
        ],
    },
]

COLOR_ORDER: List[str] = [
    item["id"] for group in COLOR_GROUPS for item in group["items"]
]

COLOR_SET = set(COLOR_ORDER)
TOGGLE_IDS = [entry["id"] for entry in TOGGLE_SCHEMA]

BASE_COLORS: Dict[str, Tuple[int, int, int]] = {
    "white": (255, 255, 255),
    "black": (0, 0, 0),
    "red": (255, 0, 0),
    "green": (0, 255, 0),
    "blue": (0, 0, 255),
    "cyan": (0, 255, 255),
    "magenta": (255, 0, 255),
    "yellow": (255, 255, 0),
    "orange": (255, 165, 0),
    "violet": (238, 130, 238),
    "pink": (255, 192, 203),
    "purple": (128, 0, 128),
    "midnightblue": (25, 25, 112),
    "navyblue": (0, 0, 128),
    "royalblue": (65, 105, 225),
}


def _read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="ignore")


# -------------------- VSCode JSONC Parsing --------------------

def _strip_jsonc_comments(raw: str) -> str:
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


def _strip_json_trailing_commas(raw: str) -> str:
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


def _parse_jsonc(raw: str) -> Dict[str, Any]:
    """Parse VSCode-style JSONC into a dict."""

    cleaned = _strip_json_trailing_commas(_strip_jsonc_comments(raw))
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("JSONC content must be a top-level object.")
    return data


def _load_vscode_settings() -> Dict[str, Any]:
    text = _read_text(VSCODE_SETTINGS_PATH)
    if not text.strip():
        return {}
    try:
        return _parse_jsonc(text)
    except json.JSONDecodeError as err:
        raise ValueError(f"Failed to parse {VSCODE_SETTINGS_PATH}: {err}") from err


def _slugify(raw: str) -> str:
    lowered = raw.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slug or "unnamed"


def _load_vscode_recipe_catalog() -> Dict[str, Any]:
    """Load latex-workshop tools/recipes from .vscode/settings.json."""

    catalog: Dict[str, Any] = {
        "tools": {},
        "recipes": [],
        "errors": [],
    }
    try:
        settings = _load_vscode_settings()
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

        recipe_id = f"vscode-{index + 1}-{_slugify(name)}"
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


def _default_compile_recipe(recipes: List[Dict[str, Any]]) -> str:
    if not recipes:
        return ""
    return str(recipes[0].get("id", ""))


def _normalize_compile_recipe(raw_recipe: Any, recipes: List[Dict[str, Any]]) -> str:
    if not recipes:
        return ""
    recipe_id = str(raw_recipe).strip() if raw_recipe is not None else ""
    if not recipe_id:
        return _default_compile_recipe(recipes)
    valid_ids = {str(item.get("id", "")) for item in recipes}
    if recipe_id in valid_ids:
        return recipe_id
    raise ValueError(f"Unknown compile recipe: {recipe_id}")


def _recipe_name_by_id(recipe_id: str, recipes: List[Dict[str, Any]]) -> str:
    for recipe in recipes:
        if str(recipe.get("id", "")) == recipe_id:
            return str(recipe.get("name", recipe_id))
    return ""


def _resolve_compile_context(compile_target: str) -> CompileContext:
    """Resolve and validate the selected compile target."""

    if not compile_target:
        raise ValueError("No compile target selected.")

    target_abs = (ROOT_DIR / compile_target).resolve()
    if not target_abs.exists():
        raise ValueError(f"Compile target does not exist: {compile_target}")
    if not target_abs.is_file():
        raise ValueError(f"Compile target is not a file: {compile_target}")
    if not _is_subpath(target_abs, ROOT_DIR.resolve()):
        raise ValueError(f"Compile target is outside workspace: {compile_target}")

    compile_cwd = target_abs.parent
    docfile = target_abs.name
    docstem = target_abs.stem
    default_pdf_abs = compile_cwd / f"{docstem}.pdf"
    default_pdf_rel = default_pdf_abs.relative_to(ROOT_DIR).as_posix()
    return CompileContext(
        target_rel=compile_target,
        target_abs=target_abs,
        compile_cwd=compile_cwd,
        docfile=docfile,
        docstem=docstem,
        default_pdf_abs=default_pdf_abs,
        default_pdf_rel=default_pdf_rel,
    )


def _append_step_log(
    logs: List[str],
    label: str,
    cwd: Path,
    command: List[str],
    output: str,
    code: int,
) -> None:
    logs.append(f"== {label} ==")
    logs.append(f"[cwd] {cwd}")
    logs.append("$ " + " ".join(command))
    if output.strip():
        lines = output.splitlines()
        logs.extend(lines[-140:])
    else:
        logs.append("(no output)")
    logs.append(f"[exit code: {code}]")
    logs.append("")


def _finalize_logs(logs: List[str]) -> str:
    joined = "\n".join(logs)
    return "\n".join(joined.splitlines()[-260:]) if joined else "(no compiler output)"


def _replace_recipe_tokens(value: str, ctx: CompileContext, outdir: str) -> str:
    """Replace recipe placeholders with concrete values for one compile run."""

    token_map = {
        "%DOCFILE%": ctx.docfile,
        "%DOC%": ctx.docstem,
        "%DOCFILEEXT%": ".tex",
        "%OUTDIR%": outdir,
    }
    resolved = value
    for token, replacement in token_map.items():
        resolved = resolved.replace(token, replacement)
    unresolved_tokens = re.findall(r"%[A-Z0-9_]+%", resolved)
    for token in unresolved_tokens:
        fallback = "."
        if "DOC" in token:
            fallback = ctx.docfile
        resolved = resolved.replace(token, fallback)
    return resolved


def _extract_recipe_outdir(args: List[str]) -> Optional[str]:
    for idx, arg in enumerate(args):
        if arg.startswith("-outdir="):
            return arg.split("=", 1)[1].strip() or None
        if arg.startswith("-output-directory="):
            return arg.split("=", 1)[1].strip() or None
        if arg in {"-outdir", "-output-directory"} and idx + 1 < len(args):
            value = args[idx + 1].strip()
            if value:
                return value
    return None


def _resolve_pdf_path_for_outdir(ctx: CompileContext, outdir: str) -> str:
    cleaned = (outdir or "").strip()
    if not cleaned or cleaned == ".":
        return ctx.default_pdf_rel

    outdir_path = Path(cleaned)
    if outdir_path.is_absolute():
        resolved_dir = outdir_path.resolve()
    else:
        resolved_dir = (ctx.compile_cwd / outdir_path).resolve()

    if not _is_subpath(resolved_dir, ROOT_DIR.resolve()):
        return ctx.default_pdf_rel
    return (resolved_dir / f"{ctx.docstem}.pdf").relative_to(ROOT_DIR).as_posix()


def _resolve_recipe_command(raw_command: str) -> str:
    command = raw_command.strip()
    if not command:
        return ""
    if "/" in command or "\\" in command:
        return command
    resolved = _resolve_binary(command)
    return resolved or command


# -------------------- Generic Value Parsing --------------------

def _bool_from_str(raw: str) -> Optional[bool]:
    lowered = raw.strip().lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    return None


def _hex_from_rgb(rgb: Tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def _blend_rgb(
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


def _parse_hex_color(raw: str) -> Optional[str]:
    value = raw.strip()
    if re.fullmatch(r"#?[0-9A-Fa-f]{6}", value):
        return "#" + value.lstrip("#").upper()
    return None


def _is_subpath(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _has_documentclass(tex_path: Path) -> bool:
    text = _read_text(tex_path)
    return bool(re.search(r"\\documentclass(?:\[[^\]]*\])?\{[^}]+\}", text))


# -------------------- Compile Target Discovery --------------------

def _list_candidate_tex_files() -> List[str]:
    root_candidates: List[str] = []
    nested_candidates: List[str] = []

    for tex_path in sorted(ROOT_DIR.glob("*.tex")):
        if tex_path.name in IGNORE_TEX_FILENAMES:
            continue
        if _has_documentclass(tex_path):
            root_candidates.append(tex_path.name)

    for tex_path in sorted(ROOT_DIR.rglob("*.tex")):
        if tex_path.parent == ROOT_DIR:
            continue
        if tex_path.name in IGNORE_TEX_FILENAMES:
            continue
        rel = tex_path.relative_to(ROOT_DIR)
        if any(part in IGNORE_DIR_NAMES or part.startswith(".") for part in rel.parts[:-1]):
            continue
        if _has_documentclass(tex_path):
            nested_candidates.append(rel.as_posix())

    candidates = root_candidates + sorted(set(nested_candidates))
    if not candidates and MAIN_TEX_PATH.exists():
        candidates.append("main.tex")

    return candidates


def _default_compile_target(candidates: List[str]) -> str:
    if "main.tex" in candidates:
        return "main.tex"
    return candidates[0] if candidates else ""


def _normalize_compile_target(raw_target: Any, candidates: List[str]) -> str:
    if not candidates:
        return ""

    target = str(raw_target).strip() if raw_target is not None else ""
    if not target:
        return _default_compile_target(candidates)
    if target in candidates:
        return target

    input_path = Path(target)
    if input_path.is_absolute():
        resolved = input_path.resolve()
    else:
        resolved = (ROOT_DIR / input_path).resolve()

    if not _is_subpath(resolved, ROOT_DIR.resolve()):
        raise ValueError(f"Compile target is outside workspace: {target}")

    rel = resolved.relative_to(ROOT_DIR).as_posix()
    if rel in candidates:
        return rel

    raise ValueError(f"Unknown compile target: {target}")


def _compile_output_pdf_relpath(compile_target: str) -> str:
    if not compile_target:
        return "main.pdf"
    return Path(compile_target).with_suffix(".pdf").as_posix()


def _resolve_workspace_pdf(rel_path: str) -> Tuple[Path, str]:
    raw = (rel_path or "").strip()
    if not raw:
        raw = "main.pdf"

    path_obj = Path(raw)
    if path_obj.is_absolute():
        raise ValueError("PDF path must be workspace-relative.")
    if path_obj.suffix.lower() != ".pdf":
        raise ValueError("PDF path must end with .pdf.")

    resolved = (ROOT_DIR / path_obj).resolve()
    if not _is_subpath(resolved, ROOT_DIR.resolve()):
        raise ValueError("PDF path is outside workspace.")

    return resolved, resolved.relative_to(ROOT_DIR).as_posix()


# -------------------- Theme Defaults and Overrides --------------------

def _parse_theme_color_defaults() -> Dict[str, str]:
    theme_text = _read_text(THEME_STY_PATH)
    colorlet_pairs = re.findall(r"\\colorlet\{([^}]+)\}\{([^}]+)\}", theme_text)
    expr_map: Dict[str, str] = {}
    for key, expr in colorlet_pairs:
        if key in COLOR_SET:
            expr_map[key] = expr.strip()

    cache: Dict[str, Tuple[int, int, int]] = {}

    def resolve_expr(expr: str, depth: int = 0) -> Tuple[int, int, int]:
        expr = expr.strip()
        if depth > 8:
            return (128, 128, 128)

        parsed_hex = _parse_hex_color(expr)
        if parsed_hex:
            h = parsed_hex.lstrip("#")
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

        lowered = expr.lower()
        if lowered in BASE_COLORS:
            return BASE_COLORS[lowered]

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
                    mixed = _blend_rgb(mixed, right, percent)
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
    for token in COLOR_ORDER:
        defaults[token] = _hex_from_rgb(resolve_token(token))
    return defaults


def _parse_main_toggle_defaults() -> Dict[str, bool]:
    text = _read_text(MAIN_TEX_PATH)
    defaults: Dict[str, bool] = {}
    for entry in TOGGLE_SCHEMA:
        command = entry["command"]
        matches = re.findall(rf"\\{command}(true|false)", text)
        if matches:
            parsed = _bool_from_str(matches[-1])
            defaults[entry["id"]] = True if parsed is None else parsed
        else:
            defaults[entry["id"]] = True
    return defaults


def _parse_toggle_override_file(path: Path) -> Dict[str, bool]:
    text = _read_text(path)
    found: Dict[str, bool] = {}
    for entry in TOGGLE_SCHEMA:
        command = entry["command"]
        matches = re.findall(rf"\\{command}(true|false)", text)
        if matches:
            parsed = _bool_from_str(matches[-1])
            if parsed is not None:
                found[entry["id"]] = parsed
    return found


def _parse_color_override_file(path: Path) -> Dict[str, str]:
    text = _read_text(path)
    define_map: Dict[str, str] = {
        name: "#" + value.upper()
        for name, value in re.findall(
            r"\\definecolor\{([^}]+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}", text
        )
    }
    overrides: Dict[str, str] = {}
    for token, mapped in re.findall(r"\\colorlet\{([^}]+)\}\{([^}]+)\}", text):
        if token not in COLOR_SET:
            continue
        if mapped in define_map:
            overrides[token] = define_map[mapped]
            continue
        parsed_hex = _parse_hex_color(mapped)
        if parsed_hex:
            overrides[token] = parsed_hex
    return overrides


# -------------------- State Load/Normalize/Persist --------------------

def _load_state() -> Dict[str, Any]:
    """Build runtime state from defaults + persisted UI state + override files."""

    compile_targets = _list_candidate_tex_files()
    recipe_catalog = _load_vscode_recipe_catalog()
    compile_recipes = recipe_catalog.get("recipes", [])
    state = {
        "toggles": _parse_main_toggle_defaults(),
        "colors": _parse_theme_color_defaults(),
        "compile_target": _default_compile_target(compile_targets),
        "compile_recipe": _default_compile_recipe(compile_recipes),
        "compile_use_internal_fallback": True,
    }

    if CONFIG_PATH.exists():
        try:
            persisted = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            persisted = {}
        if isinstance(persisted, dict):
            for key, value in persisted.get("toggles", {}).items():
                if key in state["toggles"]:
                    state["toggles"][key] = bool(value)
            for key, value in persisted.get("colors", {}).items():
                if key in state["colors"]:
                    parsed = _parse_hex_color(str(value))
                    if parsed:
                        state["colors"][key] = parsed
            if "compile_target" in persisted:
                try:
                    state["compile_target"] = _normalize_compile_target(
                        persisted.get("compile_target"),
                        compile_targets,
                    )
                except ValueError:
                    state["compile_target"] = _default_compile_target(compile_targets)
            if "compile_recipe" in persisted:
                try:
                    state["compile_recipe"] = _normalize_compile_recipe(
                        persisted.get("compile_recipe"),
                        compile_recipes,
                    )
                except ValueError:
                    state["compile_recipe"] = _default_compile_recipe(compile_recipes)
            if "compile_use_internal_fallback" in persisted:
                raw_mode = persisted.get("compile_use_internal_fallback")
                if isinstance(raw_mode, bool):
                    state["compile_use_internal_fallback"] = raw_mode
                elif isinstance(raw_mode, str):
                    parsed = _bool_from_str(raw_mode)
                    if parsed is not None:
                        state["compile_use_internal_fallback"] = parsed

    if TOGGLE_OVERRIDE_PATH.exists():
        state["toggles"].update(_parse_toggle_override_file(TOGGLE_OVERRIDE_PATH))
    if COLOR_OVERRIDE_PATH.exists():
        state["colors"].update(_parse_color_override_file(COLOR_OVERRIDE_PATH))

    for key in TOGGLE_IDS:
        state["toggles"].setdefault(key, True)
    for key in COLOR_ORDER:
        state["colors"].setdefault(key, "#808080")

    state["compile_targets"] = compile_targets
    state["compile_recipes"] = compile_recipes
    state["compile_recipe_errors"] = recipe_catalog.get("errors", [])
    state["compile_recipe_name"] = _recipe_name_by_id(
        state["compile_recipe"],
        compile_recipes,
    )
    state["compile_output_pdf"] = _compile_output_pdf_relpath(state["compile_target"])

    return state


def _normalize_payload(payload: Dict[str, Any], base_state: Dict[str, Any]) -> Dict[str, Any]:
    """Validate and normalize API payload using current state as baseline."""

    normalized = {
        "toggles": dict(base_state["toggles"]),
        "colors": dict(base_state["colors"]),
        "compile_target": base_state.get("compile_target", ""),
        "compile_recipe": base_state.get("compile_recipe", ""),
        "compile_use_internal_fallback": bool(
            base_state.get("compile_use_internal_fallback", True)
        ),
    }

    raw_toggles = payload.get("toggles", {})
    if isinstance(raw_toggles, dict):
        for key in TOGGLE_IDS:
            if key in raw_toggles:
                value = raw_toggles[key]
                if isinstance(value, bool):
                    normalized["toggles"][key] = value
                elif isinstance(value, str):
                    parsed = _bool_from_str(value)
                    if parsed is None:
                        raise ValueError(f"Invalid boolean value for {key}: {value}")
                    normalized["toggles"][key] = parsed
                else:
                    raise ValueError(f"Invalid boolean type for {key}")

    raw_colors = payload.get("colors", {})
    if isinstance(raw_colors, dict):
        for key in COLOR_ORDER:
            if key in raw_colors:
                parsed_hex = _parse_hex_color(str(raw_colors[key]))
                if not parsed_hex:
                    raise ValueError(f"Invalid hex color for {key}: {raw_colors[key]}")
                normalized["colors"][key] = parsed_hex

    if "compile_target" in payload:
        normalized["compile_target"] = _normalize_compile_target(
            payload.get("compile_target"),
            base_state.get("compile_targets", _list_candidate_tex_files()),
        )
    if "compile_recipe" in payload:
        normalized["compile_recipe"] = _normalize_compile_recipe(
            payload.get("compile_recipe"),
            base_state.get("compile_recipes", []),
        )
    if "compile_use_internal_fallback" in payload:
        raw_mode = payload.get("compile_use_internal_fallback")
        if isinstance(raw_mode, bool):
            normalized["compile_use_internal_fallback"] = raw_mode
        elif isinstance(raw_mode, str):
            parsed = _bool_from_str(raw_mode)
            if parsed is None:
                raise ValueError(
                    f"Invalid boolean value for compile_use_internal_fallback: {raw_mode}"
                )
            normalized["compile_use_internal_fallback"] = parsed
        else:
            raise ValueError("Invalid boolean type for compile_use_internal_fallback")

    return normalized


def _persist_ui_state(state: Dict[str, Any]) -> None:
    ui_state = {
        "toggles": state.get("toggles", {}),
        "colors": state.get("colors", {}),
        "compile_target": state.get("compile_target", ""),
        "compile_recipe": state.get("compile_recipe", ""),
        "compile_use_internal_fallback": bool(
            state.get("compile_use_internal_fallback", True)
        ),
    }
    CONFIG_PATH.write_text(
        json.dumps(ui_state, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


# -------------------- File Outputs --------------------

def _write_override_files(state: Dict[str, Any]) -> None:
    _persist_ui_state(state)

    toggle_lines = [
        "% Auto-generated by tools/theme_designer.py",
        "% Delete this file to return to defaults in main.tex.",
    ]
    for entry in TOGGLE_SCHEMA:
        value = "true" if state["toggles"][entry["id"]] else "false"
        toggle_lines.append(f"\\{entry['command']}{value}")
    TOGGLE_OVERRIDE_PATH.write_text("\n".join(toggle_lines) + "\n", encoding="utf-8")

    color_lines = [
        "% Auto-generated by tools/theme_designer.py",
        "% Delete this file to return to defaults in theme.sty.",
    ]
    for token in COLOR_ORDER:
        alias = "themeui" + re.sub(r"[^A-Za-z0-9]+", "", token)
        hex_value = state["colors"][token].lstrip("#").upper()
        color_lines.append(f"\\definecolor{{{alias}}}{{HTML}}{{{hex_value}}}")
        color_lines.append(f"\\colorlet{{{token}}}{{{alias}}}")
    COLOR_OVERRIDE_PATH.write_text("\n".join(color_lines) + "\n", encoding="utf-8")


def _delete_override_files() -> None:
    for path in (CONFIG_PATH, TOGGLE_OVERRIDE_PATH, COLOR_OVERRIDE_PATH):
        if path.exists():
            path.unlink()


# -------------------- Command Resolution and Execution --------------------

def _resolve_binary(name: str) -> Optional[str]:
    found = shutil.which(name)
    if found:
        return found

    candidate_dirs = [
        Path("/Library/TeX/texbin"),
        Path("/usr/texbin"),
        Path("/opt/homebrew/bin"),
        Path("/usr/local/bin"),
    ]
    for directory in candidate_dirs:
        candidate = directory / name
        if candidate.exists() and candidate.is_file():
            return str(candidate)
    return None


def _build_tex_env() -> Dict[str, str]:
    env = dict(os.environ)
    existing = [item for item in env.get("PATH", "").split(os.pathsep) if item]
    prepend = [
        "/Library/TeX/texbin",
        "/usr/texbin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
    ]
    merged: List[str] = []
    for path in prepend + existing:
        if path not in merged:
            merged.append(path)
    env["PATH"] = os.pathsep.join(merged)
    return env


def _run_command(command: List[str], cwd: Path = ROOT_DIR) -> Tuple[bool, int, str]:
    try:
        proc = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            env=_build_tex_env(),
        )
    except FileNotFoundError:
        return False, 127, f"[missing] command not found: {command[0]}"

    output = (proc.stdout or "") + ("\n" if proc.stdout and proc.stderr else "") + (proc.stderr or "")
    return proc.returncode == 0, proc.returncode, output


# -------------------- Compile Preference Helpers --------------------

def _extract_compile_preferences(normalized: Dict[str, Any]) -> Tuple[str, str, bool]:
    """Read compile target/recipe/mode from normalized state payload."""

    selected = str(normalized.get("compile_target", ""))
    selected_recipe = str(normalized.get("compile_recipe", ""))
    use_internal = bool(normalized.get("compile_use_internal_fallback", True))
    return selected, selected_recipe, use_internal


def _apply_compile_preferences(
    state: Dict[str, Any],
    compile_target: Optional[str] = None,
    compile_recipe: Optional[str] = None,
    use_internal_fallback: Optional[bool] = None,
) -> None:
    """Mutate in-memory state for compile preferences and derived fields."""

    if compile_target is not None:
        state["compile_target"] = compile_target
        state["compile_output_pdf"] = _compile_output_pdf_relpath(compile_target)
    if compile_recipe is not None:
        state["compile_recipe"] = compile_recipe
    if use_internal_fallback is not None:
        state["compile_use_internal_fallback"] = use_internal_fallback


# -------------------- Compile Pipelines --------------------

def _compile_tex_target_internal(ctx: CompileContext) -> Tuple[bool, str, str]:
    """Compile using the built-in pipeline (latexmk or xelatex/pdflatex fallback)."""

    logs: List[str] = []

    latexmk_bin = _resolve_binary("latexmk")
    if latexmk_bin:
        cmd = [
            latexmk_bin,
            "-g",
            "-xelatex",
            "-interaction=nonstopmode",
            "-halt-on-error",
            ctx.docfile,
        ]
        ok, code, out = _run_command(cmd, cwd=ctx.compile_cwd)
        _append_step_log(logs, "latexmk", ctx.compile_cwd, cmd, out, code)
        return ok, _finalize_logs(logs), ctx.default_pdf_rel

    logs.append("latexmk not found; using fallback compile pipeline.")
    logs.append("")

    tex_engine = _resolve_binary("xelatex") or _resolve_binary("pdflatex")
    if not tex_engine:
        logs.append(
            "No TeX engine found. Install TeX tools, or ensure commands are available in PATH."
        )
        return False, _finalize_logs(logs), ctx.default_pdf_rel

    first_pass_cmd = [
        tex_engine,
        "-interaction=nonstopmode",
        "-halt-on-error",
        ctx.docfile,
    ]
    ok, code, out = _run_command(first_pass_cmd, cwd=ctx.compile_cwd)
    _append_step_log(logs, "tex pass 1", ctx.compile_cwd, first_pass_cmd, out, code)
    if not ok:
        return False, _finalize_logs(logs), ctx.default_pdf_rel

    biber_bin = _resolve_binary("biber")
    has_bcf = (ctx.compile_cwd / f"{ctx.docstem}.bcf").exists()
    rerun_count = 1
    if has_bcf and biber_bin:
        biber_cmd = [biber_bin, ctx.docstem]
        bok, bcode, bout = _run_command(biber_cmd, cwd=ctx.compile_cwd)
        _append_step_log(logs, "biber", ctx.compile_cwd, biber_cmd, bout, bcode)
        if not bok:
            return False, _finalize_logs(logs), ctx.default_pdf_rel
        rerun_count = 2
    elif has_bcf and not biber_bin:
        logs.append(
            "biber not found; bibliography may be stale if your document has citations."
        )
        logs.append("")

    for idx in range(rerun_count):
        pass_cmd = [
            tex_engine,
            "-interaction=nonstopmode",
            "-halt-on-error",
            ctx.docfile,
        ]
        ok, code, out = _run_command(pass_cmd, cwd=ctx.compile_cwd)
        _append_step_log(logs, f"tex pass {idx + 2}", ctx.compile_cwd, pass_cmd, out, code)
        if not ok:
            return False, _finalize_logs(logs), ctx.default_pdf_rel

    expected_pdf_rel = ctx.default_pdf_rel
    success = ctx.default_pdf_abs.exists()
    if not success:
        fallback_pdfs = sorted(ctx.compile_cwd.glob("*.pdf"))
        if fallback_pdfs:
            fallback = fallback_pdfs[-1]
            expected_pdf_rel = fallback.relative_to(ROOT_DIR).as_posix()
            success = True
            logs.append(
                f"Expected {ctx.docstem}.pdf was not found. Using fallback PDF: {expected_pdf_rel}"
            )
        else:
            logs.append(
                f"Compile ended without errors, but {ctx.docstem}.pdf was not found."
            )

    return success, _finalize_logs(logs), expected_pdf_rel


def _compile_tex_target_recipe(ctx: CompileContext, recipe_id: str) -> Tuple[bool, str, str]:
    """Compile by executing one VSCode recipe tool-by-tool."""

    logs: List[str] = []
    catalog = _load_vscode_recipe_catalog()
    recipes = catalog.get("recipes", [])
    tools = catalog.get("tools", {})

    recipe: Optional[Dict[str, Any]] = None
    for item in recipes:
        if str(item.get("id", "")) == recipe_id:
            recipe = item
            break
    if recipe is None:
        logs.append(f"Unknown compile recipe: {recipe_id}")
        logs.append("Tip: choose an available recipe or enable internal fallback pipeline.")
        return False, _finalize_logs(logs), ctx.default_pdf_rel

    logs.append(f"[recipe] {recipe.get('name', recipe_id)}")
    logs.append("")

    outdir = "."
    for step_idx, tool_name in enumerate(recipe.get("tools", []), start=1):
        tool = tools.get(tool_name)
        if not isinstance(tool, dict):
            logs.append(f"Missing tool definition: '{tool_name}'")
            logs.append(
                "Tip: check .vscode/settings.json or enable internal fallback pipeline."
            )
            return False, _finalize_logs(logs), ctx.default_pdf_rel

        raw_command = str(tool.get("command", "")).strip()
        if not raw_command:
            logs.append(f"Tool '{tool_name}' has empty command.")
            return False, _finalize_logs(logs), ctx.default_pdf_rel

        command = _resolve_recipe_command(_replace_recipe_tokens(raw_command, ctx, outdir))
        if not command:
            logs.append(f"Tool '{tool_name}' resolved to empty command.")
            return False, _finalize_logs(logs), ctx.default_pdf_rel

        if Path(command).name == command and not _resolve_binary(command):
            logs.append(f"Missing command for tool '{tool_name}': {command}")
            logs.append(
                "Tip: install the command or enable internal fallback pipeline."
            )
            return False, _finalize_logs(logs), ctx.default_pdf_rel

        raw_args = tool.get("args", [])
        args = [_replace_recipe_tokens(str(arg), ctx, outdir) for arg in raw_args]
        detected_outdir = _extract_recipe_outdir(args)
        if detected_outdir:
            outdir = detected_outdir

        cmd = [command] + args
        ok, code, out = _run_command(cmd, cwd=ctx.compile_cwd)
        _append_step_log(
            logs,
            f"recipe step {step_idx}: {tool_name}",
            ctx.compile_cwd,
            cmd,
            out,
            code,
        )
        if not ok:
            return False, _finalize_logs(logs), _resolve_pdf_path_for_outdir(ctx, outdir)

    expected_pdf_rel = _resolve_pdf_path_for_outdir(ctx, outdir)
    expected_pdf_abs = (ROOT_DIR / expected_pdf_rel).resolve()
    if expected_pdf_abs.exists():
        return True, _finalize_logs(logs), expected_pdf_rel

    fallback_pdfs = sorted(ctx.compile_cwd.glob("*.pdf"))
    if fallback_pdfs:
        fallback = fallback_pdfs[-1]
        fallback_rel = fallback.relative_to(ROOT_DIR).as_posix()
        logs.append(f"Expected PDF not found at {expected_pdf_rel}. Using fallback PDF: {fallback_rel}")
        return True, _finalize_logs(logs), fallback_rel

    logs.append(f"Compile finished, but expected PDF was not found: {expected_pdf_rel}")
    return False, _finalize_logs(logs), expected_pdf_rel


def _compile_tex_target(
    compile_target: str,
    compile_recipe: str = "",
    use_internal_fallback: bool = True,
) -> Tuple[bool, str, str]:
    """Unified compile entrypoint for internal mode and recipe mode."""

    try:
        ctx = _resolve_compile_context(compile_target)
    except ValueError as err:
        return False, str(err), ""

    if use_internal_fallback:
        return _compile_tex_target_internal(ctx)
    return _compile_tex_target_recipe(ctx, compile_recipe)


# -------------------- API Response Builder --------------------

def _build_response_state() -> Dict[str, Any]:
    state = _load_state()
    return {
        "state": state,
        "schema": {
            "toggles": TOGGLE_SCHEMA,
            "groups": COLOR_GROUPS,
        },
    }

