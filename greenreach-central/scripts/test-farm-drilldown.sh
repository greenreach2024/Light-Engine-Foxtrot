#!/bin/bash
# Farm Drill-Down Testing Script
# Tests all detail levels: Summary → Rooms → Zones → Groups
# Framework Compliant: Systematic investigation before changes

set -euo pipefail

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZG1pbklkIjoyLCJlbWFpbCI6ImluZm9AZ3JlZW5yZWFjaGZhcm1zLmNvbSIsInJvbGUiOiJhZG1pbiIsIm5hbWUiOiJHcmVlblJlYWNoIEFkbWluIiwiaWF0IjoxNzY5OTAxOTM4LCJleHAiOjE3Njk5NDUxMzh9.JEwfcpNi7-9WX5cMHH9NjoksCr5UkEBXJZ_8nLWn5bk"
BASE="https://greenreachgreens.com"
FARM_ID="FARM-MKLOMAT3-A9D8"

echo "🔍 Farm Drill-Down Readiness Testing"
echo "Farm: $FARM_ID (Big Green Farm)"
echo "=========================================="
echo ""

# Level 1: Farm Summary
echo "=== LEVEL 1: FARM SUMMARY ==="
echo "Testing: GET /api/admin/farms/$FARM_ID"
echo ""
FARM_SUMMARY=$(curl -sS "$BASE/api/admin/farms/$FARM_ID" \
  -H "Authorization: Bearer $TOKEN")

echo "$FARM_SUMMARY" | jq '{
  farm_id: .farm.farm_id,
  name: .farm.name,
  status: .farm.status,
  last_heartbeat: .farm.last_heartbeat,
  api_url: .farm.api_url,
  central_linked: .farm.central_linked
}'

echo ""
echo "📊 Summary Stats:"
ROOM_COUNT=$(echo "$FARM_SUMMARY" | jq '.stats.rooms // 0')
ZONE_COUNT=$(echo "$FARM_SUMMARY" | jq '.stats.zones // 0')
GROUP_COUNT=$(echo "$FARM_SUMMARY" | jq '.stats.groups // 0')
DEVICE_COUNT=$(echo "$FARM_SUMMARY" | jq '.stats.devices // 0')

echo "  Rooms: $ROOM_COUNT"
echo "  Zones: $ZONE_COUNT"
echo "  Groups: $GROUP_COUNT"
echo "  Devices: $DEVICE_COUNT"
echo ""
echo "---"
echo ""

# Level 2: Rooms
echo "=== LEVEL 2: ROOMS ===="
echo "Testing: GET /api/admin/farms/$FARM_ID/rooms"
echo ""
ROOMS=$(curl -sS "$BASE/api/admin/farms/$FARM_ID/rooms" \
  -H "Authorization: Bearer $TOKEN")

echo "$ROOMS" | jq -r '.rooms[] | "Room: \(.name // .id)
  ID: \(.id)
  Zones: \(.zones | length)
  Trays: \(.trays // 0)
  Updated: \(.updatedAt)"'

echo ""
echo "📋 Room Details:"
echo "$ROOMS" | jq '.rooms[] | {
  id,
  name,
  zone_count: (.zones | length),
  has_trays: (.trays != null),
  has_layout: (.layout != null)
}'

echo ""
echo "---"
echo ""

# Level 3: Zones
echo "=== LEVEL 3: ZONES ==="
echo "Testing: GET /api/admin/farms/$FARM_ID/zones"
echo ""
ZONES=$(curl -sS "$BASE/api/admin/farms/$FARM_ID/zones" \
  -H "Authorization: Bearer $TOKEN")

