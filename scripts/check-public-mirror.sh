#!/usr/bin/env bash
#
# check-public-mirror.sh — guard against the dual-public-tree shadowing trap
#
# Background
#   server-foxtrot.js mounts greenreach-central/public/ BEFORE public/ in the
#   static-file chain. Any file present in both trees is served from the
#   central copy, so updating only one tree can be silently shadowed at
#   runtime — see PR #138 for the regressions that motivated this check.
#
# What this script does
#   For every file changed between BASE and HEAD, if it lives in public/ or
#   greenreach-central/public/ AND its shadow path exists at HEAD in the
#   other tree, the shadow must also have been changed. Otherwise the trees
#   would diverge and the central copy would shadow the public/ update at
#   runtime.
#
# Usage
#   scripts/check-public-mirror.sh                       # base=origin/main, head=HEAD
#   scripts/check-public-mirror.sh <base-sha> <head-sha> # explicit, used by CI
#
# Escape hatches
#   1. Add the path to EXEMPT below if a file genuinely belongs in only one
#      tree (and you've understood the mount-order implications).
#   2. Apply the 'skip-mirror-check' label to the PR; the workflow skips
#      this job when the label is present.

set -euo pipefail

BASE="${1:-origin/main}"
HEAD="${2:-HEAD}"

# Paths that are intentionally allowed to live in only one tree.
# Add here only after confirming the divergence is intentional.
EXEMPT=()

# Collect changed paths under either watched tree, with status. We use
# --name-status so we can treat deletions as drift-reduction (a delete on
# one side leaves the other side as the sole copy, which Express still
# serves correctly — that's a valid consolidation step).
#
# Use temp files rather than mapfile() so the script works on macOS's
# stock bash 3.2 — a developer's local sanity-check shouldn't require
# upgrading their shell.
STATUS_TMP=$(mktemp)
CHANGED_TMP=$(mktemp)  # paths that are added/modified (need a matching shadow update)
ALL_CHANGED_TMP=$(mktemp)  # all touched paths incl. deletions (used for shadow-in-changed lookup)
trap 'rm -f "$STATUS_TMP" "$CHANGED_TMP" "$ALL_CHANGED_TMP"' EXIT

git diff --name-status "$BASE" "$HEAD" -- 'public/' 'greenreach-central/public/' > "$STATUS_TMP"

if [ ! -s "$STATUS_TMP" ]; then
  echo "No changes under public/ or greenreach-central/public/."
  exit 0
fi

# Split into "needs check" (A/M) and "all changed" (incl. D).
# Status format: <status>\t<path>  (rename uses R<num>\t<old>\t<new>)
while IFS=$'\t' read -r status path rest; do
  case "$status" in
    A|M)
      printf '%s\n' "$path" >> "$CHANGED_TMP"
      printf '%s\n' "$path" >> "$ALL_CHANGED_TMP"
      ;;
    D)
      # Deletion is allowed — it reduces the dual-tree drift.
      printf '%s\n' "$path" >> "$ALL_CHANGED_TMP"
      ;;
    R*)
      # Renames: old path is gone (like a delete on that name), new path
      # needs the mirror check (like an A on that name).
      printf '%s\n' "$path" >> "$ALL_CHANGED_TMP"
      printf '%s\n' "$rest" >> "$CHANGED_TMP"
      printf '%s\n' "$rest" >> "$ALL_CHANGED_TMP"
      ;;
    *)
      # T (type change), C (copy), etc. — treat conservatively as needs-check
      printf '%s\n' "$path" >> "$CHANGED_TMP"
      printf '%s\n' "$path" >> "$ALL_CHANGED_TMP"
      ;;
  esac
done < "$STATUS_TMP"

if [ ! -s "$CHANGED_TMP" ]; then
  echo "Only deletions under public/ or greenreach-central/public/ — drift reduced."
  exit 0
fi

CHANGED_COUNT=$(wc -l < "$CHANGED_TMP" | tr -d ' ')

is_exempt() {
  local path="$1"
  for e in "${EXEMPT[@]:-}"; do
    [ "$path" = "$e" ] && return 0
  done
  return 1
}

errors=()

while IFS= read -r f; do
  [ -z "$f" ] && continue
  is_exempt "$f" && continue

  case "$f" in
    public/*)
      shadow="greenreach-central/public/${f#public/}"
      ;;
    greenreach-central/public/*)
      shadow="public/${f#greenreach-central/public/}"
      ;;
    *)
      continue
      ;;
  esac

  is_exempt "$shadow" && continue

  # Only require a matching update if the shadow EXISTS at HEAD.
  # (A new file with no shadow yet is fine; the other side may have been
  # deleted in this same PR — that's a consolidation move and should not
  # require this side to also be deleted.)
  if git cat-file -e "${HEAD}:${shadow}" 2>/dev/null; then
    # Shadow exists at HEAD. Was it touched in this change set in any way
    # (modified, added, deleted, or renamed)? If yes, the dev considered
    # both sides; if no, this is a one-sided update that will be shadowed.
    if ! grep -Fxq "$shadow" "$ALL_CHANGED_TMP"; then
      errors+=("$f -> $shadow")
    fi
  fi
done < "$CHANGED_TMP"

if [ ${#errors[@]} -eq 0 ]; then
  echo "Mirror discipline OK (${CHANGED_COUNT} change(s) checked)."
  exit 0
fi

cat <<'MSG' >&2

Mirror discipline violated.

server-foxtrot.js (line ~27708) mounts greenreach-central/public/ BEFORE
public/, so files present in both trees are served from the central copy.
Updating only one tree means the change is silently SHADOWED at runtime.

Files needing a matching update on the other side:
MSG

for e in "${errors[@]}"; do
  printf '  - %s\n' "$e" >&2
done

cat <<'MSG' >&2

Resolve by ONE of:
  - Mirror the change to the other tree:
      cp public/<file> greenreach-central/public/<file>   # or the reverse
  - Delete the shadow if you intend to consolidate onto a single tree
  - Add the path to EXEMPT in scripts/check-public-mirror.sh if the
    divergence is genuinely intentional and you've understood the
    mount-order implications
  - Apply the 'skip-mirror-check' label to the PR (use sparingly)

For the structural background see PR #138.
MSG

exit 1
