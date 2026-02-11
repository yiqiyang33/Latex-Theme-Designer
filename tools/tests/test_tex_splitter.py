import tempfile
import unittest
from pathlib import Path

from tools import tex_splitter as ts


class TexSplitterTests(unittest.TestCase):
    def test_split_article_subfiles_mode_rewrites_root_and_writes_units(self) -> None:
        original_text = (
            "\\documentclass[oneside]{article}\n"
            "\\begin{document}\n"
            "\\maketitle\n"
            "\n"
            "Front matter before split anchor.\n"
            "\n"
            "\\section[Overview]{Overview and Goals}\n"
            "First section body.\n"
            "\\subsection{Detail}\n"
            "Nested content.\n"
            "\n"
            "\\section{Methods}\n"
            "Second section body.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(root, root.parent / "Sections")

            self.assertEqual(result.document_class, "article")
            self.assertEqual(result.split_command, "section")
            self.assertEqual(result.standalone_mode, ts.STANDALONE_MODE_SUBFILES)
            self.assertEqual(result.include_macro, "\\subfile")
            self.assertTrue(result.subfiles_package_injected)
            self.assertEqual(len(result.units), 2)
            self.assertIsNotNone(result.backup_path)

            backup_text = result.backup_path.read_text(encoding="utf-8")  # type: ignore[union-attr]
            self.assertEqual(backup_text, original_text)

            rewritten = root.read_text(encoding="utf-8")
            self.assertEqual(rewritten.count("\\usepackage{subfiles}"), 1)
            self.assertIn("Front matter before split anchor.", rewritten)
            self.assertIn("\\subfile{Sections/01-overview-and-goals}", rewritten)
            self.assertIn("\\subfile{Sections/02-methods}", rewritten)
            self.assertNotIn("\\section{Methods}", rewritten)

            first_unit = (root.parent / "Sections" / "01-overview-and-goals.tex").read_text(
                encoding="utf-8"
            )
            second_unit = (root.parent / "Sections" / "02-methods.tex").read_text(
                encoding="utf-8"
            )
            self.assertTrue(
                first_unit.startswith("\\documentclass[../main.tex]{subfiles}\n\\begin{document}")
            )
            self.assertIn("\\section[Overview]{Overview and Goals}", first_unit)
            self.assertIn("\\subsection{Detail}", first_unit)
            self.assertIn("\\section{Methods}", second_unit)
            self.assertTrue(second_unit.rstrip().endswith("\\end{document}"))

    def test_split_book_uses_chapter_anchors_in_legacy_wrapper_mode(self) -> None:
        original_text = (
            "\\documentclass{book}\n"
            "\\begin{document}\n"
            "\\tableofcontents\n"
            "\n"
            "\\chapter{First Chapter}\n"
            "Alpha.\n"
            "\n"
            "\\chapter{Second Chapter}\n"
            "Beta.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "book.tex"
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(
                root,
                root.parent / "Sections",
                standalone_mode=ts.STANDALONE_MODE_LEGACY_WRAPPER,
                use_include=True,
            )

            self.assertEqual(result.document_class, "book")
            self.assertEqual(result.split_command, "chapter")
            self.assertEqual(result.standalone_mode, ts.STANDALONE_MODE_LEGACY_WRAPPER)
            self.assertEqual(result.include_macro, "\\include")
            self.assertFalse(result.subfiles_package_injected)
            self.assertEqual(len(result.units), 2)
            self.assertEqual(len(result.standalone_wrappers), 2)

            rewritten = root.read_text(encoding="utf-8")
            self.assertIn("\\include{Sections/01-first-chapter}", rewritten)
            self.assertIn("\\include{Sections/02-second-chapter}", rewritten)
            self.assertNotIn("\\chapter{First Chapter}", rewritten)

            first_unit = (root.parent / "Sections" / "01-first-chapter.tex").read_text(
                encoding="utf-8"
            )
            self.assertTrue(first_unit.startswith("\\chapter{First Chapter}"))

    def test_split_does_not_duplicate_subfiles_package_when_already_present(self) -> None:
        original_text = (
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\section{A}\n"
            "Alpha.\n"
            "\\section{B}\n"
            "Beta.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(root, root.parent / "Sections")

            self.assertEqual(result.standalone_mode, ts.STANDALONE_MODE_SUBFILES)
            self.assertFalse(result.subfiles_package_injected)
            rewritten = root.read_text(encoding="utf-8")
            self.assertEqual(rewritten.count("\\usepackage{subfiles}"), 1)

    def test_split_raises_when_no_anchor_found(self) -> None:
        original_text = (
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "No top-level section here.\n"
            "\\subsection{Only subsection}\n"
            "Body.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            with self.assertRaisesRegex(ValueError, r"No top-level \\section anchors found"):
                ts.split_tex_file(root, root.parent / "Sections")

            self.assertEqual(root.read_text(encoding="utf-8"), original_text)
            self.assertFalse((root.parent / "main.tex.bak").exists())

    def test_split_subfiles_mode_rejects_use_include(self) -> None:
        original_text = (
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{Overview}\n"
            "Alpha.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            with self.assertRaisesRegex(
                ValueError,
                r"--use-include is not supported in standalone-mode=subfiles",
            ):
                ts.split_tex_file(root, root.parent / "Sections", use_include=True)

    def test_split_dry_run_reports_plan_without_writing(self) -> None:
        original_text = (
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{Overview}\n"
            "Alpha.\n"
            "\\section{Method}\n"
            "Beta.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(root, root.parent / "Sections", dry_run=True)

            self.assertTrue(result.dry_run)
            self.assertFalse(result.already_split)
            self.assertEqual(len(result.units), 2)
            self.assertIsNotNone(result.backup_path)
            self.assertFalse(result.backup_path.exists())  # type: ignore[union-attr]
            self.assertEqual(root.read_text(encoding="utf-8"), original_text)
            self.assertFalse((root.parent / "Sections" / "01-overview.tex").exists())
            self.assertFalse((root.parent / "Sections" / "02-method.tex").exists())

    def test_split_rerun_on_existing_subfiles_layout_is_noop(self) -> None:
        original_text = (
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{Overview}\n"
            "Alpha.\n"
            "\\section{Method}\n"
            "Beta.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            first = ts.split_tex_file(root, root.parent / "Sections")
            first_rewritten = root.read_text(encoding="utf-8")
            second = ts.split_tex_file(root, root.parent / "Sections")
            second_rewritten = root.read_text(encoding="utf-8")

            self.assertFalse(first.already_split)
            self.assertTrue(second.already_split)
            self.assertIsNone(second.backup_path)
            self.assertEqual(len(second.units), 2)
            self.assertEqual(first_rewritten, second_rewritten)
            self.assertEqual(second_rewritten.count("\\subfile{"), 2)

    def test_split_starred_headings_are_supported(self) -> None:
        original_text = (
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section*{Preface}\n"
            "Intro.\n"
            "\\section{Main}\n"
            "Body.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(root, root.parent / "Sections")
            names = [unit.path.name for unit in result.units]

            self.assertEqual(names, ["01-preface.tex", "02-main.tex"])
            rewritten = root.read_text(encoding="utf-8")
            self.assertIn("\\subfile{Sections/01-preface}", rewritten)
            self.assertIn("\\subfile{Sections/02-main}", rewritten)

    def test_split_slug_fallback_for_non_ascii_and_duplicates_is_deterministic(self) -> None:
        original_text = (
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{引言}\n"
            "A.\n"
            "\\section{引言}\n"
            "B.\n"
            "\\section{Intro}\n"
            "C.\n"
            "\\section{Intro}\n"
            "D.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(root, root.parent / "Sections")
            names = [unit.path.name for unit in result.units]

            self.assertEqual(
                names,
                ["01-unit.tex", "02-unit-dup-2.tex", "03-intro.tex", "04-intro-dup-2.tex"],
            )

    def test_split_transaction_failure_keeps_existing_files_unchanged(self) -> None:
        original_text = (
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{Overview}\n"
            "Alpha.\n"
            "\\section{Method}\n"
            "Beta.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")
            existing_unit = root.parent / "Sections" / "01-overview.tex"
            existing_unit.parent.mkdir(parents=True, exist_ok=True)
            existing_unit.write_text("ORIGINAL-UNIT\n", encoding="utf-8")

            original_writer = ts._write_text_transaction
            try:
                def fail_writer(_write_map):
                    raise OSError("simulated write failure")
                ts._write_text_transaction = fail_writer
                with self.assertRaisesRegex(OSError, "simulated write failure"):
                    ts.split_tex_file(root, root.parent / "Sections")
            finally:
                ts._write_text_transaction = original_writer

            self.assertEqual(root.read_text(encoding="utf-8"), original_text)
            self.assertEqual(existing_unit.read_text(encoding="utf-8"), "ORIGINAL-UNIT\n")
            self.assertTrue((root.parent / "main.tex.bak").exists())

    def test_legacy_wrapper_mode_generates_wrapper_files(self) -> None:
        original_text = (
            "\\documentclass{article}\n"
            "\\usepackage{graphicx}\n"
            "\\begin{document}\n"
            "\\section{Overview}\n"
            "Alpha.\n"
            "\\section{Method}\n"
            "Beta.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(
                root,
                root.parent / "Sections",
                standalone_mode=ts.STANDALONE_MODE_LEGACY_WRAPPER,
            )

            self.assertEqual(result.standalone_mode, ts.STANDALONE_MODE_LEGACY_WRAPPER)
            self.assertEqual(len(result.units), 2)
            self.assertEqual(len(result.standalone_wrappers), 2)
            self.assertIsNotNone(result.standalone_dir)
            self.assertEqual(
                result.standalone_dir,
                (root.parent / "Sections" / "_standalone").resolve(),
            )

            first_wrapper_path = (
                root.parent / "Sections" / "_standalone" / "01-overview-standalone.tex"
            ).resolve()
            second_wrapper_path = (
                root.parent / "Sections" / "_standalone" / "02-method-standalone.tex"
            ).resolve()
            self.assertEqual(result.standalone_wrappers[0], first_wrapper_path)
            self.assertEqual(result.standalone_wrappers[1], second_wrapper_path)

            first_wrapper = first_wrapper_path.read_text(encoding="utf-8")
            second_wrapper = second_wrapper_path.read_text(encoding="utf-8")
            self.assertIn("\\documentclass{article}", first_wrapper)
            self.assertIn("\\input{../01-overview}", first_wrapper)
            self.assertIn("\\input{../02-method}", second_wrapper)

    def test_legacy_wrapper_names_stable_across_runs(self) -> None:
        original_text = (
            "\\documentclass{book}\n"
            "\\begin{document}\n"
            "\\chapter{Start Here}\n"
            "Alpha.\n"
            "\\chapter{Next Step}\n"
            "Beta.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            first = ts.split_tex_file(
                root,
                root.parent / "Sections",
                standalone_mode=ts.STANDALONE_MODE_LEGACY_WRAPPER,
            )
            first_names = [path.name for path in first.standalone_wrappers]

            root.write_text(original_text, encoding="utf-8")
            second = ts.split_tex_file(
                root,
                root.parent / "Sections",
                standalone_mode=ts.STANDALONE_MODE_LEGACY_WRAPPER,
            )
            second_names = [path.name for path in second.standalone_wrappers]

            self.assertEqual(first_names, second_names)
            self.assertEqual(
                second_names,
                ["01-start-here-standalone.tex", "02-next-step-standalone.tex"],
            )


if __name__ == "__main__":
    unittest.main()