echo "$ZONES" | jq -r '.zones[] | "Zone: \(.name // .id)
  Sensors: \(.sensors | keys | join(", "))
  Last Update: \(.meta.lastUpdated // .updatedAt)
  Temp: \(.sensors.tempC.current // "N/A")°C
  RH: \(.sensors.rh.current // "N/A")%
  VPD: \(.sensors.vpd.current // "N/A") kPa"'

echo ""
echo "📊 Zone Telemetry Quality:"
echo "$ZONES" | jq '.zones[] | {
  zone: .name,
  sensor_count: (.sensors | keys | length),
  has_history: (.sensors.tempC.history | length > 0),
  history_samples: (.sensors.tempC.history | length),
  has_setpoints: (.sensors.tempC.setpoint != null),
  last_update: .meta.lastUpdated
}'

echo ""
echo "---"
echo ""

# Level 4: Groups (Plantings)
echo "=== LEVEL 4: GROUPS (PLANTINGS) ==="
echo "Testing: GET /api/admin/farms/$FARM_ID/groups"
echo ""
GROUPS=$(curl -sS "$BASE/api/admin/farms/$FARM_ID/groups" \
  -H "Authorization: Bearer $TOKEN")

echo "$GROUPS" | jq -r '.groups[] | "Group: \(.name // .id)
  Recipe: \(.crop // .recipe // "Unknown")
  Zone: \(.zone // .room // "N/A")
  Trays: \(if .trays | type == "array" then (.trays | length) else .trays end)
  Plants: \((if .trays | type == "array" then (.trays | length) else .trays end) * 48)
  Phase: \(.phase // "unknown")
  Day: \(.currentDay // 0)"'

echo ""
echo "📈 Group Details:"
echo "$GROUPS" | jq '.groups[] | {
  id,
  name,
  recipe: (.crop // .recipe),
  zone: (.zone // .room),
  tray_count: (if .trays | type == "array" then (.trays | length) else .trays end),
  phase: .phase,
  day: .currentDay,
  has_schedule: (.schedule != null),
  has_targets: (.targets != null)
}'

echo ""
echo "---"
echo ""

# Additional Detail Endpoints
echo "=== ADDITIONAL FARM DETAILS ==="
echo ""

echo "1. Devices:"
curl -sS "$BASE/api/admin/farms/$FARM_ID/devices" \
  -H "Authorization: Bearer $TOKEN" | jq '{
    count: .count,
    has_devices: (.devices | length > 0)
  }'

echo ""
echo "2. Inventory:"
curl -sS "$BASE/api/admin/farms/$FARM_ID/inventory" \
  -H "Authorization: Bearer $TOKEN" | jq '{
    count: .count,
    has_inventory: (.inventory | length > 0)
  }'

echo ""
echo "3. Farm Config:"
curl -sS "$BASE/api/admin/farms/$FARM_ID/config" \
  -H "Authorization: Bearer $TOKEN" | jq '{
    has_config: . != null,
    keys: (if type == "object" then keys else [] end)
  }' 2>/dev/null || echo '{"error": "Not available"}'

echo ""
echo "---"
echo ""

echo "=== READINESS ASSESSMENT ==="
echo ""
echo "✅ = Data present and complete"
echo "⚠️  = Data present but incomplete"
echo "❌ = No data / Not working"
echo ""

# Calculate readiness scores
FARM_READY=$(echo "$FARM_SUMMARY" | jq 'if .farm.farm_id != null then "✅" else "❌" end' -r)
ROOMS_READY=$(if [ "$ROOM_COUNT" -gt 0 ]; then echo "✅"; else echo "❌"; fi)
ZONES_READY=$(if [ "$ZONE_COUNT" -gt 0 ]; then echo "✅"; else echo "❌"; fi)
GROUPS_READY=$(if [ "$GROUP_COUNT" -gt 0 ]; then echo "✅"; else echo "❌"; fi)

ZONE_TELEMETRY=$(echo "$ZONES" | jq '[.zones[].sensors.tempC.history | length] | add' 2>/dev/null || echo "0")
if [ "$ZONE_TELEMETRY" -gt 50 ]; then
  TELEMETRY_READY="✅"
else
  TELEMETRY_READY="⚠️"
fi

if [ "$DEVICE_COUNT" -gt 0 ]; then
  DEVICES_READY="✅"
else
  DEVICES_READY="⚠️"
fi

echo "Farm Summary:           $FARM_READY  (Basic info)"
echo "Room Details:           $ROOMS_READY  ($ROOM_COUNT room(s))"
echo "Zone Telemetry:         $ZONES_READY  ($ZONE_COUNT zone(s))"
echo "Telemetry History:      $TELEMETRY_READY  ($ZONE_TELEMETRY samples)"
echo "Group/Plantings:        $GROUPS_READY  ($GROUP_COUNT group(s))"
echo "Device Integration:     $DEVICES_READY  ($DEVICE_COUNT devices)"
echo ""

# Overall readiness
READY_COUNT=0
TOTAL_COUNT=6

[[ "$FARM_READY" == "✅" ]] && ((READY_COUNT++))
[[ "$ROOMS_READY" == "✅" ]] && ((READY_COUNT++))
[[ "$ZONES_READY" == "✅" ]] && ((READY_COUNT++))
[[ "$TELEMETRY_READY" == "✅" ]] && ((READY_COUNT++))
[[ "$GROUPS_READY" == "✅" ]] && ((READY_COUNT++))
[[ "$DEVICES_READY" == "✅" ]] && ((READY_COUNT++))

READINESS_PCT=$((READY_COUNT * 100 / TOTAL_COUNT))

echo "---"
echo "Overall Drill-Down Readiness: $READY_COUNT/$TOTAL_COUNT ($READINESS_PCT%)"
echo ""

if [ $READINESS_PCT -ge 80 ]; then
  echo "🎉 STATUS: PRODUCTION READY"
elif [ $READINESS_PCT -ge 60 ]; then
  echo "⚠️  STATUS: MOSTLY READY (minor gaps)"
else
  echo "❌ STATUS: NOT READY (major gaps)"
fi

echo ""
echo "=========================================="
echo "Test complete. Review results above."
