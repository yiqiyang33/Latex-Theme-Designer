#!/usr/bin/env python3
"""Core state and compile logic for Theme Designer."""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import threading
from datetime import datetime, timezone
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

CLASS_CONFIG_SCHEMA: List[Dict[str, Any]] = [
    {
        "id": "theme_class_mode",
        "command": "ThemeClassMode",
        "label": "Class Mode",
        "help": "Auto follows target document class; force book/article when needed.",
        "options": [
            {"value": "auto", "label": "Auto (detect target class)"},
            {"value": "book", "label": "Force book"},
            {"value": "article", "label": "Force article"},
        ],
    },
    {
        "id": "theme_heading_chapter_mode",
        "command": "ThemeHeadingChapterMode",
        "label": "Chapter Heading Rule",
        "help": "Control chapter heading styling when chapter is available.",
        "options": [
            {"value": "auto", "label": "Auto (book-only)"},
            {"value": "on", "label": "On if chapter exists"},
            {"value": "off", "label": "Always off"},
        ],
    },
    {
        "id": "theme_page_header_mode",
        "command": "ThemePageHeaderMode",
        "label": "Page Header Rule",
        "help": "Choose chapter-mark or section-mark page headers.",
        "options": [
            {"value": "auto", "label": "Auto by class"},
            {"value": "chapter", "label": "Prefer chapter mark"},
            {"value": "section", "label": "Prefer section mark"},
        ],
    },
    {
        "id": "theme_theorem_numbering_policy",
        "command": "ThemeTheoremNumberingPolicy",
        "label": "Theorem Numbering",
        "help": "Select theorem counter scope for definition/theorem family.",
        "options": [
            {"value": "auto", "label": "Auto (book=chapter, article=section)"},
            {"value": "section", "label": "Within section"},
            {"value": "chapter", "label": "Within chapter (fallback section)"},
            {"value": "none", "label": "Global continuous counter"},
        ],
    },
]

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
CLASS_CONFIG_IDS = [entry["id"] for entry in CLASS_CONFIG_SCHEMA]
CLASS_CONFIG_COMMANDS = {
    entry["id"]: str(entry["command"]) for entry in CLASS_CONFIG_SCHEMA
}
CLASS_CONFIG_DEFAULTS = {
    entry["id"]: str(entry["options"][0]["value"]) for entry in CLASS_CONFIG_SCHEMA
}
CLASS_CONFIG_VALID_OPTIONS = {
    entry["id"]: {str(opt["value"]) for opt in entry["options"]}
    for entry in CLASS_CONFIG_SCHEMA
}

BODY_FONT_SIZE_CONFIG: Dict[str, Any] = {
    "id": "body_font_size_pt",
    "label": "Body Font Size",
    "help": "Base body text font size applied at begin document.",
    "min": 9.0,
    "max": 14.0,
    "step": 0.5,
    "default": 10.0,
}
BODY_FONT_SIZE_ID = str(BODY_FONT_SIZE_CONFIG["id"])
BODY_FONT_SIZE_MIN = float(BODY_FONT_SIZE_CONFIG["min"])
BODY_FONT_SIZE_MAX = float(BODY_FONT_SIZE_CONFIG["max"])
BODY_FONT_SIZE_STEP = float(BODY_FONT_SIZE_CONFIG["step"])
BODY_FONT_SIZE_DEFAULT = float(BODY_FONT_SIZE_CONFIG["default"])

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

BLOCK_COLOR_TOKENS: List[str] = [
    token for token in COLOR_ORDER if not token.startswith("theme-")
]

DOCUMENT_COLOR_TOKENS: List[str] = [
    token for token in COLOR_ORDER if token.startswith("theme-")
]

