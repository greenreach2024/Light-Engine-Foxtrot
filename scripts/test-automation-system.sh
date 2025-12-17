#!/bin/bash

# Farm Automation System Demo
# Tests sensor-triggered automation between SwitchBot sensors, IFTTT, and Kasa/SwitchBot devices

echo "🚀 Farm Automation System Demo"
echo "================================"

BASE_URL="http://127.0.0.1:8091"

echo
echo "📊 Current Automation Rules:"
curl -s $BASE_URL/api/automation/rules | jq -r '.rules[] | "- \(.name) (\(.id)) - Enabled: \(.enabled)"'

echo
echo "🌡️  Testing High Temperature Sensor (32°C):"
curl -X POST $BASE_URL/api/automation/test \
  -H "Content-Type: application/json" \
  -d '{
    "sensorData": {
      "source": "switchbot",
      "deviceId": "greenhouse-temp-sensor",
      "type": "temperature", 
      "value": 32.0,
      "metadata": {"zone": "Main Greenhouse"}
    }
  }' | jq -r '.message'

echo
echo "💧 Testing Low Humidity Sensor (40% RH):"
curl -X POST $BASE_URL/api/automation/test \
  -H "Content-Type: application/json" \
  -d '{
    "sensorData": {
      "source": "switchbot",
      "deviceId": "greenhouse-humidity-sensor", 
      "type": "humidity",
      "value": 40.0,
      "metadata": {"zone": "Main Greenhouse"}
    }
  }' | jq -r '.message'

echo
echo "📡 Testing IFTTT Weather Trigger (High Temperature):"
curl -X POST "$BASE_URL/integrations/ifttt/incoming/weather_temp_change?token=test123" \
  -H "Content-Type: application/json" \
  -d '{
    "value1": "30",
    "device_id": "outdoor_weather"
  }' | jq -r '.event + " processed - Received at: " + .receivedAt'

echo
echo "🏠 Testing Environmental Data Ingest (Multiple Sensors):"
curl -X POST $BASE_URL/env \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "greenhouse-2",
    "sensors": {
      "temp": 35.0,
      "rh": 35,
      "co2": 1800
    },
    "meta": {
      "name": "Secondary Greenhouse",
      "source": "sensor-hub"
    }
  }' | jq -r 'if .status == "ok" then "Environmental data ingested successfully" else .detail // .error // "Failed" end'

echo
echo "📈 Automation Execution History (Last 5):"
curl -s $BASE_URL/api/automation/history?limit=5 | jq -r '.history[] | "\(.timestamp | strftime("%H:%M:%S")) - \(.ruleId) - \(.status)"'

echo
echo "🔧 Current Sensor Cache:"
curl -s $BASE_URL/api/automation/sensors | jq -r 'to_entries[] | "\(.key): \(.value.value) (Updated: \(.value.timestamp | strftime("%H:%M:%S")))"'

echo
echo "✅ Demo Complete!"
echo
echo "🔗 Key Integration Points:"
echo "- SwitchBot sensors → Temperature/humidity automation"
echo "- IFTTT webhooks → Weather-based triggers"  
echo "- Environmental ingest → Multi-sensor rule processing"
echo "- Kasa/SwitchBot control → Device automation (would work with real devices)"
echo "- IFTTT outbound → Notifications and external triggers"
echo
echo "📝 API Endpoints Available:"
echo "- GET  /api/automation/rules         - View all rules"
echo "- POST /api/automation/rules         - Add/update rules"
echo "- POST /api/automation/test          - Test with sensor data"
echo "- GET  /api/automation/history       - View execution log"
echo "- POST /integrations/ifttt/incoming  - IFTTT webhooks"
echo "- POST /env                          - Environmental data"