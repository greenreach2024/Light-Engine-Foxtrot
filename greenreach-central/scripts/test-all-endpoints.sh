#!/bin/bash
# Comprehensive GreenReach Central Testing Script
# Tests all endpoints, pages, and data flows following framework

set -euo pipefail

BASE="https://greenreachgreens.com"
PASSED=0
FAILED=0
WARNINGS=0

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 GreenReach Central Comprehensive Test Suite"
echo "================================================"
echo ""

# Helper functions
test_endpoint() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local check_pattern="${4:-}"
  
  echo -n "Testing $name... "
  
  response=$(curl -sS -w "\n%{http_code}" "$url" 2>&1 || echo "000")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -n -1)
  
  if [ "$http_code" = "$expected_status" ]; then
    if [ -n "$check_pattern" ]; then
      if echo "$body" | grep -q "$check_pattern"; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
      else
        echo -e "${YELLOW}⚠ WARN - Missing: $check_pattern${NC}"
        echo "  Response: $(echo "$body" | head -c 100)..."
        ((WARNINGS++))
      fi
    else
      echo -e "${GREEN}✓ PASS${NC}"
      ((PASSED++))
    fi
  else
    echo -e "${RED}✗ FAIL - Expected $expected_status, got $http_code${NC}"
    echo "  Response: $(echo "$body" | head -c 200)"
    ((FAILED++))
  fi
}

test_json_endpoint() {
  local name="$1"
  local url="$2"
  local check_field="$3"
  
  echo -n "Testing $name... "
  
  response=$(curl -sS "$url" 2>&1)
  
  if echo "$response" | jq -e ".$check_field" > /dev/null 2>&1; then
    value=$(echo "$response" | jq -r ".$check_field")
    echo -e "${GREEN}✓ PASS${NC} ($check_field: $value)"
    ((PASSED++))
  else
    echo -e "${RED}✗ FAIL - Missing field: $check_field${NC}"
    echo "  Response: $(echo "$response" | head -c 200)"
    ((FAILED++))
  fi
}

echo "=== 1. Health & Infrastructure ==="
test_endpoint "Health Check" "$BASE/health" 200 "healthy"
test_json_endpoint "Database Status" "$BASE/health" "databaseReady"
echo ""

echo "=== 2. Static Pages ==="
test_endpoint "Landing Page" "$BASE/" 302
test_endpoint "Organization Page" "$BASE/greenreach-org.html" 200 "GreenReach"
test_endpoint "Wholesale Portal" "$BASE/wholesale.html" 200
echo ""

echo "=== 3. Wholesale Marketplace ==="
test_json_endpoint "Catalog API" "$BASE/api/wholesale/catalog" "status"
test_json_endpoint "Network Farms" "$BASE/api/wholesale/network/farms" "status"
test_endpoint "Buyers Auth" "$BASE/api/wholesale/buyers/login" 400 # No credentials = 400
echo ""

echo "=== 4. Sync Endpoints (API Key Required) ==="
# These require API key, expect 401
test_endpoint "Heartbeat (No Auth)" "$BASE/api/sync/heartbeat" 401
test_endpoint "Rooms Sync (No Auth)" "$BASE/api/sync/rooms" 401
test_endpoint "Groups Sync (No Auth)" "$BASE/api/sync/groups" 401
echo ""

echo "=== 5. Admin Dashboard (Auth Required) ==="
test_endpoint "Admin Farms API" "$BASE/api/admin/farms" 401 # No token = 401
test_endpoint "Admin Stats" "$BASE/api/admin/stats" 401
test_endpoint "Admin Orders" "$BASE/api/admin/orders" 401
echo ""

echo "=== 6. Public APIs ==="
test_json_endpoint "Recipes API" "$BASE/api/recipes" "status"
echo ""

echo ""
echo "================================================"
echo "📊 Test Results Summary"
echo "================================================"
echo -e "${GREEN}Passed:${NC}   $PASSED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "${RED}Failed:${NC}   $FAILED"
echo ""

if [ $FAILED -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
elif [ $FAILED -eq 0 ]; then
  echo -e "${YELLOW}⚠️  Tests passed with warnings${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi
