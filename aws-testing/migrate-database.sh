#!/bin/bash
# Database Migration Script - Edge PostgreSQL → AWS RDS
# Simple pg_dump/restore migration (no AWS DMS needed for testing)

set -euo pipefail

echo "=========================================="
echo "Database Migration - Edge to RDS"
echo "=========================================="
echo ""

# Load configuration
if [[ ! -f "aws-testing/config.env" ]]; then
    echo "❌ Configuration not found. Run setup-infrastructure.sh first."
    exit 1
fi

source aws-testing/config.env

# Get database password from Secrets Manager
echo "1️⃣  Retrieving RDS credentials..."
DB_SECRET=$(aws secretsmanager get-secret-value \
    --secret-id "foxtrot-test/database" \
    --region $AWS_REGION \
    --query SecretString \
    --output text)

RDS_PASSWORD=$(echo "$DB_SECRET" | jq -r .password)
echo "  ✓ Credentials retrieved"
echo ""

# Prompt for edge database connection
echo "2️⃣  Edge Database Connection"
read -p "Enter edge PostgreSQL host [192.168.2.42]: " EDGE_HOST
EDGE_HOST=${EDGE_HOST:-192.168.2.42}

read -p "Enter edge PostgreSQL port [5432]: " EDGE_PORT
EDGE_PORT=${EDGE_PORT:-5432}

read -p "Enter edge PostgreSQL username [lightengine]: " EDGE_USER
EDGE_USER=${EDGE_USER:-lightengine}

read -sp "Enter edge PostgreSQL password: " EDGE_PASSWORD
echo ""
echo ""

# Export edge database
BACKUP_FILE="/tmp/foxtrot_backup_$(date +%Y%m%d_%H%M%S).sql"
echo "3️⃣  Exporting edge database..."
PGPASSWORD="$EDGE_PASSWORD" pg_dump \
    -h $EDGE_HOST \
    -p $EDGE_PORT \
    -U $EDGE_USER \
    -d lightengine \
    --no-owner \
    --no-acl \
    -f "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "  ✓ Backup created: $BACKUP_FILE ($BACKUP_SIZE)"
echo ""

# Create database on RDS if needed
echo "4️⃣  Preparing RDS database..."
PGPASSWORD="$RDS_PASSWORD" psql \
    -h $RDS_ENDPOINT \
    -U foxtrot \
    -d postgres \
    -c "CREATE DATABASE lightengine;" 2>/dev/null || echo "  Database already exists"

# Run init script to create extensions
if [[ -f "scripts/init-db.sql" ]]; then
    echo "  Running init-db.sql..."
    PGPASSWORD="$RDS_PASSWORD" psql \
        -h $RDS_ENDPOINT \
        -U foxtrot \
        -d lightengine \
        -f scripts/init-db.sql > /dev/null
fi
echo "  ✓ Database prepared"
echo ""

# Import to RDS
echo "5️⃣  Importing to RDS..."
echo "  ⚠️  This may take several minutes..."
PGPASSWORD="$RDS_PASSWORD" psql \
    -h $RDS_ENDPOINT \
    -U foxtrot \
    -d lightengine \
    -f "$BACKUP_FILE" > /tmp/restore.log 2>&1

if [[ $? -eq 0 ]]; then
    echo "  ✓ Import completed"
else
    echo "  ⚠️  Import completed with warnings (see /tmp/restore.log)"
fi
echo ""

# Verify migration
echo "6️⃣  Verifying migration..."

# Count rows in key tables
EDGE_COUNTS=$(PGPASSWORD="$EDGE_PASSWORD" psql \
    -h $EDGE_HOST \
    -p $EDGE_PORT \
    -U $EDGE_USER \
    -d lightengine \
    -t -c "
        SELECT 'farms', COUNT(*) FROM farms WHERE true
        UNION ALL
        SELECT 'wholesale_buyers', COUNT(*) FROM wholesale_buyers WHERE true
        UNION ALL
        SELECT 'wholesale_orders', COUNT(*) FROM wholesale_orders WHERE true
    " 2>/dev/null || echo "")

RDS_COUNTS=$(PGPASSWORD="$RDS_PASSWORD" psql \
    -h $RDS_ENDPOINT \
    -U foxtrot \
    -d lightengine \
    -t -c "
        SELECT 'farms', COUNT(*) FROM farms WHERE true
        UNION ALL
        SELECT 'wholesale_buyers', COUNT(*) FROM wholesale_buyers WHERE true
        UNION ALL
        SELECT 'wholesale_orders', COUNT(*) FROM wholesale_orders WHERE true
    " 2>/dev/null || echo "")

echo ""
echo "  Row Count Comparison:"
echo "  ====================="
echo "  Table              | Edge | RDS"
echo "  -------------------|------|-----"

if [[ -n "$EDGE_COUNTS" && -n "$RDS_COUNTS" ]]; then
    while IFS='|' read -r table edge_count; do
        rds_count=$(echo "$RDS_COUNTS" | grep "$table" | awk '{print $2}')
        edge_count=$(echo "$edge_count" | xargs)
        rds_count=$(echo "$rds_count" | xargs)
        printf "  %-18s | %4s | %4s" "$table" "$edge_count" "$rds_count"
        if [[ "$edge_count" == "$rds_count" ]]; then
            echo " ✓"
        else
            echo " ⚠️"
        fi
    done <<< "$EDGE_COUNTS"
else
    echo "  (Unable to compare - check tables exist)"
fi
echo ""

# Test connection string
echo "7️⃣  Generating connection string..."
CONNECTION_STRING="postgresql://foxtrot:${RDS_PASSWORD}@${RDS_ENDPOINT}:5432/lightengine"
echo ""
echo "  Connection string for ECS:"
echo "  DATABASE_URL=$CONNECTION_STRING"
echo ""

# Cleanup prompt
read -p "Delete backup file ($BACKUP_FILE)? [y/N]: " DELETE_BACKUP
if [[ "$DELETE_BACKUP" =~ ^[Yy]$ ]]; then
    rm -f "$BACKUP_FILE"
    echo "  Backup deleted"
else
    echo "  Backup kept: $BACKUP_FILE"
fi
echo ""

echo "=========================================="
echo "✅ Database Migration Complete!"
echo "=========================================="
echo ""
echo "RDS Endpoint: $RDS_ENDPOINT"
echo "Database: lightengine"
echo "Username: foxtrot"
echo "Password: (in Secrets Manager: foxtrot-test/database)"
echo ""
echo "Next step: Run ./aws-testing/deploy-ecs.sh"
echo "=========================================="
