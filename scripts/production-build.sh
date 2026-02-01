#!/bin/bash
# production-build.sh - Prepare Edge device code for production deployment
# Phase 3: Remove demo data files and validate config consistency

set -euo pipefail

echo "========================================="
echo "Production Build - Phase 3"
echo "========================================="

# Remove demo data files from build
echo ""
echo "Removing demo data files..."

DEMO_FILES=(
  "public/data/demo-farm-data.json"
  "docs/data/demo-farm-data.json"
  "public/data/wholesale-demo-catalog.json"
)

REMOVED_COUNT=0
for file in "${DEMO_FILES[@]}"; do
  if [ -f "$file" ]; then
    rm -f "$file"
    echo "  ✓ Removed $file"
    ((REMOVED_COUNT++))
  else
    echo "  - $file (not found)"
  fi
done

echo ""
echo "Removed $REMOVED_COUNT demo files"

# Validate config consistency
echo ""
echo "Validating config sources..."

# Check edge-config.json exists
if [ ! -f "config/edge-config.json" ]; then
  echo "❌ ERROR: config/edge-config.json not found"
  exit 1
fi

# Extract farmId from edge-config.json
EDGE_CONFIG_FARM_ID=$(node -p "require('./config/edge-config.json').farmId" 2>/dev/null || echo "")

if [ -z "$EDGE_CONFIG_FARM_ID" ]; then
  echo "❌ ERROR: No farmId found in edge-config.json"
  exit 1
fi

echo "  ✓ edge-config.json farmId: $EDGE_CONFIG_FARM_ID"

# Check if .env has conflicting FARM_ID (warning only)
if [ -f ".env" ] && grep -q "^FARM_ID=" .env; then
  ENV_FARM_ID=$(grep "^FARM_ID=" .env | cut -d'=' -f2)
  if [ "$ENV_FARM_ID" != "$EDGE_CONFIG_FARM_ID" ]; then
    echo "⚠️  WARNING: .env FARM_ID ($ENV_FARM_ID) differs from edge-config.json ($EDGE_CONFIG_FARM_ID)"
    echo "⚠️  edge-config.json will take precedence"
  else
    echo "  ✓ .env FARM_ID matches edge-config.json"
  fi
fi

# Validate demo farm IDs are not in production config
DEMO_FARM_IDS=("GR-00001" "LOCAL-FARM" "DEMO-FARM")
for demo_id in "${DEMO_FARM_IDS[@]}"; do
  if [ "$EDGE_CONFIG_FARM_ID" = "$demo_id" ]; then
    echo "❌ ERROR: Production build cannot use demo farm ID: $demo_id"
    echo "❌ Update config/edge-config.json with a production farm ID"
    exit 1
  fi
done

echo "  ✓ No demo farm IDs detected"

# Check PRODUCTION_MODE is set
if [ -f ".env" ]; then
  if grep -q "^PRODUCTION_MODE=true" .env; then
    echo "  ✓ PRODUCTION_MODE=true in .env"
  else
    echo "⚠️  WARNING: PRODUCTION_MODE not set to true in .env"
    echo "⚠️  Add: PRODUCTION_MODE=true"
  fi
fi

echo ""
echo "========================================="
echo "Production Build Complete"
echo "========================================="
echo "Farm ID: $EDGE_CONFIG_FARM_ID"
echo "Demo files removed: $REMOVED_COUNT"
echo "Ready for deployment"
echo ""
