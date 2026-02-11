import tempfile
import unittest
from pathlib import Path

from tools import tex_splitter as ts


class TexSplitterTests(unittest.TestCase):
    def test_split_article_rewrites_root_and_writes_units(self) -> None:
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
            self.assertEqual(result.include_macro, "\\input")
            self.assertEqual(len(result.units), 2)

            backup_text = result.backup_path.read_text(encoding="utf-8")
            self.assertEqual(backup_text, original_text)

            rewritten = root.read_text(encoding="utf-8")
            self.assertIn("Front matter before split anchor.", rewritten)
            self.assertIn("\\input{Sections/01-overview-and-goals}", rewritten)
            self.assertIn("\\input{Sections/02-methods}", rewritten)
            self.assertNotIn("\\section{Methods}", rewritten)

            first_unit = (root.parent / "Sections" / "01-overview-and-goals.tex").read_text(
                encoding="utf-8"
            )
            second_unit = (root.parent / "Sections" / "02-methods.tex").read_text(
                encoding="utf-8"
            )
            self.assertTrue(first_unit.startswith("\\section[Overview]{Overview and Goals}"))
            self.assertIn("\\subsection{Detail}", first_unit)
            self.assertTrue(second_unit.startswith("\\section{Methods}"))

    def test_split_book_uses_chapter_anchors(self) -> None:
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

            result = ts.split_tex_file(root, root.parent / "Sections", use_include=True)

            self.assertEqual(result.document_class, "book")
            self.assertEqual(result.split_command, "chapter")
            self.assertEqual(result.include_macro, "\\include")
            self.assertEqual(len(result.units), 2)

            rewritten = root.read_text(encoding="utf-8")
            self.assertIn("\\include{Sections/01-first-chapter}", rewritten)
            self.assertIn("\\include{Sections/02-second-chapter}", rewritten)
            self.assertNotIn("\\chapter{First Chapter}", rewritten)

            first_unit = (root.parent / "Sections" / "01-first-chapter.tex").read_text(
                encoding="utf-8"
            )
            self.assertTrue(first_unit.startswith("\\chapter{First Chapter}"))

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


if __name__ == "__main__":
    unittest.main()
