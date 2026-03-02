#!/usr/bin/env python3
"""Core state and compile logic for the LaTeX Editing Toolkit UI."""

from __future__ import annotations

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
TEMPLATE_DIR = ROOT_DIR / "templates"
SPLIT_STANDALONE_MODE_SUBFILES = "subfiles"
SPLIT_DEFAULT_SECTIONS_DIR = "Sections"
SPLIT_ALLOWED_MODES = {SPLIT_STANDALONE_MODE_SUBFILES}
COMPILE_COMMAND_TIMEOUT_SEC = 120.0
COMPILE_TIMEOUT_EXIT_CODE = 124

try:
    from tools import core_cleanup as _core_cleanup
    from tools import tex_splitter as _tex_splitter
    from tools import core_compile as _core_compile
    from tools import core_docclass as _core_docclass
    from tools import core_paths as _core_paths
    from tools import core_presets as _core_presets
    from tools import core_runtime as _core_runtime
    from tools import core_state as _core_state
    from tools import core_starter as _core_starter
    from tools import core_theme as _core_theme
    from tools import core_vscode as _core_vscode
    from tools import core_split as _core_split
except ModuleNotFoundError:
    import core_cleanup as _core_cleanup
    import tex_splitter as _tex_splitter
    import core_compile as _core_compile
    import core_docclass as _core_docclass
    import core_paths as _core_paths
    import core_presets as _core_presets
    import core_runtime as _core_runtime
    import core_state as _core_state
    import core_starter as _core_starter
    import core_theme as _core_theme
    import core_vscode as _core_vscode
    import core_split as _core_split

CLEAN_ROOT_SCOPE_DIRS = ["."]
CLEAN_ROOT_PROTECTED_PATTERNS = ["*.pdf", "*.synctex.gz"]
CLEAN_SUBFILE_DELETE_PATTERNS = ["*"]
CLEAN_SUBFILE_KEEP_PATTERNS = ["*.tex", "*.pdf"]
CLEAN_FALLBACK_FILE_TYPES = list(_core_cleanup.DEFAULT_CLEAN_FILE_PATTERNS)

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

STARTER_DEFAULT_OUTPUT_TARGET = "main.tex"
STARTER_TEMPLATE_DEFINITIONS: List[Dict[str, str]] = [
    {
        "id": "book-minimal",
        "label": "Book Minimal",
        "description": "Minimal book starter wired to theme.sty and theorem blocks.",
        "filename": "book-minimal.tex",
    },
    {
        "id": "article-minimal",
        "label": "Article Minimal",
        "description": "Minimal article starter wired to theme.sty and theorem blocks.",
        "filename": "article-minimal.tex",
    },
]


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
DOCUMENTCLASS_PATTERN = re.compile(
    r"\\documentclass(?:\[(?P<options>[^\]]*)\])?\{(?P<class>[^}]+)\}",
    flags=re.IGNORECASE,
)

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
    return _core_runtime.read_text(path)


# -------------------- VSCode JSONC Parsing --------------------

def _strip_jsonc_comments(raw: str) -> str:
    return _core_vscode.strip_jsonc_comments(raw)


def _strip_json_trailing_commas(raw: str) -> str:
    return _core_vscode.strip_json_trailing_commas(raw)


def _parse_jsonc(raw: str) -> Dict[str, Any]:
    return _core_vscode.parse_jsonc(raw)


def _load_vscode_settings() -> Dict[str, Any]:
    return _core_vscode.load_vscode_settings(
        vscode_settings_path=VSCODE_SETTINGS_PATH,
        read_text_fn=_read_text,
        parse_jsonc_fn=_parse_jsonc,
    )


def _slugify(raw: str) -> str:
    return _core_vscode.slugify(raw)


def _load_vscode_recipe_catalog() -> Dict[str, Any]:
    return _core_vscode.load_vscode_recipe_catalog(
        load_vscode_settings_fn=_load_vscode_settings,
        slugify_fn=_slugify,
    )


def _load_vscode_clean_file_types() -> List[str]:
    try:
        settings = _load_vscode_settings()
    except ValueError:
        settings = {}
    return _core_cleanup.clean_patterns_from_vscode_settings(
        settings,
        fallback_patterns=CLEAN_FALLBACK_FILE_TYPES,
    )


def _default_compile_recipe(recipes: List[Dict[str, Any]]) -> str:
    return _core_compile.default_compile_recipe(recipes)


def _normalize_compile_recipe(raw_recipe: Any, recipes: List[Dict[str, Any]]) -> str:
    return _core_compile.normalize_compile_recipe(
        raw_recipe,
        recipes,
        default_compile_recipe_fn=_default_compile_recipe,
    )


def _recipe_name_by_id(recipe_id: str, recipes: List[Dict[str, Any]]) -> str:
    return _core_compile.recipe_name_by_id(recipe_id, recipes)


def _resolve_compile_context(compile_target: str) -> CompileContext:
    return _core_compile.resolve_compile_context(
        compile_target,
        root_dir=ROOT_DIR,
        is_subpath=_is_subpath,
        compile_context_factory=CompileContext,
    )


def _append_step_log(
    logs: List[str],
    label: str,
    cwd: Path,
    command: List[str],
    output: str,
    code: int,
) -> None:
    _core_compile.append_step_log(logs, label, cwd, command, output, code)


def _finalize_logs(logs: List[str]) -> str:
    return _core_compile.finalize_logs(logs)


def _replace_recipe_tokens(value: str, ctx: CompileContext, outdir: str) -> str:
    return _core_compile.replace_recipe_tokens(value, ctx, outdir)


