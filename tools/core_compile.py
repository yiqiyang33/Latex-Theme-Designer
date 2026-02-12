#!/usr/bin/env python3
"""Compile orchestration helpers extracted from theme_designer_core."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

SUBFILE_PATTERN = re.compile(r"\\subfile(?:\[[^\]]*\])?\{([^}]+)\}")
UNESCAPED_PERCENT_PATTERN = re.compile(r"(?<!\\)%.*$")


def _strip_tex_comments(text: str) -> str:
    lines: List[str] = []
    for raw_line in text.splitlines():
        lines.append(UNESCAPED_PERCENT_PATTERN.sub("", raw_line))
    return "\n".join(lines)


def validate_subfile_references(
    entry_tex_abs: Path,
    *,
    root_dir: Path,
    read_text_fn: Callable[[Path], str],
    is_subpath_fn: Callable[[Path, Path], bool],
) -> List[str]:
    """Validate subfile include graph for obvious recursive/missing path failures."""

    issues: List[str] = []
    root_abs = root_dir.resolve()
    visited: set[Path] = set()
    visiting: set[Path] = set()

    def _rel(path: Path) -> str:
        try:
            return path.resolve().relative_to(root_abs).as_posix()
        except ValueError:
            return str(path.resolve())

    def _record(issue: str) -> None:
        if issue not in issues:
            issues.append(issue)

    def _resolve_subfile_target(base_file: Path, raw_ref: str) -> Path:
        raw = raw_ref.strip()
        ref = Path(raw)
        if ref.suffix.lower() != ".tex":
            ref = ref.with_suffix(".tex")
        if ref.is_absolute():
            return ref.resolve()
        return (base_file.parent / ref).resolve()

    def _walk(current: Path, chain: List[Path]) -> None:
        resolved = current.resolve()
        if resolved in visiting:
            cycle = " -> ".join([_rel(item) for item in chain + [resolved]])
            _record(f"Recursive subfile cycle detected: {cycle}")
            return
        if resolved in visited:
            return

        visiting.add(resolved)
        visited.add(resolved)
        try:
            raw_text = read_text_fn(resolved)
        except OSError as err:
            _record(f"Failed to read source file: {_rel(resolved)} ({err})")
            visiting.discard(resolved)
            return

        text = _strip_tex_comments(raw_text)
        for raw_ref in SUBFILE_PATTERN.findall(text):
            target_abs = _resolve_subfile_target(resolved, raw_ref)
            source_rel = _rel(resolved)
            target_rel = _rel(target_abs)

            if target_abs == resolved:
                _record(
                    f"Recursive subfile self-reference: {source_rel} includes '{raw_ref}'."
                )
                continue

            if not is_subpath_fn(target_abs, root_abs):
                _record(
                    f"Subfile target outside workspace: {source_rel} -> '{raw_ref}'."
                )
                continue

            if "Sections/Sections/" in target_rel:
                _record(f"Suspicious nested Sections path: {source_rel} -> {target_rel}")

            if not target_abs.exists():
                _record(f"Missing subfile target: {source_rel} -> {target_rel}")
                continue

            _walk(target_abs, chain + [resolved])

        visiting.discard(resolved)

    entry_abs = entry_tex_abs.resolve()
    if not is_subpath_fn(entry_abs, root_abs):
        return [f"Compile target is outside workspace: {entry_tex_abs}"]

    _walk(entry_abs, [])
    return issues


def resolve_compile_context(
    compile_target: str,
    *,
    root_dir: Path,
    is_subpath: Callable[[Path, Path], bool],
    compile_context_factory: Callable[..., Any],
) -> Any:
    """Resolve and validate the selected compile target."""

    if not compile_target:
        raise ValueError("No compile target selected.")

    target_abs = (root_dir / compile_target).resolve()
    if not target_abs.exists():
        raise ValueError(f"Compile target does not exist: {compile_target}")
    if not target_abs.is_file():
        raise ValueError(f"Compile target is not a file: {compile_target}")
    if not is_subpath(target_abs, root_dir.resolve()):
        raise ValueError(f"Compile target is outside workspace: {compile_target}")

    compile_cwd = target_abs.parent
    docfile = target_abs.name
    docstem = target_abs.stem
    default_pdf_abs = compile_cwd / f"{docstem}.pdf"
    default_pdf_rel = default_pdf_abs.relative_to(root_dir).as_posix()
    return compile_context_factory(
        target_rel=compile_target,
        target_abs=target_abs,
        compile_cwd=compile_cwd,
        docfile=docfile,
        docstem=docstem,
        default_pdf_abs=default_pdf_abs,
        default_pdf_rel=default_pdf_rel,
    )


def list_candidate_tex_files(
    *,
    root_dir: Path,
    ignore_tex_filenames: set[str],
    ignore_dir_names: set[str],
    has_documentclass_fn: Callable[[Path], bool],
    main_tex_path: Path,
) -> List[str]:
    root_candidates: List[str] = []
    nested_candidates: List[str] = []

    for tex_path in sorted(root_dir.glob("*.tex")):
        if tex_path.name in ignore_tex_filenames:
            continue
        if has_documentclass_fn(tex_path):
            root_candidates.append(tex_path.name)

    for tex_path in sorted(root_dir.rglob("*.tex")):
        if tex_path.parent == root_dir:
            continue
        if tex_path.name in ignore_tex_filenames:
            continue
        rel = tex_path.relative_to(root_dir)
        if any(part in ignore_dir_names or part.startswith(".") for part in rel.parts[:-1]):
            continue
        if has_documentclass_fn(tex_path):
            nested_candidates.append(rel.as_posix())

    candidates = root_candidates + sorted(set(nested_candidates))
    if not candidates and main_tex_path.exists():
        candidates.append("main.tex")

    return candidates


def default_compile_target(candidates: List[str]) -> str:
    if "main.tex" in candidates:
        return "main.tex"
    return candidates[0] if candidates else ""


def normalize_compile_target(
    raw_target: Any,
    candidates: List[str],
    *,
    root_dir: Path,
    is_subpath_fn: Callable[[Path, Path], bool],
    default_compile_target_fn: Callable[[List[str]], str],
) -> str:
    if not candidates:
        return ""

    target = str(raw_target).strip() if raw_target is not None else ""
    if not target:
        return default_compile_target_fn(candidates)
    if target in candidates:
        return target

    input_path = Path(target)
    if input_path.is_absolute():
        resolved = input_path.resolve()
    else:
        resolved = (root_dir / input_path).resolve()

    if not is_subpath_fn(resolved, root_dir.resolve()):
        raise ValueError(f"Compile target is outside workspace: {target}")

    rel = resolved.relative_to(root_dir).as_posix()
    if rel in candidates:
        return rel

    raise ValueError(f"Unknown compile target: {target}")


def compile_output_pdf_relpath(compile_target: str) -> str:
    if not compile_target:
        return "main.pdf"
    return Path(compile_target).with_suffix(".pdf").as_posix()


def default_compile_recipe(recipes: List[Dict[str, Any]]) -> str:
    if not recipes:
        return ""
    return str(recipes[0].get("id", ""))


def normalize_compile_recipe(
    raw_recipe: Any,
    recipes: List[Dict[str, Any]],
    *,
    default_compile_recipe_fn: Callable[[List[Dict[str, Any]]], str],
) -> str:
    if not recipes:
        return ""
    recipe_id = str(raw_recipe).strip() if raw_recipe is not None else ""
    if not recipe_id:
        return default_compile_recipe_fn(recipes)
    valid_ids = {str(item.get("id", "")) for item in recipes}
    if recipe_id in valid_ids:
        return recipe_id
    raise ValueError(f"Unknown compile recipe: {recipe_id}")


def recipe_name_by_id(recipe_id: str, recipes: List[Dict[str, Any]]) -> str:
    for recipe in recipes:
        if str(recipe.get("id", "")) == recipe_id:
            return str(recipe.get("name", recipe_id))
    return ""


def append_step_log(
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


def finalize_logs(logs: List[str]) -> str:
    joined = "\n".join(logs)
    return "\n".join(joined.splitlines()[-260:]) if joined else "(no compiler output)"


def replace_recipe_tokens(value: str, ctx: Any, outdir: str) -> str:
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


def extract_recipe_outdir(args: List[str]) -> Optional[str]:
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


def resolve_pdf_path_for_outdir(
    ctx: Any,
    outdir: str,
    *,
    root_dir: Path,
    is_subpath: Callable[[Path, Path], bool],
) -> str:
    cleaned = (outdir or "").strip()
    if not cleaned or cleaned == ".":
        return ctx.default_pdf_rel

    outdir_path = Path(cleaned)
    if outdir_path.is_absolute():
        resolved_dir = outdir_path.resolve()
    else:
        resolved_dir = (ctx.compile_cwd / outdir_path).resolve()

    if not is_subpath(resolved_dir, root_dir.resolve()):
        return ctx.default_pdf_rel
    return (resolved_dir / f"{ctx.docstem}.pdf").relative_to(root_dir).as_posix()


def recipe_entry_by_id(
    recipe_id: str,
    recipes: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    for recipe in recipes:
        if str(recipe.get("id", "")) == recipe_id:
            return recipe
    return None


def recipe_outdir_for_context(
    ctx: Any,
    recipe_id: str,
    catalog: Dict[str, Any],
) -> str:
    """Resolve final %OUTDIR% value for one target+recipe pair."""

    recipes = catalog.get("recipes", [])
    recipe = recipe_entry_by_id(recipe_id, recipes)
    if recipe is None:
        return "."

    tools = catalog.get("tools", {})
    outdir = "."
    for tool_name in recipe.get("tools", []):
        tool = tools.get(tool_name)
        if not isinstance(tool, dict):
            continue
        raw_args = tool.get("args", [])
        args = [replace_recipe_tokens(str(arg), ctx, outdir) for arg in raw_args]
        detected = extract_recipe_outdir(args)
        if detected:
            outdir = detected
    return outdir


def expected_output_pdf_for_selection(
    compile_target: str,
    compile_recipe: str,
    use_internal_fallback: bool,
    *,
    resolve_compile_context_fn: Callable[[str], Any],
    compile_output_pdf_relpath_fn: Callable[[str], str],
    load_vscode_recipe_catalog_fn: Callable[[], Dict[str, Any]],
    recipe_outdir_for_context_fn: Callable[[Any, str, Dict[str, Any]], str],
    resolve_pdf_path_for_outdir_fn: Callable[[Any, str], str],
    recipe_catalog: Optional[Dict[str, Any]] = None,
) -> str:
    """Predict output PDF path for the selected compile configuration."""

    if not compile_target:
        return "main.pdf"

    try:
        ctx = resolve_compile_context_fn(compile_target)
    except ValueError:
        return compile_output_pdf_relpath_fn(compile_target)

    if use_internal_fallback:
        return ctx.default_pdf_rel

    catalog = recipe_catalog if recipe_catalog is not None else load_vscode_recipe_catalog_fn()
    outdir = recipe_outdir_for_context_fn(ctx, compile_recipe, catalog)
    return resolve_pdf_path_for_outdir_fn(ctx, outdir)


def resolve_recipe_command(
    raw_command: str,
    *,
    resolve_binary_fn: Callable[[str], Optional[str]],
) -> str:
    command = raw_command.strip()
    if not command:
        return ""
    if "/" in command or "\\" in command:
        return command
    resolved = resolve_binary_fn(command)
    return resolved or command


def pick_fallback_pdf(
    ctx: Any,
    expected_pdf_rel: str,
    *,
    resolve_workspace_pdf_fn: Callable[[str], tuple[Path, str]],
    is_subpath_fn: Callable[[Path, Path], bool],
    root_dir: Path,
) -> str:
    """Find the most recently modified PDF near expected output and compile cwd."""

    candidate_dirs: List[Path] = [ctx.compile_cwd]
    expected_abs, _ = resolve_workspace_pdf_fn(expected_pdf_rel)
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
            if is_subpath_fn(resolved_pdf, root_dir.resolve()):
                candidates.append(resolved_pdf)

    if not candidates:
        return ""

    def _mtime_or_zero(path: Path) -> float:
        try:
            return path.stat().st_mtime
        except OSError:
            return 0.0

    latest = max(candidates, key=_mtime_or_zero)
    return latest.relative_to(root_dir).as_posix()


def check_output_freshness(
    ctx: Any,
    pdf_rel: str,
    *,
    resolve_workspace_pdf_fn: Callable[[str], tuple[Path, str]],
    iso8601_utc_from_epoch_fn: Callable[[float], str],
) -> Tuple[bool, str, List[str]]:
    """Verify PDF exists and is not older than source target file."""

    diagnostics: List[str] = []
    pdf_abs, normalized_pdf_rel = resolve_workspace_pdf_fn(pdf_rel)
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
        f"[source mtime] {ctx.target_rel}: {iso8601_utc_from_epoch_fn(source_mtime)}"
    )
    diagnostics.append(
        f"[pdf mtime] {normalized_pdf_rel}: {iso8601_utc_from_epoch_fn(pdf_mtime)}"
    )

    if pdf_mtime + 1e-3 < source_mtime:
        diagnostics.append("Stale preview risk: output PDF is older than source target.")
        diagnostics.append("Tip: verify recipe output directory and re-run compile.")
        return False, normalized_pdf_rel, diagnostics

    diagnostics.append("Output freshness check passed.")
    return True, normalized_pdf_rel, diagnostics


def finalize_compile_output(
    ctx: Any,
    logs: List[str],
    expected_pdf_rel: str,
    *,
    resolve_workspace_pdf_fn: Callable[[str], tuple[Path, str]],
    pick_fallback_pdf_fn: Callable[[Any, str], str],
    check_output_freshness_fn: Callable[[Any, str], Tuple[bool, str, List[str]]],
    finalize_logs_fn: Callable[[List[str]], str],
) -> Tuple[bool, str, str]:
    """Apply fallback lookup and freshness validation for compile output."""

    chosen_pdf_rel = expected_pdf_rel
    expected_abs, expected_rel = resolve_workspace_pdf_fn(expected_pdf_rel)
    if not expected_abs.exists():
        fallback_rel = pick_fallback_pdf_fn(ctx, expected_rel)
        if fallback_rel:
            logs.append(
                f"Expected PDF not found at {expected_rel}. Using fallback PDF: {fallback_rel}"
            )
            logs.append("")
            chosen_pdf_rel = fallback_rel
        else:
            logs.append(f"Compile finished, but expected PDF was not found: {expected_rel}")
            logs.append("")
            return False, finalize_logs_fn(logs), expected_rel

    logs.append("== output check ==")
    freshness_ok, normalized_pdf_rel, diagnostics = check_output_freshness_fn(
        ctx,
        chosen_pdf_rel,
    )
    logs.extend(diagnostics)
    logs.append("")
    return freshness_ok, finalize_logs_fn(logs), normalized_pdf_rel


def compile_tex_target_internal(
    ctx: Any,
    *,
    resolve_binary_fn: Callable[[str], Optional[str]],
    run_command_fn: Callable[[List[str], Path], Tuple[bool, int, str]],
    append_step_log_fn: Callable[[List[str], str, Path, List[str], str, int], None],
    finalize_logs_fn: Callable[[List[str]], str],
    finalize_compile_output_fn: Callable[[Any, List[str], str], Tuple[bool, str, str]],
) -> Tuple[bool, str, str]:
    """Compile using the built-in pipeline (latexmk or xelatex/pdflatex fallback)."""

    logs: List[str] = []

    latexmk_bin = resolve_binary_fn("latexmk")
    if latexmk_bin:
        cmd = [
            latexmk_bin,
            "-g",
            "-xelatex",
            "-interaction=nonstopmode",
            "-halt-on-error",
            ctx.docfile,
        ]
        ok, code, out = run_command_fn(cmd, cwd=ctx.compile_cwd)
        append_step_log_fn(logs, "latexmk", ctx.compile_cwd, cmd, out, code)
        if not ok:
            return False, finalize_logs_fn(logs), ctx.default_pdf_rel
        return finalize_compile_output_fn(ctx, logs, ctx.default_pdf_rel)

    logs.append("latexmk not found; using fallback compile pipeline.")
    logs.append("")

    tex_engine = resolve_binary_fn("xelatex") or resolve_binary_fn("pdflatex")
    if not tex_engine:
        logs.append(
            "No TeX engine found. Install TeX tools, or ensure commands are available in PATH."
        )
        return False, finalize_logs_fn(logs), ctx.default_pdf_rel

    first_pass_cmd = [
        tex_engine,
        "-interaction=nonstopmode",
        "-halt-on-error",
        ctx.docfile,
    ]
    ok, code, out = run_command_fn(first_pass_cmd, cwd=ctx.compile_cwd)
    append_step_log_fn(logs, "tex pass 1", ctx.compile_cwd, first_pass_cmd, out, code)
    if not ok:
        return False, finalize_logs_fn(logs), ctx.default_pdf_rel

    biber_bin = resolve_binary_fn("biber")
    has_bcf = (ctx.compile_cwd / f"{ctx.docstem}.bcf").exists()
    rerun_count = 1
    if has_bcf and biber_bin:
        biber_cmd = [biber_bin, ctx.docstem]
        bok, bcode, bout = run_command_fn(biber_cmd, cwd=ctx.compile_cwd)
        append_step_log_fn(logs, "biber", ctx.compile_cwd, biber_cmd, bout, bcode)
        if not bok:
            return False, finalize_logs_fn(logs), ctx.default_pdf_rel
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
        ok, code, out = run_command_fn(pass_cmd, cwd=ctx.compile_cwd)
        append_step_log_fn(logs, f"tex pass {idx + 2}", ctx.compile_cwd, pass_cmd, out, code)
        if not ok:
            return False, finalize_logs_fn(logs), ctx.default_pdf_rel

    return finalize_compile_output_fn(ctx, logs, ctx.default_pdf_rel)


def compile_tex_target_recipe(
    ctx: Any,
    recipe_id: str,
    *,
    load_vscode_recipe_catalog_fn: Callable[[], Dict[str, Any]],
    recipe_entry_by_id_fn: Callable[[str, List[Dict[str, Any]]], Optional[Dict[str, Any]]],
    resolve_recipe_command_fn: Callable[[str], str],
    replace_recipe_tokens_fn: Callable[[str, Any, str], str],
    extract_recipe_outdir_fn: Callable[[List[str]], Optional[str]],
    run_command_fn: Callable[[List[str], Path], Tuple[bool, int, str]],
    append_step_log_fn: Callable[[List[str], str, Path, List[str], str, int], None],
    finalize_logs_fn: Callable[[List[str]], str],
    resolve_binary_fn: Callable[[str], Optional[str]],
    resolve_pdf_path_for_outdir_fn: Callable[[Any, str], str],
    finalize_compile_output_fn: Callable[[Any, List[str], str], Tuple[bool, str, str]],
) -> Tuple[bool, str, str]:
    """Compile by executing one VSCode recipe tool-by-tool."""

    logs: List[str] = []
    catalog = load_vscode_recipe_catalog_fn()
    recipes = catalog.get("recipes", [])
    tools = catalog.get("tools", {})

    recipe = recipe_entry_by_id_fn(recipe_id, recipes)
    if recipe is None:
        logs.append(f"Unknown compile recipe: {recipe_id}")
        logs.append("Tip: choose an available recipe or enable internal fallback pipeline.")
        return False, finalize_logs_fn(logs), ctx.default_pdf_rel

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
            return False, finalize_logs_fn(logs), ctx.default_pdf_rel

        raw_command = str(tool.get("command", "")).strip()
        if not raw_command:
            logs.append(f"Tool '{tool_name}' has empty command.")
            return False, finalize_logs_fn(logs), ctx.default_pdf_rel

        command = resolve_recipe_command_fn(replace_recipe_tokens_fn(raw_command, ctx, outdir))
        if not command:
            logs.append(f"Tool '{tool_name}' resolved to empty command.")
            return False, finalize_logs_fn(logs), ctx.default_pdf_rel

        if Path(command).name == command and not resolve_binary_fn(command):
            logs.append(f"Missing command for tool '{tool_name}': {command}")
            logs.append(
                "Tip: install the command or enable internal fallback pipeline."
            )
            return False, finalize_logs_fn(logs), ctx.default_pdf_rel

        raw_args = tool.get("args", [])
        args = [replace_recipe_tokens_fn(str(arg), ctx, outdir) for arg in raw_args]
        detected_outdir = extract_recipe_outdir_fn(args)
        if detected_outdir:
            outdir = detected_outdir

        cmd = [command] + args
        ok, code, out = run_command_fn(cmd, cwd=ctx.compile_cwd)
        append_step_log_fn(
            logs,
            f"recipe step {step_idx}: {tool_name}",
            ctx.compile_cwd,
            cmd,
            out,
            code,
        )
        if not ok:
            return False, finalize_logs_fn(logs), resolve_pdf_path_for_outdir_fn(ctx, outdir)

    expected_pdf_rel = resolve_pdf_path_for_outdir_fn(ctx, outdir)
    return finalize_compile_output_fn(ctx, logs, expected_pdf_rel)


def compile_tex_target(
    compile_target: str,
    compile_recipe: str,
    use_internal_fallback: bool,
    *,
    resolve_compile_context_fn: Callable[[str], Any],
    preflight_fn: Optional[Callable[[Any], Optional[Tuple[bool, str, str]]]] = None,
    compile_tex_target_internal_fn: Callable[[Any], Tuple[bool, str, str]],
    compile_tex_target_recipe_fn: Callable[[Any, str], Tuple[bool, str, str]],
) -> Tuple[bool, str, str]:
    """Unified compile entrypoint for internal mode and recipe mode."""

    try:
        ctx = resolve_compile_context_fn(compile_target)
    except ValueError as err:
        return False, str(err), ""

    if preflight_fn is not None:
        preflight_result = preflight_fn(ctx)
        if preflight_result is not None:
            return preflight_result

    if use_internal_fallback:
        return compile_tex_target_internal_fn(ctx)
    return compile_tex_target_recipe_fn(ctx, compile_recipe)
