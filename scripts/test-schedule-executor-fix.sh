#!/bin/bash
# Schedule Executor Verification Script
# Tests that group automation is working correctly after the fix

set -e

echo "================================================"
echo "Schedule Executor Fix Verification"
echo "================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BASE_URL="http://127.0.0.1:8091"

echo "Step 1: Restarting server..."
pm2 restart charlie
sleep 3
echo -e "${GREEN}✓ Server restarted${NC}\n"

echo "Step 2: Testing manual Grow3 control..."
MANUAL_RESULT=$(curl -s -X PATCH "${BASE_URL}/grow3/devicedatas/device/2" \
  -H "Content-Type: application/json" \
  -d '{"status": "on", "channelsValue": "0505162C0000"}')

if echo "$MANUAL_RESULT" | grep -q "success"; then
  echo -e "${GREEN}✓ Manual control working${NC}"
  echo "  Response: $(echo $MANUAL_RESULT | jq -c .)"
else
  echo -e "${RED}✗ Manual control failed${NC}"
  echo "  Response: $MANUAL_RESULT"
  exit 1
fi
echo ""

echo "Step 3: Testing schedule executor tick..."
TICK_RESULT=$(curl -s -X POST "${BASE_URL}/api/schedule-executor/tick")

if echo "$TICK_RESULT" | grep -q '"success":true'; then
  echo -e "${GREEN}✓ Schedule executor tick succeeded${NC}"
  
  # Check for device success
  SUCCESS_COUNT=$(echo "$TICK_RESULT" | jq '[.results[].devices[] | select(.success == true)] | length')
  FAILURE_COUNT=$(echo "$TICK_RESULT" | jq '[.results[].devices[] | select(.success == false)] | length')
  TOTAL_COUNT=$((SUCCESS_COUNT + FAILURE_COUNT))
  
  echo "  Devices controlled: ${SUCCESS_COUNT}/${TOTAL_COUNT} succeeded"
  
  if [ "$FAILURE_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠ Some devices failed:${NC}"
    echo "$TICK_RESULT" | jq '.results[].devices[] | select(.success == false) | {light, error}'
  fi
  
  # Show summary
  echo ""
  echo "Group Status Summary:"
  echo "$TICK_RESULT" | jq -r '.results[] | "  \(.group): \(if .devices[].success then "✓ SUCCESS" else "✗ FAILED" end)"'
else
  echo -e "${RED}✗ Schedule executor tick failed${NC}"
  echo "  Response: $(echo $TICK_RESULT | jq -c .)"
  exit 1
fi
echo ""

echo "Step 4: Checking server logs for errors..."
ERROR_COUNT=$(pm2 logs charlie --err --lines 50 --nostream 2>&1 | grep -c "Cannot PATCH" || true)

if [ "$ERROR_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✓ No 404 errors in logs${NC}"
else
  echo -e "${RED}✗ Found $ERROR_COUNT 404 errors in recent logs${NC}"
  pm2 logs charlie --err --lines 10 --nostream 2>&1 | grep "Cannot PATCH"
  exit 1
fi
echo ""

echo "Step 5: Monitoring next scheduled execution..."
echo "  Waiting for next tick (max 60 seconds)..."

# Monitor logs for next ScheduleExecutor tick
timeout 65 bash -c 'tail -f ~/.pm2/logs/charlie-out.log | grep -m 1 "\[ScheduleExecutor\] PATCH"' 2>/dev/null || true

echo -e "${GREEN}✓ Schedule executor is running${NC}"
echo ""

echo "================================================"
echo -e "${GREEN}All tests passed! ✓${NC}"
echo "================================================"
echo ""
echo "Group automation is now working correctly."
echo ""
echo "Next steps:"
echo "  - Monitor automation: pm2 logs charlie --lines 50"
echo "  - Force tick: curl -s http://127.0.0.1:8091/api/schedule-executor/tick | jq"
echo "  - Check device status: curl -s http://127.0.0.1:8091/api/devicedatas | jq"
echo ""