BLOCK_PRESET_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "id": "default",
        "label": "Default",
        "description": "Current built-in theorem/callout palette from theme.sty.",
    },
    {
        "id": "midnight",
        "label": "Midnight",
        "description": "Cool, high-contrast palette for theorem and callout blocks.",
        "colors": {
            "definition-body-bg": "#EAF2FF",
            "definition-title-bg": "#C8DAFF",
            "definition-title-fg": "#0F2A5F",
            "definition-accent": "#2952A3",
            "theorem-body-bg": "#E6F9FF",
            "theorem-title-bg": "#B8EBF7",
            "theorem-title-fg": "#0D4A5A",
            "theorem-accent": "#1B7286",
            "lemma-body-bg": "#F5ECFF",
            "lemma-title-bg": "#DEC8F8",
            "lemma-title-fg": "#45226E",
            "lemma-accent": "#6A3CA0",
            "corollary-body-bg": "#FFF4E5",
            "corollary-title-bg": "#F9D7A8",
            "corollary-title-fg": "#6B3D00",
            "corollary-accent": "#A65A00",
            "proposition-body-bg": "#F7F8E8",
            "proposition-title-bg": "#E6E9B5",
            "proposition-title-fg": "#5C5E1A",
            "proposition-accent": "#8A8D2B",
            "claim-body-bg": "#FFF1F3",
            "claim-title-bg": "#F8CDD5",
            "claim-title-fg": "#612532",
            "claim-accent": "#9A4155",
            "fact-body-bg": "#F1F0F8",
            "fact-title-bg": "#D5D1EB",
            "fact-title-fg": "#2D234A",
            "fact-accent": "#5A4E88",
            "assumption-body-bg": "#FFF8E8",
            "assumption-title-bg": "#F2E2B5",
            "assumption-title-fg": "#5E4A14",
            "assumption-accent": "#927320",
            "note-bg": "#EEF2FF",
            "note-title-bg": "#CFD7FF",
            "note-title-fg": "#1B2562",
            "note-accent": "#3342A8",
            "note-frame": "#B8C3FF",
            "example-bg": "#E8FAFA",
            "example-label-fg": "#0F6E70",
            "example-accent": "#19989B",
            "remark-bg": "#F0F4FF",
            "remark-label-fg": "#233B88",
            "remark-inline-fg": "#2B4AB0",
            "remark-accent": "#3D56C2",
            "assump-bg": "#FFF9E9",
            "assump-label-fg": "#6B5B1F",
            "assump-accent": "#A0801A",
        },
    },
    {
        "id": "meadow",
        "label": "Meadow",
        "description": "Soft green-blue palette with calm earth-tone accents.",
        "colors": {
            "definition-body-bg": "#ECF8F1",
            "definition-title-bg": "#CDECDC",
            "definition-title-fg": "#1E4A34",
            "definition-accent": "#2F7A55",
            "theorem-body-bg": "#ECF7F9",
            "theorem-title-bg": "#CBE9F0",
            "theorem-title-fg": "#174452",
            "theorem-accent": "#2B7084",
            "lemma-body-bg": "#F2F0FA",
            "lemma-title-bg": "#DCCFF3",
            "lemma-title-fg": "#3F2D66",
            "lemma-accent": "#6945A6",
            "corollary-body-bg": "#FFF6E9",
            "corollary-title-bg": "#F8DBB3",
            "corollary-title-fg": "#6A4210",
            "corollary-accent": "#A0631C",
            "proposition-body-bg": "#F6F7E9",
            "proposition-title-bg": "#E2E7BD",
            "proposition-title-fg": "#4B5421",
            "proposition-accent": "#748233",
            "claim-body-bg": "#FFF1F0",
            "claim-title-bg": "#F9D3CF",
            "claim-title-fg": "#6A2F2A",
            "claim-accent": "#A14C43",
            "fact-body-bg": "#F3F2FA",
            "fact-title-bg": "#DCD6F0",
            "fact-title-fg": "#342A59",
            "fact-accent": "#5B4B8C",
            "assumption-body-bg": "#FFF9EA",
            "assumption-title-bg": "#F4E5BF",
            "assumption-title-fg": "#64531B",
            "assumption-accent": "#9A7A29",
            "note-bg": "#EEF8F5",
            "note-title-bg": "#D4ECE4",
            "note-title-fg": "#1F4A3D",
            "note-accent": "#2F7C64",
            "note-frame": "#B8DDD1",
            "example-bg": "#EBFAF6",
            "example-label-fg": "#1F6D5F",
            "example-accent": "#2D9E8A",
            "remark-bg": "#EEF4FB",
            "remark-label-fg": "#294A78",
            "remark-inline-fg": "#2F5A90",
            "remark-accent": "#3E6FB0",
            "assump-bg": "#F9FCEB",
            "assump-label-fg": "#5E6827",
            "assump-accent": "#8B9A33",
        },
    },
    {
        "id": "ember",
        "label": "Ember",
        "description": "Warm sunset palette with rose, amber, and plum contrast.",
        "colors": {
            "definition-body-bg": "#FFF3EE",
            "definition-title-bg": "#F7D4C7",
            "definition-title-fg": "#5F2D1F",
            "definition-accent": "#9A4B33",
            "theorem-body-bg": "#FFF7EC",
            "theorem-title-bg": "#F8DEB9",
            "theorem-title-fg": "#664110",
            "theorem-accent": "#A56A1E",
            "lemma-body-bg": "#F9F0FF",
            "lemma-title-bg": "#E7D2F6",
            "lemma-title-fg": "#4F2D67",
            "lemma-accent": "#7B49A2",
            "corollary-body-bg": "#FFF1F4",
            "corollary-title-bg": "#F8CFD8",
            "corollary-title-fg": "#652536",
            "corollary-accent": "#A0455C",
            "proposition-body-bg": "#FDF5E9",
            "proposition-title-bg": "#F0DDBD",
            "proposition-title-fg": "#5F481F",
            "proposition-accent": "#967034",
            "claim-body-bg": "#FFF0EB",
            "claim-title-bg": "#F8CEC0",
            "claim-title-fg": "#6A2C1D",
            "claim-accent": "#A44C33",
            "fact-body-bg": "#F2F3FD",
            "fact-title-bg": "#D8DCF7",
            "fact-title-fg": "#2C356D",
            "fact-accent": "#4657B5",
            "assumption-body-bg": "#FFF8EF",
            "assumption-title-bg": "#F5E3C6",
            "assumption-title-fg": "#6A4C20",
            "assumption-accent": "#A7782D",
            "note-bg": "#F8F2FF",
            "note-title-bg": "#E4D7F9",
            "note-title-fg": "#3F2A66",
            "note-accent": "#6243A3",
            "note-frame": "#CDBBEA",
            "example-bg": "#FFF9EF",
            "example-label-fg": "#7A4B13",
            "example-accent": "#B4711A",
            "remark-bg": "#FFF2F1",
            "remark-label-fg": "#7A3030",
            "remark-inline-fg": "#A04242",
            "remark-accent": "#C55A50",
            "assump-bg": "#FFF8E9",
            "assump-label-fg": "#6C5A20",
            "assump-accent": "#A58625",
        },
    },
]

