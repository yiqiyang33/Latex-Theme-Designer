"""Theme Designer UI loader."""

from __future__ import annotations

from pathlib import Path

UI_HTML_PATH = Path(__file__).resolve().parent / "ui" / "theme_designer.html"


def _load_html_page(path: Path = UI_HTML_PATH) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as err:
        raise RuntimeError(f"Failed to load Theme Designer HTML from {path}: {err}") from err


HTML_PAGE = _load_html_page()
