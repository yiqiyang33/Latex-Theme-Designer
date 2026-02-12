import argparse
import io
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from contextlib import redirect_stdout

from tools import latex_toolkit as ltk
from tools import theme_designer as td_entry
from tools import theme_designer_core as td
from tools import theme_designer_server as tds
from tools import theme_designer_ui as tdu
from tools import tex_splitter as ts


class ThemeDesignerTests(unittest.TestCase):
    def test_theme_designer_ui_loaded_from_external_html_asset(self) -> None:
        raw = tdu.UI_HTML_PATH.read_text(encoding="utf-8")
        self.assertEqual(tdu.HTML_PAGE, raw)

    def test_theme_designer_ui_loader_reports_missing_asset(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Failed to load toolkit HTML"):
            tdu._load_html_page(Path("/tmp/_theme_designer_ui_missing_asset.html"))

    def test_theme_designer_entrypoint_is_legacy_alias(self) -> None:
        self.assertIs(td_entry.run_server, ltk.run_server)
        self.assertIs(td_entry.main, ltk.main)
        self.assertIs(td_entry.ThemeDesignerHandler, ltk.ThemeDesignerHandler)

    def test_launcher_scripts_exist_and_use_latex_toolkit_entrypoint(self) -> None:
        root = td.ROOT_DIR
        shell_script = root / "scripts/start-ui.sh"
        command_script = root / "scripts/start-ui.command"

        self.assertTrue(shell_script.exists())
        self.assertTrue(command_script.exists())
        self.assertTrue(os.access(shell_script, os.X_OK))
        self.assertTrue(os.access(command_script, os.X_OK))

        sh_text = shell_script.read_text(encoding="utf-8")
        command_text = command_script.read_text(encoding="utf-8")
        self.assertIn("tools/latex_toolkit.py --open-browser --port auto", sh_text)
        self.assertIn("start-ui.sh", command_text)

    def _embedded_ui_script(self) -> str:
        match = re.search(r"<script>(.*)</script>", tdu.HTML_PAGE, re.S)
        self.assertIsNotNone(match, "Embedded HTML page is missing <script> block.")
        return match.group(1) if match else ""

    def test_theme_designer_ui_embedded_script_has_valid_js_syntax(self) -> None:
        node_bin = shutil.which("node")
        if not node_bin:
            self.skipTest("node is required for UI script syntax check")

        script = self._embedded_ui_script()

        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as tmp:
            tmp.write(script)
            tmp_path = Path(tmp.name)

        try:
            run = subprocess.run(
                [node_bin, "--check", str(tmp_path)],
                capture_output=True,
                text=True,
                check=False,
            )
        finally:
            tmp_path.unlink(missing_ok=True)

        if run.returncode != 0:
            detail = (run.stderr or run.stdout).strip()
            self.fail(f"Embedded UI script has invalid JS syntax: {detail}")

    def test_ui_selector_state_sync_and_disable_guards_exist(self) -> None:
        script = self._embedded_ui_script()
        self.assertIn("const selectorState = {", script)
        self.assertIn("function syncSelectorStateFromModel()", script)
        self.assertIn("select.disabled = entries.length === 0;", script)
        self.assertIn("applyBtn.disabled = recipes.length === 0;", script)
        self.assertNotIn("fallback.checked || recipes.length === 0", script)

    def test_split_response_refresh_keeps_template_and_recipe_catalogs(self) -> None:
        baseline = td._build_response_state()
        baseline_templates = [
            str(item.get("id", ""))
            for item in baseline.get("schema", {}).get("starter_templates", [])
        ]
        baseline_recipes = [
            str(item.get("id", ""))
            for item in baseline.get("state", {}).get("compile_recipes", [])
        ]

        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_selector_catalog_refresh"
        source_rel = "tools/tests/_tmp_selector_catalog_refresh/main.tex"
        source_abs = root / source_rel
        source_abs.parent.mkdir(parents=True, exist_ok=True)
        source_abs.write_text(
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{One}\n"
            "Alpha.\n"
            "\\section{Two}\n"
            "Beta.\n"
            "\\end{document}\n",
            encoding="utf-8",
        )

        try:
            refreshed = tds._split_response_payload(
                {
                    "compile_target": source_rel,
                    "standalone_mode": "subfiles",
                    "dry_run": True,
                }
            )
        finally:
            if base_dir.exists():
                shutil.rmtree(base_dir)

        refreshed_templates = [
            str(item.get("id", ""))
            for item in refreshed.get("schema", {}).get("starter_templates", [])
        ]
        refreshed_recipes = [
            str(item.get("id", ""))
            for item in refreshed.get("state", {}).get("compile_recipes", [])
        ]

        self.assertEqual(refreshed_templates, baseline_templates)
        self.assertEqual(refreshed_recipes, baseline_recipes)
        self.assertIn(source_rel, refreshed.get("state", {}).get("compile_targets", []))

    def test_build_tex_env_includes_workspace_lookup_paths(self) -> None:
        env = td._build_tex_env()
        workspace = str(td.ROOT_DIR.resolve())
        self.assertIn(workspace, env.get("TEXINPUTS", ""))
        self.assertIn(workspace, env.get("BIBINPUTS", ""))
        self.assertIn(workspace, env.get("BSTINPUTS", ""))

    def test_compile_returns_triplet_when_tex_binaries_missing(self) -> None:
        original = td._resolve_binary
        try:
            td._resolve_binary = lambda name: None
            success, output, pdf_path = td._compile_tex_target("main.tex")
        finally:
            td._resolve_binary = original

        self.assertFalse(success)
        self.assertIn("No TeX engine found", output)
        self.assertEqual(pdf_path, "main.pdf")

    def test_compile_preflight_blocks_nested_sections_subfile_reference(self) -> None:
        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_compile_preflight_self_ref"
        target_rel = "tools/tests/_tmp_compile_preflight_self_ref/main.tex"
        target_abs = root / target_rel
        section_abs = base_dir / "Sections/01-overview.tex"
        section_abs.parent.mkdir(parents=True, exist_ok=True)
        target_abs.write_text(
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-overview}\n"
            "\\end{document}\n",
            encoding="utf-8",
        )
        section_abs.write_text(
            "\\documentclass[../main.tex]{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-overview}\n"
            "\\end{document}\n",
            encoding="utf-8",
        )

        try:
            success, output, pdf_rel = td._compile_tex_target(target_rel)
        finally:
            if base_dir.exists():
                shutil.rmtree(base_dir)

        self.assertFalse(success)
        self.assertIn("[preflight] Compile blocked", output)
        self.assertIn("Suspicious nested Sections path", output)
        self.assertIn("Missing subfile target", output)
        self.assertIn("tools/tests/_tmp_compile_preflight_self_ref/Sections/01-overview.tex", output)
        self.assertEqual(pdf_rel, "tools/tests/_tmp_compile_preflight_self_ref/main.pdf")

    def test_compile_preflight_blocks_missing_subfile_target_in_recipe_mode(self) -> None:
        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_compile_preflight_missing_ref"
        target_rel = "tools/tests/_tmp_compile_preflight_missing_ref/main.tex"
        target_abs = root / target_rel
        target_abs.parent.mkdir(parents=True, exist_ok=True)
        target_abs.write_text(
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/does-not-exist}\n"
            "\\end{document}\n",
            encoding="utf-8",
        )

        try:
            success, output, pdf_rel = td._compile_tex_target(
                target_rel,
                compile_recipe="vscode-1-xelatex",
                use_internal_fallback=False,
            )
        finally:
            if base_dir.exists():
                shutil.rmtree(base_dir)

        self.assertFalse(success)
        self.assertIn("[preflight] Compile blocked", output)
        self.assertIn("Missing subfile target", output)
        self.assertIn("tools/tests/_tmp_compile_preflight_missing_ref/main.tex", output)
        self.assertEqual(pdf_rel, "tools/tests/_tmp_compile_preflight_missing_ref/main.pdf")

    def test_run_command_uses_timeout_and_shell_disabled(self) -> None:
        captured: dict[str, object] = {}
        original_subprocess_run = td.subprocess.run
        try:
            def fake_run(command, **kwargs):
                captured["command"] = list(command)
                captured["kwargs"] = dict(kwargs)
                return subprocess.CompletedProcess(command, 0, stdout="ok", stderr="")

            td.subprocess.run = fake_run
            success, code, output = td._run_command(["xelatex", "main.tex"])
        finally:
            td.subprocess.run = original_subprocess_run

        self.assertTrue(success)
        self.assertEqual(code, 0)
        self.assertEqual(output, "ok")
        kwargs = captured.get("kwargs", {})
        self.assertEqual(kwargs.get("timeout"), td.COMPILE_COMMAND_TIMEOUT_SEC)
        self.assertIs(kwargs.get("shell"), False)

    def test_run_command_timeout_returns_bounded_failure(self) -> None:
        original_subprocess_run = td.subprocess.run
        try:
            def fake_run(command, **kwargs):
                raise subprocess.TimeoutExpired(
                    cmd=command,
                    timeout=kwargs.get("timeout"),
                    output="partial stdout",
                    stderr="partial stderr",
                )

            td.subprocess.run = fake_run
            success, code, output = td._run_command(["xelatex", "main.tex"])
        finally:
            td.subprocess.run = original_subprocess_run

        self.assertFalse(success)
        self.assertEqual(code, td.COMPILE_TIMEOUT_EXIT_CODE)
        self.assertIn("[timeout]", output)
        self.assertIn(f"{td.COMPILE_COMMAND_TIMEOUT_SEC:.1f}s", output)
        self.assertIn("xelatex main.tex", output)
        self.assertIn("partial stdout", output)
        self.assertIn("partial stderr", output)

    def test_append_step_log_includes_cwd_command_and_exit_code(self) -> None:
        logs: list[str] = []
        td._append_step_log(
            logs,
            "tex pass 1",
            td.ROOT_DIR,
            ["xelatex", "main.tex"],
            "",
            2,
        )
        joined = "\n".join(logs)
        self.assertIn("== tex pass 1 ==", joined)
        self.assertIn("[cwd]", joined)
        self.assertIn("$ xelatex main.tex", joined)
        self.assertIn("[exit code: 2]", joined)

    def test_parse_jsonc_supports_comments_and_trailing_commas(self) -> None:
        sample = """
        {
          // comment
          "a": 1,
          "b": [1, 2,],
        }
        """
        parsed = td._parse_jsonc(sample)
        self.assertEqual(parsed, {"a": 1, "b": [1, 2]})

    def test_load_vscode_settings_jsonc(self) -> None:
        settings = td._load_vscode_settings()
        self.assertIn("latex-workshop.latex.tools", settings)
        self.assertIn("latex-workshop.latex.recipes", settings)
        # Ensure loaded object is JSON-serializable for future UI/API use.
        json.dumps(settings)

    def test_load_vscode_recipe_catalog(self) -> None:
        catalog = td._load_vscode_recipe_catalog()
        self.assertIn("tools", catalog)
        self.assertIn("recipes", catalog)
        self.assertIsInstance(catalog["tools"], dict)
        self.assertIsInstance(catalog["recipes"], list)
        self.assertTrue(len(catalog["recipes"]) >= 1)

    def test_recipe_executor_runs_steps_in_order(self) -> None:
        root = td.ROOT_DIR
        target_rel = "tools/tests/_tmp_recipe_target.tex"
        target_abs = root / target_rel
        target_abs.parent.mkdir(parents=True, exist_ok=True)
        target_abs.write_text("\\documentclass{article}\\begin{document}x\\end{document}\n", encoding="utf-8")
        expected_pdf = target_abs.with_suffix(".pdf")
        if expected_pdf.exists():
            expected_pdf.unlink()

        calls = []
        original_catalog = td._load_vscode_recipe_catalog
        original_resolve_binary = td._resolve_binary
        original_run_command = td._run_command
        try:
            td._load_vscode_recipe_catalog = lambda: {
                "tools": {
                    "xelatex": {
                        "name": "xelatex",
                        "command": "xelatex",
                        "args": ["%DOCFILE%"],
                    },
                    "bibtex": {
                        "name": "bibtex",
                        "command": "bibtex",
                        "args": ["%DOC%"],
                    },
                },
                "recipes": [
                    {
                        "id": "vscode-1-test",
                        "name": "xelatex -> bibtex -> xelatex",
                        "tools": ["xelatex", "bibtex", "xelatex"],
                    }
                ],
                "errors": [],
            }
            td._resolve_binary = lambda name: f"/usr/bin/{name}"

            def fake_run(command, cwd=td.ROOT_DIR):
                calls.append(command)
                if command[0].endswith("xelatex"):
                    (Path(cwd) / "_tmp_recipe_target.pdf").write_bytes(b"%PDF-1.4\n")
                return True, 0, "ok"

            td._run_command = fake_run
            success, output, pdf_rel = td._compile_tex_target(
                target_rel,
                "vscode-1-test",
                use_internal_fallback=False,
            )
        finally:
            td._load_vscode_recipe_catalog = original_catalog
            td._resolve_binary = original_resolve_binary
            td._run_command = original_run_command
            if target_abs.exists():
                target_abs.unlink()
            if expected_pdf.exists():
                expected_pdf.unlink()

        self.assertTrue(success)
        self.assertEqual(
            [Path(cmd[0]).name for cmd in calls],
            ["xelatex", "bibtex", "xelatex"],
        )
        self.assertIn("recipe step 1", output)
        self.assertIn("recipe step 2", output)
        self.assertIn("recipe step 3", output)
        self.assertEqual(pdf_rel, "tools/tests/_tmp_recipe_target.pdf")

    def test_expected_output_pdf_tracks_recipe_outdir(self) -> None:
        root = td.ROOT_DIR
        target_rel = "tools/tests/_tmp_outdir_target.tex"
        target_abs = root / target_rel
        target_abs.parent.mkdir(parents=True, exist_ok=True)
        target_abs.write_text(
            "\\documentclass{article}\\begin{document}x\\end{document}\n",
            encoding="utf-8",
        )

        original_catalog = td._load_vscode_recipe_catalog
        try:
            td._load_vscode_recipe_catalog = lambda: {
                "tools": {
                    "latexmk": {
                        "name": "latexmk",
                        "command": "latexmk",
                        "args": ["-outdir=build/%DOC%", "%DOCFILE%"],
                    }
                },
                "recipes": [
                    {
                        "id": "vscode-1-outdir",
                        "name": "latexmk-outdir",
                        "tools": ["latexmk"],
                    }
                ],
                "errors": [],
            }
            pdf_rel = td._expected_output_pdf_for_selection(
                target_rel,
                "vscode-1-outdir",
                use_internal_fallback=False,
            )
        finally:
            td._load_vscode_recipe_catalog = original_catalog
            if target_abs.exists():
                target_abs.unlink()

        self.assertEqual(
            pdf_rel,
            "tools/tests/build/_tmp_outdir_target/_tmp_outdir_target.pdf",
        )

    def test_candidate_targets_include_generated_subfiles_units(self) -> None:
        root = td.ROOT_DIR
        source_rel = "tools/tests/_tmp_subfiles_discovery.tex"
        source_abs = root / source_rel
        sections_abs = root / "tools/tests/_tmp_subfiles_discovery_sections"
        source_abs.parent.mkdir(parents=True, exist_ok=True)
        source_abs.write_text(
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{Overview}\n"
            "Alpha.\n"
            "\\section{Methods}\n"
            "Beta.\n"
            "\\end{document}\n",
            encoding="utf-8",
        )

        try:
            split = ts.split_tex_file(source_abs, sections_abs)
            candidates = td._list_candidate_tex_files()
        finally:
            for backup in source_abs.parent.glob(source_abs.name + ".bak*"):
                if backup.exists():
                    backup.unlink()
            if source_abs.exists():
                source_abs.unlink()
            if sections_abs.exists():
                shutil.rmtree(sections_abs)

        self.assertIn(source_rel, candidates)
        for unit in split.units:
            self.assertIn(unit.path.relative_to(root).as_posix(), candidates)

    def test_refresh_derived_state_detects_parent_class_for_subfiles_target(self) -> None:
        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_subfiles_class_detect"
        root_rel = "tools/tests/_tmp_subfiles_class_detect/main.tex"
        unit_rel = "tools/tests/_tmp_subfiles_class_detect/Sections/01-intro.tex"
        root_abs = root / root_rel
        unit_abs = root / unit_rel
        unit_abs.parent.mkdir(parents=True, exist_ok=True)
        root_abs.write_text(
            "\\documentclass{book}\n"
            "\\begin{document}\n"
            "\\chapter{Intro}\n"
            "Alpha.\n"
            "\\end{document}\n",
            encoding="utf-8",
        )
        unit_abs.write_text(
            "\\documentclass[../main.tex]{subfiles}\n"
            "\\begin{document}\n"
            "\\chapter{Intro}\n"
            "Alpha.\n"
            "\\end{document}\n",
            encoding="utf-8",
        )

        try:
            state = {
                "compile_target": unit_rel,
                "compile_recipe": "",
                "compile_use_internal_fallback": True,
                "compile_recipes": [],
                "class_config": {"theme_class_mode": "auto"},
            }
            td._refresh_derived_state(state)
        finally:
            if base_dir.exists():
                shutil.rmtree(base_dir)

        self.assertEqual(state["detected_document_class"], "book")
        self.assertTrue(state["detected_document_class_has_chapter"])
        self.assertEqual(state["effective_theme_class"], "book")

    def test_internal_compile_subfile_target_runs_in_section_dir_and_invokes_biber(self) -> None:
        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_subfiles_internal_compile"
        target_rel = "tools/tests/_tmp_subfiles_internal_compile/Sections/01-unit.tex"
        target_abs = root / target_rel
        target_abs.parent.mkdir(parents=True, exist_ok=True)
        target_abs.write_text(
            "\\documentclass[../main.tex]{subfiles}\n"
            "\\begin{document}\n"
            "\\section{Unit}\n"
            "Alpha.\n"
            "\\end{document}\n",
            encoding="utf-8",
        )
        (target_abs.parent / "01-unit.bcf").write_text("<bcf/>", encoding="utf-8")

        calls = []
        original_resolve_binary = td._resolve_binary
        original_run_command = td._run_command
        try:
            td._resolve_binary = (
                lambda name: (
                    None
                    if name == "latexmk"
                    else (f"/usr/bin/{name}" if name in {"xelatex", "biber"} else None)
                )
            )

            def fake_run(command, cwd=td.ROOT_DIR):
                calls.append((list(command), Path(cwd)))
                if Path(command[0]).name == "xelatex":
                    (Path(cwd) / "01-unit.pdf").write_bytes(b"%PDF-1.4\n")
                return True, 0, "ok"

            td._run_command = fake_run
            success, output, pdf_rel = td._compile_tex_target(target_rel)
        finally:
            td._resolve_binary = original_resolve_binary
            td._run_command = original_run_command
            if base_dir.exists():
                shutil.rmtree(base_dir)

        self.assertTrue(success)
        self.assertIn("biber", output)
        self.assertEqual(
            pdf_rel,
            "tools/tests/_tmp_subfiles_internal_compile/Sections/01-unit.pdf",
        )
        self.assertTrue(all(cwd == target_abs.parent for _, cwd in calls))
        self.assertTrue(
            any(
                Path(command[0]).name == "biber"
                and len(command) >= 2
                and command[1] == "01-unit"
                for command, _ in calls
            )
        )

    def test_recipe_compile_subfile_target_resolves_doc_tokens_and_outdir_pdf(self) -> None:
        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_subfiles_recipe_compile"
        target_rel = "tools/tests/_tmp_subfiles_recipe_compile/Sections/01-unit.tex"
        target_abs = root / target_rel
        target_abs.parent.mkdir(parents=True, exist_ok=True)
        target_abs.write_text(
            "\\documentclass[../main.tex]{subfiles}\n"
            "\\begin{document}\n"
            "\\section{Unit}\n"
            "Alpha.\n"
            "\\end{document}\n",
            encoding="utf-8",
        )

        calls = []
        original_catalog = td._load_vscode_recipe_catalog
        original_resolve_binary = td._resolve_binary
        original_run_command = td._run_command
        try:
            td._load_vscode_recipe_catalog = lambda: {
                "tools": {
                    "latexmk": {
                        "name": "latexmk",
                        "command": "latexmk",
                        "args": ["-outdir=build/%DOC%", "%DOCFILE%", "%DOC%"],
                    }
                },
                "recipes": [
                    {
                        "id": "vscode-1-subfiles-outdir",
                        "name": "latexmk-subfiles-outdir",
                        "tools": ["latexmk"],
                    }
                ],
                "errors": [],
            }
            td._resolve_binary = lambda name: f"/usr/bin/{name}" if name == "latexmk" else None

            def fake_run(command, cwd=td.ROOT_DIR):
                calls.append((list(command), Path(cwd)))
                (Path(cwd) / "build" / "01-unit").mkdir(parents=True, exist_ok=True)
                (Path(cwd) / "build" / "01-unit" / "01-unit.pdf").write_bytes(b"%PDF-1.4\n")
                return True, 0, "ok"

            td._run_command = fake_run
            success, _, pdf_rel = td._compile_tex_target(
                target_rel,
                "vscode-1-subfiles-outdir",
                use_internal_fallback=False,
            )
        finally:
            td._load_vscode_recipe_catalog = original_catalog
            td._resolve_binary = original_resolve_binary
            td._run_command = original_run_command
            if base_dir.exists():
                shutil.rmtree(base_dir)

        self.assertTrue(success)
        self.assertEqual(
            pdf_rel,
            "tools/tests/_tmp_subfiles_recipe_compile/Sections/build/01-unit/01-unit.pdf",
        )
        self.assertEqual(len(calls), 1)
        command, cwd = calls[0]
        self.assertEqual(cwd, target_abs.parent)
        self.assertEqual(Path(command[0]).name, "latexmk")
        self.assertIn("-outdir=build/01-unit", command)
        self.assertIn("01-unit.tex", command)
        self.assertIn("01-unit", command)

    def test_split_compile_target_returns_summary_and_generates_subfile_targets(self) -> None:
        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_split_core"
        source_rel = "tools/tests/_tmp_split_core/main.tex"
        source_abs = root / source_rel
        source_abs.parent.mkdir(parents=True, exist_ok=True)
        source_abs.write_text(
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{Overview}\n"
            "Alpha.\n"
            "\\section{Method}\n"
            "Beta.\n"
            "\\end{document}\n",
            encoding="utf-8",
        )

        try:
            result = td._split_compile_target(source_rel)
            rewritten = source_abs.read_text(encoding="utf-8")
        finally:
            for backup in source_abs.parent.glob("main.tex.bak*"):
                if backup.exists():
                    backup.unlink()
            if base_dir.exists():
                shutil.rmtree(base_dir)

        self.assertEqual(result.get("standalone_mode"), "subfiles")
        self.assertEqual(result.get("source_target"), source_rel)
        self.assertTrue(result.get("backup_path", "").endswith(".bak"))
        self.assertTrue(result.get("subfiles_package_injected"))
        generated = result.get("generated_subfile_targets", [])
        self.assertTrue(len(generated) >= 2)
        self.assertIn("\\subfile{Sections/overview}", rewritten)

    def test_split_compile_target_dry_run_does_not_write_files(self) -> None:
        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_split_core_dry_run"
        source_rel = "tools/tests/_tmp_split_core_dry_run/main.tex"
        source_abs = root / source_rel
        source_abs.parent.mkdir(parents=True, exist_ok=True)
        original_text = (
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{Overview}\n"
            "Alpha.\n"
            "\\section{Method}\n"
            "Beta.\n"
            "\\end{document}\n"
        )
        source_abs.write_text(original_text, encoding="utf-8")
        planned_unit = root / "tools/tests/_tmp_split_core_dry_run/Sections/overview.tex"

        try:
            result = td._split_compile_target(source_rel, dry_run=True)
            rewritten = source_abs.read_text(encoding="utf-8")
            backup_candidates = list(source_abs.parent.glob("main.tex.bak*"))
        finally:
            if base_dir.exists():
                shutil.rmtree(base_dir)

        self.assertTrue(result.get("dry_run"))
        self.assertFalse(result.get("already_split"))
        self.assertTrue(result.get("backup_path", "").endswith(".bak"))
        self.assertIn("Dry-run mode enabled", "\n".join(result.get("warnings", [])))
        self.assertEqual(rewritten, original_text)
        self.assertFalse(planned_unit.exists())
        self.assertEqual(len(backup_candidates), 0)

    def test_split_compile_target_rejects_subfiles_unit_source(self) -> None:
        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_split_core_subfile_guard"
        source_rel = "tools/tests/_tmp_split_core_subfile_guard/Sections/01-overview.tex"
        root_abs = root / "tools/tests/_tmp_split_core_subfile_guard/main.tex"
        source_abs = root / source_rel
        source_abs.parent.mkdir(parents=True, exist_ok=True)
        root_abs.write_text(
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-overview}\n"
            "\\end{document}\n",
            encoding="utf-8",
        )
        source_text = (
            "\\documentclass[../main.tex]{subfiles}\n"
            "\\begin{document}\n"
            "\\section{Overview}\n"
            "Alpha.\n"
            "\\end{document}\n"
        )
        source_abs.write_text(source_text, encoding="utf-8")
        nested_sections_abs = source_abs.parent / "Sections"

        try:
            with self.assertRaisesRegex(
                ValueError,
                r"Split source 'tools/tests/_tmp_split_core_subfile_guard/Sections/01-overview\.tex' is a subfile unit",
            ):
                td._split_compile_target(source_rel)
            self.assertEqual(source_abs.read_text(encoding="utf-8"), source_text)
            self.assertFalse(nested_sections_abs.exists())
        finally:
            if base_dir.exists():
                shutil.rmtree(base_dir)

    def test_server_split_response_refreshes_targets_and_exposes_split_payload(self) -> None:
        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_split_server"
        source_rel = "tools/tests/_tmp_split_server/main.tex"
        source_abs = root / source_rel
        source_abs.parent.mkdir(parents=True, exist_ok=True)
        source_abs.write_text(
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{A}\n"
            "Alpha.\n"
            "\\section{B}\n"
            "Beta.\n"
            "\\end{document}\n",
            encoding="utf-8",
        )

        try:
            response = tds._split_response_payload(
                {
                    "compile_target": source_rel,
                    "standalone_mode": "subfiles",
                }
            )
        finally:
            for backup in source_abs.parent.glob("main.tex.bak*"):
                if backup.exists():
                    backup.unlink()
            if base_dir.exists():
                shutil.rmtree(base_dir)

        self.assertIn("state", response)
        self.assertIn("split", response)
        split = response["split"]
        generated = split.get("generated_subfile_targets", [])
        self.assertTrue(len(generated) >= 2)
        self.assertIn(generated[0], response["state"].get("compile_targets", []))
        self.assertEqual(split.get("suggested_compile_target"), generated[0])

    def test_server_split_response_dry_run_string_bool_supported(self) -> None:
        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_split_server_dry_run"
        source_rel = "tools/tests/_tmp_split_server_dry_run/main.tex"
        source_abs = root / source_rel
        source_abs.parent.mkdir(parents=True, exist_ok=True)
        original_text = (
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{A}\n"
            "Alpha.\n"
            "\\section{B}\n"
            "Beta.\n"
            "\\end{document}\n"
        )
        source_abs.write_text(original_text, encoding="utf-8")
        planned_unit = root / "tools/tests/_tmp_split_server_dry_run/Sections/a.tex"

        try:
            response = tds._split_response_payload(
                {
                    "compile_target": source_rel,
                    "standalone_mode": "subfiles",
                    "dry_run": "true",
                }
            )
            rewritten = source_abs.read_text(encoding="utf-8")
            backup_candidates = list(source_abs.parent.glob("main.tex.bak*"))
        finally:
            if base_dir.exists():
                shutil.rmtree(base_dir)

        split = response.get("split", {})
        self.assertTrue(split.get("dry_run"))
        self.assertEqual(rewritten, original_text)
        self.assertFalse(planned_unit.exists())
        self.assertEqual(len(backup_candidates), 0)

    def test_server_split_response_supports_numbered_naming_mode(self) -> None:
        root = td.ROOT_DIR
        base_dir = root / "tools/tests/_tmp_split_server_numbered"
        source_rel = "tools/tests/_tmp_split_server_numbered/main.tex"
        source_abs = root / source_rel
        source_abs.parent.mkdir(parents=True, exist_ok=True)
        source_abs.write_text(
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{A}\n"
            "Alpha.\n"
            "\\section{B}\n"
            "Beta.\n"
            "\\end{document}\n",
            encoding="utf-8",
        )

        try:
            response = tds._split_response_payload(
                {
                    "compile_target": source_rel,
                    "standalone_mode": "subfiles",
                    "naming_mode": "numbered",
                    "dry_run": True,
                }
            )
        finally:
            if base_dir.exists():
                shutil.rmtree(base_dir)

        split = response.get("split", {})
        generated = split.get("generated_subfile_targets", [])
        self.assertEqual(split.get("naming_mode"), "numbered")
        self.assertTrue(any(path.endswith("/01-a.tex") for path in generated))

    def test_server_split_response_rejects_invalid_naming_mode(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported split naming mode"):
            tds._split_response_payload(
                {
                    "compile_target": "main.tex",
                    "naming_mode": "bad-mode",
                    "dry_run": True,
                }
            )

    def test_server_split_response_rejects_invalid_prune_unreferenced_type(self) -> None:
        with self.assertRaisesRegex(ValueError, "prune_unreferenced must be a boolean"):
            tds._split_response_payload(
                {
                    "compile_target": "main.tex",
                    "prune_unreferenced": 1,
                    "dry_run": True,
                }
            )

    def test_server_split_response_rejects_invalid_dry_run_type(self) -> None:
        with self.assertRaisesRegex(ValueError, "dry_run must be a boolean"):
            tds._split_response_payload({"dry_run": 1})

    def test_server_split_response_rejects_unknown_compile_target(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown compile target"):
            tds._split_response_payload(
                {
                    "compile_target": "tools/tests/_tmp_missing_target_for_split.tex",
                    "dry_run": True,
                }
            )

    def test_server_split_response_rejects_outside_workspace_target(self) -> None:
        with self.assertRaisesRegex(ValueError, "outside workspace"):
            tds._split_response_payload(
                {
                    "compile_target": "../../outside.tex",
                    "dry_run": True,
                }
            )

    def test_server_api_error_payload_has_standard_fields(self) -> None:
        payload = tds._api_error_payload(
            "Invalid payload.",
            "bad_request",
            "Check request field types.",
        )
        self.assertEqual(payload.get("error"), "Invalid payload.")
        self.assertEqual(payload.get("code"), "bad_request")
        self.assertEqual(payload.get("hint"), "Check request field types.")

    def test_compile_fails_when_pdf_is_older_than_source(self) -> None:
        root = td.ROOT_DIR
        target_rel = "tools/tests/_tmp_stale_target.tex"
        target_abs = root / target_rel
        pdf_abs = target_abs.with_suffix(".pdf")
        target_abs.parent.mkdir(parents=True, exist_ok=True)
        target_abs.write_text(
            "\\documentclass{article}\\begin{document}stale\\end{document}\n",
            encoding="utf-8",
        )
        pdf_abs.write_bytes(b"%PDF-1.4\n")

        now = time.time()
        os.utime(pdf_abs, (now - 20, now - 20))
        os.utime(target_abs, (now, now))

        original_resolve_binary = td._resolve_binary
        original_run_command = td._run_command
        try:
            td._resolve_binary = lambda name: "/usr/bin/latexmk" if name == "latexmk" else None
            td._run_command = lambda command, cwd=td.ROOT_DIR: (True, 0, "ok")
            success, output, pdf_rel = td._compile_tex_target(target_rel)
        finally:
            td._resolve_binary = original_resolve_binary
            td._run_command = original_run_command
            if target_abs.exists():
                target_abs.unlink()
            if pdf_abs.exists():
                pdf_abs.unlink()

        self.assertFalse(success)
        self.assertIn("Stale preview risk", output)
        self.assertEqual(pdf_rel, "tools/tests/_tmp_stale_target.pdf")

    def test_refresh_derived_state_detects_book_and_article_modes(self) -> None:
        root = td.ROOT_DIR
        book_rel = "tools/tests/_tmp_class_book.tex"
        article_rel = "tools/tests/_tmp_class_article.tex"
        book_abs = root / book_rel
        article_abs = root / article_rel
        book_abs.parent.mkdir(parents=True, exist_ok=True)
        book_abs.write_text(
            "\\documentclass{book}\\begin{document}\\chapter{A}\\end{document}\n",
            encoding="utf-8",
        )
        article_abs.write_text(
            "\\documentclass{article}\\begin{document}\\section{A}\\end{document}\n",
            encoding="utf-8",
        )

        try:
            state = {
                "compile_target": book_rel,
                "compile_recipe": "",
                "compile_use_internal_fallback": True,
                "compile_recipes": [],
                "class_config": {"theme_class_mode": "auto"},
            }
            td._refresh_derived_state(state)
            self.assertEqual(state["effective_theme_class"], "book")
            self.assertTrue(state["detected_document_class_has_chapter"])

            state["compile_target"] = article_rel
            td._refresh_derived_state(state)
            self.assertEqual(state["effective_theme_class"], "article")
            self.assertFalse(state["detected_document_class_has_chapter"])

            state["class_config"]["theme_class_mode"] = "book"
            td._refresh_derived_state(state)
            self.assertEqual(state["effective_theme_class"], "book")
        finally:
            if book_abs.exists():
                book_abs.unlink()
            if article_abs.exists():
                article_abs.unlink()

    def test_refresh_derived_state_supports_forced_class_mode_mismatch(self) -> None:
        root = td.ROOT_DIR
        book_rel = "tools/tests/_tmp_class_forced_book.tex"
        article_rel = "tools/tests/_tmp_class_forced_article.tex"
        book_abs = root / book_rel
        article_abs = root / article_rel
        book_abs.parent.mkdir(parents=True, exist_ok=True)
        book_abs.write_text(
            "\\documentclass{book}\\begin{document}\\chapter{A}\\end{document}\n",
            encoding="utf-8",
        )
        article_abs.write_text(
            "\\documentclass{article}\\begin{document}\\section{A}\\end{document}\n",
            encoding="utf-8",
        )

        try:
            state = {
                "compile_target": book_rel,
                "compile_recipe": "",
                "compile_use_internal_fallback": True,
                "compile_recipes": [],
                "class_config": {"theme_class_mode": "article"},
            }
            td._refresh_derived_state(state)
            self.assertTrue(state["detected_document_class_has_chapter"])
            self.assertEqual(state["effective_theme_class"], "article")

            state["compile_target"] = article_rel
            state["class_config"]["theme_class_mode"] = "book"
            td._refresh_derived_state(state)
            self.assertFalse(state["detected_document_class_has_chapter"])
            self.assertEqual(state["effective_theme_class"], "book")
        finally:
            if book_abs.exists():
                book_abs.unlink()
            if article_abs.exists():
                article_abs.unlink()

    def test_apply_compile_preferences_resets_forced_class_on_target_switch(self) -> None:
        root = td.ROOT_DIR
        book_rel = "tools/tests/_tmp_class_switch_book.tex"
        article_rel = "tools/tests/_tmp_class_switch_article.tex"
        book_abs = root / book_rel
        article_abs = root / article_rel
        book_abs.parent.mkdir(parents=True, exist_ok=True)
        book_abs.write_text(
            "\\documentclass{book}\\begin{document}\\chapter{A}\\end{document}\n",
            encoding="utf-8",
        )
        article_abs.write_text(
            "\\documentclass{article}\\begin{document}\\section{A}\\end{document}\n",
            encoding="utf-8",
        )

        try:
            state = {
                "compile_target": article_rel,
                "compile_recipe": "",
                "compile_use_internal_fallback": True,
                "compile_recipes": [],
                "class_config": {"theme_class_mode": "article"},
            }
            td._refresh_derived_state(state)
            td._apply_compile_preferences(state, compile_target=book_rel)
            self.assertEqual(state["class_config"]["theme_class_mode"], "auto")
            self.assertEqual(state["effective_theme_class"], "book")

            state["class_config"]["theme_class_mode"] = "book"
            td._apply_compile_preferences(state, compile_target=article_rel)
            self.assertEqual(state["class_config"]["theme_class_mode"], "auto")
            self.assertEqual(state["effective_theme_class"], "article")
        finally:
            if book_abs.exists():
                book_abs.unlink()
            if article_abs.exists():
                article_abs.unlink()

    def test_load_state_resets_forced_class_when_persisted_target_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            cfg_path = tmp_path / "theme.ui.json"
            toggle_path = tmp_path / "theme.overrides.tex"
            color_path = tmp_path / "theme.colors.tex"

            cfg_path.write_text(
                json.dumps(
                    {
                        "compile_target": "tools/tests/_tmp_missing_target.tex",
                        "class_config": {"theme_class_mode": "book"},
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            original_config = td.CONFIG_PATH
            original_toggle = td.TOGGLE_OVERRIDE_PATH
            original_color = td.COLOR_OVERRIDE_PATH
            try:
                td.CONFIG_PATH = cfg_path
                td.TOGGLE_OVERRIDE_PATH = toggle_path
                td.COLOR_OVERRIDE_PATH = color_path
                state = td._load_state()
            finally:
                td.CONFIG_PATH = original_config
                td.TOGGLE_OVERRIDE_PATH = original_toggle
                td.COLOR_OVERRIDE_PATH = original_color

        self.assertEqual(state["compile_target"], "main.tex")
        self.assertEqual(state["class_config"]["theme_class_mode"], "auto")
        self.assertEqual(state["effective_theme_class"], "article")

    def test_write_override_files_includes_class_config_macros(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            cfg_path = tmp_path / "theme.ui.json"
            toggle_path = tmp_path / "theme.overrides.tex"
            color_path = tmp_path / "theme.colors.tex"

            original_config = td.CONFIG_PATH
            original_toggle = td.TOGGLE_OVERRIDE_PATH
            original_color = td.COLOR_OVERRIDE_PATH
            try:
                td.CONFIG_PATH = cfg_path
                td.TOGGLE_OVERRIDE_PATH = toggle_path
                td.COLOR_OVERRIDE_PATH = color_path
                state = td._load_state()
                state["class_config"]["theme_class_mode"] = "article"
                state["class_config"]["theme_theorem_numbering_policy"] = "none"
                state["body_font_size_pt"] = 11.5
                td._write_override_files(state)
                text = toggle_path.read_text(encoding="utf-8")
            finally:
                td.CONFIG_PATH = original_config
                td.TOGGLE_OVERRIDE_PATH = original_toggle
                td.COLOR_OVERRIDE_PATH = original_color

        self.assertIn("\\def\\ThemeClassMode{article}", text)
        self.assertIn("\\def\\ThemeTheoremNumberingPolicy{none}", text)
        self.assertIn("\\def\\ThemeBodyFontSizePt{11.5}", text)

    def test_apply_block_preset_updates_block_tokens_only(self) -> None:
        state = td._load_state()
        original_document_tokens = {
            token: state["colors"][token]
            for token in td.COLOR_ORDER
            if token.startswith("theme-")
        }

        td._apply_block_preset(state, "midnight")
        expected_block_colors = td._block_preset_tokens_by_id(
            "midnight",
            td._build_block_preset_catalog(td._parse_theme_color_defaults()),
        )

        self.assertEqual(state["block_preset"], "midnight")
        for token, expected in expected_block_colors.items():
            self.assertEqual(state["colors"][token], expected)
        for token, expected in original_document_tokens.items():
            self.assertEqual(state["colors"][token], expected)

    def test_block_preset_persist_and_reload_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            cfg_path = tmp_path / "theme.ui.json"
            toggle_path = tmp_path / "theme.overrides.tex"
            color_path = tmp_path / "theme.colors.tex"

            original_config = td.CONFIG_PATH
            original_toggle = td.TOGGLE_OVERRIDE_PATH
            original_color = td.COLOR_OVERRIDE_PATH
            try:
                td.CONFIG_PATH = cfg_path
                td.TOGGLE_OVERRIDE_PATH = toggle_path
                td.COLOR_OVERRIDE_PATH = color_path

                state = td._load_state()
                td._apply_block_preset(state, "midnight")
                td._write_override_files(state)

                persisted = json.loads(cfg_path.read_text(encoding="utf-8"))
                self.assertEqual(persisted.get("block_preset"), "midnight")

                color_text = color_path.read_text(encoding="utf-8")
                for token in ("definition-body-bg", "theorem-title-bg", "note-accent"):
                    alias = "themeui" + re.sub(r"[^A-Za-z0-9]+", "", token)
                    hex_value = state["colors"][token].lstrip("#")
                    self.assertIn(
                        f"\\definecolor{{{alias}}}{{HTML}}{{{hex_value}}}",
                        color_text,
                    )

                reloaded = td._load_state()
            finally:
                td.CONFIG_PATH = original_config
                td.TOGGLE_OVERRIDE_PATH = original_toggle
                td.COLOR_OVERRIDE_PATH = original_color

        self.assertEqual(reloaded["block_preset"], "midnight")
        for token in td.BLOCK_COLOR_TOKENS:
            self.assertEqual(reloaded["colors"][token], state["colors"][token])

    def test_apply_heading_toc_preset_updates_document_tokens_only(self) -> None:
        state = td._load_state()
        original_block_tokens = {
            token: state["colors"][token]
            for token in td.COLOR_ORDER
            if not token.startswith("theme-")
        }

        td._apply_heading_toc_preset(state, "inkstone")
        expected_document_colors = td._heading_toc_preset_tokens_by_id(
            "inkstone",
            td._build_heading_toc_preset_catalog(td._parse_theme_color_defaults()),
        )

        self.assertEqual(state["heading_toc_preset"], "inkstone")
        for token, expected in expected_document_colors.items():
            self.assertEqual(state["colors"][token], expected)
        for token, expected in original_block_tokens.items():
            self.assertEqual(state["colors"][token], expected)

    def test_heading_toc_preset_persist_and_reload_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            cfg_path = tmp_path / "theme.ui.json"
            toggle_path = tmp_path / "theme.overrides.tex"
            color_path = tmp_path / "theme.colors.tex"

            original_config = td.CONFIG_PATH
            original_toggle = td.TOGGLE_OVERRIDE_PATH
            original_color = td.COLOR_OVERRIDE_PATH
            try:
                td.CONFIG_PATH = cfg_path
                td.TOGGLE_OVERRIDE_PATH = toggle_path
                td.COLOR_OVERRIDE_PATH = color_path

                state = td._load_state()
                td._apply_heading_toc_preset(state, "sunset")
                td._write_override_files(state)

                persisted = json.loads(cfg_path.read_text(encoding="utf-8"))
                self.assertEqual(persisted.get("heading_toc_preset"), "sunset")

                color_text = color_path.read_text(encoding="utf-8")
                for token in ("theme-chapter", "theme-toc-section", "theme-header-rule"):
                    alias = "themeui" + re.sub(r"[^A-Za-z0-9]+", "", token)
                    hex_value = state["colors"][token].lstrip("#")
                    self.assertIn(
                        f"\\definecolor{{{alias}}}{{HTML}}{{{hex_value}}}",
                        color_text,
                    )

                reloaded = td._load_state()
            finally:
                td.CONFIG_PATH = original_config
                td.TOGGLE_OVERRIDE_PATH = original_toggle
                td.COLOR_OVERRIDE_PATH = original_color

        self.assertEqual(reloaded["heading_toc_preset"], "sunset")
        for token in td.DOCUMENT_COLOR_TOKENS:
            self.assertEqual(reloaded["colors"][token], state["colors"][token])

    def test_normalize_payload_rejects_invalid_class_config(self) -> None:
        base_state = td._load_state()
        with self.assertRaisesRegex(ValueError, "theme_class_mode"):
            td._normalize_payload(
                {"class_config": {"theme_class_mode": "invalid-mode"}},
                base_state,
            )

    def test_normalize_payload_rejects_invalid_block_preset(self) -> None:
        base_state = td._load_state()
        with self.assertRaisesRegex(ValueError, "Unknown block preset"):
            td._normalize_payload({"block_preset": "not-a-preset"}, base_state)

    def test_normalize_payload_rejects_invalid_heading_toc_preset(self) -> None:
        base_state = td._load_state()
        with self.assertRaisesRegex(ValueError, "Unknown heading/TOC preset"):
            td._normalize_payload({"heading_toc_preset": "not-a-preset"}, base_state)

    def test_normalize_payload_rejects_out_of_range_body_font_size(self) -> None:
        base_state = td._load_state()
        with self.assertRaisesRegex(ValueError, "body_font_size_pt"):
            td._normalize_payload({"body_font_size_pt": 14.5}, base_state)

    def test_normalize_payload_rejects_invalid_step_body_font_size(self) -> None:
        base_state = td._load_state()
        with self.assertRaisesRegex(ValueError, "increments"):
            td._normalize_payload({"body_font_size_pt": 10.3}, base_state)

    def test_body_font_size_override_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            cfg_path = tmp_path / "theme.ui.json"
            toggle_path = tmp_path / "theme.overrides.tex"
            color_path = tmp_path / "theme.colors.tex"

            original_config = td.CONFIG_PATH
            original_toggle = td.TOGGLE_OVERRIDE_PATH
            original_color = td.COLOR_OVERRIDE_PATH
            try:
                td.CONFIG_PATH = cfg_path
                td.TOGGLE_OVERRIDE_PATH = toggle_path
                td.COLOR_OVERRIDE_PATH = color_path

                state = td._load_state()
                state["body_font_size_pt"] = 12.0
                td._write_override_files(state)

                persisted = json.loads(cfg_path.read_text(encoding="utf-8"))
                self.assertEqual(persisted.get("body_font_size_pt"), 12.0)

                reloaded = td._load_state()
            finally:
                td.CONFIG_PATH = original_config
                td.TOGGLE_OVERRIDE_PATH = original_toggle
                td.COLOR_OVERRIDE_PATH = original_color

        self.assertEqual(reloaded["body_font_size_pt"], 12.0)

    def test_block_presets_include_new_palettes(self) -> None:
        state = td._load_state()
        preset_ids = {entry.get("id") for entry in state.get("block_presets", [])}
        self.assertTrue({"default", "midnight", "meadow", "ember"}.issubset(preset_ids))

    def test_heading_toc_presets_include_new_styles(self) -> None:
        state = td._load_state()
        preset_ids = {entry.get("id") for entry in state.get("heading_toc_presets", [])}
        self.assertTrue({"default", "inkstone", "aurora", "sunset"}.issubset(preset_ids))

    def test_response_schema_contains_body_font_size_config(self) -> None:
        payload = td._build_response_state()
        schema = payload.get("schema", {})
        self.assertIn("body_font_size", schema)
        self.assertEqual(schema["body_font_size"]["id"], "body_font_size_pt")

    def test_response_schema_contains_starter_templates(self) -> None:
        payload = td._build_response_state()
        schema = payload.get("schema", {})
        starter_templates = schema.get("starter_templates", [])
        starter_ids = {entry.get("id") for entry in starter_templates}
        self.assertTrue({"book-minimal", "article-minimal"}.issubset(starter_ids))
        self.assertEqual(schema.get("starter_default_template"), "book-minimal")

    def test_generate_starter_template_supports_custom_output_name(self) -> None:
        root = td.ROOT_DIR
        target_base = "tools/tests/_tmp_bootstrap_custom_name"
        target_rel = f"{target_base}.tex"
        target_abs = root / target_rel
        if target_abs.exists():
            target_abs.unlink()

        try:
            generated_target, overwritten = td._generate_starter_template_file(
                "book-minimal",
                target_base,
                overwrite=False,
            )
            self.assertEqual(generated_target, target_rel)
            self.assertFalse(overwritten)
            self.assertTrue(target_abs.exists())
            text = target_abs.read_text(encoding="utf-8")
        finally:
            if target_abs.exists():
                target_abs.unlink()

        self.assertIn("\\documentclass[oneside]{book}", text)
        self.assertIn("\\usepackage{xparse}", text)
        self.assertIn("\\usepackage{amsmath, amsthm, amssymb, amsfonts}", text)

    def test_generate_starter_template_requires_explicit_overwrite(self) -> None:
        root = td.ROOT_DIR
        target_rel = "tools/tests/_tmp_bootstrap_overwrite.tex"
        target_abs = root / target_rel
        target_abs.parent.mkdir(parents=True, exist_ok=True)
        target_abs.write_text("existing\n", encoding="utf-8")

        try:
            with self.assertRaisesRegex(ValueError, "already exists"):
                td._generate_starter_template_file(
                    "article-minimal",
                    target_rel,
                    overwrite=False,
                )

            generated_target, overwritten = td._generate_starter_template_file(
                "article-minimal",
                target_rel,
                overwrite=True,
            )
            self.assertEqual(generated_target, target_rel)
            self.assertTrue(overwritten)
            text = target_abs.read_text(encoding="utf-8")
        finally:
            if target_abs.exists():
                target_abs.unlink()

        self.assertIn("\\documentclass[oneside]{article}", text)

    def test_bootstrap_starter_template_refreshes_and_selects_generated_target(self) -> None:
        root = td.ROOT_DIR
        target_rel = "tools/tests/_tmp_bootstrap_refresh.tex"
        target_abs = root / target_rel
        if target_abs.exists():
            target_abs.unlink()

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_config = Path(tmp_dir) / "theme.ui.json"
            original_config = td.CONFIG_PATH
            try:
                td.CONFIG_PATH = tmp_config
                response, generated_target, overwritten = td._bootstrap_starter_template(
                    "article-minimal",
                    target_rel,
                    overwrite=False,
                )
            finally:
                td.CONFIG_PATH = original_config
                if target_abs.exists():
                    target_abs.unlink()

        self.assertEqual(generated_target, target_rel)
        self.assertFalse(overwritten)
        state = response.get("state", {})
        self.assertIn(target_rel, state.get("compile_targets", []))
        self.assertEqual(state.get("compile_target"), target_rel)

    def test_compile_smoke_minimal_book_target(self) -> None:
        root = td.ROOT_DIR
        target_rel = "tools/tests/_tmp_smoke_book.tex"
        target_abs = root / target_rel
        pdf_abs = target_abs.with_suffix(".pdf")
        target_abs.parent.mkdir(parents=True, exist_ok=True)
        target_abs.write_text(
            "\\documentclass{book}\\begin{document}\\chapter{Smoke}\\end{document}\n",
            encoding="utf-8",
        )

        original_resolve_binary = td._resolve_binary
        original_run_command = td._run_command
        try:
            td._resolve_binary = lambda name: "/usr/bin/latexmk" if name == "latexmk" else None

            def fake_run(command, cwd=td.ROOT_DIR):
                (Path(cwd) / "_tmp_smoke_book.pdf").write_bytes(b"%PDF-1.4\n")
                return True, 0, "ok"

            td._run_command = fake_run
            success, _, pdf_rel = td._compile_tex_target(target_rel)
        finally:
            td._resolve_binary = original_resolve_binary
            td._run_command = original_run_command
            if target_abs.exists():
                target_abs.unlink()
            if pdf_abs.exists():
                pdf_abs.unlink()

        self.assertTrue(success)
        self.assertEqual(pdf_rel, "tools/tests/_tmp_smoke_book.pdf")

    def test_compile_smoke_minimal_article_target(self) -> None:
        root = td.ROOT_DIR
        target_rel = "tools/tests/_tmp_smoke_article.tex"
        target_abs = root / target_rel
        pdf_abs = target_abs.with_suffix(".pdf")
        target_abs.parent.mkdir(parents=True, exist_ok=True)
        target_abs.write_text(
            "\\documentclass{article}\\begin{document}\\section{Smoke}\\end{document}\n",
            encoding="utf-8",
        )

        original_resolve_binary = td._resolve_binary
        original_run_command = td._run_command
        try:
            td._resolve_binary = lambda name: "/usr/bin/latexmk" if name == "latexmk" else None

            def fake_run(command, cwd=td.ROOT_DIR):
                (Path(cwd) / "_tmp_smoke_article.pdf").write_bytes(b"%PDF-1.4\n")
                return True, 0, "ok"

            td._run_command = fake_run
            success, _, pdf_rel = td._compile_tex_target(target_rel)
        finally:
            td._resolve_binary = original_resolve_binary
            td._run_command = original_run_command
            if target_abs.exists():
                target_abs.unlink()
            if pdf_abs.exists():
                pdf_abs.unlink()

        self.assertTrue(success)
        self.assertEqual(pdf_rel, "tools/tests/_tmp_smoke_article.pdf")

    def test_server_parse_port_arg_supports_auto_and_integer(self) -> None:
        self.assertEqual(tds._parse_port_arg("auto"), "auto")
        self.assertEqual(tds._parse_port_arg("0"), 0)
        self.assertEqual(tds._parse_port_arg("8765"), 8765)
        with self.assertRaises(argparse.ArgumentTypeError):
            tds._parse_port_arg("invalid")

    def test_server_parse_lifecycle_mode_arg_validation(self) -> None:
        self.assertEqual(
            tds._parse_lifecycle_mode_arg("manual"),
            tds.LIFECYCLE_MODE_MANUAL,
        )
        self.assertEqual(
            tds._parse_lifecycle_mode_arg("shutdown-on-last-tab"),
            tds.LIFECYCLE_MODE_SHUTDOWN_ON_LAST_TAB,
        )
        with self.assertRaises(argparse.ArgumentTypeError):
            tds._parse_lifecycle_mode_arg("invalid")

    def test_server_resolve_server_port_zero_returns_bound_endpoint(self) -> None:
        server, url = tds._resolve_server("127.0.0.1", 0)
        try:
            bound_port = int(server.server_address[1])
        finally:
            server.server_close()

        self.assertGreater(bound_port, 0)
        self.assertEqual(url, f"http://127.0.0.1:{bound_port}")

    def test_server_port_auto_falls_back_when_start_port_occupied(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        occupied_port = int(sock.getsockname()[1])

        original_auto_start = tds.AUTO_PORT_START
        try:
            tds.AUTO_PORT_START = occupied_port
            server, _ = tds._resolve_server("127.0.0.1", "auto")
            try:
                bound_port = int(server.server_address[1])
            finally:
                server.server_close()
        finally:
            tds.AUTO_PORT_START = original_auto_start
            sock.close()

        self.assertNotEqual(bound_port, occupied_port)
        self.assertGreater(bound_port, occupied_port)

    def test_server_explicit_port_collision_reports_clear_error(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        occupied_port = int(sock.getsockname()[1])

        try:
            with self.assertRaisesRegex(
                OSError,
                r"--port auto.*--port 0",
            ):
                tds._resolve_server("127.0.0.1", occupied_port)
        finally:
            sock.close()

    def test_lifecycle_controller_manual_mode_never_auto_shutdown(self) -> None:
        controller = tds.LifecycleController(
            tds.LifecycleConfig(
                mode=tds.LIFECYCLE_MODE_MANUAL,
                session_timeout_sec=1.0,
                idle_grace_sec=1.0,
                monitor_interval_sec=0.1,
            )
        )
        controller.heartbeat("session-a", now_monotonic=10.0)
        self.assertFalse(controller.should_shutdown(now_monotonic=100.0))

    def test_lifecycle_controller_shutdown_on_last_tab_after_grace(self) -> None:
        controller = tds.LifecycleController(
            tds.LifecycleConfig(
                mode=tds.LIFECYCLE_MODE_SHUTDOWN_ON_LAST_TAB,
                session_timeout_sec=2.0,
                idle_grace_sec=3.0,
                monitor_interval_sec=0.1,
            )
        )
        controller.heartbeat("session-a", now_monotonic=1.0)

        self.assertFalse(controller.should_shutdown(now_monotonic=2.0))
        # First check after expiry only starts grace countdown.
        self.assertFalse(controller.should_shutdown(now_monotonic=3.1))
        self.assertFalse(controller.should_shutdown(now_monotonic=5.9))
        self.assertTrue(controller.should_shutdown(now_monotonic=6.2))

    def test_normalize_session_id_validation(self) -> None:
        generated = tds._normalize_session_id("")
        self.assertTrue(isinstance(generated, str) and len(generated) > 0)
        self.assertEqual(tds._normalize_session_id("Session_01-abc"), "Session_01-abc")
        with self.assertRaisesRegex(ValueError, "session_id"):
            tds._normalize_session_id("not valid")

    def test_run_server_open_browser_uses_resolved_url(self) -> None:
        class FakeServer:
            def __init__(self) -> None:
                self.closed = False
                self.lifecycle_controller = tds.LifecycleController(
                    tds.LifecycleConfig(mode=tds.LIFECYCLE_MODE_MANUAL)
                )

            def serve_forever(self) -> None:
                raise KeyboardInterrupt

            def server_close(self) -> None:
                self.closed = True

        fake_server = FakeServer()
        opened_urls = []
        captured_stdout = io.StringIO()
        original_resolve_server = tds._resolve_server
        original_browser_open = tds.webbrowser.open
        try:
            tds._resolve_server = lambda host, port, lifecycle_config=None: (
                fake_server,
                "http://127.0.0.1:9921",
            )
            tds.webbrowser.open = lambda url: opened_urls.append(url)
            with redirect_stdout(captured_stdout):
                tds.run_server("127.0.0.1", "auto", open_browser=True)
        finally:
            tds._resolve_server = original_resolve_server
            tds.webbrowser.open = original_browser_open

        self.assertEqual(opened_urls, ["http://127.0.0.1:9921"])
        self.assertIn(
            "LaTeX toolkit UI running at http://127.0.0.1:9921",
            captured_stdout.getvalue(),
        )
        self.assertTrue(fake_server.closed)


if __name__ == "__main__":
    unittest.main()
