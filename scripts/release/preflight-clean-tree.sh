#!/usr/bin/env bash
set -euo pipefail

CANONICAL_ROOT="/Volumes/CodeVault/Projects/Light-Engine-Foxtrot"
ALLOW_UNTRACKED_DOCS="${ALLOW_UNTRACKED_DOCS:-false}"
REQUIRE_SHA=false
SHA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sha)
      SHA="${2:-}"
      shift 2
      ;;
    --require-sha)
      REQUIRE_SHA=true
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      exit 2
      ;;
  esac
done

TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$TOPLEVEL" ]]; then
  echo "Preflight failed: not in a git repository"
  exit 1
fi

PHYSICAL_TOPLEVEL="$(cd "$TOPLEVEL" && pwd -P)"
if [[ "$PHYSICAL_TOPLEVEL" != "$CANONICAL_ROOT" ]]; then
  echo "Preflight failed: repository root must be $CANONICAL_ROOT"
  echo "Detected root: $PHYSICAL_TOPLEVEL"
  exit 1
fi

cd "$TOPLEVEL"

if [[ "$REQUIRE_SHA" == true && -z "$SHA" ]]; then
  echo "Preflight failed: --sha is required"
  exit 1
fi

if [[ -n "$SHA" ]]; then
  if ! git cat-file -e "${SHA}^{commit}" 2>/dev/null; then
    echo "Preflight failed: invalid commit SHA: $SHA"
    exit 1
  fi
fi

STAGED="$(git diff --name-only --cached)"
UNSTAGED="$(git diff --name-only)"
UNTRACKED_RAW="$(git ls-files --others --exclude-standard)"

if [[ "$ALLOW_UNTRACKED_DOCS" == "true" ]]; then
  UNTRACKED="$(printf '%s\n' "$UNTRACKED_RAW" | grep -Ev '(^$|\.md$)' || true)"
else
  UNTRACKED="$UNTRACKED_RAW"
fi

if [[ -n "$STAGED" || -n "$UNSTAGED" || -n "$UNTRACKED" ]]; then
  echo "Preflight failed: working tree is not clean"
  [[ -n "$STAGED" ]] && { echo "-- staged changes --"; echo "$STAGED"; }
  [[ -n "$UNSTAGED" ]] && { echo "-- unstaged changes --"; echo "$UNSTAGED"; }
  [[ -n "$UNTRACKED" ]] && { echo "-- untracked files --"; echo "$UNTRACKED"; }
  exit 1
fi

echo "Preflight passed"
echo "root=$PHYSICAL_TOPLEVEL"
echo "head=$(git rev-parse HEAD)"
[[ -n "$SHA" ]] && echo "release_sha=$SHA"
