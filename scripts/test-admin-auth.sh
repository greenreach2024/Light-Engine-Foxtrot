#!/bin/bash
# Admin Authentication Test Suite
# Tests the complete authentication flow for GreenReach Central Admin

set -e  # Exit on error

API_BASE="${API_BASE:-http://localhost:8091}"
TEST_EMAIL="test-admin@greenreach.test"
TEST_PASSWORD="TestPassword123"

echo "========================================"
echo "Admin Authentication Test Suite"
echo "========================================"
echo "API Base: $API_BASE"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Function to print test result
test_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: $2"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC}: $2"
        ((FAILED++))
    fi
}

echo "Test 1: Check admin endpoints are protected (should return 401)"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/admin/farms")
if [ "$RESPONSE" = "401" ]; then
    test_result 0 "Admin endpoint returns 401 without auth"
else
    test_result 1 "Admin endpoint should return 401, got $RESPONSE"
fi

echo ""
echo "Test 2: Login with invalid credentials (should fail)"
LOGIN_RESPONSE=$(curl -s -X POST "$API_BASE/api/admin/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"invalid@test.com","password":"wrongpass"}' \
    -w "\n%{http_code}")

HTTP_CODE=$(echo "$LOGIN_RESPONSE" | tail -n1)
BODY=$(echo "$LOGIN_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "401" ]; then
    test_result 0 "Invalid login returns 401"
else
    test_result 1 "Invalid login should return 401, got $HTTP_CODE"
fi

echo ""
echo "Test 3: Try to access protected endpoint with invalid token"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer invalid-token-12345" \
    "$API_BASE/api/admin/farms")

if [ "$RESPONSE" = "401" ]; then
    test_result 0 "Invalid token returns 401"
else
    test_result 1 "Invalid token should return 401, got $RESPONSE"
fi

echo ""
echo "Test 4: Check if admin user exists (for valid login test)"
echo -e "${YELLOW}Note: This test requires an admin user to exist${NC}"
echo "If no admin user exists, run: node scripts/create-admin-user.js"
echo ""

# Try to login with a real admin user
# This will fail if no user exists, but that's expected for first-time setup
echo "Test 5: Verify session endpoint is protected"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/admin/auth/verify")
if [ "$RESPONSE" = "401" ]; then
    test_result 0 "Verify endpoint returns 401 without token"
else
    test_result 1 "Verify endpoint should return 401, got $RESPONSE"
fi

echo ""
echo "Test 6: Check logout endpoint is protected"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/api/admin/auth/logout")
if [ "$RESPONSE" = "401" ]; then
    test_result 0 "Logout endpoint returns 401 without token"
else
    test_result 1 "Logout endpoint should return 401, got $RESPONSE"
fi

echo ""
echo "Test 7: Verify all admin endpoints are protected"
ENDPOINTS=(
    "/api/admin/farms"
    "/api/admin/analytics/aggregate"
    "/api/admin/farms/db"
)

ALL_PROTECTED=true
for endpoint in "${ENDPOINTS[@]}"; do
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE$endpoint")
    if [ "$RESPONSE" != "401" ]; then
        echo "  - $endpoint returned $RESPONSE (expected 401)"
        ALL_PROTECTED=false
    fi
done

if [ "$ALL_PROTECTED" = true ]; then
    test_result 0 "All admin endpoints are protected"
else
    test_result 1 "Some admin endpoints are not protected"
fi

echo ""
echo "Test 8: Check admin login page is accessible"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/GR-central-admin-login.html")
if [ "$RESPONSE" = "200" ]; then
    test_result 0 "Login page is accessible"
else
    test_result 1 "Login page should return 200, got $RESPONSE"
fi

echo ""
echo "Test 9: Check admin dashboard is accessible (HTML)"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/GR-central-admin.html")
if [ "$RESPONSE" = "200" ]; then
    test_result 0 "Admin dashboard HTML is accessible"
else
    test_result 1 "Admin dashboard should return 200, got $RESPONSE"
fi

echo ""
echo "========================================"
echo "Test Results"
echo "========================================"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed! ✓${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Run database migration: psql \$DATABASE_URL -f migrations/003_create_admin_tables.sql"
    echo "2. Create admin user: node scripts/create-admin-user.js"
    echo "3. Test login with real credentials"
    exit 0
else
    echo -e "${RED}Some tests failed${NC}"
    echo ""
    echo "Please review the failures above and fix any issues."
    exit 1
fi
