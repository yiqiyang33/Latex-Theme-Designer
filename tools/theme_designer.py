#!/usr/bin/env python3
"""
Local UI for tuning LaTeX template theme colors and feature toggles.

Usage:
  python3 tools/theme_designer.py --open-browser
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

ROOT_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT_DIR / "theme.ui.json"
TOGGLE_OVERRIDE_PATH = ROOT_DIR / "theme.overrides.tex"
COLOR_OVERRIDE_PATH = ROOT_DIR / "theme.colors.tex"
MAIN_TEX_PATH = ROOT_DIR / "main.tex"
THEME_STY_PATH = ROOT_DIR / "theme.sty"

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


def _load_state() -> Dict[str, Any]:
    compile_targets = _list_candidate_tex_files()
    state = {
        "toggles": _parse_main_toggle_defaults(),
        "colors": _parse_theme_color_defaults(),
        "compile_target": _default_compile_target(compile_targets),
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

    if TOGGLE_OVERRIDE_PATH.exists():
        state["toggles"].update(_parse_toggle_override_file(TOGGLE_OVERRIDE_PATH))
    if COLOR_OVERRIDE_PATH.exists():
        state["colors"].update(_parse_color_override_file(COLOR_OVERRIDE_PATH))

    for key in TOGGLE_IDS:
        state["toggles"].setdefault(key, True)
    for key in COLOR_ORDER:
        state["colors"].setdefault(key, "#808080")

    state["compile_targets"] = compile_targets
    state["compile_output_pdf"] = _compile_output_pdf_relpath(state["compile_target"])

    return state


def _normalize_payload(payload: Dict[str, Any], base_state: Dict[str, Any]) -> Dict[str, Any]:
    normalized = {
        "toggles": dict(base_state["toggles"]),
        "colors": dict(base_state["colors"]),
        "compile_target": base_state.get("compile_target", ""),
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

    return normalized


def _persist_ui_state(state: Dict[str, Any]) -> None:
    ui_state = {
        "toggles": state.get("toggles", {}),
        "colors": state.get("colors", {}),
        "compile_target": state.get("compile_target", ""),
    }
    CONFIG_PATH.write_text(
        json.dumps(ui_state, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


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


def _compile_tex_target(compile_target: str) -> Tuple[bool, str, str]:
    logs: List[str] = []

    if not compile_target:
        return False, "No compile target selected.", ""

    target_path = (ROOT_DIR / compile_target).resolve()
    if not target_path.exists():
        return False, f"Compile target does not exist: {compile_target}", ""
    if not target_path.is_file():
        return False, f"Compile target is not a file: {compile_target}", ""

    if not _is_subpath(target_path, ROOT_DIR.resolve()):
        return False, f"Compile target is outside workspace: {compile_target}", ""

    compile_cwd = target_path.parent
    docfile = target_path.name
    docstem = target_path.stem
    expected_pdf_abs = compile_cwd / f"{docstem}.pdf"
    expected_pdf_rel = expected_pdf_abs.relative_to(ROOT_DIR).as_posix()

    def append_step(label: str, command: List[str], success: bool, code: int, output: str) -> None:
        logs.append(f"== {label} ==")
        logs.append(f"[cwd] {compile_cwd}")
        logs.append("$ " + " ".join(command))
        if output.strip():
            lines = output.splitlines()
            logs.extend(lines[-140:])
        else:
            logs.append("(no output)")
        logs.append(f"[exit code: {code}]")
        logs.append("")

    latexmk_bin = _resolve_binary("latexmk")
    if latexmk_bin:
        cmd = [
            latexmk_bin,
            "-g",
            "-xelatex",
            "-interaction=nonstopmode",
            "-halt-on-error",
            docfile,
        ]
        ok, code, out = _run_command(cmd, cwd=compile_cwd)
        append_step("latexmk", cmd, ok, code, out)
        joined = "\n".join(logs)
        tail = "\n".join(joined.splitlines()[-260:]) if joined else "(no compiler output)"
        return ok, tail, expected_pdf_rel

    logs.append("latexmk not found; using fallback compile pipeline.")
    logs.append("")

    tex_engine = _resolve_binary("xelatex") or _resolve_binary("pdflatex")
    if not tex_engine:
        logs.append(
            "No TeX engine found. Install TeX tools, or ensure commands are available in PATH."
        )
        joined = "\n".join(logs)
        return False, joined

    first_pass_cmd = [
        tex_engine,
        "-interaction=nonstopmode",
        "-halt-on-error",
        docfile,
    ]
    ok, code, out = _run_command(first_pass_cmd, cwd=compile_cwd)
    append_step("tex pass 1", first_pass_cmd, ok, code, out)
    if not ok:
        joined = "\n".join(logs)
        return False, "\n".join(joined.splitlines()[-260:]), expected_pdf_rel

    biber_bin = _resolve_binary("biber")
    has_bcf = (compile_cwd / f"{docstem}.bcf").exists()
    rerun_count = 1
    if has_bcf and biber_bin:
        biber_cmd = [biber_bin, docstem]
        bok, bcode, bout = _run_command(biber_cmd, cwd=compile_cwd)
        append_step("biber", biber_cmd, bok, bcode, bout)
        if not bok:
            joined = "\n".join(logs)
            return False, "\n".join(joined.splitlines()[-260:]), expected_pdf_rel
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
            docfile,
        ]
        ok, code, out = _run_command(pass_cmd, cwd=compile_cwd)
        append_step(f"tex pass {idx + 2}", pass_cmd, ok, code, out)
        if not ok:
            joined = "\n".join(logs)
            return False, "\n".join(joined.splitlines()[-260:]), expected_pdf_rel

    success = expected_pdf_abs.exists()
    if not success:
        fallback_pdfs = sorted(compile_cwd.glob("*.pdf"))
        if fallback_pdfs:
            fallback = fallback_pdfs[-1]
            expected_pdf_rel = fallback.relative_to(ROOT_DIR).as_posix()
            success = True
            logs.append(
                f"Expected {docstem}.pdf was not found. Using fallback PDF: {expected_pdf_rel}"
            )
        else:
            logs.append(
                f"Compile ended without errors, but {docstem}.pdf was not found."
            )

    joined = "\n".join(logs)
    tail = "\n".join(joined.splitlines()[-260:]) if joined else "(no compiler output)"
    return success, tail, expected_pdf_rel


def _build_response_state() -> Dict[str, Any]:
    state = _load_state()
    return {
        "state": state,
        "schema": {
            "toggles": TOGGLE_SCHEMA,
            "groups": COLOR_GROUPS,
        },
    }


HTML_PAGE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Theme Designer</title>
  <style>
    :root {
      --bg: #f5f7fb;
      --panel: #ffffff;
      --line: #d8dee9;
      --text: #1f2937;
      --muted: #6b7280;
      --accent: #0b5bd3;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "SF Pro Text", "Segoe UI", system-ui, sans-serif;
      color: var(--text);
      background: linear-gradient(150deg, #eef3ff 0%, #f7fafc 40%, #f3f6fb 100%);
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(360px, 430px) 1fr;
      gap: 14px;
      padding: 14px;
      min-height: 100vh;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 10px 28px rgba(17, 24, 39, 0.05);
    }
    h1 { margin: 0 0 8px; font-size: 24px; }
    h2 { margin: 14px 0 8px; font-size: 18px; }
    p.hint { margin: 0 0 10px; color: var(--muted); font-size: 13px; line-height: 1.4; }
    .toggles { display: grid; gap: 8px; margin-bottom: 12px; }
    .toggle {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 8px;
      align-items: start;
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: #fafcff;
    }
    .toggle label { font-weight: 600; display: block; font-size: 14px; }
    .toggle span { font-size: 12px; color: var(--muted); }
    details.group {
      border: 1px solid var(--line);
      border-radius: 10px;
      margin-bottom: 8px;
      overflow: hidden;
      background: #fcfdff;
    }
    details.group > summary {
      cursor: pointer;
      list-style: none;
      padding: 9px 11px;
      font-weight: 700;
      font-size: 14px;
      border-bottom: 1px solid #edf1f8;
    }
    details.group[open] > summary { background: #f5f8ff; }
    .rows { display: grid; gap: 8px; padding: 10px; }
    .row {
      display: grid;
      grid-template-columns: minmax(110px, 1fr) auto auto;
      gap: 8px;
      align-items: center;
    }
    .row label { font-size: 13px; color: #263041; }
    .row input[type="color"] {
      width: 36px;
      height: 28px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 1px;
      background: #fff;
    }
    .row input.hex {
      width: 104px;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 5px 7px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .row input.hex.invalid {
      border-color: #dc2626;
      background: #fff1f2;
    }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .compile-target {
      display: grid;
      grid-template-columns: 72px 1fr auto;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }
    .compile-target label {
      font-size: 13px;
      font-weight: 700;
      color: #334155;
    }
    .compile-target select {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 6px 9px;
      font-size: 13px;
      background: #fff;
      color: #1f2937;
    }
    .compile-target code {
      font-size: 12px;
      color: #475569;
    }
    button {
      border: 1px solid #bfd3ff;
      background: #eef4ff;
      color: #0b3f96;
      padding: 7px 11px;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
    }
    button.primary {
      border-color: #0b5bd3;
      background: #0b5bd3;
      color: white;
    }
    button.warn {
      border-color: #f3c4c4;
      background: #fff2f2;
      color: #9f1239;
    }
    .status {
      min-height: 24px;
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
    }
    .status.ok { color: #047857; }
    .status.err { color: #b91c1c; }
    .preview-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 10px;
    }
    .sample {
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid #e5eaf4;
      background: white;
    }
    .sample .title {
      font-weight: 700;
      padding: 7px 10px;
      font-size: 13px;
    }
    .sample .body {
      padding: 10px;
      font-size: 13px;
      line-height: 1.45;
      border-left-width: 5px;
      border-left-style: solid;
    }
    .doc-preview {
      margin: 10px 0 14px;
      padding: 10px;
      border: 1px dashed #d6dce8;
      border-radius: 10px;
      background: #fbfdff;
    }
    .doc-preview .chapter { font-weight: 800; font-size: 19px; }
    .doc-preview .section { font-weight: 700; font-size: 16px; margin-top: 5px; }
    .doc-preview .subsection { font-weight: 700; font-size: 14px; margin-top: 3px; }
    .pdf-wrap {
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: hidden;
      margin-top: 8px;
      background: #fff;
    }
    iframe#pdfFrame { width: 100%; height: 430px; border: 0; }
    pre.log {
      margin: 8px 0 0;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 10px;
      max-height: 260px;
      overflow: auto;
      background: #0f172a;
      color: #e2e8f0;
      font-size: 12px;
      line-height: 1.35;
    }
    @media (max-width: 1080px) {
      .layout { grid-template-columns: 1fr; }
      iframe#pdfFrame { height: 360px; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <section class="panel">
      <h1>Theme Designer</h1>
      <p class="hint">Adjust block colors and feature switches. Save writes <code>theme.colors.tex</code> and <code>theme.overrides.tex</code>.</p>
      <h2>Feature Toggles</h2>
      <div id="toggleBox" class="toggles"></div>
      <h2>Colors</h2>
      <div id="groupBox"></div>
    </section>
    <section class="panel">
      <div class="compile-target">
        <label for="targetSelect">Compile</label>
        <select id="targetSelect"></select>
        <button id="applyTargetBtn">Apply Target</button>
      </div>
      <code id="targetInfo"></code>
      <div class="actions">
        <button id="saveBtn" class="primary">Save Overrides</button>
        <button id="compileBtn">Compile PDF</button>
        <button id="refreshPdfBtn">Refresh PDF Preview</button>
        <button id="resetBtn" class="warn">Reset (Delete Overrides)</button>
      </div>
      <div id="status" class="status"></div>

      <h2>Live Preview</h2>
      <div id="docPreview" class="doc-preview"></div>
      <div id="preview" class="preview-grid"></div>

      <h2>PDF Preview</h2>
      <div class="pdf-wrap">
        <iframe id="pdfFrame" src="/api/pdf"></iframe>
      </div>

      <h2>Compiler Log</h2>
      <pre id="logBox" class="log">(click "Compile PDF" to run latexmk)</pre>
    </section>
  </div>
  <script>
    let model = null;

    function setStatus(text, kind = "") {
      const el = document.getElementById("status");
      el.textContent = text;
      el.className = "status " + kind;
    }

    function color(token) {
      return model.state.colors[token] || "#808080";
    }

    function toggleOn(id) {
      return !!model.state.toggles[id];
    }

    function pdfPathForTarget(target) {
      if (!target || !target.endsWith(".tex")) return "main.pdf";
      return target.slice(0, -4) + ".pdf";
    }

    function currentPdfPath() {
      return model.state.compile_output_pdf || pdfPathForTarget(model.state.compile_target);
    }

    function renderTargetInfo() {
      const info = document.getElementById("targetInfo");
      info.textContent = `target: ${model.state.compile_target || "(none)"} | pdf: ${currentPdfPath()}`;
    }

    function renderCompileTargetSelector() {
      const select = document.getElementById("targetSelect");
      select.innerHTML = "";
      const targets = model.state.compile_targets || [];
      for (const target of targets) {
        const opt = document.createElement("option");
        opt.value = target;
        opt.textContent = target;
        select.appendChild(opt);
      }
      if (model.state.compile_target) {
        select.value = model.state.compile_target;
      }
      select.onchange = () => {
        model.state.compile_target = select.value;
        renderTargetInfo();
      };
      renderTargetInfo();
    }

    function renderToggles() {
      const box = document.getElementById("toggleBox");
      box.innerHTML = "";
      for (const item of model.schema.toggles) {
        const row = document.createElement("div");
        row.className = "toggle";
        row.innerHTML = `
          <input type="checkbox" id="toggle-${item.id}" ${toggleOn(item.id) ? "checked" : ""}>
          <div>
            <label for="toggle-${item.id}">${item.label}</label>
            <span>${item.help}</span>
          </div>
        `;
        row.querySelector("input").addEventListener("change", (ev) => {
          model.state.toggles[item.id] = ev.target.checked;
          renderPreview();
        });
        box.appendChild(row);
      }
    }

    function bindColorInputHandlers(inputColor, inputHex, token) {
      inputColor.addEventListener("input", () => {
        inputHex.value = inputColor.value.toUpperCase();
        inputHex.classList.remove("invalid");
        model.state.colors[token] = inputColor.value.toUpperCase();
        renderPreview();
      });
      inputHex.addEventListener("input", () => {
        const val = inputHex.value.trim();
        if (/^#?[0-9a-fA-F]{6}$/.test(val)) {
          const fixed = ("#" + val.replace("#", "")).toUpperCase();
          inputHex.classList.remove("invalid");
          inputColor.value = fixed;
          model.state.colors[token] = fixed;
          renderPreview();
        } else {
          inputHex.classList.add("invalid");
        }
      });
    }

    function renderColorGroups() {
      const box = document.getElementById("groupBox");
      box.innerHTML = "";
      for (const group of model.schema.groups) {
        const details = document.createElement("details");
        details.className = "group";
        details.open = true;
        const summary = document.createElement("summary");
        summary.textContent = group.title;
        details.appendChild(summary);

        const rows = document.createElement("div");
        rows.className = "rows";
        for (const item of group.items) {
          const row = document.createElement("div");
          row.className = "row";
          row.innerHTML = `
            <label>${item.label}</label>
            <input type="color" value="${color(item.id)}">
            <input class="hex" value="${color(item.id)}">
          `;
          const inputColor = row.children[1];
          const inputHex = row.children[2];
          bindColorInputHandlers(inputColor, inputHex, item.id);
          rows.appendChild(row);
        }
        details.appendChild(rows);
        box.appendChild(details);
      }
    }

    function sampleCard(title, titleBg, titleFg, bodyBg, accent) {
      const shadow = toggleOn("enable_block_shadow") ? "box-shadow: 0 3px 0 rgba(17,24,39,0.11);" : "";
      return `
        <article class="sample" style="${shadow}">
          <div class="title" style="background:${titleBg};color:${titleFg};">${title}</div>
          <div class="body" style="background:${bodyBg};border-left-color:${accent};">
            Short content preview for <strong>${title.toLowerCase()}</strong>.
          </div>
        </article>
      `;
    }

    function renderPreview() {
      const docPreview = document.getElementById("docPreview");
      docPreview.innerHTML = `
        <div class="chapter" style="color:${color("theme-chapter")}">Chapter 1. Variational Inference</div>
        <div class="section" style="color:${color("theme-section")}">1.1 Intro</div>
        <div class="subsection" style="color:${color("theme-subsection")}">1.1.1 The objective</div>
      `;

      const noteShadow = toggleOn("enable_block_shadow") ? "box-shadow: 0 3px 0 rgba(17,24,39,0.11);" : "";
      const noteCard = `
        <article class="sample" style="${noteShadow}">
          <div class="title" style="background:${color("note-title-bg")};color:${color("note-title-fg")}">Note</div>
          <div class="body" style="background:${color("note-bg")};border-left-color:${color("note-accent")}">
            A titled note preview block.
          </div>
        </article>
      `;

      document.getElementById("preview").innerHTML = [
        sampleCard("Definition", color("definition-title-bg"), color("definition-title-fg"), color("definition-body-bg"), color("definition-accent")),
        sampleCard("Theorem", color("theorem-title-bg"), color("theorem-title-fg"), color("theorem-body-bg"), color("theorem-accent")),
        sampleCard("Lemma", color("lemma-title-bg"), color("lemma-title-fg"), color("lemma-body-bg"), color("lemma-accent")),
        sampleCard("Corollary", color("corollary-title-bg"), color("corollary-title-fg"), color("corollary-body-bg"), color("corollary-accent")),
        noteCard,
        sampleCard("Example", color("example-bg"), color("example-label-fg"), color("example-bg"), color("example-accent")),
        sampleCard("Remark", color("remark-bg"), color("remark-label-fg"), color("remark-bg"), color("remark-accent"))
      ].join("");
    }

    async function getState() {
      const resp = await fetch("/api/state");
      if (!resp.ok) throw new Error("Failed to load state.");
      return resp.json();
    }

    async function postJson(url, payload) {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {})
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Request failed.");
      return data;
    }

    function refreshPdf() {
      const path = currentPdfPath();
      document.getElementById("pdfFrame").src = `/api/pdf?path=${encodeURIComponent(path)}&ts=${Date.now()}`;
      renderTargetInfo();
    }

    async function saveOverrides() {
      setStatus("Saving overrides...");
      try {
        const result = await postJson("/api/save", model.state);
        model = result;
        renderCompileTargetSelector();
        setStatus("Saved to theme.colors.tex and theme.overrides.tex", "ok");
      } catch (err) {
        setStatus(err.message, "err");
      }
    }

    async function applyCompileTarget() {
      const select = document.getElementById("targetSelect");
      const selected = select.value;
      setStatus(`Applying compile target: ${selected}`);
      try {
        model = await postJson("/api/target", { compile_target: selected });
        renderCompileTargetSelector();
        refreshPdf();
        setStatus(`Compile target set to ${model.state.compile_target}`, "ok");
      } catch (err) {
        setStatus(err.message, "err");
      }
    }

    async function resetOverrides() {
      if (!confirm("Delete override files and reset to defaults?")) return;
      setStatus("Resetting...");
      try {
        model = await postJson("/api/reset", {});
        renderCompileTargetSelector();
        renderToggles();
        renderColorGroups();
        renderPreview();
        refreshPdf();
        setStatus("Reset complete. Override files deleted.", "ok");
      } catch (err) {
        setStatus(err.message, "err");
      }
    }

    async function compilePdf() {
      const selected = document.getElementById("targetSelect").value || model.state.compile_target;
      model.state.compile_target = selected;
      setStatus(`Compiling ${selected}...`);
      const btn = document.getElementById("compileBtn");
      btn.disabled = true;
      try {
        const result = await postJson("/api/compile", { compile_target: selected });
        document.getElementById("logBox").textContent = result.output;
        if (result.compile_target) {
          model.state.compile_target = result.compile_target;
        }
        if (result.pdf_path) {
          model.state.compile_output_pdf = result.pdf_path;
        }
        renderTargetInfo();
        if (result.success) {
          setStatus("Compile succeeded.", "ok");
          refreshPdf();
        } else {
          setStatus("Compile failed. Check log below.", "err");
        }
      } catch (err) {
        setStatus(err.message, "err");
      } finally {
        btn.disabled = false;
      }
    }

    async function init() {
      setStatus("Loading...");
      model = await getState();
      renderCompileTargetSelector();
      renderToggles();
      renderColorGroups();
      renderPreview();
      setStatus("Ready");
      refreshPdf();

      document.getElementById("applyTargetBtn").addEventListener("click", applyCompileTarget);
      document.getElementById("saveBtn").addEventListener("click", saveOverrides);
      document.getElementById("resetBtn").addEventListener("click", resetOverrides);
      document.getElementById("compileBtn").addEventListener("click", compilePdf);
      document.getElementById("refreshPdfBtn").addEventListener("click", refreshPdf);
    }

    init().catch((err) => {
      setStatus(err.message, "err");
    });
  </script>
</body>
</html>
"""


class ThemeDesignerHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, payload: Dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _send_bytes(self, status_code: int, body: bytes, content_type: str) -> None:
        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _parse_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        if not raw.strip():
            return {}
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("JSON body must be an object.")
        return data

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/":
            self._send_bytes(200, HTML_PAGE.encode("utf-8"), "text/html; charset=utf-8")
            return

        if path == "/api/state":
            with STATE_LOCK:
                payload = _build_response_state()
            self._send_json(200, payload)
            return

        if path == "/api/pdf":
            try:
                query = parse_qs(parsed.query)
                requested_pdf = query.get("path", [""])[0]
                if not requested_pdf:
                    state = _load_state()
                    requested_pdf = state.get("compile_output_pdf", "main.pdf")
                pdf_abs, pdf_rel = _resolve_workspace_pdf(requested_pdf)
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
                return

            if not pdf_abs.exists():
                self._send_json(404, {"error": f"{pdf_rel} not found. Compile first."})
                return

            body = pdf_abs.read_bytes()
            self._send_bytes(200, body, "application/pdf")
            return

        self._send_json(404, {"error": f"Unknown path: {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api/save":
            try:
                payload = self._parse_json_body()
                with STATE_LOCK:
                    current = _load_state()
                    normalized = _normalize_payload(payload, current)
                    _write_override_files(normalized)
                    response = _build_response_state()
                self._send_json(200, response)
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
            except Exception as err:  # pragma: no cover - defensive path
                self._send_json(500, {"error": f"Failed to save: {err}"})
            return

        if self.path == "/api/target":
            try:
                payload = self._parse_json_body()
                with STATE_LOCK:
                    current = _load_state()
                    if "compile_target" not in payload:
                        raise ValueError("Missing compile_target in request payload.")
                    selected = _normalize_compile_target(
                        payload.get("compile_target"),
                        current.get("compile_targets", []),
                    )
                    current["compile_target"] = selected
                    current["compile_output_pdf"] = _compile_output_pdf_relpath(selected)
                    _persist_ui_state(current)
                    response = _build_response_state()
                self._send_json(200, response)
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
            except Exception as err:  # pragma: no cover
                self._send_json(500, {"error": f"Failed to set compile target: {err}"})
            return

        if self.path == "/api/reset":
            try:
                with STATE_LOCK:
                    _delete_override_files()
                    response = _build_response_state()
                self._send_json(200, response)
            except Exception as err:  # pragma: no cover
                self._send_json(500, {"error": f"Failed to reset: {err}"})
            return

        if self.path == "/api/compile":
            try:
                payload = self._parse_json_body()
                with STATE_LOCK:
                    current = _load_state()
                    if "compile_target" in payload:
                        selected = _normalize_compile_target(
                            payload.get("compile_target"),
                            current.get("compile_targets", []),
                        )
                    else:
                        selected = current.get("compile_target", "")

                    current["compile_target"] = selected
                    _persist_ui_state(current)
                    success, output, pdf_path = _compile_tex_target(selected)

                self._send_json(
                    200,
                    {
                        "success": success,
                        "output": output,
                        "compile_target": selected,
                        "pdf_path": pdf_path,
                    },
                )
            except ValueError as err:
                self._send_json(400, {"error": str(err)})
            except Exception as err:  # pragma: no cover
                self._send_json(500, {"error": f"Compile failed: {err}"})
            return

        self._send_json(404, {"error": f"Unknown path: {self.path}"})


def run_server(host: str, port: int, open_browser: bool) -> None:
    server = ThreadingHTTPServer((host, port), ThemeDesignerHandler)
    url = f"http://{host}:{port}"
    print(f"Theme designer running at {url}")
    print("Press Ctrl+C to stop.")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run local UI for theme tuning.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind (default: 8765)")
    parser.add_argument(
        "--open-browser",
        action="store_true",
        help="Open default browser automatically after startup.",
    )
    args = parser.parse_args()
    run_server(args.host, args.port, args.open_browser)


if __name__ == "__main__":
    main()
