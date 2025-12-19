#!/bin/bash

echo "🧪 Testing GreenReach Central API"
echo "=================================="
echo ""

# Check if server is running
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
  echo "✅ Server is running"
  echo ""
  
  echo "📊 Health Check:"
  curl -s http://localhost:3000/health | json_pp
  echo ""
  
else
  echo "❌ Server is not running"
  echo "   Start with: npm run dev"
  exit 1
fi

echo "📝 Testing Farm Registration..."
RESPONSE=$(curl -s -X POST http://localhost:3000/api/farms/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Farm",
    "email": "test@example.com",
    "phone": "+1-555-0100",
    "address_line1": "123 Test St",
    "city": "Portland",
    "state": "OR",
    "postal_code": "97201",
    "latitude": 45.5231,
    "longitude": -122.6765
  }')

echo "$RESPONSE" | json_pp
echo ""

# Extract farm_id and api_key if successful
FARM_ID=$(echo "$RESPONSE" | grep -o '"farmId":"[^"]*"' | cut -d'"' -f4)
API_KEY=$(echo "$RESPONSE" | grep -o '"apiKey":"[^"]*"' | cut -d'"' -f4)

if [ ! -z "$FARM_ID" ]; then
  echo "✅ Farm registered: $FARM_ID"
  echo ""
  
  echo "📊 Testing Heartbeat..."
  curl -s -X POST "http://localhost:3000/api/farms/$FARM_ID/heartbeat" \
    -H "X-API-Key: $API_KEY" | json_pp
  echo ""
  
  echo "📊 Testing Health Sync..."
  curl -s -X POST http://localhost:3000/api/sync/health \
    -H "Content-Type: application/json" \
    -H "X-Farm-ID: $FARM_ID" \
    -H "X-API-Key: $API_KEY" \
    -d '{
      "overall_status": "healthy",
      "cpu_usage": 25.5,
      "memory_usage": 45.2,
      "disk_usage": 30.1,
      "active_devices": 10,
      "offline_devices": 0,
      "alert_count": 0,
      "avg_temperature": 22.5,
      "avg_humidity": 65.0,
      "avg_co2": 800,
      "uptime_seconds": 86400
    }' | json_pp
  echo ""
else
  echo "❌ Farm registration failed"
fi

echo "✨ Test Complete!"
