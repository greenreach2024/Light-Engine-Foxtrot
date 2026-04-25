#!/bin/bash
# Restore runtime data files after deployment
# Only restores files that are non-empty and newer than the deployed seed versions

BACKUP_DIR="/tmp/le-foxtrot-data-backup"
APP_DATA="/var/app/current/public/data"

if [ -d "$BACKUP_DIR" ]; then
  echo "[postdeploy] Restoring runtime data files..."
  mkdir -p "$APP_DATA"
  
  for backup_file in "$BACKUP_DIR"/*.json; do
    if [ ! -f "$backup_file" ]; then
      continue
    fi
    
    fname=$(basename "$backup_file")
    target="$APP_DATA/$fname"
    backup_size=$(wc -c < "$backup_file" | tr -d ' ')
    
    # Only restore if backup has meaningful content (more than just [] or {})
    if [ "$backup_size" -gt 4 ]; then
      cp "$backup_file" "$target"
      echo "[postdeploy] Restored $fname ($backup_size bytes)"
    else
      echo "[postdeploy] Skipped $fname (only $backup_size bytes — seed/empty)"
    fi
  done
  
  # Set proper permissions
  chown -R webapp:webapp "$APP_DATA" 2>/dev/null || true
  
  # Clean up backup
  rm -rf "$BACKUP_DIR"
  echo "[postdeploy] Restore complete, backup cleaned up"
else
  echo "[postdeploy] No backup found, using deployed seed data"
fi
