#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/sync_template.sh [options]

Options:
  --target <dir>         Target workspace to sync into (default: current directory)
  --branch <name>        Template branch/tag (default: main)
  --source-url <url>     Template repository URL (default: this template GitHub repo)
  --source-dir <dir>     Use local template directory as source (no network)
  --include-file <file>  Paths to sync (default: <target>/.template-sync-include)
  --ignore-file <file>   Exclude patterns inside synced paths (default: <target>/.template-sync-ignore)
  --delete-stale         Delete files removed from synced source directories
  --dry-run              Preview changes without writing files
  -h, --help             Show help

Notes:
  - This script syncs only include-paths (code/template files), not the whole folder.
  - Directory sync does not delete extra target files unless --delete-stale is set.
  - It does NOT require target directory to be a git repository.
  - It does NOT require clean working tree (dirty is allowed by default).
EOF
}

DEFAULT_SOURCE_URL="https://github.com/yiqiyang33/Latex-Theme-Designer"
TARGET_DIR="$(pwd)"
BRANCH="main"
SOURCE_URL="$DEFAULT_SOURCE_URL"
SOURCE_DIR=""
DRY_RUN="0"
DELETE_STALE="0"

INCLUDE_FILE=""
IGNORE_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_DIR="${2:-}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    --source-url)
      SOURCE_URL="${2:-}"
      shift 2
      ;;
    --source-dir)
      SOURCE_DIR="${2:-}"
      shift 2
      ;;
    --include-file)
      INCLUDE_FILE="${2:-}"
      shift 2
      ;;
    --ignore-file)
      IGNORE_FILE="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
      ;;
    --delete-stale)
      DELETE_STALE="1"
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

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
if [[ -z "$INCLUDE_FILE" ]]; then
  INCLUDE_FILE="$TARGET_DIR/.template-sync-include"
fi
if [[ -z "$IGNORE_FILE" ]]; then
  IGNORE_FILE="$TARGET_DIR/.template-sync-ignore"
fi

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Error: target directory does not exist: $TARGET_DIR" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

SNAPSHOT_DIR="$TMP_DIR/snapshot"
mkdir -p "$SNAPSHOT_DIR"

parse_github_slug() {
  local raw="$1"
  local stripped="$raw"

  stripped="${stripped#https://github.com/}"
  stripped="${stripped#http://github.com/}"
  stripped="${stripped#git@github.com:}"
  stripped="${stripped%.git}"
  stripped="${stripped#/}"
  stripped="${stripped%/}"

  if [[ "$stripped" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
    echo "$stripped"
    return 0
  fi
  return 1
}

fetch_snapshot_from_github() {
  local repo_slug="$1"
  local branch="$2"
  local out_dir="$3"

  if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl is required to download template snapshot." >&2
    return 1
  fi
  local tarball="$TMP_DIR/template.tar.gz"
  local codeload_url="https://codeload.github.com/${repo_slug}/tar.gz/refs/heads/${branch}"

  echo "[sync-template] download ${repo_slug}@${branch}"
  curl -fsSL "$codeload_url" -o "$tarball"
  tar -xzf "$tarball" -C "$TMP_DIR"

  local extracted
  extracted="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | grep -v '/snapshot$' | head -n 1 || true)"
  if [[ -z "$extracted" ]]; then
    echo "Error: failed to extract downloaded snapshot." >&2
    return 1
  fi
  rsync -a "$extracted"/ "$out_dir"/
}

fetch_snapshot_with_git() {
  local source_url="$1"
  local branch="$2"
  local out_dir="$3"

  if ! command -v git >/dev/null 2>&1; then
    echo "Error: git is required for non-GitHub source URL: $source_url" >&2
    return 1
  fi

  echo "[sync-template] clone ${source_url}@${branch}"
  git clone --depth 1 --branch "$branch" "$source_url" "$TMP_DIR/repo"
  rsync -a --exclude ".git/" "$TMP_DIR/repo"/ "$out_dir"/
}

if [[ -n "$SOURCE_DIR" ]]; then
  SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"
  if [[ ! -d "$SOURCE_DIR" ]]; then
    echo "Error: source directory does not exist: $SOURCE_DIR" >&2
    exit 1
  fi
  echo "[sync-template] use local source directory: $SOURCE_DIR"
  rsync -a --exclude ".git/" "$SOURCE_DIR"/ "$SNAPSHOT_DIR"/
else
  if repo_slug="$(parse_github_slug "$SOURCE_URL")"; then
    fetch_snapshot_from_github "$repo_slug" "$BRANCH" "$SNAPSHOT_DIR"
  else
    fetch_snapshot_with_git "$SOURCE_URL" "$BRANCH" "$SNAPSHOT_DIR"
  fi
fi

if [[ ! -f "$INCLUDE_FILE" ]]; then
  echo "Error: include file not found: $INCLUDE_FILE" >&2
  echo "Create it with paths you want to sync (one path per line)." >&2
  exit 1
fi

INCLUDE_PATHS=()
while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
  line="$(printf '%s' "$raw_line" | sed 's/[[:space:]]*$//')"
  if [[ -z "$line" ]]; then
    continue
  fi
  if [[ "$line" == \#* ]]; then
    continue
  fi
  INCLUDE_PATHS+=("$line")
done < "$INCLUDE_FILE"

if [[ ${#INCLUDE_PATHS[@]} -eq 0 ]]; then
  echo "Error: include file is empty: $INCLUDE_FILE" >&2
  exit 1
fi

DIR_RSYNC_ARGS=(
  -a
  -c
  --no-times
  --omit-dir-times
  --itemize-changes
)
FILE_RSYNC_ARGS=(
  -a
  -c
  --no-times
  --omit-dir-times
  --itemize-changes
)

if [[ -f "$IGNORE_FILE" ]]; then
  DIR_RSYNC_ARGS+=(--exclude-from "$IGNORE_FILE")
fi
if [[ "$DELETE_STALE" == "1" ]]; then
  DIR_RSYNC_ARGS+=(--delete)
fi
if [[ "$DRY_RUN" == "1" ]]; then
  DIR_RSYNC_ARGS+=(--dry-run)
  FILE_RSYNC_ARGS+=(--dry-run)
fi

echo "[sync-template] target: $TARGET_DIR"
echo "[sync-template] include-file: $INCLUDE_FILE"
if [[ -f "$IGNORE_FILE" ]]; then
  echo "[sync-template] ignore-file: $IGNORE_FILE"
else
  echo "[sync-template] ignore-file: (not found)"
fi
if [[ "$DELETE_STALE" == "1" ]]; then
  echo "[sync-template] delete-stale: enabled for synced directories"
else
  echo "[sync-template] delete-stale: disabled"
fi

for rel_path in "${INCLUDE_PATHS[@]}"; do
  src="$SNAPSHOT_DIR/$rel_path"
  dst="$TARGET_DIR/$rel_path"

  if [[ ! -e "$src" ]]; then
    echo "[sync-template] skip missing source path: $rel_path"
    continue
  fi

  if [[ -d "$src" ]]; then
    mkdir -p "$dst"
    rsync "${DIR_RSYNC_ARGS[@]}" "$src"/ "$dst"/
  else
    mkdir -p "$(dirname "$dst")"
    rsync "${FILE_RSYNC_ARGS[@]}" "$src" "$dst"
  fi
done

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[sync-template] dry-run complete (no files changed)."
else
  echo "[sync-template] sync complete."
  if git -C "$TARGET_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$TARGET_DIR" status --short
  fi
fi
