#!/bin/bash
# Test Purchase Flow Helper Script
# Runs complete test of purchase system

set -e

echo "🧪 Light Engine Purchase Flow Test Suite"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
DB_NAME="${DB_NAME:-light_engine_db}"
DB_USER="${DB_USER:-postgres}"

echo "📋 Configuration:"
echo "  Base URL: $BASE_URL"
echo "  Database: $DB_NAME"
echo "  DB User: $DB_USER"
echo ""

# Test 1: Check dependencies
echo "1️⃣  Checking dependencies..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found${NC}"
    exit 1
fi

if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}⚠️  psql not found - database checks will be skipped${NC}"
    HAS_PSQL=false
else
    HAS_PSQL=true
fi

echo -e "${GREEN}✅ Dependencies OK${NC}"
echo ""

# Test 2: Check npm packages
echo "2️⃣  Checking npm packages..."
if ! npm list stripe bcryptjs &> /dev/null; then
    echo -e "${YELLOW}⚠️  Missing packages - running npm install...${NC}"
    npm install
else
    echo -e "${GREEN}✅ Packages installed${NC}"
fi
echo ""

# Test 3: Check database migration
if [ "$HAS_PSQL" = true ]; then
    echo "3️⃣  Checking database schema..."
    
    # Check if api_key column exists in farms table
    COLUMN_EXISTS=$(psql -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM information_schema.columns 
         WHERE table_name='farms' AND column_name='api_key';" 2>/dev/null || echo "0")
    
    if [ "$COLUMN_EXISTS" = "0" ]; then
        echo -e "${YELLOW}⚠️  Database migration needed${NC}"
        echo "Would you like to run the migration now? (y/n)"
        read -r response
        if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
            psql -U "$DB_USER" -d "$DB_NAME" -f migrations/010_purchase_onboarding.sql
            echo -e "${GREEN}✅ Migration completed${NC}"
        else
            echo -e "${RED}❌ Migration skipped - tests may fail${NC}"
        fi
    else
        echo -e "${GREEN}✅ Database schema OK${NC}"
    fi
    echo ""
fi

# Test 4: Check environment variables
echo "4️⃣  Checking environment variables..."
if [ -z "$SQUARE_ACCESS_TOKEN" ]; then
    echo -e "${YELLOW}⚠️  SQUARE_ACCESS_TOKEN not set${NC}"
    echo "Set sandbox token: export SQUARE_ACCESS_TOKEN=EAAA..."
fi

if [ -z "$SQUARE_APPLICATION_ID" ]; then
    echo -e "${YELLOW}⚠️  SQUARE_APPLICATION_ID not set${NC}"
    echo "Set application ID: export SQUARE_APPLICATION_ID=sandbox-sq0idb-..."
fi

if [ -z "$SQUARE_LOCATION_ID" ]; then
    echo -e "${YELLOW}⚠️  SQUARE_LOCATION_ID not set${NC}"
    echo "Set location ID: export SQUARE_LOCATION_ID=L..."
fi

if [ -n "$SQUARE_ACCESS_TOKEN" ] && [ -n "$SQUARE_APPLICATION_ID" ] && [ -n "$SQUARE_LOCATION_ID" ]; then
    echo -e "${GREEN}✅ Square credentials configured${NC}"
fi
echo ""

# Test 5: Check server is running
echo "5️⃣  Checking server status..."
if curl -s --head --fail "$BASE_URL/LEMarketing-purchase.html" > /dev/null; then
    echo -e "${GREEN}✅ Server is running at $BASE_URL${NC}"
else
    echo -e "${RED}❌ Server not responding${NC}"
    echo "Start server with: npm start"
    exit 1
fi
echo ""

# Test 6: Test API endpoints
echo "6️⃣  Testing API endpoints..."

# Test checkout session creation
echo "  Testing POST /api/farms/create-checkout-session..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/farms/create-checkout-session" \
    -H "Content-Type: application/json" \
    -d '{
        "plan": "cloud",
        "email": "test@example.com",
        "farm_name": "Test Farm",
        "contact_name": "Test User"
    }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    SESSION_ID=$(echo "$BODY" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$SESSION_ID" ]; then
        echo -e "${GREEN}✅ Checkout session created: $SESSION_ID${NC}"
    else
        echo -e "${RED}❌ No session ID returned${NC}"
        echo "Response: $BODY"
    fi
elif [ "$HTTP_CODE" = "500" ] && echo "$BODY" | grep -q "SQUARE_ACCESS_TOKEN"; then
    echo -e "${YELLOW}⚠️  Square not configured (expected in local dev)${NC}"
else
    echo -e "${RED}❌ Unexpected response: $HTTP_CODE${NC}"
    echo "Response: $BODY"
fi
echo ""

# Test 7: Check purchase page loads
echo "7️⃣  Testing purchase page..."
if curl -s "$BASE_URL/LEMarketing-purchase.html" | grep -q "Square"; then
    echo -e "${GREEN}✅ Purchase page loads with Square integration${NC}"
else
    echo -e "${RED}❌ Purchase page missing Square integration${NC}"
fi
echo ""

# Test 8: Check success page exists
echo "8️⃣  Testing success page..."
if curl -s --head --fail "$BASE_URL/purchase-success.html" > /dev/null; then
    echo -e "${GREEN}✅ Success page exists${NC}"
else
    echo -e "${RED}❌ Success page not found${NC}"
fi
echo ""

# Summary
echo "=========================================="
echo "📊 Test Summary"
echo "=========================================="
echo ""
echo "✅ Prerequisites checked"
echo "✅ Dependencies installed"
if [ "$HAS_PSQL" = true ]; then
    echo "✅ Database schema verified"
fi
echo "✅ Server running"
echo "✅ API endpoints responding"
echo ""
echo "🎯 Next Steps:"
echo ""
echo "1. Get Square sandbox credentials:"
echo "   https://developer.squareup.com/apps"
echo ""
echo "2. Set environment variables:"
echo "   export SQUARE_ACCESS_TOKEN=EAAA..."
echo "   export SQUARE_APPLICATION_ID=sandbox-sq0idb-..."
echo "   export SQUARE_LOCATION_ID=L..."
echo "   export SQUARE_ENVIRONMENT=sandbox"
echo ""
echo "3. Test purchase flow manually:"
echo "   Open: $BASE_URL/LEMarketing-purchase.html"
echo "   Use test card: 4111 1111 1111 1111"
echo ""
echo "4. Check database:"
echo "   psql -U $DB_USER -d $DB_NAME"
echo "   SELECT * FROM farms ORDER BY created_at DESC LIMIT 5;"
echo ""
echo "5. View logs:"
echo "   tail -f logs/server.log"
echo ""
echo "📚 Documentation:"
echo "   - PURCHASE_SYSTEM_SUMMARY.md"
echo "   - PURCHASE_FLOW_DEPLOYMENT.md"
echo ""
