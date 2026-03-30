#!/bin/bash
# ===========================================================================
# GreenReach Central - Farm Registration & API Key Setup
# ===========================================================================
# Run this on the GreenReach Central production server
# Date: January 31, 2026
# Purpose: Register Big Green Farm and configure sync
# ===========================================================================

set -euo pipefail

echo "================================================"
echo "GreenReach Central - Farm Registration"
echo "================================================"
echo ""

# Configuration
FARM_ID="FARM-MKLOMAT3-A9D8"
FARM_NAME="Big Green Farm"
CONTACT_NAME="Peter Gilbert"
EMAIL="peter@greenreachgreens.com"
API_URL="http://192.168.2.222:8091"
API_KEY="ae61e0c94acc6c2f6611f2864902dfe8085d18c6aa4b975b33a10b3d6a0e9b3b"

# Database connection (adjust as needed)
DB_HOST="${RDS_HOSTNAME:-greenreach-central.cgyiqxgtxvr8.us-east-1.rds.amazonaws.com}"
DB_NAME="${RDS_DB_NAME:-greenreach_central}"
DB_USER="${RDS_USERNAME:-postgres}"
DB_PASS="${RDS_PASSWORD:-Farms2024}"

echo "1. Registering farm in database..."
echo "   Farm ID: $FARM_ID"
echo "   Name: $FARM_NAME"
echo ""

# Use psql to insert the farm
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" << EOF
-- Register farm
INSERT INTO farms (farm_id, name, contact_name, email, api_url, status, last_heartbeat, created_at, updated_at)
VALUES (
  '$FARM_ID',
  '$FARM_NAME',
  '$CONTACT_NAME',
  '$EMAIL',
  '$API_URL',
  'offline',
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT (farm_id) DO UPDATE 
SET 
  name = EXCLUDED.name,
  contact_name = EXCLUDED.contact_name,
  email = EXCLUDED.email,
  api_url = EXCLUDED.api_url,
  updated_at = NOW();

-- Verify farm was inserted
SELECT farm_id, name, contact_name, email, status 
FROM farms 
WHERE farm_id = '$FARM_ID';
EOF

if [ $? -eq 0 ]; then
  echo "✅ Farm registered successfully"
else
  echo "❌ Farm registration failed"
  exit 1
fi

echo ""
echo "2. Testing sync endpoint..."
echo ""

# Test heartbeat endpoint
curl -sS -X POST http://localhost:3000/api/sync/heartbeat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -H "X-Farm-ID: $FARM_ID" \
  -d '{
    "status":"online",
    "cpu_usage":25.5,
    "memory_usage":45.2,
    "disk_usage":32.1,
    "metadata": {
      "name": "Big Green Farm",
      "contact_name": "Peter Gilbert"
    }
  }' | jq '.'

echo ""
echo "================================================"
echo "Setup complete!"
echo "================================================"
echo ""
echo "✅ Farm registered: $FARM_ID"
echo "✅ API key ready: ${API_KEY:0:20}..."
echo ""
echo "Next step: Configure reTerminal with:"
echo "  EDGE_MODE=true"
echo "  FARM_ID=$FARM_ID"
echo "  GREENREACH_CENTRAL_URL=https://greenreachgreens.com"
echo "  GREENREACH_API_KEY=$API_KEY"
echo ""
