#!/bin/bash

# Cloud-to-Edge Sync Test Script
# Tests the farm settings sync between GreenReach Central and edge devices

set -euo pipefail

# Configuration
CENTRAL_URL="${GREENREACH_CENTRAL_URL:-http://localhost:3000}"
EDGE_URL="${EDGE_URL:-http://100.65.187.59:8091}"
FARM_ID="${FARM_ID:-FARM-MKLOMAT3-A9D8}"
API_KEY="${GREENREACH_API_KEY:-test-api-key}"

echo "========================================="
echo "Cloud-to-Edge Sync Test"
echo "========================================="
echo "Central URL: $CENTRAL_URL"
echo "Edge URL: $EDGE_URL"
echo "Farm ID: $FARM_ID"
echo ""

# Test 1: Check cloud health
echo "Test 1: Check GreenReach Central health"
echo "-----------------------------------------"
HEALTH_RESPONSE=$(curl -sS "$CENTRAL_URL/health")
echo "$HEALTH_RESPONSE" | head -c 200
echo ""
echo ""

# Test 2: Queue certification change on cloud
echo "Test 2: Queue certification change on cloud"
echo "-----------------------------------------"
CLOUD_RESPONSE=$(curl -sS -X POST "$CENTRAL_URL/api/farm-settings/$FARM_ID/certifications" \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $API_KEY" \
  -H "X-Farm-ID: $FARM_ID" \
  -d '{
    "certifications": ["GAP", "USDA Organic"],
    "practices": ["Pesticide Free", "Hydroponic"]
  }')

echo "$CLOUD_RESPONSE" | head -c 300
echo ""
echo ""

# Test 3: Check pending changes (as edge device would)
echo "Test 3: Poll for pending changes"
echo "-----------------------------------------"
PENDING_RESPONSE=$(curl -sS -X GET "$CENTRAL_URL/api/farm-settings/$FARM_ID/pending" \
  -H "X-API-Key: $API_KEY" \
  -H "X-Farm-ID: $FARM_ID")

echo "$PENDING_RESPONSE" | head -c 400
echo ""
echo ""

# Test 4: Check edge device sync status (if accessible)
if curl -sS --connect-timeout 3 "$EDGE_URL/health" > /dev/null 2>&1; then
  echo "Test 4: Check edge device sync status"
  echo "-----------------------------------------"
  EDGE_STATUS=$(curl -sS "$EDGE_URL/api/sync/settings/status" || echo '{"error":"Not available"}')
  echo "$EDGE_STATUS" | head -c 400
  echo ""
  echo ""
  
  echo "Test 5: Manually trigger edge poll"
  echo "-----------------------------------------"
  POLL_RESPONSE=$(curl -sS -X POST "$EDGE_URL/api/sync/settings/poll" || echo '{"error":"Failed"}')
  echo "$POLL_RESPONSE" | head -c 300
  echo ""
  echo ""
else
  echo "Test 4: Edge device not accessible (skipped)"
  echo "-----------------------------------------"
  echo "Edge device at $EDGE_URL is not reachable."
  echo "This is normal if testing locally without edge device."
  echo ""
fi

# Test 6: Check cloud audit history
echo "Test 6: Check cloud audit history"
echo "-----------------------------------------"
HISTORY_RESPONSE=$(curl -sS -X GET "$CENTRAL_URL/api/farm-settings/$FARM_ID/history")
echo "$HISTORY_RESPONSE" | head -c 400
echo ""
echo ""

echo "========================================="
echo "Test Complete"
echo "========================================="
echo ""
echo "Next Steps:"
echo "1. If testing locally, start GreenReach Central: cd greenreach-central && npm start"
echo "2. Access edge device to verify sync: ssh greenreach@100.65.187.59"
echo "3. Check edge logs: pm2 logs lightengine-node | grep 'Settings Sync'"
echo "4. Wait 30 seconds for automatic sync, or manually trigger poll"
echo ""
