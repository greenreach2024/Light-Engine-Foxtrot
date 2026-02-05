#!/bin/bash
# Light Engine Consolidation - Test Execution Helper
# Run this to systematically test each page

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  Light Engine Consolidation - Test Execution Helper       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if server is running
check_server() {
  if curl -s http://localhost:8091/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Server running on port 8091"
    return 0
  else
    echo -e "${RED}✗${NC} Server not running on port 8091"
    echo ""
    echo "Start server with:"
    echo "  PORT=8091 node server-foxtrot.js"
    return 1
  fi
}

# Test page load
test_page() {
  local page=$1
  local name=$2
  
  echo -ne "${BLUE}Testing:${NC} $name ... "
  
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:8091/$page" | grep -q "200"; then
    echo -e "${GREEN}✓ PASS${NC}"
    return 0
  else
    echo -e "${RED}✗ FAIL${NC}"
    return 1
  fi
}

echo "Checking server status..."
if ! check_server; then
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "PHASE 1: CRITICAL PATH TESTING"
echo "═══════════════════════════════════════════════════════════"
echo ""

PASSED=0
FAILED=0

# Priority 1: Admin Dashboard
echo "🎯 PRIORITY 1: Admin Dashboard"
if test_page "light-engine/public/LE-farm-admin.html" "Admin Dashboard"; then
  ((PASSED++))
else
  ((FAILED++))
fi

echo ""
echo "  Manual checks required:"
echo "  → Open: http://localhost:8091/light-engine/public/LE-farm-admin.html"
echo "  → Verify KPI cards show REAL data (not 320, 7680, 24, 14d)"
echo "  → Check browser console for errors"
echo "  → Test navigation menu"
echo ""
read -p "Press Enter when Admin Dashboard manual check complete..."

# Priority 2: Farm Summary
echo ""
echo "🎯 PRIORITY 2: Farm Summary (Group v2)"
if test_page "light-engine/public/views/farm-summary.html" "Farm Summary"; then
  ((PASSED++))
else
  ((FAILED++))
fi

echo ""
echo "  Manual checks required:"
echo "  → Open: http://localhost:8091/light-engine/public/views/farm-summary.html"
echo "  → Verify all groups from groups.json display"
echo "  → Check group details (crop, trays, days to harvest)"
echo "  → Test filtering and sorting"
echo ""
read -p "Press Enter when Farm Summary manual check complete..."

# Priority 3: Tray Inventory
echo ""
echo "🎯 PRIORITY 3: Tray Inventory"
if test_page "light-engine/public/views/tray-inventory.html" "Tray Inventory"; then
  ((PASSED++))
else
  ((FAILED++))
fi

echo ""
echo "  Manual checks required:"
echo "  → Open: http://localhost:8091/light-engine/public/views/tray-inventory.html"
echo "  → Verify tray grid displays"
echo "  → Check tray status indicators"
echo "  → Test move/harvest operations"
echo ""
read -p "Press Enter when Tray Inventory manual check complete..."

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "PHASE 2: CORE OPERATIONS TESTING"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Core operation pages
CORE_PAGES=(
  "light-engine/public/views/planting-scheduler.html:Planting Scheduler"
  "light-engine/public/views/nutrient-management.html:Nutrient Management"
  "light-engine/public/views/farm-inventory.html:Farm Inventory"
  "light-engine/public/LE-wholesale-orders.html:Wholesale Orders"
)

for page_info in "${CORE_PAGES[@]}"; do
  IFS=':' read -r page name <<< "$page_info"
  if test_page "$page" "$name"; then
    ((PASSED++))
  else
    ((FAILED++))
  fi
done

echo ""
read -p "Open each page above in browser for detailed testing? (y/n): " detailed
if [[ "$detailed" == "y" ]]; then
  for page_info in "${CORE_PAGES[@]}"; do
    IFS=':' read -r page name <<< "$page_info"
    echo ""
    echo "→ Testing: $name"
    echo "  URL: http://localhost:8091/$page"
    read -p "  Press Enter when complete..."
  done
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "PHASE 3: ALL ADMIN PAGES"
echo "═══════════════════════════════════════════════════════════"
echo ""

# All LE-*.html pages
ADMIN_PAGES=(
  "LE-dashboard.html"
  "LE-billing.html"
  "LE-downloads.html"
  "LE-notifications.html"
  "LE-notification-settings.html"
  "LE-qr-generator.html"
  "LE-setup-wizard-legacy.html"
  "LE-wholesale-review.html"
  "LE-ai-agent-test.html"
  "LE-admin-legacy.html"
  "LE-create-test-farm.html"
  "LE-migration-wizard.html"
  "LE-offline.html"
  "LE-switchbot.html"
  "LE-vpd.html"
)

for page in "${ADMIN_PAGES[@]}"; do
  if test_page "light-engine/public/$page" "$page"; then
    ((PASSED++))
  else
    ((FAILED++))
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "PHASE 4: ALL OPERATION VIEWS"
echo "═══════════════════════════════════════════════════════════"
echo ""

VIEW_PAGES=(
  "room-heatmap.html"
  "room-mapper.html"
  "tray-setup.html"
  "field-mapping.html"
  "iot-manager.html"
  "fan-rotation-monitor.html"
  "tray-inventory-old-backup.html"
)

for page in "${VIEW_PAGES[@]}"; do
  if test_page "light-engine/public/views/$page" "$page"; then
    ((PASSED++))
  else
    ((FAILED++))
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "TEST RESULTS SUMMARY"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo -e "Pages Tested:  ${BLUE}$((PASSED + FAILED))${NC}"
echo -e "Passed:        ${GREEN}$PASSED${NC}"
echo -e "Failed:        ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All pages loaded successfully!${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Complete manual feature testing (see LIGHT_ENGINE_CONSOLIDATION_TEST_PLAN.md)"
  echo "2. Verify KPI data accuracy"
  echo "3. Test Group v2 CRUD operations"
  echo "4. Document any bugs found"
else
  echo -e "${RED}✗ Some pages failed to load${NC}"
  echo ""
  echo "Review failures and check:"
  echo "- Server logs for errors"
  echo "- Browser console for JavaScript errors"
  echo "- File paths are correct"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "FEATURE DETECTION TEST"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "Testing feature config endpoint..."
if curl -s http://localhost:8091/api/config/features > /dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} Feature config endpoint exists"
  echo ""
  echo "Feature Config:"
  curl -s http://localhost:8091/api/config/features | python3 -m json.tool 2>/dev/null || curl -s http://localhost:8091/api/config/features
else
  echo -e "${YELLOW}⚠${NC} Feature config endpoint not implemented yet"
  echo "  This will cause config.js to use fallback defaults"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Full test plan: LIGHT_ENGINE_CONSOLIDATION_TEST_PLAN.md"
echo "Results template: Fill out test results section in plan"
echo ""
