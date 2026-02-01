#!/bin/bash
# backup-edge-data.sh - Edge device data backup to Central
# Purpose: Daily automated backup of Edge device critical data to Central
# Usage: Run via cron - 0 2 * * * /path/to/backup-edge-data.sh

set -euo pipefail

# Configuration
EDGE_DIR="/home/greenreach/Light-Engine-Foxtrot"
LOG_FILE="${EDGE_DIR}/logs/edge-backup.log"

# Create logs directory if it doesn't exist
mkdir -p "${EDGE_DIR}/logs"

# Load environment variables
if [ -f "${EDGE_DIR}/.env" ]; then
  source <(grep -E '^(FARM_ID|GREENREACH_API_KEY|GREENREACH_CENTRAL_URL)=' "${EDGE_DIR}/.env")
fi

# Fallback to edge-config.json if .env missing values
if [ -z "${FARM_ID:-}" ]; then
  FARM_ID=$(node -p "require('${EDGE_DIR}/config/edge-config.json').farmId" 2>/dev/null || echo "")
fi
if [ -z "${GREENREACH_API_KEY:-}" ]; then
  GREENREACH_API_KEY=$(node -p "require('${EDGE_DIR}/config/edge-config.json').apiKey" 2>/dev/null || echo "")
fi
if [ -z "${GREENREACH_CENTRAL_URL:-}" ]; then
  GREENREACH_CENTRAL_URL=$(node -p "require('${EDGE_DIR}/config/edge-config.json').centralApiUrl" 2>/dev/null || echo "https://greenreachgreens.com")
fi

# Validate required values
if [ -z "${FARM_ID}" ] || [ -z "${GREENREACH_API_KEY}" ] || [ -z "${GREENREACH_CENTRAL_URL}" ]; then
  echo "[$(date)] ERROR: Missing required configuration (FARM_ID, API_KEY, or CENTRAL_URL)" | tee -a "${LOG_FILE}"
  exit 1
fi

echo "[$(date)] Starting Edge device backup - Farm: ${FARM_ID}" | tee -a "${LOG_FILE}"

# Function to sync data file to Central
sync_data() {
  local endpoint=$1
  local file_path=$2
  local data_type=$3
  
  if [ ! -f "${file_path}" ]; then
    echo "[$(date)] WARNING: ${data_type} file not found: ${file_path}" | tee -a "${LOG_FILE}"
    return 1
  fi
  
  echo "[$(date)] Backing up ${data_type}..." | tee -a "${LOG_FILE}"
  
  HTTP_CODE=$(curl -sS -w "%{http_code}" -o /tmp/backup-response.txt \
    -X POST "${GREENREACH_CENTRAL_URL}${endpoint}" \
    -H "X-API-Key: ${GREENREACH_API_KEY}" \
    -H "X-Farm-ID: ${FARM_ID}" \
    -H "Content-Type: application/json" \
    -d @"${file_path}")
  
  if [ "${HTTP_CODE}" -eq 200 ] || [ "${HTTP_CODE}" -eq 201 ]; then
    echo "[$(date)] ✅ ${data_type} backup successful (HTTP ${HTTP_CODE})" | tee -a "${LOG_FILE}"
    return 0
  else
    echo "[$(date)] ❌ ${data_type} backup failed (HTTP ${HTTP_CODE})" | tee -a "${LOG_FILE}"
    cat /tmp/backup-response.txt | tee -a "${LOG_FILE}"
    return 1
  fi
}

# Backup critical data files
BACKUP_SUCCESS=0
BACKUP_FAILURE=0

if sync_data "/api/sync/groups" "${EDGE_DIR}/public/data/groups.json" "groups"; then
  ((BACKUP_SUCCESS++))
else
  ((BACKUP_FAILURE++))
fi

if sync_data "/api/sync/rooms" "${EDGE_DIR}/public/data/rooms.json" "rooms"; then
  ((BACKUP_SUCCESS++))
else
  ((BACKUP_FAILURE++))
fi

if sync_data "/api/sync/schedules" "${EDGE_DIR}/public/data/schedules.json" "schedules"; then
  ((BACKUP_SUCCESS++))
else
  ((BACKUP_FAILURE++))
fi

# Backup edge configuration
if [ -f "${EDGE_DIR}/config/edge-config.json" ]; then
  if sync_data "/api/sync/config" "${EDGE_DIR}/config/edge-config.json" "config"; then
    ((BACKUP_SUCCESS++))
  else
    ((BACKUP_FAILURE++))
  fi
fi

# Summary
echo "[$(date)] Backup complete: ${BACKUP_SUCCESS} succeeded, ${BACKUP_FAILURE} failed" | tee -a "${LOG_FILE}"

if [ ${BACKUP_FAILURE} -gt 0 ]; then
  exit 1
fi

exit 0
