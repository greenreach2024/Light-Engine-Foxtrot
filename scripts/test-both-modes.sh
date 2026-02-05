#!/bin/bash
set -e

MODE=$1

if [ -z "$MODE" ]; then
  echo "Usage: ./scripts/test-both-modes.sh [edge|cloud|both]"
  echo ""
  echo "Tests Light Engine in different deployment modes"
  exit 1
fi

echo "=== Light Engine Mode Testing ==="
echo ""

test_edge_mode() {
  echo "🔧 Testing EDGE MODE (full functionality)..."
  echo ""
  
  # Check if light-engine exists
  if [ ! -d "light-engine/public" ]; then
    echo "❌ ERROR: light-engine/ not found. Run consolidation first."
    exit 1
  fi
  
  # Copy edge config
  cp deployments/edge/.env.edge light-engine/.env
  
  echo "📋 Edge configuration:"
  echo "   - DEPLOYMENT_MODE=edge"
  echo "   - ENABLE_DEVICE_CONTROL=true"
  echo "   - ENABLE_NUTRIENT_CONTROL=true"
  echo ""
  
  echo "✅ Edge mode configuration applied"
  echo ""
  echo "Expected features:"
  echo "   ✓ Monitoring (sensors, inventory, plans)"
  echo "   ✓ Activity Hub (orders, picking, packing)"
  echo "   ✓ Quality Control (checkpoints)"
  echo "   ✓ Tray Operations (harvest, moves)"
  echo "   ✓ Device Control (lights, pumps, HVAC)"
  echo "   ✓ Nutrient Management (pH/EC dosing)"
  echo ""
  echo "To start edge server:"
  echo "   cd light-engine && PORT=8091 node server.js"
  echo ""
  echo "To test feature config:"
  echo "   curl http://localhost:8091/api/config/features"
  echo ""
}

test_cloud_mode() {
  echo "☁️  Testing CLOUD MODE (safe operations only)..."
  echo ""
  
  # Check if light-engine exists
  if [ ! -d "light-engine/public" ]; then
    echo "❌ ERROR: light-engine/ not found. Run consolidation first."
    exit 1
  fi
  
  # Copy cloud config
  cp deployments/cloud/.env.cloud light-engine/.env
  
  echo "📋 Cloud configuration:"
  echo "   - DEPLOYMENT_MODE=cloud"
  echo "   - ENABLE_DEVICE_CONTROL=false"
  echo "   - ENABLE_NUTRIENT_CONTROL=false"
  echo ""
  
  echo "✅ Cloud mode configuration applied"
  echo ""
  echo "Expected features:"
  echo "   ✓ Monitoring (sensors, inventory, plans)"
  echo "   ✓ Activity Hub (orders, picking, packing)"
  echo "   ✓ Quality Control (checkpoints)"
  echo "   ✓ Tray Operations (harvest, moves)"
  echo "   ✗ Device Control (restricted - requires 24/7 edge device)"
  echo "   ✗ Nutrient Management (restricted - requires 24/7 edge device)"
  echo ""
  echo "To start cloud server:"
  echo "   cd light-engine && PORT=3000 node server.js"
  echo ""
  echo "To test feature config:"
  echo "   curl http://localhost:3000/api/config/features"
  echo ""
}

verify_files() {
  echo "📁 Verifying Light Engine structure..."
  echo ""
  
  HTML_COUNT=$(find light-engine/public -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
  LE_COUNT=$(find light-engine/public -name 'LE-*.html' 2>/dev/null | wc -l | tr -d ' ')
  VIEW_COUNT=$(find light-engine/public/views -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
  
  echo "   - Total HTML files: $HTML_COUNT"
  echo "   - LE admin files: $LE_COUNT"
  echo "   - View files: $VIEW_COUNT"
  echo "   - Config file: $([ -f "light-engine/public/config.js" ] && echo "✓ Present" || echo "✗ Missing")"
  echo ""
  
  if [ -f "light-engine/public/config.js" ]; then
    echo "✅ Structure verified"
  else
    echo "❌ WARNING: config.js missing"
  fi
  echo ""
}

compare_endpoints() {
  echo "🔍 Comparing available endpoints between modes..."
  echo ""
  echo "┌─────────────────────────────┬──────┬───────┐"
  echo "│ Endpoint                    │ Edge │ Cloud │"
  echo "├─────────────────────────────┼──────┼───────┤"
  echo "│ /api/inventory/*            │  ✓   │   ✓   │"
  echo "│ /api/activity-hub/*         │  ✓   │   ✓   │"
  echo "│ /api/qa/*                   │  ✓   │   ✓   │"
  echo "│ /api/tray-runs/*            │  ✓   │   ✓   │"
  echo "│ /api/devices/*/control      │  ✓   │   ✗   │"
  echo "│ /api/nutrients/dose         │  ✓   │   ✗   │"
  echo "│ /env                        │  ✓   │   ✓   │"
  echo "└─────────────────────────────┴──────┴───────┘"
  echo ""
}

case "$MODE" in
  edge)
    verify_files
    test_edge_mode
    ;;
  cloud)
    verify_files
    test_cloud_mode
    ;;
  both)
    verify_files
    echo "═══════════════════════════════════════════════"
    test_edge_mode
    echo "═══════════════════════════════════════════════"
    echo ""
    test_cloud_mode
    echo "═══════════════════════════════════════════════"
    echo ""
    compare_endpoints
    ;;
  *)
    echo "❌ Invalid mode: $MODE"
    echo "Use: edge, cloud, or both"
    exit 1
    ;;
esac

echo "✅ Mode testing configuration complete"
echo ""
echo "📝 Manual testing checklist:"
echo "   [ ] Start server in test mode"
echo "   [ ] Visit admin dashboard"
echo "   [ ] Verify feature detection loads"
echo "   [ ] Check restricted features show appropriate message"
echo "   [ ] Test activity hub functionality"
echo "   [ ] Verify quality control works"
echo "   [ ] Test inventory management"
echo ""
echo "⚠️  Remember: Test BOTH modes before deployment!"
