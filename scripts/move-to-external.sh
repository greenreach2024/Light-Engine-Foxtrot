#!/bin/bash
# Move large files to external drive
# Usage: ./move-to-external.sh /Volumes/YourExternalDrive

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 /Volumes/ExternalDriveName"
  echo ""
  echo "Available volumes:"
  ls -1 /Volumes/
  exit 1
fi

EXTERNAL="$1"
if [ ! -d "$EXTERNAL" ]; then
  echo "Error: $EXTERNAL not found"
  echo "Available volumes:"
  ls -1 /Volumes/
  exit 1
fi

BACKUP_DIR="$EXTERNAL/light-engine-backup"
mkdir -p "$BACKUP_DIR"

echo "Creating backup directory: $BACKUP_DIR"
echo ""

# 1. Move esp32-firmware (41MB)
echo "Moving esp32-firmware..."
if [ -d "esp32-firmware" ]; then
  rsync -av --progress esp32-firmware/ "$BACKUP_DIR/esp32-firmware/"
  echo "✓ Copied esp32-firmware"
  echo "  Verifying..."
  if diff -r esp32-firmware/ "$BACKUP_DIR/esp32-firmware/" > /dev/null 2>&1; then
    rm -rf esp32-firmware/
    ln -s "$BACKUP_DIR/esp32-firmware" esp32-firmware
    echo "✓ Removed local copy, created symlink"
  else
    echo "✗ Verification failed, keeping local copy"
  fi
else
  echo "  esp32-firmware not found, skipping"
fi
echo ""

# 2. Move Elastic Beanstalk app_versions (190MB)
echo "Moving Elastic Beanstalk app_versions..."
if [ -d "greenreach-central/.elasticbeanstalk/app_versions" ]; then
  rsync -av --progress greenreach-central/.elasticbeanstalk/app_versions/ "$BACKUP_DIR/app_versions/"
  echo "✓ Copied app_versions"
  echo "  Verifying..."
  if diff -r greenreach-central/.elasticbeanstalk/app_versions/ "$BACKUP_DIR/app_versions/" > /dev/null 2>&1; then
    rm -rf greenreach-central/.elasticbeanstalk/app_versions/*
    ln -s "$BACKUP_DIR/app_versions" greenreach-central/.elasticbeanstalk/app_versions-external
    echo "✓ Cleared local app_versions, created symlink"
  else
    echo "✗ Verification failed, keeping local copy"
  fi
else
  echo "  app_versions not found, skipping"
fi
echo ""

# 3. Create git mirror backup
echo "Creating git mirror backup..."
if [ ! -d "$BACKUP_DIR/light-engine-foxtrot.git" ]; then
  git clone --mirror . "$BACKUP_DIR/light-engine-foxtrot.git"
  echo "✓ Created git mirror backup"
else
  echo "  Updating existing git mirror..."
  cd "$BACKUP_DIR/light-engine-foxtrot.git"
  git fetch --all
  cd -
  echo "✓ Updated git mirror backup"
fi
echo ""

echo "========================================="
echo "Backup complete!"
echo "Location: $BACKUP_DIR"
echo ""
echo "Space freed:"
du -sh "$BACKUP_DIR"
echo ""
echo "Current disk usage:"
df -h . | tail -1
