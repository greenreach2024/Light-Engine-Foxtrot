#!/bin/bash
# Backup runtime data files before deployment overwrites them
# These files are written by the app at runtime but live in the deployment directory

BACKUP_DIR="/tmp/le-foxtrot-data-backup"
APP_DATA="/var/app/current/public/data"

# Only backup if the app was previously deployed
if [ -d "$APP_DATA" ]; then
  echo "[predeploy] Backing up runtime data files..."
  mkdir -p "$BACKUP_DIR"
  
  # List of runtime data files that should survive deployments
  RUNTIME_FILES=(
    "iot-devices.json"
    "farm.json"
    "rooms.json"
    "env.json"
    "room-map.json"
    "groups.json"
    "switchbot-devices.json"
    "schedules.json"
    "plans.json"
    "controller.json"
    "calibration.json"
  )
  
  for f in "${RUNTIME_FILES[@]}"; do
    if [ -f "$APP_DATA/$f" ]; then
      cp "$APP_DATA/$f" "$BACKUP_DIR/$f"
      echo "[predeploy] Backed up $f ($(wc -c < "$APP_DATA/$f") bytes)"
    fi
  done
  
  # Also backup room-map-*.json files (dynamic per-room maps)
  for rmf in "$APP_DATA"/room-map-*.json; do
    if [ -f "$rmf" ]; then
      cp "$rmf" "$BACKUP_DIR/$(basename "$rmf")"
      echo "[predeploy] Backed up $(basename "$rmf")"
    fi
  done
  
  echo "[predeploy] Backup complete to $BACKUP_DIR"
else
  echo "[predeploy] No previous deployment found, skipping backup"
fi