def _extract_recipe_outdir(args: List[str]) -> Optional[str]:
    return _core_compile.extract_recipe_outdir(args)


def _resolve_pdf_path_for_outdir(ctx: CompileContext, outdir: str) -> str:
    return _core_compile.resolve_pdf_path_for_outdir(
        ctx,
        outdir,
        root_dir=ROOT_DIR,
        is_subpath=_is_subpath,
    )


def _recipe_entry_by_id(
    recipe_id: str,
    recipes: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    return _core_compile.recipe_entry_by_id(recipe_id, recipes)


def _recipe_outdir_for_context(
    ctx: CompileContext,
    recipe_id: str,
    catalog: Dict[str, Any],
) -> str:
    return _core_compile.recipe_outdir_for_context(ctx, recipe_id, catalog)


def _expected_output_pdf_for_selection(
    compile_target: str,
    compile_recipe: str,
    use_internal_fallback: bool,
    recipe_catalog: Optional[Dict[str, Any]] = None,
) -> str:
    return _core_compile.expected_output_pdf_for_selection(
        compile_target,
        compile_recipe,
        use_internal_fallback,
        resolve_compile_context_fn=_resolve_compile_context,
        compile_output_pdf_relpath_fn=_compile_output_pdf_relpath,
        load_vscode_recipe_catalog_fn=_load_vscode_recipe_catalog,
        recipe_outdir_for_context_fn=_recipe_outdir_for_context,
        resolve_pdf_path_for_outdir_fn=_resolve_pdf_path_for_outdir,
        recipe_catalog=recipe_catalog,
    )


def _resolve_recipe_command(raw_command: str) -> str:
    return _core_compile.resolve_recipe_command(
        raw_command,
        resolve_binary_fn=_resolve_binary,
    )


# -------------------- Generic Value Parsing --------------------

def _bool_from_str(raw: str) -> Optional[bool]:
    return _core_theme.bool_from_str(raw)


def _hex_from_rgb(rgb: Tuple[int, int, int]) -> str:
    return _core_theme.hex_from_rgb(rgb)


def _blend_rgb(
    left: Tuple[int, int, int],
    right: Tuple[int, int, int],
    left_weight: float,
) -> Tuple[int, int, int]:
    return _core_theme.blend_rgb(left, right, left_weight)


def _parse_hex_color(raw: str) -> Optional[str]:
    return _core_theme.parse_hex_color(raw)


def _format_body_font_size(value: float) -> str:
    return _core_theme.format_body_font_size(value)


def _parse_body_font_size_value(raw_value: Any) -> Optional[float]:
    return _core_state.parse_body_font_size_value(raw_value)


def _normalize_body_font_size_value(raw_value: Any) -> float:
    return _core_state.normalize_body_font_size_value(
        raw_value,
        min_value=BODY_FONT_SIZE_MIN,
        max_value=BODY_FONT_SIZE_MAX,
        step=BODY_FONT_SIZE_STEP,
        default_value=BODY_FONT_SIZE_DEFAULT,
    )


def _validate_body_font_size_value(raw_value: Any) -> float:
    return _core_state.validate_body_font_size_value(
        raw_value,
        field_id=BODY_FONT_SIZE_ID,
        min_value=BODY_FONT_SIZE_MIN,
        max_value=BODY_FONT_SIZE_MAX,
        step=BODY_FONT_SIZE_STEP,
        normalize_body_font_size_value_fn=_normalize_body_font_size_value,
    )


def _build_block_preset_catalog(theme_defaults: Dict[str, str]) -> List[Dict[str, Any]]:
    return _core_presets.build_block_preset_catalog(
        theme_defaults,
        block_preset_definitions=BLOCK_PRESET_DEFINITIONS,
        block_color_tokens=BLOCK_COLOR_TOKENS,
        parse_hex_color_fn=_parse_hex_color,
    )


def _block_preset_meta(catalog: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    return _core_presets.preset_meta(catalog)


def _default_block_preset_id(block_presets: List[Dict[str, Any]]) -> str:
    return _core_presets.default_preset_id(block_presets, default_id="default")


def _normalize_block_preset(raw_preset: Any, block_presets: List[Dict[str, Any]]) -> str:
    return _core_presets.normalize_block_preset(raw_preset, block_presets)


def _block_preset_tokens_by_id(
    preset_id: str,
    catalog: List[Dict[str, Any]],
) -> Dict[str, str]:
    return _core_presets.block_preset_tokens_by_id(
        preset_id,
        catalog,
        block_color_tokens=BLOCK_COLOR_TOKENS,
        parse_hex_color_fn=_parse_hex_color,
    )


def _apply_block_preset(state: Dict[str, Any], preset_id: Any) -> None:
    _core_presets.apply_block_preset(
        state,
        preset_id,
        parse_theme_color_defaults_fn=_parse_theme_color_defaults,
        build_block_preset_catalog_fn=_build_block_preset_catalog,
        block_preset_meta_fn=_block_preset_meta,
        normalize_block_preset_fn=_normalize_block_preset,
        block_preset_tokens_by_id_fn=_block_preset_tokens_by_id,
    )


def _build_heading_toc_preset_catalog(theme_defaults: Dict[str, str]) -> List[Dict[str, Any]]:
    return _core_presets.build_heading_toc_preset_catalog(
        theme_defaults,
        heading_toc_preset_definitions=HEADING_TOC_PRESET_DEFINITIONS,
        document_color_tokens=DOCUMENT_COLOR_TOKENS,
        parse_hex_color_fn=_parse_hex_color,
    )


def _heading_toc_preset_meta(catalog: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    return _core_presets.preset_meta(catalog)


def _default_heading_toc_preset_id(heading_toc_presets: List[Dict[str, Any]]) -> str:
    return _core_presets.default_preset_id(heading_toc_presets, default_id="default")


def _normalize_heading_toc_preset(
    raw_preset: Any,
    heading_toc_presets: List[Dict[str, Any]],
) -> str:
    return _core_presets.normalize_heading_toc_preset(raw_preset, heading_toc_presets)


def _heading_toc_preset_tokens_by_id(
    preset_id: str,
    catalog: List[Dict[str, Any]],
) -> Dict[str, str]:
    return _core_presets.heading_toc_preset_tokens_by_id(
        preset_id,
        catalog,
        document_color_tokens=DOCUMENT_COLOR_TOKENS,
        parse_hex_color_fn=_parse_hex_color,
    )


def _apply_heading_toc_preset(state: Dict[str, Any], preset_id: Any) -> None:
    _core_presets.apply_heading_toc_preset(
        state,
        preset_id,
        parse_theme_color_defaults_fn=_parse_theme_color_defaults,
        build_heading_toc_preset_catalog_fn=_build_heading_toc_preset_catalog,
        heading_toc_preset_meta_fn=_heading_toc_preset_meta,
        normalize_heading_toc_preset_fn=_normalize_heading_toc_preset,
        heading_toc_preset_tokens_by_id_fn=_heading_toc_preset_tokens_by_id,
    )


def _is_subpath(path: Path, parent: Path) -> bool:
    return _core_paths.is_subpath(path, parent)


def _normalize_class_config_value(field_id: str, raw_value: Any) -> str:
    return _core_state.normalize_class_config_value(
        field_id,
        raw_value,
        class_config_valid_options=CLASS_CONFIG_VALID_OPTIONS,
        class_config_defaults=CLASS_CONFIG_DEFAULTS,
    )


def _validate_class_config_value(field_id: str, raw_value: Any) -> str:
    return _core_state.validate_class_config_value(
        field_id,
        raw_value,
        class_config_valid_options=CLASS_CONFIG_VALID_OPTIONS,
    )


def _normalize_class_config_map(raw_map: Dict[str, Any]) -> Dict[str, str]:
    return _core_state.normalize_class_config_map(
        raw_map,
        class_config_defaults=CLASS_CONFIG_DEFAULTS,
        class_config_ids=CLASS_CONFIG_IDS,
        normalize_class_config_value_fn=_normalize_class_config_value,
    )


def _extract_documentclass_declaration(tex_path: Path) -> Tuple[str, str]:
    return _core_docclass.extract_documentclass_declaration(
        tex_path,
        read_text_fn=_read_text,
        documentclass_pattern=DOCUMENTCLASS_PATTERN,
    )


def _resolve_subfiles_parent_tex(tex_path: Path, class_options: str) -> Optional[Path]:
    return _core_docclass.resolve_subfiles_parent_tex(
        tex_path,
        class_options,
        root_dir=ROOT_DIR,
        is_subpath_fn=_is_subpath,
    )


def _extract_documentclass_name(tex_path: Path, _visited: Optional[set[Path]] = None) -> str:
    return _core_docclass.extract_documentclass_name(
        tex_path,
        extract_documentclass_declaration_fn=_extract_documentclass_declaration,
        resolve_subfiles_parent_tex_fn=_resolve_subfiles_parent_tex,
        _visited=_visited,
    )


def _extract_documentclass_name_raw(tex_path: Path) -> str:
    return _core_docclass.extract_documentclass_name_raw(
        tex_path,
        read_text_fn=_read_text,
        documentclass_pattern=DOCUMENTCLASS_PATTERN,
    )


def _is_chapter_capable_class(class_name: str) -> bool:
    return _core_state.is_chapter_capable_class(
        class_name,
        chapter_class_names=CHAPTER_CLASS_NAMES,
    )


def _detect_target_documentclass(compile_target: str) -> str:
    return _core_docclass.detect_target_documentclass(
        compile_target,
        resolve_compile_context_fn=_resolve_compile_context,
        extract_documentclass_name_fn=_extract_documentclass_name,
    )


def _effective_theme_class(theme_class_mode: str, detected_document_class: str) -> str:
    return _core_state.effective_theme_class(
        theme_class_mode,
        detected_document_class,
        normalize_class_config_value_fn=_normalize_class_config_value,
        is_chapter_capable_class_fn=_is_chapter_capable_class,
    )


def _is_incompatible_forced_theme_class(
    theme_class_mode: str,
    detected_document_class: str,
) -> bool:
    return _core_state.is_incompatible_forced_theme_class(
        theme_class_mode,
        detected_document_class,
        normalize_class_config_value_fn=_normalize_class_config_value,
        is_chapter_capable_class_fn=_is_chapter_capable_class,
    )


def _coerce_class_mode_on_target_switch(
    state: Dict[str, Any],
    previous_target: str,
    next_target: str,
) -> bool:
    return _core_state.coerce_class_mode_on_target_switch(
        state,
        previous_target,
        next_target,
        normalize_class_config_map_fn=_normalize_class_config_map,
        detect_target_documentclass_fn=_detect_target_documentclass,
        is_incompatible_forced_theme_class_fn=_is_incompatible_forced_theme_class,
    )


def _has_documentclass(tex_path: Path) -> bool:
    return _core_docclass.has_documentclass(
        tex_path,
        extract_documentclass_name_raw_fn=_extract_documentclass_name_raw,
    )


def _class_profile_for_state(state: Dict[str, Any]) -> Dict[str, Any]:
    return _core_state.class_profile_for_state(
        state,
        normalize_class_config_map_fn=_normalize_class_config_map,
        detect_target_documentclass_fn=_detect_target_documentclass,
        is_chapter_capable_class_fn=_is_chapter_capable_class,
        effective_theme_class_fn=_effective_theme_class,
    )


def _refresh_derived_state(
    state: Dict[str, Any],
    recipe_catalog: Optional[Dict[str, Any]] = None,
) -> None:
    _core_state.refresh_derived_state(
        state,
        recipe_catalog,
        recipe_name_by_id_fn=_recipe_name_by_id,
        expected_output_pdf_for_selection_fn=_expected_output_pdf_for_selection,
        class_profile_for_state_fn=_class_profile_for_state,
    )


# -------------------- Starter Template Bootstrap --------------------

def _starter_template_catalog() -> Dict[str, Dict[str, Any]]:
    return _core_starter.starter_template_catalog(
        template_definitions=STARTER_TEMPLATE_DEFINITIONS,
        template_dir=TEMPLATE_DIR,
    )


def _starter_template_meta(catalog: Dict[str, Dict[str, Any]]) -> List[Dict[str, str]]:
    return _core_starter.starter_template_meta(
        catalog,
        template_definitions=STARTER_TEMPLATE_DEFINITIONS,
    )


def _default_starter_template_id(starter_templates: List[Dict[str, str]]) -> str:
    return _core_starter.default_starter_template_id(starter_templates)


def _normalize_starter_template(
    raw_template: Any,
    starter_templates: List[Dict[str, str]],
) -> str:
    return _core_starter.normalize_starter_template(
        raw_template,
        starter_templates,
        default_starter_template_id_fn=_default_starter_template_id,
    )


def _normalize_starter_output_target(raw_target: Any) -> str:
    return _core_starter.normalize_starter_output_target(
        raw_target,
        default_output_target=STARTER_DEFAULT_OUTPUT_TARGET,
        root_dir=ROOT_DIR,
        is_subpath_fn=_is_subpath,
    )


def _generate_starter_template_file(
    template_id: Any,
    output_target: Any = STARTER_DEFAULT_OUTPUT_TARGET,
    overwrite: bool = False,
) -> Tuple[str, bool]:
    return _core_starter.generate_starter_template_file(
        template_id,
        output_target,
        bool(overwrite),
        template_definitions=STARTER_TEMPLATE_DEFINITIONS,
        template_dir=TEMPLATE_DIR,
        root_dir=ROOT_DIR,
        default_output_target=STARTER_DEFAULT_OUTPUT_TARGET,
        is_subpath_fn=_is_subpath,
        read_text_fn=_read_text,
    )


# -------------------- Compile Target Discovery --------------------

def _list_candidate_tex_files() -> List[str]:
    return _core_compile.list_candidate_tex_files(
        root_dir=ROOT_DIR,
        ignore_tex_filenames=IGNORE_TEX_FILENAMES,
        ignore_dir_names=IGNORE_DIR_NAMES,
        has_documentclass_fn=_has_documentclass,
        main_tex_path=MAIN_TEX_PATH,
    )


def _discover_subfile_scope_dirs() -> Tuple[List[str], List[str]]:
    scope_dirs: set[str] = set()
    errors: List[str] = []
    resolved_root = ROOT_DIR.resolve()

    for tex_path in sorted(ROOT_DIR.rglob("*.tex")):
        rel_tex = tex_path.relative_to(ROOT_DIR)
        if any(part in IGNORE_DIR_NAMES or part.startswith(".") for part in rel_tex.parts[:-1]):
            continue

        try:
            class_name, _ = _extract_documentclass_declaration(tex_path)
        except OSError as err:
            errors.append(
                f"Failed to inspect documentclass for {rel_tex.as_posix()}: {err}"
            )
            continue

        if class_name != "subfiles":
            continue
        parent_abs = tex_path.parent.resolve()
        if parent_abs == resolved_root:
            continue
        if not _is_subpath(parent_abs, resolved_root):
            errors.append(
                f"Skipped subfile scope outside workspace: {tex_path.parent.as_posix()}"
            )
            continue
        scope_dirs.add(parent_abs.relative_to(resolved_root).as_posix())

    return sorted(scope_dirs), sorted(set(errors))


def _default_compile_target(candidates: List[str]) -> str:
    return _core_compile.default_compile_target(candidates)


def _normalize_compile_target(raw_target: Any, candidates: List[str]) -> str:
    return _core_compile.normalize_compile_target(
        raw_target,
        candidates,
        root_dir=ROOT_DIR,
        is_subpath_fn=_is_subpath,
        default_compile_target_fn=_default_compile_target,
    )


def _compile_output_pdf_relpath(compile_target: str) -> str:
    return _core_compile.compile_output_pdf_relpath(compile_target)


def _resolve_workspace_pdf(rel_path: str) -> Tuple[Path, str]:
    raw = (rel_path or "").strip()
    if not raw:
        raw = "main.pdf"
    if Path(raw).is_absolute():
        raise ValueError("PDF path must be workspace-relative.")
    return _core_paths.resolve_workspace_pdf(
        raw,
        root_dir=ROOT_DIR,
        is_subpath_fn=_is_subpath,
    )


def _safe_workspace_pdf_relpath(raw_path: Any) -> str:
    return _core_paths.safe_workspace_pdf_relpath(
        raw_path,
        resolve_workspace_pdf_fn=_resolve_workspace_pdf,
    )


def _safe_workspace_relpath(path: Optional[Path]) -> str:
    return _core_paths.safe_workspace_relpath(
        path,
        root_dir=ROOT_DIR,
        is_subpath_fn=_is_subpath,
    )


def _cleanup_build_artifacts(dry_run: bool = False) -> Dict[str, Any]:
    dry_run = bool(dry_run)
    clean_patterns = _load_vscode_clean_file_types()
    subfile_scope_dirs, discover_errors = _discover_subfile_scope_dirs()

    root_result = _core_cleanup.clean_build_artifacts(
        root_dir=ROOT_DIR,
        scope_dirs=CLEAN_ROOT_SCOPE_DIRS,
        patterns=clean_patterns,
        protected_patterns=CLEAN_ROOT_PROTECTED_PATTERNS,
        dry_run=dry_run,
        is_subpath_fn=_is_subpath,
    )

    if subfile_scope_dirs:
        subfile_result = _core_cleanup.clean_build_artifacts(
            root_dir=ROOT_DIR,
            scope_dirs=subfile_scope_dirs,
            patterns=CLEAN_SUBFILE_DELETE_PATTERNS,
            protected_patterns=CLEAN_SUBFILE_KEEP_PATTERNS,
            dry_run=dry_run,
            is_subpath_fn=_is_subpath,
        )
        empty_dirs_result = _core_cleanup.prune_empty_directories(
            root_dir=ROOT_DIR,
            scope_dirs=subfile_scope_dirs,
            dry_run=dry_run,
            is_subpath_fn=_is_subpath,
        )
    else:
        subfile_result = {
            "success": True,
            "dry_run": dry_run,
            "scope": [],
            "patterns": list(CLEAN_SUBFILE_DELETE_PATTERNS),
            "protected_patterns": list(CLEAN_SUBFILE_KEEP_PATTERNS),
            "deleted_files": [],
            "deleted_count": 0,
            "skipped_protected_files": [],
            "skipped_protected_count": 0,
            "errors": [],
        }
        empty_dirs_result = {
            "success": True,
            "dry_run": dry_run,
            "scope": [],
            "removed_empty_dirs": [],
            "removed_empty_dir_count": 0,
            "errors": [],
        }

    deleted_files = sorted(
        set(root_result.get("deleted_files", [])) | set(subfile_result.get("deleted_files", []))
    )
    skipped_protected_files = sorted(
        set(root_result.get("skipped_protected_files", []))
        | set(subfile_result.get("skipped_protected_files", []))
    )
    removed_empty_dirs = sorted(set(empty_dirs_result.get("removed_empty_dirs", [])))
    errors = sorted(
        set(discover_errors)
        | set(root_result.get("errors", []))
        | set(subfile_result.get("errors", []))
        | set(empty_dirs_result.get("errors", []))
    )
    merged_scope = sorted(set(root_result.get("scope", [])) | set(subfile_result.get("scope", [])))

    return {
        "success": len(errors) == 0,
        "dry_run": dry_run,
        "scope": merged_scope,
        "patterns": clean_patterns,
        "protected_patterns": list(CLEAN_ROOT_PROTECTED_PATTERNS),
        "deleted_files": deleted_files,
        "deleted_count": len(deleted_files),
        "skipped_protected_files": skipped_protected_files,
        "skipped_protected_count": len(skipped_protected_files),
        "errors": errors,
        "root_scope": list(root_result.get("scope", [])),
        "subfile_scope": list(subfile_result.get("scope", [])),
        "root_patterns": clean_patterns,
        "root_protected_patterns": list(CLEAN_ROOT_PROTECTED_PATTERNS),
        "subfile_keep_patterns": list(CLEAN_SUBFILE_KEEP_PATTERNS),
        "removed_empty_dirs": removed_empty_dirs,
        "removed_empty_dir_count": len(removed_empty_dirs),
    }


def _normalize_split_mode(raw_mode: Any) -> str:
    return _core_split.normalize_split_mode(
        raw_mode,
        default_mode=SPLIT_STANDALONE_MODE_SUBFILES,
        allowed_modes=SPLIT_ALLOWED_MODES,
    )


def _normalize_split_sections_dir(raw_dir: Any) -> str:
    return _core_split.normalize_split_sections_dir(
        raw_dir,
        default_sections_dir=SPLIT_DEFAULT_SECTIONS_DIR,
    )


def _validate_split_source_target(target_rel: str, target_abs: Path) -> None:
    _core_split.validate_split_source_target(
        target_rel,
        target_abs,
        extract_documentclass_declaration=_extract_documentclass_declaration,
        resolve_subfiles_parent_tex=_resolve_subfiles_parent_tex,
        safe_workspace_relpath=_safe_workspace_relpath,
    )


def _split_compile_target(
    compile_target: str,
    standalone_mode: Any = SPLIT_STANDALONE_MODE_SUBFILES,
    sections_dir: Any = SPLIT_DEFAULT_SECTIONS_DIR,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Split one compile target and return UI-facing operation summary."""

    return _core_split.split_compile_target(
        compile_target,
        standalone_mode=standalone_mode,
        sections_dir=sections_dir,
        dry_run=bool(dry_run),
        default_mode=SPLIT_STANDALONE_MODE_SUBFILES,
        allowed_modes=SPLIT_ALLOWED_MODES,
        default_sections_dir=SPLIT_DEFAULT_SECTIONS_DIR,
        resolve_compile_context=_resolve_compile_context,
        extract_documentclass_declaration=_extract_documentclass_declaration,
        resolve_subfiles_parent_tex=_resolve_subfiles_parent_tex,
        safe_workspace_relpath=_safe_workspace_relpath,
        splitter=_tex_splitter,
    )


def _renumber_compile_target(
    compile_target: str,
    mode: Any = "add",
    dry_run: bool = False,
) -> Dict[str, Any]:
    return _core_split.renumber_compile_target(
        compile_target,
        mode=mode,
        dry_run=bool(dry_run),
        resolve_compile_context=_resolve_compile_context,
        extract_documentclass_declaration=_extract_documentclass_declaration,
        resolve_subfiles_parent_tex=_resolve_subfiles_parent_tex,
        safe_workspace_relpath=_safe_workspace_relpath,
        splitter=_tex_splitter,
    )


def _unsplit_compile_target(
    compile_target: str,
    dry_run: bool = False,
    delete_source: bool = True,
) -> Dict[str, Any]:
    return _core_split.unsplit_compile_target(
        compile_target,
        dry_run=bool(dry_run),
        delete_source=bool(delete_source),
        resolve_compile_context=_resolve_compile_context,
        safe_workspace_relpath=_safe_workspace_relpath,
        splitter=_tex_splitter,
    )


def _iso8601_utc_from_epoch(epoch_seconds: float) -> str:
    return _core_runtime.iso8601_utc_from_epoch(epoch_seconds)


def _now_iso8601_utc() -> str:
    return _core_runtime.now_iso8601_utc()


# -------------------- Theme Defaults and Overrides --------------------

def _parse_theme_color_defaults() -> Dict[str, str]:
    return _core_theme.parse_theme_color_defaults(
        theme_sty_path=THEME_STY_PATH,
        read_text_fn=_read_text,
        color_set=COLOR_SET,
        color_order=COLOR_ORDER,
        base_colors=BASE_COLORS,
        parse_hex_color_fn=_parse_hex_color,
        blend_rgb_fn=_blend_rgb,
        hex_from_rgb_fn=_hex_from_rgb,
    )


def _parse_main_toggle_defaults() -> Dict[str, bool]:
    return _core_state.parse_main_toggle_defaults(
        main_tex_path=MAIN_TEX_PATH,
        read_text_fn=_read_text,
        toggle_schema=TOGGLE_SCHEMA,
        bool_from_str_fn=_bool_from_str,
    )


def _parse_toggle_override_file(path: Path) -> Dict[str, bool]:
    return _core_state.parse_toggle_override_file(
        path,
        read_text_fn=_read_text,
        toggle_schema=TOGGLE_SCHEMA,
        bool_from_str_fn=_bool_from_str,
    )


def _parse_class_override_file(path: Path) -> Dict[str, str]:
    return _core_state.parse_class_override_file(
        path,
        read_text_fn=_read_text,
        class_config_ids=CLASS_CONFIG_IDS,
        class_config_commands=CLASS_CONFIG_COMMANDS,
        normalize_class_config_value_fn=_normalize_class_config_value,
    )


def _parse_body_font_size_override(path: Path) -> Optional[float]:
    return _core_state.parse_body_font_size_override(
        path,
        read_text_fn=_read_text,
        normalize_body_font_size_value_fn=_normalize_body_font_size_value,
    )


def _parse_color_override_file(path: Path) -> Dict[str, str]:
    return _core_state.parse_color_override_file(
        path,
        read_text_fn=_read_text,
        color_set=COLOR_SET,
        parse_hex_color_fn=_parse_hex_color,
    )


# -------------------- State Load/Normalize/Persist --------------------

def _load_state() -> Dict[str, Any]:
    return _core_state.load_state(
        parse_theme_color_defaults_fn=_parse_theme_color_defaults,
        build_block_preset_catalog_fn=_build_block_preset_catalog,
        block_preset_meta_fn=_block_preset_meta,
        default_block_preset_id_fn=_default_block_preset_id,
        build_heading_toc_preset_catalog_fn=_build_heading_toc_preset_catalog,
        heading_toc_preset_meta_fn=_heading_toc_preset_meta,
        default_heading_toc_preset_id_fn=_default_heading_toc_preset_id,
        list_candidate_tex_files_fn=_list_candidate_tex_files,
        load_vscode_recipe_catalog_fn=_load_vscode_recipe_catalog,
        parse_main_toggle_defaults_fn=_parse_main_toggle_defaults,
        body_font_size_id=BODY_FONT_SIZE_ID,
        body_font_size_default=BODY_FONT_SIZE_DEFAULT,
        class_config_defaults=CLASS_CONFIG_DEFAULTS,
        default_compile_target_fn=_default_compile_target,
        default_compile_recipe_fn=_default_compile_recipe,
        config_path=CONFIG_PATH,
        parse_hex_color_fn=_parse_hex_color,
        normalize_block_preset_fn=_normalize_block_preset,
        normalize_heading_toc_preset_fn=_normalize_heading_toc_preset,
        normalize_body_font_size_value_fn=_normalize_body_font_size_value,
        normalize_class_config_map_fn=_normalize_class_config_map,
        normalize_compile_target_fn=_normalize_compile_target,
        normalize_compile_recipe_fn=_normalize_compile_recipe,
        bool_from_str_fn=_bool_from_str,
        toggle_override_path=TOGGLE_OVERRIDE_PATH,
        parse_toggle_override_file_fn=_parse_toggle_override_file,
        parse_class_override_file_fn=_parse_class_override_file,
        parse_body_font_size_override_fn=_parse_body_font_size_override,
        color_override_path=COLOR_OVERRIDE_PATH,
        parse_color_override_file_fn=_parse_color_override_file,
        toggle_ids=TOGGLE_IDS,
        color_order=COLOR_ORDER,
        class_config_ids=CLASS_CONFIG_IDS,
        normalize_class_config_value_fn=_normalize_class_config_value,
        coerce_class_mode_on_target_switch_fn=_coerce_class_mode_on_target_switch,
        refresh_derived_state_fn=_refresh_derived_state,
        safe_workspace_pdf_relpath_fn=_safe_workspace_pdf_relpath,
    )


def _normalize_payload(payload: Dict[str, Any], base_state: Dict[str, Any]) -> Dict[str, Any]:
    return _core_state.normalize_payload(
        payload,
        base_state,
        toggle_ids=TOGGLE_IDS,
        color_order=COLOR_ORDER,
        class_config_ids=CLASS_CONFIG_IDS,
        body_font_size_id=BODY_FONT_SIZE_ID,
        body_font_size_default=BODY_FONT_SIZE_DEFAULT,
        normalize_block_preset_fn=_normalize_block_preset,
        normalize_heading_toc_preset_fn=_normalize_heading_toc_preset,
        normalize_body_font_size_value_fn=_normalize_body_font_size_value,
        validate_body_font_size_value_fn=_validate_body_font_size_value,
        normalize_class_config_map_fn=_normalize_class_config_map,
        validate_class_config_value_fn=_validate_class_config_value,
        bool_from_str_fn=_bool_from_str,
        parse_hex_color_fn=_parse_hex_color,
        normalize_compile_target_fn=_normalize_compile_target,
        list_candidate_tex_files_fn=_list_candidate_tex_files,
        normalize_compile_recipe_fn=_normalize_compile_recipe,
    )


def _persist_ui_state(state: Dict[str, Any]) -> None:
    _core_state.persist_ui_state(
        state,
        config_path=CONFIG_PATH,
        body_font_size_id=BODY_FONT_SIZE_ID,
        body_font_size_default=BODY_FONT_SIZE_DEFAULT,
        normalize_body_font_size_value_fn=_normalize_body_font_size_value,
        normalize_class_config_map_fn=_normalize_class_config_map,
    )


# -------------------- File Outputs --------------------

def _write_override_files(state: Dict[str, Any]) -> None:
    _core_state.write_override_files(
        state,
        body_font_size_id=BODY_FONT_SIZE_ID,
        body_font_size_default=BODY_FONT_SIZE_DEFAULT,
        parse_theme_color_defaults_fn=_parse_theme_color_defaults,
        block_preset_meta_fn=_block_preset_meta,
        build_block_preset_catalog_fn=_build_block_preset_catalog,
        normalize_block_preset_fn=_normalize_block_preset,
        heading_toc_preset_meta_fn=_heading_toc_preset_meta,
        build_heading_toc_preset_catalog_fn=_build_heading_toc_preset_catalog,
        normalize_heading_toc_preset_fn=_normalize_heading_toc_preset,
        normalize_body_font_size_value_fn=_normalize_body_font_size_value,
        normalize_class_config_map_fn=_normalize_class_config_map,
        refresh_derived_state_fn=_refresh_derived_state,
        persist_ui_state_fn=_persist_ui_state,
        format_body_font_size_fn=_format_body_font_size,
        toggle_schema=TOGGLE_SCHEMA,
        toggle_override_path=TOGGLE_OVERRIDE_PATH,
        class_config_ids=CLASS_CONFIG_IDS,
        class_config_commands=CLASS_CONFIG_COMMANDS,
        color_order=COLOR_ORDER,
        color_override_path=COLOR_OVERRIDE_PATH,
    )


def _delete_override_files() -> None:
    _core_state.delete_override_files(
        config_path=CONFIG_PATH,
        toggle_override_path=TOGGLE_OVERRIDE_PATH,
        color_override_path=COLOR_OVERRIDE_PATH,
    )


# -------------------- Command Resolution and Execution --------------------

def _resolve_binary(name: str) -> Optional[str]:
    return _core_runtime.resolve_binary(
        name,
        which_fn=shutil.which,
    )


def _build_tex_env() -> Dict[str, str]:
    return _core_runtime.build_tex_env(
        root_dir=ROOT_DIR,
        environ=dict(os.environ),
    )


def _run_command(command: List[str], cwd: Path = ROOT_DIR) -> Tuple[bool, int, str]:
    return _core_runtime.run_command(
        command,
        cwd=cwd,
        build_tex_env_fn=_build_tex_env,
        timeout_sec=COMPILE_COMMAND_TIMEOUT_SEC,
        timeout_exit_code=COMPILE_TIMEOUT_EXIT_CODE,
        subprocess_run_fn=subprocess.run,
    )


def _pick_fallback_pdf(ctx: CompileContext, expected_pdf_rel: str) -> str:
    return _core_compile.pick_fallback_pdf(
        ctx,
        expected_pdf_rel,
        resolve_workspace_pdf_fn=_resolve_workspace_pdf,
        is_subpath_fn=_is_subpath,
        root_dir=ROOT_DIR,
    )


def _check_output_freshness(
    ctx: CompileContext,
    pdf_rel: str,
) -> Tuple[bool, str, List[str]]:
    return _core_compile.check_output_freshness(
        ctx,
        pdf_rel,
        resolve_workspace_pdf_fn=_resolve_workspace_pdf,
        iso8601_utc_from_epoch_fn=_iso8601_utc_from_epoch,
    )


def _finalize_compile_output(
    ctx: CompileContext,
    logs: List[str],
    expected_pdf_rel: str,
) -> Tuple[bool, str, str]:
    return _core_compile.finalize_compile_output(
        ctx,
        logs,
        expected_pdf_rel,
        resolve_workspace_pdf_fn=_resolve_workspace_pdf,
        pick_fallback_pdf_fn=_pick_fallback_pdf,
        check_output_freshness_fn=_check_output_freshness,
        finalize_logs_fn=_finalize_logs,
    )


# -------------------- Compile Preference Helpers --------------------

def _extract_compile_preferences(normalized: Dict[str, Any]) -> Tuple[str, str, bool]:
    return _core_state.extract_compile_preferences(normalized)


def _apply_compile_preferences(
    state: Dict[str, Any],
    compile_target: Optional[str] = None,
    compile_recipe: Optional[str] = None,
    use_internal_fallback: Optional[bool] = None,
) -> None:
    _core_state.apply_compile_preferences(
        state,
        compile_target=compile_target,
        compile_recipe=compile_recipe,
        use_internal_fallback=use_internal_fallback,
        normalize_class_config_map_fn=_normalize_class_config_map,
        coerce_class_mode_on_target_switch_fn=_coerce_class_mode_on_target_switch,
        refresh_derived_state_fn=_refresh_derived_state,
    )


def _apply_compile_result(state: Dict[str, Any], success: bool, pdf_path: str) -> None:
    _core_state.apply_compile_result(
        state,
        success,
        pdf_path,
        refresh_derived_state_fn=_refresh_derived_state,
        safe_workspace_pdf_relpath_fn=_safe_workspace_pdf_relpath,
        now_iso8601_utc_fn=_now_iso8601_utc,
    )


def _bootstrap_starter_template(
    template_id: Any,
    output_target: Any = STARTER_DEFAULT_OUTPUT_TARGET,
    overwrite: bool = False,
) -> Tuple[Dict[str, Any], str, bool]:
    return _core_starter.bootstrap_starter_template(
        template_id,
        output_target,
        bool(overwrite),
        default_output_target=STARTER_DEFAULT_OUTPUT_TARGET,
        generate_starter_template_file_fn=_generate_starter_template_file,
        load_state_fn=_load_state,
        apply_compile_preferences_fn=_apply_compile_preferences,
        persist_ui_state_fn=_persist_ui_state,
        build_response_state_fn=_build_response_state,
    )


# -------------------- Compile Pipelines --------------------

def _compile_tex_target_internal(ctx: CompileContext) -> Tuple[bool, str, str]:
    return _core_compile.compile_tex_target_internal(
        ctx,
        resolve_binary_fn=_resolve_binary,
        run_command_fn=_run_command,
        append_step_log_fn=_append_step_log,
        finalize_logs_fn=_finalize_logs,
        finalize_compile_output_fn=_finalize_compile_output,
    )


def _compile_tex_target_recipe(ctx: CompileContext, recipe_id: str) -> Tuple[bool, str, str]:
    return _core_compile.compile_tex_target_recipe(
        ctx,
        recipe_id,
        load_vscode_recipe_catalog_fn=_load_vscode_recipe_catalog,
        recipe_entry_by_id_fn=_recipe_entry_by_id,
        resolve_recipe_command_fn=_resolve_recipe_command,
        replace_recipe_tokens_fn=_replace_recipe_tokens,
        extract_recipe_outdir_fn=_extract_recipe_outdir,
        run_command_fn=_run_command,
        append_step_log_fn=_append_step_log,
        finalize_logs_fn=_finalize_logs,
        resolve_binary_fn=_resolve_binary,
        resolve_pdf_path_for_outdir_fn=_resolve_pdf_path_for_outdir,
        finalize_compile_output_fn=_finalize_compile_output,
    )


def _preflight_compile_context(
    ctx: CompileContext,
) -> Optional[Tuple[bool, str, str]]:
    issues = _core_compile.validate_subfile_references(
        ctx.target_abs,
        root_dir=ROOT_DIR,
        read_text_fn=_read_text,
        is_subpath_fn=_is_subpath,
    )
    if not issues:
        return None

    logs: List[str] = [
        "[preflight] Compile blocked due to invalid \\subfile references.",
        "",
    ]
    for issue in issues[:8]:
        logs.append(f"- {issue}")
    if len(issues) > 8:
        logs.append(f"- ... and {len(issues) - 8} more issue(s)")
    logs.append("")
    logs.append("Hint: fix the listed section/include paths, then re-run compile.")
    return False, "\n".join(logs), ctx.default_pdf_rel


def _compile_tex_target(
    compile_target: str,
    compile_recipe: str = "",
    use_internal_fallback: bool = True,
) -> Tuple[bool, str, str]:
    return _core_compile.compile_tex_target(
        compile_target,
        compile_recipe,
        use_internal_fallback,
        resolve_compile_context_fn=_resolve_compile_context,
        preflight_fn=_preflight_compile_context,
        compile_tex_target_internal_fn=_compile_tex_target_internal,
        compile_tex_target_recipe_fn=_compile_tex_target_recipe,
    )


# -------------------- API Response Builder --------------------

def _build_response_state() -> Dict[str, Any]:
    state = _load_state()
    starter_templates = _starter_template_meta(_starter_template_catalog())
    return {
        "state": state,
        "schema": {
            "toggles": TOGGLE_SCHEMA,
            "groups": COLOR_GROUPS,
            "class_config": CLASS_CONFIG_SCHEMA,
            "block_presets": state.get("block_presets", []),
            "heading_toc_presets": state.get("heading_toc_presets", []),
            "body_font_size": BODY_FONT_SIZE_CONFIG,
            "starter_templates": starter_templates,
            "starter_default_template": _default_starter_template_id(starter_templates),
            "starter_default_output_target": STARTER_DEFAULT_OUTPUT_TARGET,
        },
    }
