#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Mirrored Asset Sync Check
# Detects files that exist in both public/ and greenreach-central/public/
# and flags any that have diverged.
#
# Usage:
#   ./scripts/sync-check-mirrored.sh          # report only
#   ./scripts/sync-check-mirrored.sh --ci     # exit 1 if diverged
#   ./scripts/sync-check-mirrored.sh --sync   # copy canonical → Central
#
# Canonical source: public/ (Light Engine)
# Mirror target:   greenreach-central/public/
#
# Files in KNOWN_DIVERGENT are expected to differ (Central-specific features).
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CANONICAL="$REPO_ROOT/public"
MIRROR="$REPO_ROOT/greenreach-central/public"
MODE="${1:-}"

# Files expected to diverge (Central has additional features)
# Central adds: Stripe support, farmFetch auth wrapper, Buyers tab,
# different login redirect, etc.
KNOWN_DIVERGENT=(
  "GR-admin.html"
  "GR-central-admin.html"
  "GR-central-admin-login.html"
  "GR-wholesale.html"
  "js/wholesale-admin.js"
  "central-admin.js"
  "farm-admin.js"
  "farm-admin.html"
  "farm-admin-login.html"
  "auth-guard.js"
  "login.html"
  "farm-sales-pos.html"
  "farm-sales-shop.html"
  "farm-sales-store.html"
  "setup-wizard.html"
  "setup-wizard-old.html"
)

is_known_divergent() {
  local file="$1"
  for kd in "${KNOWN_DIVERGENT[@]}"; do
    if [[ "$file" == "$kd" ]]; then return 0; fi
  done
  return 1
}

# Find mirrored files
MIRRORED=$(comm -12 \
  <(find "$CANONICAL" -type f \( -name '*.html' -o -name '*.js' \) | sed "s|^${CANONICAL}/||" | sort) \
  <(find "$MIRROR" -type f \( -name '*.html' -o -name '*.js' \) | sed "s|^${MIRROR}/||" | sort))

IDENTICAL=0
DIVERGED=0
DIVERGED_KNOWN=0
DIVERGED_FILES=()
SYNCED=0

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Mirrored Asset Sync Check — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Canonical: public/"
echo "  Mirror:    greenreach-central/public/"
echo "═══════════════════════════════════════════════════════════════"
echo ""

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  if diff -q "$CANONICAL/$file" "$MIRROR/$file" > /dev/null 2>&1; then
    ((IDENTICAL++))
  else
    if is_known_divergent "$file"; then
      ((DIVERGED_KNOWN++))
      printf "  ⚠ EXPECTED DIVERGENCE: %s\n" "$file"
    else
      ((DIVERGED++))
      DIVERGED_FILES+=("$file")
      printf "  ✗ DIVERGED: %s\n" "$file"
      if [[ "$MODE" == "--sync" ]]; then
        cp "$CANONICAL/$file" "$MIRROR/$file"
        ((SYNCED++))
        printf "    → synced from canonical\n"
      fi
    fi
  fi
done <<< "$MIRRORED"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Identical:          $IDENTICAL"
echo "  Diverged (known):   $DIVERGED_KNOWN"
echo "  Diverged (unknown): $DIVERGED"
if [[ "$MODE" == "--sync" ]]; then
  echo "  Synced:             $SYNCED"
fi
echo "═══════════════════════════════════════════════════════════════"

if [[ "$DIVERGED" -gt 0 && "$MODE" != "--sync" ]]; then
  echo ""
  echo "Unexpected divergences found. Run with --sync to copy canonical → mirror."
  echo "If a file should intentionally differ, add it to KNOWN_DIVERGENT in this script."
  echo ""
  if [[ "$MODE" == "--ci" ]]; then
    exit 1
  fi
fi

echo ""
exit 0
