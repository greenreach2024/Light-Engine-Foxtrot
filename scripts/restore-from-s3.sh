#!/bin/bash
# ==========================================
# Restore Light Engine Data from S3 Backup
# ==========================================

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
PROFILE="${AWS_PROFILE:-light-engine}"
BACKUP_BUCKET="${AWS_S3_BACKUP_BUCKET:-light-engine-backups}"
BACKUP_FILE="${1:-latest.tar.gz}"
TEMP_DIR="/tmp/light-engine-restore-$(date +%s)"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Light Engine Restore from S3         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if backup file specified
if [ -z "$1" ]; then
    echo -e "${YELLOW}⚠️  No backup file specified, using latest${NC}"
    BACKUP_FILE="latest.tar.gz"
else
    # If date specified (e.g., 2025-12-07), find backup
    if [[ $1 =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        DATE_DIR="daily/$1"
        echo -e "${BLUE}🔍 Looking for backups on $1...${NC}"
        
        # List available backups for that date
        BACKUPS=$(aws s3 ls "s3://$BACKUP_BUCKET/$DATE_DIR/" --profile $PROFILE | grep ".tar.gz" | awk '{print $4}')
        
        if [ -z "$BACKUPS" ]; then
            echo -e "${RED}❌ No backups found for $1${NC}"
            exit 1
        fi
        
        echo -e "${YELLOW}Available backups:${NC}"
        echo "$BACKUPS" | nl
        
        # If multiple, ask user to select
        BACKUP_COUNT=$(echo "$BACKUPS" | wc -l | tr -d ' ')
        if [ "$BACKUP_COUNT" -gt 1 ]; then
            read -p "Select backup number (1-$BACKUP_COUNT): " BACKUP_NUM
            BACKUP_FILE=$(echo "$BACKUPS" | sed -n "${BACKUP_NUM}p")
        else
            BACKUP_FILE=$(echo "$BACKUPS")
        fi
        
        BACKUP_PATH="$DATE_DIR/$BACKUP_FILE"
    else
        BACKUP_PATH="$BACKUP_FILE"
    fi
fi

echo ""
echo "  Profile:       $PROFILE"
echo "  Backup Bucket: $BACKUP_BUCKET"
echo "  Backup File:   $BACKUP_PATH"
echo ""

# Warning
echo -e "${RED}⚠️  WARNING: This will overwrite existing data!${NC}"
read -p "Continue? (yes/NO) " -r
if [[ ! $REPLY =~ ^yes$ ]]; then
    echo "Aborted."
    exit 1
fi

# Create temp directory
mkdir -p $TEMP_DIR
cd $TEMP_DIR

# Download from S3
echo ""
echo -e "${BLUE}☁️  Downloading from S3...${NC}"
aws s3 cp "s3://$BACKUP_BUCKET/$BACKUP_PATH" . \
  --profile $PROFILE

# Extract archive
echo -e "${BLUE}📦 Extracting archive...${NC}"
tar -xzf $(basename $BACKUP_PATH)

# Restore data
echo -e "${BLUE}♻️  Restoring data...${NC}"
EXTRACT_DIR=$(ls -d light-engine-backup-* | head -1)

if [ -d "$EXTRACT_DIR/data" ]; then
    echo "  • Restoring public/data/"
    rm -rf public/data
    cp -r "$EXTRACT_DIR/data" public/
fi

if [ -f "$EXTRACT_DIR/.env.example" ]; then
    echo "  • Restoring .env.example"
    cp "$EXTRACT_DIR/.env.example" .
fi

# Cleanup
echo ""
echo -e "${BLUE}🧹 Cleaning up...${NC}"
cd -
rm -rf $TEMP_DIR

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Restore Complete!                  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}⚠️  Remember to restart the application:${NC}"
echo "  • Backend:  python3 -m backend"
echo "  • Frontend: node server-charlie.js"
