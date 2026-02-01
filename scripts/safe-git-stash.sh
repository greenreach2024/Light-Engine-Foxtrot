#!/bin/bash
# safe-git-stash.sh - Git stash with pre-stash backup to prevent data loss
# Purpose: Safely stash changes after backing up production data
# Usage: ./scripts/safe-git-stash.sh [stash message]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EDGE_DIR="$(dirname "$SCRIPT_DIR")"

cd "$EDGE_DIR"

echo "⚠️  Git stash will overwrite uncommitted changes!"
echo ""

# Check if there are any changes to stash
if git diff --quiet && git diff --cached --quiet; then
  echo "No changes to stash. Working directory clean."
  exit 0
fi

# Show what will be stashed
echo "📋 Files that will be stashed:"
git status --short
echo ""

# Create backup first
echo "🔄 Creating backup before stash..."
if [ -f "${SCRIPT_DIR}/backup-edge-data.sh" ]; then
  # Run backup script if available
  "${SCRIPT_DIR}/backup-edge-data.sh" || echo "⚠️  Backup script failed, but continuing..."
else
  # Manual backup of critical files
  BACKUP_DIR="${EDGE_DIR}/backups/manual-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  
  cp "${EDGE_DIR}/public/data/farm.json" "$BACKUP_DIR/" 2>/dev/null || true
  cp "${EDGE_DIR}/public/data/rooms.json" "$BACKUP_DIR/" 2>/dev/null || true
  cp "${EDGE_DIR}/public/data/groups.json" "$BACKUP_DIR/" 2>/dev/null || true
  cp "${EDGE_DIR}/public/data/schedules.json" "$BACKUP_DIR/" 2>/dev/null || true
  cp "${EDGE_DIR}/public/data/equipment-metadata.json" "$BACKUP_DIR/" 2>/dev/null || true
  
  echo "✅ Manual backup created: $BACKUP_DIR"
fi

echo ""

# Confirm with user
read -p "Continue with git stash? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "❌ Stash aborted"
  exit 1
fi

# Get optional stash message
STASH_MSG="${1:-Stashed $(date +%Y-%m-%d_%H:%M:%S)}"

# Perform stash
echo ""
echo "🔄 Stashing changes..."
git stash push -m "$STASH_MSG"

echo ""
echo "✅ Stashed successfully"
echo "   Message: $STASH_MSG"
echo "   Backup available in: ${EDGE_DIR}/backups/"
echo ""
echo "💡 To restore stashed changes: git stash pop"
echo "💡 To view stash list: git stash list"
