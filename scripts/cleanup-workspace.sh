#!/bin/bash
set -euo pipefail

cd /Users/petergilbert/Light-Engine-Foxtrot

echo "=== Light Engine Foxtrot Workspace Cleanup ==="
echo ""
echo "This script will remove ~6.9GB of build artifacts and cached files."
echo "All changes are safe and reversible through normal build processes."
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi
echo ""

# Step 1: Backup critical data
echo "Step 1: Backing up lightengine.db..."
if [ -f "lightengine.db" ]; then
  BACKUP_FILE="lightengine.db.backup-$(date +%Y%m%d-%H%M%S)"
  cp lightengine.db "$BACKUP_FILE"
  echo "✓ Backup created: $BACKUP_FILE"
else
  echo "  (lightengine.db not found, skipping)"
fi
echo ""

# Step 2: AWS Elastic Beanstalk artifacts (SAFE - in .gitignore)
echo "Step 2: Removing AWS Elastic Beanstalk deployment artifacts..."
REMOVED_SIZE=0
if [ -d "greenreach-central/.elasticbeanstalk/app_versions" ]; then
  SIZE=$(du -sm greenreach-central/.elasticbeanstalk/app_versions 2>/dev/null | awk '{print $1}')
  echo "  Found app_versions/: ${SIZE}MB"
  rm -rf greenreach-central/.elasticbeanstalk/app_versions
  REMOVED_SIZE=$((REMOVED_SIZE + SIZE))
  echo "  ✓ Removed"
fi
if [ -d "greenreach-central/.elasticbeanstalk/logs" ]; then
  SIZE=$(du -sm greenreach-central/.elasticbeanstalk/logs 2>/dev/null | awk '{print $1}')
  echo "  Found logs/: ${SIZE}MB"
  rm -rf greenreach-central/.elasticbeanstalk/logs
  REMOVED_SIZE=$((REMOVED_SIZE + SIZE))
  echo "  ✓ Removed"
fi
echo "  ✓ Preserved config.yml and *.cfg.yml"
echo "  Total recovered: ${REMOVED_SIZE}MB"
echo ""

# Step 3: Firmware builds (check for active builds first)
echo "Step 3: Checking for active PlatformIO builds..."
if pgrep -f "pio run" > /dev/null 2>&1; then
  echo "  ⚠️  Active PIO build detected! Skipping firmware cleanup."
  echo "  (Stop builds and re-run this script to clean .pio directories)"
else
  echo "  No active builds found."
  PIO_COUNT=$(find . -path "*/.pio/build" -type d 2>/dev/null | wc -l | tr -d ' ')
  if [ "$PIO_COUNT" -gt 0 ]; then
    echo "  Removing $PIO_COUNT .pio/build directories..."
    find . -path "*/.pio/build" -type d -print -exec rm -rf {} + 2>/dev/null || true
    echo "  ✓ Firmware builds removed"
  else
    echo "  (No .pio/build directories found)"
  fi
fi
echo ""

# Step 4: Python artifacts (ask first)
echo "Step 4: Python cache and virtual environment cleanup..."
if [ -d ".venv" ] || [ -n "$(find . -name __pycache__ -type d 2>/dev/null | head -1)" ]; then
  read -p "Are you actively developing Python code right now? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    if [ -d ".venv" ]; then
      SIZE=$(du -sm .venv 2>/dev/null | awk '{print $1}')
      rm -rf .venv
      echo "  ✓ Removed .venv/ (${SIZE}MB)"
    fi
    CACHE_COUNT=$(find . -name __pycache__ -type d 2>/dev/null | wc -l | tr -d ' ')
    if [ "$CACHE_COUNT" -gt 0 ]; then
      find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
      echo "  ✓ Removed $CACHE_COUNT __pycache__ directories"
    fi
    if [ -d ".pytest_cache" ]; then
      rm -rf .pytest_cache
      echo "  ✓ Removed .pytest_cache/"
    fi
    echo "  ℹ️  Recreate with: python -m venv .venv && source .venv/bin/activate"
  else
    echo "  ⚠️  Skipped Python cleanup (active development)"
  fi
else
  echo "  (No Python artifacts found)"
fi
echo ""

# Step 5: Dist directories (verify first)
echo "Step 5: Build output directories..."
DIST_FOUND=false
if [ -d "dist" ] || [ -d "examples/typescript-client/dist" ] || [ -d ".vscode-extension/light-engine-agents/dist" ] || [ -d "desktop-app/build" ]; then
  DIST_FOUND=true
  echo "  Found build output directories:"
  [ -d "dist" ] && echo "    - dist/"
  [ -d "examples/typescript-client/dist" ] && echo "    - examples/typescript-client/dist/"
  [ -d ".vscode-extension/light-engine-agents/dist" ] && echo "    - .vscode-extension/light-engine-agents/dist/"
  [ -d "desktop-app/build" ] && echo "    - desktop-app/build/"
  echo ""
  read -p "Delete these build outputs? Confirm they're NOT runtime assets (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    [ -d "dist" ] && rm -rf dist/ && echo "  ✓ Removed dist/"
    [ -d "examples/typescript-client/dist" ] && rm -rf examples/typescript-client/dist/ && echo "  ✓ Removed examples/typescript-client/dist/"
    [ -d ".vscode-extension/light-engine-agents/dist" ] && rm -rf .vscode-extension/light-engine-agents/dist/ && echo "  ✓ Removed .vscode-extension/light-engine-agents/dist/"
    [ -d "desktop-app/build" ] && rm -rf desktop-app/build && echo "  ✓ Removed desktop-app/build/"
  else
    echo "  ⚠️  Skipped dist cleanup"
  fi
else
  echo "  (No build output directories found)"
fi
echo ""

# Final report
echo "=== Cleanup Complete ==="
echo ""
echo "Current workspace size:"
du -sh . 2>/dev/null | awk '{print "  " $1}'
echo ""
if [ -f "$BACKUP_FILE" ]; then
  echo "Database backup:"
  ls -lh "$BACKUP_FILE" 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
  echo ""
fi
echo "Next steps:"
echo "  1. Review untracked files for secrets:"
echo "     grep -r 'AKIA\\|password=' aws-testing/"
echo ""
echo "  2. Commit safe files:"
echo "     git add ACTIVITY_HUB_BUG_REPORT.md \\"
echo "       AGENT_SKILLS_FRAMEWORK_UPDATE_2026-02-07.md \\"
echo "       DEPLOYMENT_MODELS.md build-and-verify.sh \\"
echo "       public/hotfix-session-storage.js"
echo "     git commit -m 'Add recent documentation and hotfixes'"
echo ""
echo "  3. Rebuild Python venv if needed:"
echo "     python -m venv .venv && source .venv/bin/activate"
echo "     pip install -r requirements.txt"
echo ""
echo "Done!"
