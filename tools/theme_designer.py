#!/usr/bin/env python3
"""Compatibility entrypoint for Theme Designer.

Core logic lives in `tools/theme_designer_core.py`.
HTTP server/CLI lives in `tools/theme_designer_server.py`.
"""

from __future__ import annotations

import importlib

try:
    _core = importlib.import_module("tools.theme_designer_core")
    _server = importlib.import_module("tools.theme_designer_server")
except ModuleNotFoundError:
    _core = importlib.import_module("theme_designer_core")
    _server = importlib.import_module("theme_designer_server")

# Re-export core symbols (including private helpers) to keep compatibility.
for _name, _value in vars(_core).items():
    if not _name.startswith("__"):
        globals()[_name] = _value

ThemeDesignerHandler = _server.ThemeDesignerHandler
run_server = _server.run_server
main = _server.main


if __name__ == "__main__":
    main()
