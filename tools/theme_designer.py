#!/usr/bin/env python3
"""Compatibility entrypoint for legacy Theme Designer naming.

Canonical entrypoint: `tools/latex_toolkit.py`.
"""

from __future__ import annotations

import importlib

try:
    _toolkit = importlib.import_module("tools.latex_toolkit")
except ModuleNotFoundError:
    _toolkit = importlib.import_module("latex_toolkit")

# Re-export toolkit symbols to keep full backwards compatibility.
for _name, _value in vars(_toolkit).items():
    if not _name.startswith("__"):
        globals()[_name] = _value

if __name__ == "__main__":
    _toolkit.main()
