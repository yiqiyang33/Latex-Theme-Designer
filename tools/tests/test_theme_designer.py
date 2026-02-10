import json
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
