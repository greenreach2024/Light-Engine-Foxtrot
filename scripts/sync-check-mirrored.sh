#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Mirrored Asset Sync Check
# Detects critical files that exist in both public/ and greenreach-central/public/
# and flags any that have diverged.
#
# Usage:
#   ./scripts/sync-check-mirrored.sh          # report only
#   ./scripts/sync-check-mirrored.sh --ci     # exit 1 if diverged
#   ./scripts/sync-check-mirrored.sh --sync   # copy canonical → mirror
#
# Canonical source: greenreach-central/public/
# Mirror target:   public/
#
# Only files listed in scripts/mirrored-assets-required.txt are enforced.
# This keeps CI focused on the mirrored assets that must remain identical
# across LE and Central, without failing on legacy duplicates that are
# intentionally or historically divergent.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CANONICAL="$REPO_ROOT/greenreach-central/public"
MIRROR="$REPO_ROOT/public"
MODE="${1:-}"
REQUIRED_LIST="$REPO_ROOT/scripts/mirrored-assets-required.txt"

if [[ ! -f "$REQUIRED_LIST" ]]; then
  echo "Required mirror manifest not found: $REQUIRED_LIST" >&2
  exit 1
fi

IDENTICAL=0
DIVERGED=0
DIVERGED_FILES=()
SYNCED=0
MISSING=0
MISSING_FILES=()

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Mirrored Asset Sync Check — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Canonical: greenreach-central/public/"
echo "  Mirror:    public/"
echo "═══════════════════════════════════════════════════════════════"
echo ""

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  if [[ ! -f "$CANONICAL/$file" || ! -f "$MIRROR/$file" ]]; then
    ((MISSING++))
    MISSING_FILES+=("$file")
    printf "  ✗ MISSING MIRROR: %s\n" "$file"
    continue
  fi
  if diff -q "$CANONICAL/$file" "$MIRROR/$file" > /dev/null 2>&1; then
    ((IDENTICAL++))
  else
    ((DIVERGED++))
    DIVERGED_FILES+=("$file")
    printf "  ✗ DIVERGED: %s\n" "$file"
    if [[ "$MODE" == "--sync" ]]; then
      mkdir -p "$(dirname "$MIRROR/$file")"
      cp "$CANONICAL/$file" "$MIRROR/$file"
      ((SYNCED++))
      printf "    → synced from canonical\n"
    fi
  fi
done < "$REQUIRED_LIST"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Identical:          $IDENTICAL"
echo "  Missing:            $MISSING"
echo "  Diverged:           $DIVERGED"
if [[ "$MODE" == "--sync" ]]; then
  echo "  Synced:             $SYNCED"
fi
echo "═══════════════════════════════════════════════════════════════"

if [[ "$MODE" != "--sync" && ( "$DIVERGED" -gt 0 || "$MISSING" -gt 0 ) ]]; then
  echo ""
  echo "Unexpected divergences found. Run with --sync to copy canonical → mirror."
  echo "Deploy rule: if a mirrored file changes, sync both copies and deploy BOTH Cloud Run services."
  echo "If a file should be enforced, list it in scripts/mirrored-assets-required.txt."
  echo ""
  if [[ "$MODE" == "--ci" ]]; then
    exit 1
  fi
fi

echo ""
exit 0
