#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[start-ui] python3 is not available in PATH." >&2
  exit 127
fi

echo "[start-ui] launching LaTeX toolkit UI from ${ROOT_DIR}"
exec python3 tools/latex_toolkit.py --open-browser --port auto
