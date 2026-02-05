#!/bin/bash
set -e

echo "=== Light Engine Consolidation Script ==="
echo ""
echo "⚠️  This script uses EDGE files (public/) as source of truth"
echo ""

# Safety check 1: Analysis report must exist
if ! ls consolidation-analysis-*.md >/dev/null 2>&1; then
  echo "❌ ERROR: No analysis report found!"
  echo ""
  echo "You must run analyze-file-differences.sh first and review the results."
  echo ""
  echo "Run: ./scripts/analyze-file-differences.sh"
  exit 1
fi

# Show most recent analysis report name
ANALYSIS_REPORT=$(ls -t consolidation-analysis-*.md | head -1)
echo "📄 Found analysis report: $ANALYSIS_REPORT"
echo ""

# Safety check 2: User confirmation
read -p "Have you reviewed the analysis report and documented any cloud improvements? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo ""
  echo "❌ Aborted. Please review: $ANALYSIS_REPORT"
  echo ""
  echo "Pay special attention to the 'Files That Differ' section."
  exit 1
fi

echo ""
read -p "Are you ready to proceed with consolidation? This will restructure files. (yes/no): " final_confirm
if [ "$final_confirm" != "yes" ]; then
  echo "❌ Aborted by user."
  exit 1
fi

echo ""
echo "✅ Starting consolidation..."
echo ""

# Create backup
echo "📦 Creating backup of current state..."
BACKUP_DIR="backups/pre-consolidation-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r public "$BACKUP_DIR/"
cp -r greenreach-central/public "$BACKUP_DIR/greenreach-central-public"
cp server-foxtrot.js "$BACKUP_DIR/" 2>/dev/null || true
cp greenreach-central/server.js "$BACKUP_DIR/greenreach-central-server.js" 2>/dev/null || true
echo "   ✓ Backup saved to $BACKUP_DIR"
echo ""

# 1. Create new structure
echo "📁 Creating light-engine structure..."
mkdir -p light-engine/public
mkdir -p deployments/edge
mkdir -p deployments/cloud

# 2. Copy Light Engine files from EDGE (source of truth)
echo "📋 Copying Light Engine UI from edge (public/)..."

# Copy all LE HTML files
if ls public/LE-*.html >/dev/null 2>&1; then
  cp public/LE-*.html light-engine/public/ 2>/dev/null || true
  echo "   ✓ Copied LE-*.html files"
fi

# Copy views folder
if [ -d "public/views" ]; then
  cp -r public/views light-engine/public/
  echo "   ✓ Copied views/ folder"
fi

# Copy shared assets
[ -d "public/styles" ] && cp -r public/styles light-engine/public/ && echo "   ✓ Copied styles/"
[ -d "public/scripts" ] && cp -r public/scripts light-engine/public/ && echo "   ✓ Copied scripts/"
[ -d "public/js" ] && cp -r public/js light-engine/public/ && echo "   ✓ Copied js/"
[ -f "public/auth-guard.js" ] && cp public/auth-guard.js light-engine/public/
[ -f "public/farm-admin.js" ] && cp public/farm-admin.js light-engine/public/

# Copy data structure (excluding runtime data)
echo "   ✓ Setting up data/ folder structure..."
mkdir -p light-engine/public/data
[ -f "public/data/demo-farm-complete.json" ] && cp public/data/demo-farm-complete.json light-engine/public/data/
if ls public/data/recipes-*.csv >/dev/null 2>&1; then
  cp public/data/recipes-*.csv light-engine/public/data/ 2>/dev/null || true
fi

FILE_COUNT=$(find light-engine/public -name '*.html' | wc -l | tr -d ' ')
echo "   ✓ Copied $FILE_COUNT HTML files total"
echo ""

# 3. Create feature detection config
echo "⚙️  Creating feature detection system..."
cat > light-engine/public/config.js << 'EOF'
/**
 * Light Engine Feature Detection
 * Feature restrictions based on RELIABILITY requirements, not technical capability
 * 
 * Both deployments support:
 * - Monitoring (sensors, inventory, plans)
 * - Activity Hub (orders, picking, packing)
 * - Quality Control (checkpoints)
 * - Tray Operations (harvest, moves, planting)
 * 
 * Edge-only features (require 24/7 reliable connection):
 * - Device Control (lights, pumps, HVAC)
 * - Nutrient Management (pH/EC dosing)
 */
(async function() {
  try {
    const response = await fetch('/api/config/features');
    if (!response.ok) {
      console.warn('[LE Config] Feature config unavailable, using edge defaults');
      window.LE_CONFIG = {
        deployment: 'edge',
        features: {
          monitoring: true,
          inventory: true,
          planning: true,
          forecasting: true,
          activityHub: true,
          qualityControl: true,
          trayOperations: true,
          tabletPairing: true,
          deviceControl: true,
          nutrientControl: true,
          criticalAlerts: true
        }
      };
      return;
    }
    
    window.LE_CONFIG = await response.json();
    document.dispatchEvent(new CustomEvent('le:config:ready'));
    console.log('[LE Config] Loaded:', window.LE_CONFIG.deployment, 'mode');
    
    if (!window.LE_CONFIG.features.deviceControl) {
      console.info('[LE Config] Critical controls restricted:', window.LE_CONFIG.restrictions.reason);
    }
  } catch (err) {
    console.error('[LE Config] Failed to load:', err);
    // Default to edge mode on error
    window.LE_CONFIG = {
      deployment: 'edge',
      features: {
        monitoring: true,
        inventory: true,
        planning: true,
        forecasting: true,
        activityHub: true,
        qualityControl: true,
        trayOperations: true,
        tabletPairing: true,
        deviceControl: true,
        nutrientControl: true,
        criticalAlerts: true
      }
    };
  }
})();
EOF
echo "   ✓ Created config.js"
echo ""

