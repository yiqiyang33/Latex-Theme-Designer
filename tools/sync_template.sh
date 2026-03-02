#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/sync_template.sh [--remote origin] [--branch main] [--dry-run] [--allow-dirty]

Description:
  Sync project files from the template remote branch into current workspace,
  while preserving paths listed in .template-sync-ignore.

Defaults:
  --remote origin
  --branch main

Examples:
  tools/sync_template.sh --dry-run
  tools/sync_template.sh
  tools/sync_template.sh --remote origin --branch main
EOF
}

REMOTE="origin"
BRANCH="main"
DRY_RUN="0"
ALLOW_DIRTY="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)
      REMOTE="${2:-}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: current directory is not a git repository." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
IGNORE_FILE="$REPO_ROOT/.template-sync-ignore"

if [[ "$ALLOW_DIRTY" != "1" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: working tree is not clean. Commit/stash first, or use --allow-dirty." >&2
    exit 1
  fi
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "Error: remote '$REMOTE' does not exist." >&2
  exit 1
fi

echo "[sync-template] fetch $REMOTE/$BRANCH"
git fetch --prune "$REMOTE" "$BRANCH"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "[sync-template] export $REMOTE/$BRANCH"
git archive --format=tar "$REMOTE/$BRANCH" | tar -xf - -C "$TMP_DIR"

RSYNC_ARGS=(
  -a
  --delete
  --itemize-changes
  --exclude ".git/"
  --exclude "main.tex"
  --exclude "Sections/"
  --exclude ".template-sync-ignore"
  --exclude "tools/sync_template.sh"
)

if [[ -f "$IGNORE_FILE" ]]; then
  RSYNC_ARGS+=(--exclude-from "$IGNORE_FILE")
else
  echo "[sync-template] warning: $IGNORE_FILE not found, no custom excludes applied."
fi

if [[ "$DRY_RUN" == "1" ]]; then
  RSYNC_ARGS+=(--dry-run)
fi

echo "[sync-template] rsync template snapshot into workspace"
rsync "${RSYNC_ARGS[@]}" "$TMP_DIR"/ "$REPO_ROOT"/

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[sync-template] dry-run complete (no files changed)."
else
  echo "[sync-template] sync complete."
  git -C "$REPO_ROOT" status --short
fi
