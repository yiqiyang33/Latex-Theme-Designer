#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

"${SCRIPT_DIR}/start-ui.sh" || {
  code=$?
  echo
  echo "[start-ui] failed with exit code ${code}."
  read -r -p "Press Enter to close..."
  exit "${code}"
}