HEADING_TOC_PRESET_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "id": "default",
        "label": "Default",
        "description": "Current built-in heading/TOC palette from theme.sty.",
    },
    {
        "id": "inkstone",
        "label": "Inkstone",
        "description": "Deep indigo heading palette with restrained TOC contrast.",
        "colors": {
            "theme-chapter": "#1F2A44",
            "theme-section": "#273B66",
            "theme-subsection": "#35589A",
            "theme-toc-title": "#1E2D53",
            "theme-toc-chapter": "#243A6A",
            "theme-toc-section": "#4465A8",
            "theme-header-rule": "#1B2948",
        },
    },
    {
        "id": "aurora",
        "label": "Aurora",
        "description": "Cool teal-forward scheme for modern notes and reports.",
        "colors": {
            "theme-chapter": "#0E5A61",
            "theme-section": "#12727E",
            "theme-subsection": "#2F94A3",
            "theme-toc-title": "#0F6169",
            "theme-toc-chapter": "#107681",
            "theme-toc-section": "#2C8D99",
            "theme-header-rule": "#0D4A50",
        },
    },
    {
        "id": "sunset",
        "label": "Sunset",
        "description": "Warm rust and amber hierarchy for chapter and TOC headings.",
        "colors": {
            "theme-chapter": "#8A2E3B",
            "theme-section": "#A3422E",
            "theme-subsection": "#C26C2A",
            "theme-toc-title": "#7A2A36",
            "theme-toc-chapter": "#954137",
            "theme-toc-section": "#B66232",
            "theme-header-rule": "#6F2D33",
        },
    },
]


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


