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

    def test_split_book_with_inserted_middle_chapter_generates_three_units(self) -> None:
        original_text = (
            "\\documentclass{book}\n"
            "\\begin{document}\n"
            "\\chapter{First}\n"
            "Alpha.\n"
            "\\chapter{Middle}\n"
            "Beta.\n"
            "\\chapter{Last}\n"
            "Gamma.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(root, root.parent / "Sections")

            self.assertEqual(result.split_command, "chapter")
            self.assertEqual([unit.path.name for unit in result.units], [
                "01-first.tex",
                "02-middle.tex",
                "03-last.tex",
            ])
            rewritten = root.read_text(encoding="utf-8")
            self.assertIn("\\subfile{Sections/01-first}", rewritten)
            self.assertIn("\\subfile{Sections/02-middle}", rewritten)
            self.assertIn("\\subfile{Sections/03-last}", rewritten)
            self.assertNotIn("\\chapter{Middle}", rewritten)

    def test_split_mixed_layout_preserves_existing_refs_and_inserts_new_unit(self) -> None:
        original_text = (
            "\\documentclass{book}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-intro}\n"
            "\\chapter{New Mid}\n"
            "Inserted body.\n"
            "\\subfile{Sections/02-existing}\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            sections = root.parent / "Sections"
            sections.mkdir(parents=True, exist_ok=True)
            (sections / "01-intro.tex").write_text("intro\n", encoding="utf-8")
            (sections / "02-existing.tex").write_text("existing\n", encoding="utf-8")
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(root, sections)
            rewritten = root.read_text(encoding="utf-8")

            self.assertFalse(result.already_split)
            self.assertEqual([unit.path.name for unit in result.units], ["03-new-mid.tex"])
            self.assertIn("\\subfile{Sections/01-intro}", rewritten)
            self.assertIn("\\subfile{Sections/03-new-mid}", rewritten)
            self.assertIn("\\subfile{Sections/02-existing}", rewritten)
            self.assertNotIn("\\chapter{New Mid}", rewritten)
            new_unit = (sections / "03-new-mid.tex").read_text(encoding="utf-8")
            self.assertIn("\\chapter{New Mid}", new_unit)
            self.assertNotIn("\\subfile{Sections/02-existing}", new_unit)

    def test_split_mixed_layout_skips_existing_filename_conflicts(self) -> None:
        original_text = (
            "\\documentclass{book}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-intro}\n"
            "\\chapter{New Mid}\n"
            "Inserted body.\n"
            "\\subfile{Sections/02-existing}\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            sections = root.parent / "Sections"
            sections.mkdir(parents=True, exist_ok=True)
            (sections / "01-intro.tex").write_text("intro\n", encoding="utf-8")
            (sections / "02-existing.tex").write_text("existing\n", encoding="utf-8")
            (sections / "03-new-mid.tex").write_text("occupied\n", encoding="utf-8")
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(root, sections)
            rewritten = root.read_text(encoding="utf-8")

            self.assertEqual([unit.path.name for unit in result.units], ["04-new-mid.tex"])
            self.assertIn("\\subfile{Sections/04-new-mid}", rewritten)
            self.assertTrue((sections / "03-new-mid.tex").exists())
            self.assertTrue((sections / "04-new-mid.tex").exists())

    def test_split_book_appendix_stays_in_root_and_not_in_previous_unit(self) -> None:
        original_text = (
            "\\documentclass{book}\n"
            "\\begin{document}\n"
            "\\chapter{Main Part}\n"
            "Main body.\n"
            "\\appendix\n"
            "\\chapter{Proofs}\n"
            "Proof text.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(root, root.parent / "Sections")
            rewritten = root.read_text(encoding="utf-8")
            first_unit = (root.parent / "Sections" / "01-main-part.tex").read_text(
                encoding="utf-8"
            )
            second_unit = (root.parent / "Sections" / "02-proofs.tex").read_text(
                encoding="utf-8"
            )

            self.assertEqual([unit.path.name for unit in result.units], [
                "01-main-part.tex",
                "02-proofs.tex",
            ])
            self.assertIn("\\subfile{Sections/01-main-part}", rewritten)
            self.assertIn("\\appendix", rewritten)
            self.assertIn("\\subfile{Sections/02-proofs}", rewritten)
            self.assertLess(
                rewritten.find("\\appendix"),
                rewritten.find("\\subfile{Sections/02-proofs}"),
            )
            self.assertNotIn("\\appendix", first_unit)
            self.assertIn("\\chapter{Proofs}", second_unit)

    def test_split_article_appendix_stays_in_root(self) -> None:
        original_text = (
            "\\documentclass{article}\n"
            "\\begin{document}\n"
            "\\section{Main Part}\n"
            "Main body.\n"
            "\\appendix\n"
            "\\section{Supplement}\n"
            "Supp text.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            root.write_text(original_text, encoding="utf-8")

            result = ts.split_tex_file(root, root.parent / "Sections")
            rewritten = root.read_text(encoding="utf-8")
            first_unit = (root.parent / "Sections" / "01-main-part.tex").read_text(
                encoding="utf-8"
            )

            self.assertEqual([unit.path.name for unit in result.units], [
                "01-main-part.tex",
                "02-supplement.tex",
            ])
            self.assertIn("\\appendix", rewritten)
            self.assertNotIn("\\appendix", first_unit)

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

    def test_split_rejects_subfiles_unit_target_to_prevent_recursive_sections(self) -> None:
        root_text = (
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-overview}\n"
            "\\end{document}\n"
        )
        unit_text = (
            "\\documentclass[../main.tex]{subfiles}\n"
            "\\begin{document}\n"
            "\\section{Overview}\n"
            "Alpha.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            unit = Path(tmp_dir) / "Sections" / "01-overview.tex"
            unit.parent.mkdir(parents=True, exist_ok=True)
            root.write_text(root_text, encoding="utf-8")
            unit.write_text(unit_text, encoding="utf-8")

            with self.assertRaisesRegex(
                ValueError,
                r"documentclass\{subfiles\}.*parent root \.tex file",
            ):
                ts.split_tex_file(unit, unit.parent / "Sections")

            self.assertEqual(unit.read_text(encoding="utf-8"), unit_text)
            self.assertFalse((unit.parent / "Sections").exists())
            self.assertFalse((unit.parent / "01-overview.tex.bak").exists())

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

    def test_renumber_add_only_fills_missing_prefixes_by_reference_order(self) -> None:
        root_text = (
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-alpha}\n"
            "\\subfile{Sections/beta}\n"
            "\\subfile{Sections/04-delta}\n"
            "\\subfile{Sections/gamma}\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            sections = root.parent / "Sections"
            sections.mkdir(parents=True, exist_ok=True)
            root.write_text(root_text, encoding="utf-8")
            (sections / "01-alpha.tex").write_text("A\n", encoding="utf-8")
            (sections / "beta.tex").write_text("B\n", encoding="utf-8")
            (sections / "04-delta.tex").write_text("D\n", encoding="utf-8")
            (sections / "gamma.tex").write_text("G\n", encoding="utf-8")

            result = ts.renumber_references(root, mode="add")
            rewritten = root.read_text(encoding="utf-8")

            self.assertEqual(result.mode, "add")
            self.assertIn("\\subfile{Sections/01-alpha}", rewritten)
            self.assertIn("\\subfile{Sections/02-beta}", rewritten)
            self.assertIn("\\subfile{Sections/04-delta}", rewritten)
            self.assertIn("\\subfile{Sections/03-gamma}", rewritten)
            self.assertTrue((sections / "02-beta.tex").exists())
            self.assertTrue((sections / "03-gamma.tex").exists())
            self.assertFalse((sections / "beta.tex").exists())
            self.assertFalse((sections / "gamma.tex").exists())
            self.assertIsNotNone(result.backup_path)

    def test_renumber_remove_strips_numeric_prefix_without_touching_unprefixed(self) -> None:
        root_text = (
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-alpha}\n"
            "\\subfile{Sections/02-beta}\n"
            "\\subfile{Sections/gamma}\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            sections = root.parent / "Sections"
            sections.mkdir(parents=True, exist_ok=True)
            root.write_text(root_text, encoding="utf-8")
            (sections / "01-alpha.tex").write_text("A\n", encoding="utf-8")
            (sections / "02-beta.tex").write_text("B\n", encoding="utf-8")
            (sections / "gamma.tex").write_text("G\n", encoding="utf-8")

            result = ts.renumber_references(root, mode="remove")
            rewritten = root.read_text(encoding="utf-8")

            self.assertEqual(result.mode, "remove")
            self.assertIn("\\subfile{Sections/alpha}", rewritten)
            self.assertIn("\\subfile{Sections/beta}", rewritten)
            self.assertIn("\\subfile{Sections/gamma}", rewritten)
            self.assertTrue((sections / "alpha.tex").exists())
            self.assertTrue((sections / "beta.tex").exists())
            self.assertTrue((sections / "gamma.tex").exists())
            self.assertFalse((sections / "01-alpha.tex").exists())
            self.assertFalse((sections / "02-beta.tex").exists())
            self.assertIsNotNone(result.backup_path)

    def test_renumber_dry_run_does_not_write(self) -> None:
        root_text = (
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/topic}\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            sections = root.parent / "Sections"
            sections.mkdir(parents=True, exist_ok=True)
            root.write_text(root_text, encoding="utf-8")
            (sections / "topic.tex").write_text("T\n", encoding="utf-8")

            result = ts.renumber_references(root, mode="add", dry_run=True)

            self.assertTrue(result.dry_run)
            self.assertEqual(root.read_text(encoding="utf-8"), root_text)
            self.assertTrue((sections / "topic.tex").exists())
            self.assertFalse((sections / "01-topic.tex").exists())
            self.assertIsNotNone(result.backup_path)
            self.assertFalse(result.backup_path.exists())  # type: ignore[union-attr]

    def test_renumber_conflict_raises_and_keeps_files(self) -> None:
        root_text = (
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-alpha}\n"
            "\\subfile{Sections/alpha}\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            sections = root.parent / "Sections"
            sections.mkdir(parents=True, exist_ok=True)
            root.write_text(root_text, encoding="utf-8")
            (sections / "01-alpha.tex").write_text("A1\n", encoding="utf-8")
            (sections / "alpha.tex").write_text("A0\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "already exists"):
                ts.renumber_references(root, mode="remove")

            self.assertEqual(root.read_text(encoding="utf-8"), root_text)
            self.assertTrue((sections / "01-alpha.tex").exists())
            self.assertTrue((sections / "alpha.tex").exists())

    def test_unsplit_inlines_unit_and_deletes_source_by_default(self) -> None:
        root_text = (
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-topic}\n"
            "\\end{document}\n"
        )
        unit_text = (
            "\\documentclass[../main.tex]{subfiles}\n"
            "\\begin{document}\n"
            "\\section{Topic}\n"
            "Alpha.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            unit = Path(tmp_dir) / "Sections" / "01-topic.tex"
            unit.parent.mkdir(parents=True, exist_ok=True)
            root.write_text(root_text, encoding="utf-8")
            unit.write_text(unit_text, encoding="utf-8")

            result = ts.unsplit_one_unit(unit)
            rewritten = root.read_text(encoding="utf-8")

            self.assertTrue(result.deleted_source)
            self.assertIn("\\section{Topic}", rewritten)
            self.assertNotIn("\\subfile{Sections/01-topic}", rewritten)
            self.assertFalse(unit.exists())
            self.assertIsNotNone(result.backup_path)

    def test_unsplit_keep_source_retains_unit_file(self) -> None:
        root_text = (
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-topic}\n"
            "\\end{document}\n"
        )
        unit_text = (
            "\\documentclass[../main.tex]{subfiles}\n"
            "\\begin{document}\n"
            "\\section{Topic}\n"
            "Alpha.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            unit = Path(tmp_dir) / "Sections" / "01-topic.tex"
            unit.parent.mkdir(parents=True, exist_ok=True)
            root.write_text(root_text, encoding="utf-8")
            unit.write_text(unit_text, encoding="utf-8")

            result = ts.unsplit_one_unit(unit, delete_source=False)

            self.assertFalse(result.deleted_source)
            self.assertTrue(unit.exists())
            self.assertIn("\\section{Topic}", root.read_text(encoding="utf-8"))

    def test_unsplit_dry_run_does_not_write(self) -> None:
        root_text = (
            "\\documentclass{article}\n"
            "\\usepackage{subfiles}\n"
            "\\begin{document}\n"
            "\\subfile{Sections/01-topic}\n"
            "\\end{document}\n"
        )
        unit_text = (
            "\\documentclass[../main.tex]{subfiles}\n"
            "\\begin{document}\n"
            "\\section{Topic}\n"
            "Alpha.\n"
            "\\end{document}\n"
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir) / "main.tex"
            unit = Path(tmp_dir) / "Sections" / "01-topic.tex"
            unit.parent.mkdir(parents=True, exist_ok=True)
            root.write_text(root_text, encoding="utf-8")
            unit.write_text(unit_text, encoding="utf-8")

            result = ts.unsplit_one_unit(unit, dry_run=True)

            self.assertTrue(result.dry_run)
            self.assertFalse(result.deleted_source)
            self.assertEqual(root.read_text(encoding="utf-8"), root_text)
            self.assertTrue(unit.exists())
            self.assertIsNotNone(result.backup_path)
            self.assertFalse(result.backup_path.exists())  # type: ignore[union-attr]

    def test_unsplit_rejects_non_subfiles_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = Path(tmp_dir) / "plain.tex"
            target.write_text(
                "\\documentclass{article}\\begin{document}\\section{A}\\end{document}\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "must be a subfiles unit"):
                ts.unsplit_one_unit(target)


if __name__ == "__main__":
    unittest.main()
