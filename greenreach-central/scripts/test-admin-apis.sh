#!/bin/bash
# Comprehensive Admin API Testing
# Tests all endpoints with admin authentication
# Framework Compliant: Investigation before changes

set -euo pipefail

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZG1pbklkIjoyLCJlbWFpbCI6ImluZm9AZ3JlZW5yZWFjaGZhcm1zLmNvbSIsInJvbGUiOiJhZG1pbiIsIm5hbWUiOiJHcmVlblJlYWNoIEFkbWluIiwiaWF0IjoxNzY5OTAxOTM4LCJleHAiOjE3Njk5NDUxMzh9.JEwfcpNi7-9WX5cMHH9NjoksCr5UkEBXJZ_8nLWn5bk"
BASE="https://greenreachgreens.com"

echo "🔐 GreenReach Central Admin API Test Suite"
echo "============================================"
echo ""

# Test helper
test_admin_api() {
  local name="$1"
  local endpoint="$2"
  
  echo "📊 Testing: $name"
  echo "   Endpoint: GET $endpoint"
  
  response=$(curl -sS "$BASE$endpoint" \
    -H "Authorization: Bearer $TOKEN" 2>&1)
  
  if echo "$response" | jq -e . > /dev/null 2>&1; then
    echo "$response" | jq '.'
  else
    echo "$response" | head -c 500
  fi
  
  echo ""
  echo "---"
  echo ""
}

echo "=== 1. Farm Management ==="
test_admin_api "All Farms" "/api/admin/farms"
test_admin_api "Specific Farm" "/api/admin/farms/FARM-MKLOMAT3-A9D8"
test_admin_api "Farm Rooms" "/api/admin/farms/FARM-MKLOMAT3-A9D8/rooms"
test_admin_api "Farm Zones" "/api/admin/farms/FARM-MKLOMAT3-A9D8/zones"
test_admin_api "Farm Groups" "/api/admin/farms/FARM-MKLOMAT3-A9D8/groups"

echo "=== 2. Aggregate Data ==="
test_admin_api "All Rooms" "/api/admin/rooms"
test_admin_api "All Zones" "/api/admin/zones"
test_admin_api "KPIs" "/api/admin/kpis"

echo "=== 3. Analytics ==="
test_admin_api "Aggregate Analytics" "/api/admin/analytics/aggregate"
test_admin_api "Anomalies" "/api/admin/anomalies"
test_admin_api "Fleet Monitoring" "/api/admin/fleet/monitoring"
test_admin_api "Alerts" "/api/admin/alerts"

echo "=== 4. Farm Details ==="
test_admin_api "Farm Devices" "/api/admin/farms/FARM-MKLOMAT3-A9D8/devices"
test_admin_api "Farm Inventory" "/api/admin/farms/FARM-MKLOMAT3-A9D8/inventory"
test_admin_api "Farm Recipes" "/api/admin/farms/FARM-MKLOMAT3-A9D8/recipes"

echo "=== 5. Dashboards ==="
test_admin_api "Energy Dashboard" "/api/admin/energy/dashboard"
test_admin_api "Harvest Forecast" "/api/admin/harvest/forecast"

echo ""
echo "✅ Test Suite Complete"
echo ""
echo "📝 Review results above to identify:"
echo "   - Working endpoints (returns data)"
echo "   - Empty endpoints (returns [], no data synced yet)"
echo "   - Error endpoints (needs fixing)"
