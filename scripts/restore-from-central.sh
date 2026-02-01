#!/bin/bash
# restore-from-central.sh - Restore Edge device data from Central backup
# Purpose: Recover Edge device data after hardware failure or data loss
# Usage: ./restore-from-central.sh [farmId]

set -euo pipefail

EDGE_DIR="/home/greenreach/Light-Engine-Foxtrot"
BACKUP_DIR="${EDGE_DIR}/backups/$(date +%Y%m%d-%H%M%S)"

# Get farmId from argument or config
FARM_ID=${1:-$(node -p "require('${EDGE_DIR}/config/edge-config.json').farmId" 2>/dev/null || echo "")}

if [ -z "${FARM_ID}" ]; then
  echo "ERROR: No farm ID provided. Usage: ./restore-from-central.sh [farmId]"
  exit 1
fi

# Load API configuration
if [ -f "${EDGE_DIR}/.env" ]; then
  source <(grep -E '^(GREENREACH_API_KEY|GREENREACH_CENTRAL_URL)=' "${EDGE_DIR}/.env")
fi

GREENREACH_API_KEY=${GREENREACH_API_KEY:-$(node -p "require('${EDGE_DIR}/config/edge-config.json').apiKey" 2>/dev/null || echo "")}
GREENREACH_CENTRAL_URL=${GREENREACH_CENTRAL_URL:-$(node -p "require('${EDGE_DIR}/config/edge-config.json').centralApiUrl" 2>/dev/null || echo "https://greenreachgreens.com")}

if [ -z "${GREENREACH_API_KEY}" ] || [ -z "${GREENREACH_CENTRAL_URL}" ]; then
  echo "ERROR: Missing API_KEY or CENTRAL_URL in configuration"
  exit 1
fi

echo "========================================="
echo "Edge Device Data Recovery"
echo "========================================="
echo "Farm ID: ${FARM_ID}"
echo "Central: ${GREENREACH_CENTRAL_URL}"
echo ""

# Create backup directory for current data (before restore)
mkdir -p "${BACKUP_DIR}"
echo "Backing up current data to: ${BACKUP_DIR}"

for file in groups.json rooms.json schedules.json; do
  if [ -f "${EDGE_DIR}/public/data/${file}" ]; then
    cp "${EDGE_DIR}/public/data/${file}" "${BACKUP_DIR}/"
    echo "  ✓ Backed up ${file}"
  fi
done

# Restore data from Central
echo ""
echo "Fetching backup data from Central..."

HTTP_CODE=$(curl -sS -w "%{http_code}" -o /tmp/restore-data.json \
  -X POST \
  -H "X-API-Key: ${GREENREACH_API_KEY}" \
  -H "X-Farm-ID: ${FARM_ID}" \
  "${GREENREACH_CENTRAL_URL}/api/sync/restore/${FARM_ID}")

if [ "${HTTP_CODE}" -ne 200 ]; then
  echo "ERROR: Failed to fetch data from Central (HTTP ${HTTP_CODE})"
  cat /tmp/restore-data.json
  exit 1
fi

# Validate response has data
GROUP_COUNT=$(node -p "JSON.parse(require('fs').readFileSync('/tmp/restore-data.json', 'utf8')).data?.groups?.length || 0")

if [ "${GROUP_COUNT}" -eq 0 ]; then
  echo "WARNING: No groups found in Central backup for farm ${FARM_ID}"
  echo "This farm may not have synced data to Central yet."
  echo "Current data preserved in: ${BACKUP_DIR}"
  exit 1
fi

echo "✓ Found ${GROUP_COUNT} groups in Central backup"

# Extract and write data files
node -e "
const response = JSON.parse(require('fs').readFileSync('/tmp/restore-data.json', 'utf8'));
const data = response.data;
const fs = require('fs');

if (data.groups && data.groups.length > 0) {
  fs.writeFileSync('${EDGE_DIR}/public/data/groups.json', JSON.stringify({
    groups: data.groups,
    metadata: { source: 'central_restore', lastUpdated: new Date().toISOString() }
  }, null, 2));
  console.log('  ✓ Restored groups.json');
}

if (data.rooms && data.rooms.length > 0) {
  fs.writeFileSync('${EDGE_DIR}/public/data/rooms.json', JSON.stringify({
    rooms: data.rooms,
    metadata: { source: 'central_restore', lastUpdated: new Date().toISOString() }
  }, null, 2));
  console.log('  ✓ Restored rooms.json');
}

if (data.schedules && data.schedules.length > 0) {
  fs.writeFileSync('${EDGE_DIR}/public/data/schedules.json', JSON.stringify({
    schedules: data.schedules,
    metadata: { source: 'central_restore', lastUpdated: new Date().toISOString() }
  }, null, 2));
  console.log('  ✓ Restored schedules.json');
}
"

echo ""
echo "========================================="
echo "Restore Complete!"
echo "========================================="
echo "Data restored from Central backup"
echo "Previous data saved to: ${BACKUP_DIR}"
echo ""
echo "Next steps:"
echo "  1. Restart Edge server: pm2 restart lightengine-node"
echo "  2. Verify data: curl http://localhost:8091/data/groups.json"
echo ""
