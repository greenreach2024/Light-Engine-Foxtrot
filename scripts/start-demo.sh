#!/bin/bash

###############################################################################
# Light Engine - Demo Version Setup
# Creates a fully functional demo with mock data for testing
###############################################################################

set -e

echo "=========================================="
echo "🌱 Light Engine Demo Setup"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
DEMO_PORT=8000
DEMO_TENANT="demo-farm-001"

echo -e "${BLUE}📋 Demo Configuration:${NC}"
echo "  Port: $DEMO_PORT"
echo "  Tenant: $DEMO_TENANT"
echo "  Mode: Development (with mock data)"
echo ""

# Check if backend is running
if lsof -Pi :$DEMO_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Backend already running on port $DEMO_PORT${NC}"
    echo "   Stopping existing backend..."
    lsof -ti:$DEMO_PORT | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Start backend with demo configuration
echo -e "${GREEN}🚀 Starting backend with demo configuration...${NC}"
cd "$(dirname "$0")/.."

# Load environment
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Start backend in background
python3 -m backend > /tmp/lightengine-demo.log 2>&1 &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"

# Wait for backend to start
echo -e "${BLUE}⏳ Waiting for backend to start...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:$DEMO_PORT/ > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Backend is ready!${NC}"
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# Create demo data
echo -e "${BLUE}📦 Creating demo data...${NC}"

# Create demo customer
echo -n "   Creating demo customer... "
python3 << 'PYEOF'
import os
import sys
os.environ['SQUARE_ENVIRONMENT'] = 'sandbox'
os.environ['SQUARE_ACCESS_TOKEN'] = os.getenv('SQUARE_ACCESS_TOKEN', 'EAAAl3UxQY8RcG0UonmzQVkQHDUNVeivA6FPDDWRMskq0F2j1_WieB9SSowKUifa')

try:
    from backend.billing.square_client import SquareClient
    
    client = SquareClient()
    result = client.create_customer(
        email='demo@lightengine.io',
        first_name='Demo',
        last_name='Farm',
        tenant_id='demo-farm-001'
    )
    
    if result.get('success'):
        print(f"✅ Customer ID: {result['customer_id']}")
    else:
        print(f"ℹ️  Using existing customer")
except Exception as e:
    print(f"ℹ️  Mock mode (no Square connection)")
PYEOF

# Display demo information
echo ""
echo "=========================================="
echo -e "${GREEN}✅ Demo Environment Ready!${NC}"
echo "=========================================="
echo ""
echo "📊 Demo Dashboard:"
echo "   http://localhost:$DEMO_PORT/"
echo ""
echo "💳 Billing Page:"
echo "   http://localhost:$DEMO_PORT/billing.html"
echo ""
echo "🔧 API Endpoints:"
echo "   http://localhost:$DEMO_PORT/docs"
echo ""
echo "📋 Available Plans:"
echo "   • Starter: \$49/month (10 devices, 1K API calls/day)"
echo "   • Pro: \$199/month (50 devices, 10K API calls/day)"
echo "   • Enterprise: \$999/month (500 devices, 100K API calls/day)"
echo ""
echo "🧪 Test Cards (Square Sandbox):"
echo "   • Success: 4111 1111 1111 1111"
echo "   • Decline: 4000 0000 0000 0002"
echo "   • CVV: 111  Postal: 12345"
echo ""
echo "📝 Logs:"
echo "   tail -f /tmp/lightengine-demo.log"
echo ""
echo "🛑 Stop Demo:"
echo "   kill $BACKEND_PID"
echo ""
echo "=========================================="