def _recipe_entry_by_id(
    recipe_id: str,
    recipes: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    for recipe in recipes:
        if str(recipe.get("id", "")) == recipe_id:
            return recipe
    return None


def _recipe_outdir_for_context(
    ctx: CompileContext,
    recipe_id: str,
    catalog: Dict[str, Any],
) -> str:
    """Resolve final %OUTDIR% value for one target+recipe pair."""

    recipes = catalog.get("recipes", [])
    recipe = _recipe_entry_by_id(recipe_id, recipes)
    if recipe is None:
        return "."

    tools = catalog.get("tools", {})
    outdir = "."
    for tool_name in recipe.get("tools", []):
        tool = tools.get(tool_name)
        if not isinstance(tool, dict):
            continue
        raw_args = tool.get("args", [])
        args = [_replace_recipe_tokens(str(arg), ctx, outdir) for arg in raw_args]
        detected = _extract_recipe_outdir(args)
        if detected:
            outdir = detected
    return outdir


def _expected_output_pdf_for_selection(
    compile_target: str,
    compile_recipe: str,
    use_internal_fallback: bool,
    recipe_catalog: Optional[Dict[str, Any]] = None,
) -> str:
    """Predict output PDF path for the selected compile configuration."""

    if not compile_target:
        return "main.pdf"

    try:
        ctx = _resolve_compile_context(compile_target)
    except ValueError:
        return _compile_output_pdf_relpath(compile_target)

    if use_internal_fallback:
        return ctx.default_pdf_rel

    catalog = recipe_catalog if recipe_catalog is not None else _load_vscode_recipe_catalog()
    outdir = _recipe_outdir_for_context(ctx, compile_recipe, catalog)
    return _resolve_pdf_path_for_outdir(ctx, outdir)


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


def _format_body_font_size(value: float) -> str:
    return f"{value:.1f}"


def _parse_body_font_size_value(raw_value: Any) -> Optional[float]:
    if isinstance(raw_value, bool):
        return None
    try:
        parsed = float(raw_value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def _normalize_body_font_size_value(raw_value: Any) -> float:
    parsed = _parse_body_font_size_value(raw_value)
    if parsed is None:
        return BODY_FONT_SIZE_DEFAULT
    clamped = min(BODY_FONT_SIZE_MAX, max(BODY_FONT_SIZE_MIN, parsed))
    snapped_steps = round((clamped - BODY_FONT_SIZE_MIN) / BODY_FONT_SIZE_STEP)
    snapped = BODY_FONT_SIZE_MIN + snapped_steps * BODY_FONT_SIZE_STEP
    bounded = min(BODY_FONT_SIZE_MAX, max(BODY_FONT_SIZE_MIN, snapped))
    return round(bounded, 1)


def _validate_body_font_size_value(raw_value: Any) -> float:
    parsed = _parse_body_font_size_value(raw_value)
    if parsed is None:
        raise ValueError(
            f"Invalid value for {BODY_FONT_SIZE_ID}: {raw_value}. Expected a number."
        )
    if parsed < BODY_FONT_SIZE_MIN or parsed > BODY_FONT_SIZE_MAX:
        raise ValueError(
            f"Invalid value for {BODY_FONT_SIZE_ID}: {raw_value}. "
            f"Expected {BODY_FONT_SIZE_MIN:.1f} to {BODY_FONT_SIZE_MAX:.1f}."
        )
    normalized = _normalize_body_font_size_value(parsed)
    if abs(normalized - parsed) > 1e-9:
        raise ValueError(
            f"Invalid value for {BODY_FONT_SIZE_ID}: {raw_value}. "
            f"Expected increments of {BODY_FONT_SIZE_STEP:.1f}."
        )
    return normalized


def _build_block_preset_catalog(theme_defaults: Dict[str, str]) -> List[Dict[str, Any]]:
    catalog: List[Dict[str, Any]] = []
    for preset in BLOCK_PRESET_DEFINITIONS:
        preset_id = str(preset.get("id", "")).strip()
        if not preset_id:
            continue
        token_map: Dict[str, str] = {
            token: _parse_hex_color(str(theme_defaults.get(token, "#808080"))) or "#808080"
            for token in BLOCK_COLOR_TOKENS
        }
        raw_colors = preset.get("colors", {})
        if isinstance(raw_colors, dict):
            for token in BLOCK_COLOR_TOKENS:
                if token not in raw_colors:
                    continue
                parsed = _parse_hex_color(str(raw_colors[token]))
                if parsed:
                    token_map[token] = parsed
        catalog.append(
            {
                "id": preset_id,
                "label": str(preset.get("label", preset_id)),
                "description": str(preset.get("description", "")),
                "tokens": token_map,
            }
        )
    return catalog


def _block_preset_meta(catalog: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    return [
        {
            "id": str(entry.get("id", "")),
            "label": str(entry.get("label", entry.get("id", ""))),
            "description": str(entry.get("description", "")),
        }
        for entry in catalog
        if str(entry.get("id", "")).strip()
    ]


def _default_block_preset_id(block_presets: List[Dict[str, Any]]) -> str:
    if not isinstance(block_presets, list):
        return "default"
    for item in block_presets:
        if str(item.get("id", "")).strip() == "default":
            return "default"
    if block_presets:
        return str(block_presets[0].get("id", "default"))
    return "default"


def _normalize_block_preset(raw_preset: Any, block_presets: List[Dict[str, Any]]) -> str:
    if not isinstance(block_presets, list):
        block_presets = []
    valid_ids = {
        str(item.get("id", "")).strip()
        for item in block_presets
        if str(item.get("id", "")).strip()
    }
    default_id = _default_block_preset_id(block_presets)
    if not valid_ids:
        return default_id
    preset_id = str(raw_preset).strip() if raw_preset is not None else ""
    if not preset_id:
        return default_id
    if preset_id in valid_ids:
        return preset_id
    raise ValueError(
        f"Unknown block preset: {preset_id}. Expected one of: {', '.join(sorted(valid_ids))}"
    )


def _block_preset_tokens_by_id(
    preset_id: str,
    catalog: List[Dict[str, Any]],
) -> Dict[str, str]:
    for item in catalog:
        if str(item.get("id", "")).strip() != preset_id:
            continue
        raw_tokens = item.get("tokens", {})
        if not isinstance(raw_tokens, dict):
            break
        parsed: Dict[str, str] = {}
        for token in BLOCK_COLOR_TOKENS:
            maybe = _parse_hex_color(str(raw_tokens.get(token, "")))
            if maybe:
                parsed[token] = maybe
        if len(parsed) == len(BLOCK_COLOR_TOKENS):
            return parsed
    raise ValueError(f"Block preset token map not found for: {preset_id}")


def _apply_block_preset(state: Dict[str, Any], preset_id: Any) -> None:
    theme_defaults = _parse_theme_color_defaults()
    catalog = _build_block_preset_catalog(theme_defaults)
    block_presets = _block_preset_meta(catalog)
    normalized_preset = _normalize_block_preset(preset_id, block_presets)
    token_map = _block_preset_tokens_by_id(normalized_preset, catalog)
    state.setdefault("colors", {})
    for token, value in token_map.items():
        state["colors"][token] = value
    state["block_preset"] = normalized_preset
    state["block_presets"] = block_presets


def _build_heading_toc_preset_catalog(theme_defaults: Dict[str, str]) -> List[Dict[str, Any]]:
    catalog: List[Dict[str, Any]] = []
    for preset in HEADING_TOC_PRESET_DEFINITIONS:
        preset_id = str(preset.get("id", "")).strip()
        if not preset_id:
            continue
        token_map: Dict[str, str] = {
            token: _parse_hex_color(str(theme_defaults.get(token, "#808080"))) or "#808080"
            for token in DOCUMENT_COLOR_TOKENS
        }
        raw_colors = preset.get("colors", {})
        if isinstance(raw_colors, dict):
            for token in DOCUMENT_COLOR_TOKENS:
                if token not in raw_colors:
                    continue
                parsed = _parse_hex_color(str(raw_colors[token]))
                if parsed:
                    token_map[token] = parsed
        catalog.append(
            {
                "id": preset_id,
                "label": str(preset.get("label", preset_id)),
                "description": str(preset.get("description", "")),
                "tokens": token_map,
            }
        )
    return catalog


def _heading_toc_preset_meta(catalog: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    return [
        {
            "id": str(entry.get("id", "")),
            "label": str(entry.get("label", entry.get("id", ""))),
            "description": str(entry.get("description", "")),
        }
        for entry in catalog
        if str(entry.get("id", "")).strip()
    ]


def _default_heading_toc_preset_id(heading_toc_presets: List[Dict[str, Any]]) -> str:
    if not isinstance(heading_toc_presets, list):
        return "default"
    for item in heading_toc_presets:
        if str(item.get("id", "")).strip() == "default":
            return "default"
    if heading_toc_presets:
        return str(heading_toc_presets[0].get("id", "default"))
    return "default"


def _normalize_heading_toc_preset(
    raw_preset: Any,
    heading_toc_presets: List[Dict[str, Any]],
) -> str:
    if not isinstance(heading_toc_presets, list):
        heading_toc_presets = []
    valid_ids = {
        str(item.get("id", "")).strip()
        for item in heading_toc_presets
        if str(item.get("id", "")).strip()
    }
    default_id = _default_heading_toc_preset_id(heading_toc_presets)
    if not valid_ids:
        return default_id
    preset_id = str(raw_preset).strip() if raw_preset is not None else ""
    if not preset_id:
        return default_id
    if preset_id in valid_ids:
        return preset_id
    raise ValueError(
        "Unknown heading/TOC preset: "
        f"{preset_id}. Expected one of: {', '.join(sorted(valid_ids))}"
    )


def _heading_toc_preset_tokens_by_id(
    preset_id: str,
    catalog: List[Dict[str, Any]],
) -> Dict[str, str]:
    for item in catalog:
        if str(item.get("id", "")).strip() != preset_id:
            continue
        raw_tokens = item.get("tokens", {})
        if not isinstance(raw_tokens, dict):
            break
        parsed: Dict[str, str] = {}
        for token in DOCUMENT_COLOR_TOKENS:
            maybe = _parse_hex_color(str(raw_tokens.get(token, "")))
            if maybe:
                parsed[token] = maybe
        if len(parsed) == len(DOCUMENT_COLOR_TOKENS):
            return parsed
    raise ValueError(f"Heading/TOC preset token map not found for: {preset_id}")


def _apply_heading_toc_preset(state: Dict[str, Any], preset_id: Any) -> None:
    theme_defaults = _parse_theme_color_defaults()
    catalog = _build_heading_toc_preset_catalog(theme_defaults)
    heading_toc_presets = _heading_toc_preset_meta(catalog)
    normalized_preset = _normalize_heading_toc_preset(preset_id, heading_toc_presets)
    token_map = _heading_toc_preset_tokens_by_id(normalized_preset, catalog)
    state.setdefault("colors", {})
    for token, value in token_map.items():
        state["colors"][token] = value
    state["heading_toc_preset"] = normalized_preset
    state["heading_toc_presets"] = heading_toc_presets


def _is_subpath(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _normalize_class_config_value(field_id: str, raw_value: Any) -> str:
    valid = CLASS_CONFIG_VALID_OPTIONS.get(field_id, set())
    parsed = str(raw_value or "").strip().lower()
    if parsed in valid:
        return parsed
    return CLASS_CONFIG_DEFAULTS[field_id]


def _validate_class_config_value(field_id: str, raw_value: Any) -> str:
    parsed = str(raw_value or "").strip().lower()
    valid = CLASS_CONFIG_VALID_OPTIONS.get(field_id, set())
    if parsed in valid:
        return parsed
    options = ", ".join(sorted(valid))
    raise ValueError(f"Invalid value for {field_id}: {raw_value}. Expected one of: {options}")


def _normalize_class_config_map(raw_map: Dict[str, Any]) -> Dict[str, str]:
    config = dict(CLASS_CONFIG_DEFAULTS)
    if not isinstance(raw_map, dict):
        return config
    for field_id in CLASS_CONFIG_IDS:
        if field_id in raw_map:
            config[field_id] = _normalize_class_config_value(field_id, raw_map[field_id])
    return config


def _extract_documentclass_name(tex_path: Path) -> str:
    text = _read_text(tex_path)
    match = re.search(r"\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}", text)
    if not match:
        return ""
    raw_name = match.group(1).strip()
    if "," in raw_name:
        raw_name = raw_name.split(",", 1)[0]
    return raw_name.strip().lower()


def _is_chapter_capable_class(class_name: str) -> bool:
    name = (class_name or "").strip().lower()
    if not name:
        return False
    if name in CHAPTER_CLASS_NAMES:
        return True
    return name.endswith("book") or name.endswith("report")


def _detect_target_documentclass(compile_target: str) -> str:
    if not compile_target:
        return ""
    try:
        target_abs = _resolve_compile_context(compile_target).target_abs
    except ValueError:
        return ""
    return _extract_documentclass_name(target_abs)


def _effective_theme_class(theme_class_mode: str, detected_document_class: str) -> str:
    mode = _normalize_class_config_value("theme_class_mode", theme_class_mode)
    if mode in {"book", "article"}:
        return mode
    if _is_chapter_capable_class(detected_document_class):
        return "book"
    return "article"


def _has_documentclass(tex_path: Path) -> bool:
    return bool(_extract_documentclass_name(tex_path))


def _class_profile_for_state(state: Dict[str, Any]) -> Dict[str, Any]:
    class_config = _normalize_class_config_map(state.get("class_config", {}))
    detected = _detect_target_documentclass(str(state.get("compile_target", "")))
    detected_has_chapter = _is_chapter_capable_class(detected)
    effective = _effective_theme_class(
        class_config.get("theme_class_mode", "auto"),
        detected,
    )
    return {
        "class_config": class_config,
        "detected_document_class": detected or "(unknown)",
        "detected_document_class_has_chapter": detected_has_chapter,
        "effective_theme_class": effective,
    }


def _refresh_derived_state(
    state: Dict[str, Any],
    recipe_catalog: Optional[Dict[str, Any]] = None,
) -> None:
    compile_target_value = str(state.get("compile_target", ""))
    compile_recipe_value = str(state.get("compile_recipe", ""))
    use_internal_value = bool(state.get("compile_use_internal_fallback", True))
    compile_recipes = state.get("compile_recipes", [])
    if isinstance(compile_recipes, list):
        state["compile_recipe_name"] = _recipe_name_by_id(
            compile_recipe_value,
            compile_recipes,
        )
    state["compile_output_pdf_expected"] = _expected_output_pdf_for_selection(
        compile_target_value,
        compile_recipe_value,
        use_internal_value,
        recipe_catalog=recipe_catalog,
    )

    profile = _class_profile_for_state(state)
    state["class_config"] = profile["class_config"]
    state["detected_document_class"] = profile["detected_document_class"]
    state["detected_document_class_has_chapter"] = profile["detected_document_class_has_chapter"]
    state["effective_theme_class"] = profile["effective_theme_class"]


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


def _safe_workspace_pdf_relpath(raw_path: Any) -> str:
    """Best-effort normalize of workspace-relative PDF path."""

    try:
        _, rel = _resolve_workspace_pdf(str(raw_path))
        return rel
    except (TypeError, ValueError):
        return ""


def _iso8601_utc_from_epoch(epoch_seconds: float) -> str:
    dt = datetime.fromtimestamp(epoch_seconds, tz=timezone.utc).replace(microsecond=0)
    return dt.isoformat().replace("+00:00", "Z")


def _now_iso8601_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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


def _parse_class_override_file(path: Path) -> Dict[str, str]:
    text = _read_text(path)
    parsed: Dict[str, str] = {}
    for field_id in CLASS_CONFIG_IDS:
        command = CLASS_CONFIG_COMMANDS[field_id]
        matches = re.findall(rf"\\def\\{command}\{{([^}}]+)\}}", text)
        if matches:
            parsed[field_id] = _normalize_class_config_value(field_id, matches[-1])
    return parsed


def _parse_body_font_size_override(path: Path) -> Optional[float]:
    text = _read_text(path)
    matches = re.findall(r"\\def\\ThemeBodyFontSizePt\{([^}]+)\}", text)
    if not matches:
        return None
    return _normalize_body_font_size_value(matches[-1])


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

    theme_defaults = _parse_theme_color_defaults()
    block_preset_catalog = _build_block_preset_catalog(theme_defaults)
    block_presets = _block_preset_meta(block_preset_catalog)
    default_block_preset = _default_block_preset_id(block_presets)
    heading_toc_preset_catalog = _build_heading_toc_preset_catalog(theme_defaults)
    heading_toc_presets = _heading_toc_preset_meta(heading_toc_preset_catalog)
    default_heading_toc_preset = _default_heading_toc_preset_id(heading_toc_presets)
    compile_targets = _list_candidate_tex_files()
    recipe_catalog = _load_vscode_recipe_catalog()
    compile_recipes = recipe_catalog.get("recipes", [])
    state = {
        "toggles": _parse_main_toggle_defaults(),
        "colors": dict(theme_defaults),
        "block_preset": default_block_preset,
        "block_presets": block_presets,
        "heading_toc_preset": default_heading_toc_preset,
        "heading_toc_presets": heading_toc_presets,
        BODY_FONT_SIZE_ID: BODY_FONT_SIZE_DEFAULT,
        "class_config": dict(CLASS_CONFIG_DEFAULTS),
        "compile_target": _default_compile_target(compile_targets),
        "compile_recipe": _default_compile_recipe(compile_recipes),
        "compile_use_internal_fallback": True,
        "compile_output_pdf": "",
        "compile_output_pdf_expected": "",
        "compile_last_compile_at": "",
        "compile_last_success": None,
    }
    persisted_output_pdf = ""
    persisted_output_pdf_expected = ""
    persisted_last_compile_at = ""
    persisted_last_success: Optional[bool] = None

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
            if "block_preset" in persisted:
                try:
                    state["block_preset"] = _normalize_block_preset(
                        persisted.get("block_preset"),
                        block_presets,
                    )
                except ValueError:
                    state["block_preset"] = default_block_preset
            if "heading_toc_preset" in persisted:
                try:
                    state["heading_toc_preset"] = _normalize_heading_toc_preset(
                        persisted.get("heading_toc_preset"),
                        heading_toc_presets,
                    )
                except ValueError:
                    state["heading_toc_preset"] = default_heading_toc_preset
            if BODY_FONT_SIZE_ID in persisted:
                state[BODY_FONT_SIZE_ID] = _normalize_body_font_size_value(
                    persisted.get(BODY_FONT_SIZE_ID)
                )
            state["class_config"] = _normalize_class_config_map(
                persisted.get("class_config", state["class_config"])
            )
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
            if isinstance(persisted.get("compile_output_pdf"), str):
                persisted_output_pdf = persisted.get("compile_output_pdf", "")
            if isinstance(persisted.get("compile_output_pdf_expected"), str):
                persisted_output_pdf_expected = persisted.get("compile_output_pdf_expected", "")
            if isinstance(persisted.get("compile_last_compile_at"), str):
                persisted_last_compile_at = persisted.get("compile_last_compile_at", "")
            if isinstance(persisted.get("compile_last_success"), bool):
                persisted_last_success = persisted.get("compile_last_success")

    if TOGGLE_OVERRIDE_PATH.exists():
        state["toggles"].update(_parse_toggle_override_file(TOGGLE_OVERRIDE_PATH))
        state["class_config"].update(_parse_class_override_file(TOGGLE_OVERRIDE_PATH))
        parsed_body_font_size = _parse_body_font_size_override(TOGGLE_OVERRIDE_PATH)
        if parsed_body_font_size is not None:
            state[BODY_FONT_SIZE_ID] = parsed_body_font_size
    if COLOR_OVERRIDE_PATH.exists():
        state["colors"].update(_parse_color_override_file(COLOR_OVERRIDE_PATH))

    for key in TOGGLE_IDS:
        state["toggles"].setdefault(key, True)
    for key in COLOR_ORDER:
        state["colors"].setdefault(key, "#808080")
    state["block_preset"] = _normalize_block_preset(
        state.get("block_preset"),
        block_presets,
    )
    state["heading_toc_preset"] = _normalize_heading_toc_preset(
        state.get("heading_toc_preset"),
        heading_toc_presets,
    )
    state[BODY_FONT_SIZE_ID] = _normalize_body_font_size_value(
        state.get(BODY_FONT_SIZE_ID, BODY_FONT_SIZE_DEFAULT)
    )

    state["compile_targets"] = compile_targets
    state["compile_recipes"] = compile_recipes
    state["compile_recipe_errors"] = recipe_catalog.get("errors", [])
    for field_id in CLASS_CONFIG_IDS:
        state["class_config"][field_id] = _normalize_class_config_value(
            field_id,
            state["class_config"].get(field_id, CLASS_CONFIG_DEFAULTS[field_id]),
        )

    _refresh_derived_state(state, recipe_catalog=recipe_catalog)
    expected_output_pdf = str(state.get("compile_output_pdf_expected", "main.pdf"))
    state["compile_output_pdf"] = expected_output_pdf
    maybe_persisted_output = _safe_workspace_pdf_relpath(persisted_output_pdf)
    maybe_persisted_expected = _safe_workspace_pdf_relpath(persisted_output_pdf_expected)
    if maybe_persisted_output and maybe_persisted_expected == expected_output_pdf:
        state["compile_output_pdf"] = maybe_persisted_output
    state["compile_last_compile_at"] = persisted_last_compile_at
    state["compile_last_success"] = persisted_last_success

    return state


def _normalize_payload(payload: Dict[str, Any], base_state: Dict[str, Any]) -> Dict[str, Any]:
    """Validate and normalize API payload using current state as baseline."""

    normalized = {
        "toggles": dict(base_state["toggles"]),
        "colors": dict(base_state["colors"]),
        "block_preset": _normalize_block_preset(
            base_state.get("block_preset"),
            base_state.get("block_presets", []),
        ),
        "block_presets": list(base_state.get("block_presets", [])),
        "heading_toc_preset": _normalize_heading_toc_preset(
            base_state.get("heading_toc_preset"),
            base_state.get("heading_toc_presets", []),
        ),
        "heading_toc_presets": list(base_state.get("heading_toc_presets", [])),
        BODY_FONT_SIZE_ID: _normalize_body_font_size_value(
            base_state.get(BODY_FONT_SIZE_ID, BODY_FONT_SIZE_DEFAULT)
        ),
        "class_config": _normalize_class_config_map(base_state.get("class_config", {})),
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

    if "block_preset" in payload:
        normalized["block_preset"] = _normalize_block_preset(
            payload.get("block_preset"),
            base_state.get("block_presets", []),
        )
    if "heading_toc_preset" in payload:
        normalized["heading_toc_preset"] = _normalize_heading_toc_preset(
            payload.get("heading_toc_preset"),
            base_state.get("heading_toc_presets", []),
        )
    if BODY_FONT_SIZE_ID in payload:
        normalized[BODY_FONT_SIZE_ID] = _validate_body_font_size_value(
            payload.get(BODY_FONT_SIZE_ID)
        )

    raw_class_config = payload.get("class_config", {})
    if isinstance(raw_class_config, dict):
        for field_id in CLASS_CONFIG_IDS:
            if field_id in raw_class_config:
                normalized["class_config"][field_id] = _validate_class_config_value(
                    field_id,
                    raw_class_config[field_id],
                )

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
        "block_preset": state.get("block_preset", "default"),
        "heading_toc_preset": state.get("heading_toc_preset", "default"),
        BODY_FONT_SIZE_ID: _normalize_body_font_size_value(
            state.get(BODY_FONT_SIZE_ID, BODY_FONT_SIZE_DEFAULT)
        ),
        "class_config": _normalize_class_config_map(state.get("class_config", {})),
        "compile_target": state.get("compile_target", ""),
        "compile_recipe": state.get("compile_recipe", ""),
        "compile_use_internal_fallback": bool(
            state.get("compile_use_internal_fallback", True)
        ),
        "compile_output_pdf": state.get("compile_output_pdf", ""),
        "compile_output_pdf_expected": state.get("compile_output_pdf_expected", ""),
        "compile_last_compile_at": state.get("compile_last_compile_at", ""),
        "compile_last_success": state.get("compile_last_success"),
    }
    CONFIG_PATH.write_text(
        json.dumps(ui_state, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


# -------------------- File Outputs --------------------

def _write_override_files(state: Dict[str, Any]) -> None:
    block_presets = state.get("block_presets", [])
    if not isinstance(block_presets, list) or not block_presets:
        block_presets = _block_preset_meta(
            _build_block_preset_catalog(_parse_theme_color_defaults())
        )
    state["block_presets"] = block_presets
    state["block_preset"] = _normalize_block_preset(
        state.get("block_preset"),
        block_presets,
    )
    heading_toc_presets = state.get("heading_toc_presets", [])
    if not isinstance(heading_toc_presets, list) or not heading_toc_presets:
        heading_toc_presets = _heading_toc_preset_meta(
            _build_heading_toc_preset_catalog(_parse_theme_color_defaults())
        )
    state["heading_toc_presets"] = heading_toc_presets
    state["heading_toc_preset"] = _normalize_heading_toc_preset(
        state.get("heading_toc_preset"),
        heading_toc_presets,
    )
    state[BODY_FONT_SIZE_ID] = _normalize_body_font_size_value(
        state.get(BODY_FONT_SIZE_ID, BODY_FONT_SIZE_DEFAULT)
    )
    state["class_config"] = _normalize_class_config_map(state.get("class_config", {}))
    _refresh_derived_state(state)
    _persist_ui_state(state)

    toggle_lines = [
        "% Auto-generated by tools/theme_designer.py",
        "% Delete this file to return to defaults in main.tex.",
    ]
    for entry in TOGGLE_SCHEMA:
        value = "true" if state["toggles"][entry["id"]] else "false"
        toggle_lines.append(f"\\{entry['command']}{value}")
    toggle_lines.append("")
    toggle_lines.append("% Class-aware options for theme.sty and theorems.tex.")
    for field_id in CLASS_CONFIG_IDS:
        command = CLASS_CONFIG_COMMANDS[field_id]
        value = state["class_config"][field_id]
        toggle_lines.append(f"\\def\\{command}{{{value}}}")
    toggle_lines.append("")
    toggle_lines.append("% Base body font size in pt.")
    toggle_lines.append(
        f"\\def\\ThemeBodyFontSizePt{{{_format_body_font_size(state[BODY_FONT_SIZE_ID])}}}"
    )
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


def _pick_fallback_pdf(ctx: CompileContext, expected_pdf_rel: str) -> str:
    """Find the most recently modified PDF near expected output and compile cwd."""

    candidate_dirs: List[Path] = [ctx.compile_cwd]
    expected_abs, _ = _resolve_workspace_pdf(expected_pdf_rel)
    candidate_dirs.append(expected_abs.parent)

    seen_dirs: set[str] = set()
    candidates: List[Path] = []
    for directory in candidate_dirs:
        try:
            resolved_dir = directory.resolve()
        except OSError:
            continue
        key = str(resolved_dir)
        if key in seen_dirs:
            continue
        seen_dirs.add(key)
        if not resolved_dir.exists() or not resolved_dir.is_dir():
            continue
        for pdf in resolved_dir.glob("*.pdf"):
            try:
                resolved_pdf = pdf.resolve()
            except OSError:
                continue
            if _is_subpath(resolved_pdf, ROOT_DIR.resolve()):
                candidates.append(resolved_pdf)

    if not candidates:
        return ""

    def _mtime_or_zero(path: Path) -> float:
        try:
            return path.stat().st_mtime
        except OSError:
            return 0.0

    latest = max(candidates, key=_mtime_or_zero)
    return latest.relative_to(ROOT_DIR).as_posix()


def _check_output_freshness(
    ctx: CompileContext,
    pdf_rel: str,
) -> Tuple[bool, str, List[str]]:
    """Verify PDF exists and is not older than source target file."""

    diagnostics: List[str] = []
    pdf_abs, normalized_pdf_rel = _resolve_workspace_pdf(pdf_rel)
    if not pdf_abs.exists():
        diagnostics.append(f"Output PDF not found: {normalized_pdf_rel}")
        return False, normalized_pdf_rel, diagnostics

    try:
        source_mtime = ctx.target_abs.stat().st_mtime
    except OSError as err:
        diagnostics.append(f"Cannot read source timestamp for {ctx.target_rel}: {err}")
        return False, normalized_pdf_rel, diagnostics

    try:
        pdf_mtime = pdf_abs.stat().st_mtime
    except OSError as err:
        diagnostics.append(f"Cannot read PDF timestamp for {normalized_pdf_rel}: {err}")
        return False, normalized_pdf_rel, diagnostics

    diagnostics.append(
        f"[source mtime] {ctx.target_rel}: {_iso8601_utc_from_epoch(source_mtime)}"
    )
    diagnostics.append(
        f"[pdf mtime] {normalized_pdf_rel}: {_iso8601_utc_from_epoch(pdf_mtime)}"
    )

    if pdf_mtime + 1e-3 < source_mtime:
        diagnostics.append("Stale preview risk: output PDF is older than source target.")
        diagnostics.append("Tip: verify recipe output directory and re-run compile.")
        return False, normalized_pdf_rel, diagnostics

    diagnostics.append("Output freshness check passed.")
    return True, normalized_pdf_rel, diagnostics


def _finalize_compile_output(
    ctx: CompileContext,
    logs: List[str],
    expected_pdf_rel: str,
) -> Tuple[bool, str, str]:
    """Apply fallback lookup and freshness validation for compile output."""

    chosen_pdf_rel = expected_pdf_rel
    expected_abs, expected_rel = _resolve_workspace_pdf(expected_pdf_rel)
    if not expected_abs.exists():
        fallback_rel = _pick_fallback_pdf(ctx, expected_rel)
        if fallback_rel:
            logs.append(
                f"Expected PDF not found at {expected_rel}. Using fallback PDF: {fallback_rel}"
            )
            logs.append("")
            chosen_pdf_rel = fallback_rel
        else:
            logs.append(f"Compile finished, but expected PDF was not found: {expected_rel}")
            logs.append("")
            return False, _finalize_logs(logs), expected_rel

    logs.append("== output check ==")
    freshness_ok, normalized_pdf_rel, diagnostics = _check_output_freshness(
        ctx,
        chosen_pdf_rel,
    )
    logs.extend(diagnostics)
    logs.append("")
    return freshness_ok, _finalize_logs(logs), normalized_pdf_rel


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

    changed = False
    if compile_target is not None:
        state["compile_target"] = compile_target
        changed = True
    if compile_recipe is not None:
        state["compile_recipe"] = compile_recipe
        changed = True
    if use_internal_fallback is not None:
        state["compile_use_internal_fallback"] = use_internal_fallback
        changed = True

    if changed:
        _refresh_derived_state(state)
        state["compile_output_pdf"] = str(state.get("compile_output_pdf_expected", "main.pdf"))


def _apply_compile_result(state: Dict[str, Any], success: bool, pdf_path: str) -> None:
    """Persist compile output metadata in in-memory state."""

    _refresh_derived_state(state)
    expected_output = str(state.get("compile_output_pdf_expected", "main.pdf"))
    resolved_pdf_path = _safe_workspace_pdf_relpath(pdf_path)
    state["compile_output_pdf"] = resolved_pdf_path or expected_output
    state["compile_last_compile_at"] = _now_iso8601_utc()
    state["compile_last_success"] = bool(success)


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
        if not ok:
            return False, _finalize_logs(logs), ctx.default_pdf_rel
        return _finalize_compile_output(ctx, logs, ctx.default_pdf_rel)

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

    return _finalize_compile_output(ctx, logs, ctx.default_pdf_rel)


def _compile_tex_target_recipe(ctx: CompileContext, recipe_id: str) -> Tuple[bool, str, str]:
    """Compile by executing one VSCode recipe tool-by-tool."""

    logs: List[str] = []
    catalog = _load_vscode_recipe_catalog()
    recipes = catalog.get("recipes", [])
    tools = catalog.get("tools", {})

    recipe = _recipe_entry_by_id(recipe_id, recipes)
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
    return _finalize_compile_output(ctx, logs, expected_pdf_rel)


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
            "class_config": CLASS_CONFIG_SCHEMA,
            "block_presets": state.get("block_presets", []),
            "heading_toc_presets": state.get("heading_toc_presets", []),
            "body_font_size": BODY_FONT_SIZE_CONFIG,
        },
    }
