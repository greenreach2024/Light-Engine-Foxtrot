#!/bin/bash

# Cleanup Elastic Beanstalk local artifacts
# Scope: .elasticbeanstalk/app_versions and .elasticbeanstalk/logs only
# Retention: keep N most recent by mtime

set -euo pipefail

KEEP_APP_VERSIONS=20
KEEP_LOGS=10
DRY_RUN=true

usage() {
  cat <<EOF
Usage: $0 [--apply] [--keep-app N] [--keep-logs N]

Defaults:
  --keep-app 20
  --keep-logs 10
  (dry-run unless --apply is provided)

Scope is strictly limited to:
  .elasticbeanstalk/app_versions
  .elasticbeanstalk/logs
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)
      DRY_RUN=false
      ;;
    --keep-app)
      KEEP_APP_VERSIONS="$2"
      shift
      ;;
    --keep-logs)
      KEEP_LOGS="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
  
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_VERSIONS_DIR="$ROOT_DIR/.elasticbeanstalk/app_versions"
LOGS_DIR="$ROOT_DIR/.elasticbeanstalk/logs"

prune_dir() {
  local dir="$1"
  local keep="$2"

  if [ ! -d "$dir" ]; then
    echo "Skip: $dir (not found)"
    return 0
  fi

  local total
  total=$(ls -1t "$dir" | wc -l | tr -d ' ')

  if [ "$total" -le "$keep" ]; then
    echo "OK: $dir has $total items (<= $keep). Nothing to remove."
    return 0
  fi

  echo "Pruning $dir: keeping $keep of $total"

  local to_remove
  to_remove=$(ls -1t "$dir" | tail -n +$((keep + 1)))

  if [ -z "$to_remove" ]; then
    echo "Nothing to remove in $dir"
    return 0
  fi

  while IFS= read -r item; do
    [ -z "$item" ] && continue
    local target="$dir/$item"
    if [ "$DRY_RUN" = true ]; then
      echo "DRY RUN: rm -rf \"$target\""
    else
      rm -rf "$target"
      echo "Removed: $target"
    fi
  done <<< "$to_remove"
}

echo "Elastic Beanstalk cleanup (local)"
echo "Root: $ROOT_DIR"
echo "Dry run: $DRY_RUN"
echo "Keep app_versions: $KEEP_APP_VERSIONS"
echo "Keep logs: $KEEP_LOGS"
echo ""

prune_dir "$APP_VERSIONS_DIR" "$KEEP_APP_VERSIONS"
prune_dir "$LOGS_DIR" "$KEEP_LOGS"