# 4. Create deployment configs
echo "🚀 Creating deployment configurations..."

mkdir -p deployments/edge
cat > deployments/edge/.env.edge << 'EOF'
# Edge Device Configuration
# Dedicated hardware with 24/7 uptime - enables critical systems

DEPLOYMENT_MODE=edge
ENABLE_DEVICE_CONTROL=true       # Lights, pumps, HVAC control (requires 24/7 uptime)
ENABLE_NUTRIENT_CONTROL=true     # pH/EC dosing (requires 24/7 uptime)
DATABASE_TYPE=sqlite
DATA_DIR=./data
PORT=8091

# Note: Edge device also supports all safe operations:
# - Activity Hub, Quality Control, Tray Operations, etc.
EOF

mkdir -p deployments/cloud
cat > deployments/cloud/.env.cloud << 'EOF'
# Cloud/Computer Configuration  
# May shut down or disconnect - safe operations only

DEPLOYMENT_MODE=cloud
ENABLE_DEVICE_CONTROL=false      # Restricted: critical controls need 24/7 connection
ENABLE_NUTRIENT_CONTROL=false    # Restricted: dosing systems need 24/7 connection
DATABASE_TYPE=postgresql
DATABASE_URL=${DATABASE_URL}
PORT=3000

# Note: Cloud supports all safe operations:
# - Monitoring, Activity Hub, Quality Control, Tray Operations, etc.
# Restriction reason: Computer may shut down, be taken home, or lose connection
EOF

echo "   ✓ Created deployment/edge/.env.edge"
echo "   ✓ Created deployment/cloud/.env.cloud"
echo ""

# 5. Archive cloud-specific LE files (for review)
echo "📦 Archiving cloud versions for review..."
ARCHIVE_DIR="backups/cloud-versions-archive-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$ARCHIVE_DIR"
if ls greenreach-central/public/LE-*.html >/dev/null 2>&1; then
  cp greenreach-central/public/LE-*.html "$ARCHIVE_DIR/" 2>/dev/null || true
fi
if [ -d "greenreach-central/public/views" ]; then
  mkdir -p "$ARCHIVE_DIR/views"
  cp greenreach-central/public/views/*.html "$ARCHIVE_DIR/views/" 2>/dev/null || true
fi
echo "   ✓ Cloud versions archived to $ARCHIVE_DIR"
echo ""

# 6. Update greenreach-central to only have GR files
echo "🧹 Cleaning greenreach-central/public/ (removing LE files)..."
cd greenreach-central/public
rm -f LE-*.html 2>/dev/null || true
rm -rf views/ 2>/dev/null || true
rm -f farm-admin.js auth-guard.js 2>/dev/null || true
cd ../..

# Keep only GR-*.html files
GR_COUNT=$(ls -1 greenreach-central/public/GR-*.html 2>/dev/null | wc -l | tr -d ' ')
echo "   ✓ GreenReach Central now contains only GR-*.html files ($GR_COUNT files)"
echo ""

# 7. Schema validation
echo "✅ Running schema validation..."
if command -v npm &> /dev/null && [ -f "package.json" ]; then
  if npm run validate-schemas; then
    echo "   ✓ Schema validation passed"
  else
    echo ""
    echo "⚠️  WARNING: Schema validation failed!"
    echo "   This might be expected if schemas need updating."
    echo ""
    read -p "Continue anyway? (yes/no): " schema_confirm
    if [ "$schema_confirm" != "yes" ]; then
      echo "❌ Aborted. Restoring from backup..."
      cp -r "$BACKUP_DIR/public" .
      cp -r "$BACKUP_DIR/greenreach-central-public" greenreach-central/public
      exit 1
    fi
  fi
else
  echo "   ⚠️ Schema validation not available (skipped)"
fi
echo ""

# 8. Create symlink for deployment access (if needed)
echo "🔗 Creating deployment symlink..."
cd greenreach-central/public
if [ ! -L "light-engine-ui" ]; then
  ln -s ../../light-engine/public light-engine-ui
  echo "   ✓ Created symlink: greenreach-central/public/light-engine-ui"
else
  echo "   ✓ Symlink already exists"
fi
cd ../..
echo ""

echo "✅ Consolidation complete!"
echo ""
echo "📊 Summary:"
echo "   - Light Engine UI: light-engine/public/"
echo "   - Source: Edge (public/) - production-tested version"
echo "   - Backup: $BACKUP_DIR"
echo "   - Cloud archive: $ARCHIVE_DIR"
echo "   - GreenReach Central: $GR_COUNT GR-*.html files remain"
echo ""
echo "📋 Next steps:"
echo "   1. Review archived cloud files: $ARCHIVE_DIR"
echo "   2. Test edge mode: ./scripts/test-both-modes.sh edge"
echo "   3. Test cloud mode: ./scripts/test-both-modes.sh cloud"
echo "   4. Deploy to edge: cd deployments/edge && ./deploy-edge.sh"
echo "   5. Deploy to cloud: cd deployments/cloud && ./deploy-cloud.sh"
echo ""
echo "⚠️  Remember: Do NOT deploy without user approval!"
