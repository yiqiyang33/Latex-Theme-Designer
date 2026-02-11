#!/usr/bin/env python3
"""Runtime/IO helpers extracted from theme_designer_core."""

from __future__ import annotations

import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="ignore")


def resolve_binary(
    name: str,
    *,
    which_fn: Callable[[str], Optional[str]] = shutil.which,
    candidate_dirs: Optional[List[Path]] = None,
) -> Optional[str]:
    found = which_fn(name)
    if found:
        return found

    search_dirs = candidate_dirs or [
        Path("/Library/TeX/texbin"),
        Path("/usr/texbin"),
        Path("/opt/homebrew/bin"),
        Path("/usr/local/bin"),
    ]
    for directory in search_dirs:
        candidate = directory / name
        if candidate.exists() and candidate.is_file():
            return str(candidate)
    return None


def build_tex_env(
    *,
    root_dir: Path,
    environ: Dict[str, str],
    pathsep: str = os.pathsep,
    prepend_paths: Optional[List[str]] = None,
) -> Dict[str, str]:
    env = dict(environ)
    existing = [item for item in env.get("PATH", "").split(pathsep) if item]
    prepend = prepend_paths or [
        "/Library/TeX/texbin",
        "/usr/texbin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
    ]
    merged: List[str] = []
    for path in prepend + existing:
        if path not in merged:
            merged.append(path)
    env["PATH"] = pathsep.join(merged)

    workspace = str(root_dir.resolve())
    tex_inputs = [item for item in env.get("TEXINPUTS", "").split(pathsep) if item]
    bib_inputs = [item for item in env.get("BIBINPUTS", "").split(pathsep) if item]
    bst_inputs = [item for item in env.get("BSTINPUTS", "").split(pathsep) if item]

    env["TEXINPUTS"] = pathsep.join([".", workspace] + tex_inputs) + pathsep
    env["BIBINPUTS"] = pathsep.join([".", workspace] + bib_inputs) + pathsep
    env["BSTINPUTS"] = pathsep.join([".", workspace] + bst_inputs) + pathsep
    return env


def run_command(
    command: List[str],
    *,
    cwd: Path,
    build_tex_env_fn: Callable[[], Dict[str, str]],
    timeout_sec: float,
    timeout_exit_code: int,
    subprocess_run_fn: Callable[..., object],
) -> Tuple[bool, int, str]:
    try:
        proc = subprocess_run_fn(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            env=build_tex_env_fn(),
            timeout=timeout_sec,
            shell=False,
        )
    except FileNotFoundError:
        return False, 127, f"[missing] command not found: {command[0]}"
    except subprocess.TimeoutExpired as err:
        output_parts: List[str] = []
        if err.output:
            output_parts.append(str(err.output))
        if err.stderr:
            output_parts.append(str(err.stderr))
        output_parts.append(
            f"[timeout] command exceeded {timeout_sec:.1f}s: " + " ".join(command)
        )
        return False, timeout_exit_code, "\n".join(output_parts)

    stdout = str(getattr(proc, "stdout", "") or "")
    stderr = str(getattr(proc, "stderr", "") or "")
    code = int(getattr(proc, "returncode", 1))
    output = stdout + ("\n" if stdout and stderr else "") + stderr
    return code == 0, code, output


def iso8601_utc_from_epoch(epoch_seconds: float) -> str:
    dt = datetime.fromtimestamp(epoch_seconds, tz=timezone.utc).replace(microsecond=0)
    return dt.isoformat().replace("+00:00", "Z")


def now_iso8601_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
