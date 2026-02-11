import json
import os
from pathlib import Path
import re
import tempfile
import time
import unittest

from tools import theme_designer_core as td


class ThemeDesignerTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
