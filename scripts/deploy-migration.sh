#!/bin/bash
# Deploy database migration to RDS from EB instance

set -e

echo "=== Database Migration Deployment ==="
echo "Target: light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com"
echo ""

# Get DB credentials from environment
DB_HOST="${DB_HOST:-light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-lightengine}"
DB_USER="${DB_USER:-lightengine}"
DB_PASSWORD="${DB_PASSWORD:-LePphcacxDs35ciLLhnkhaXr7}"

# Set PGPASSWORD for non-interactive execution
export PGPASSWORD="$DB_PASSWORD"

echo "Step 1: Check current tables..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "\dt" || echo "No tables yet or connection failed"

echo ""
echo "Step 2: Running migration 001_create_farms_users.sql..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f /var/app/current/migrations/001_create_farms_users.sql

echo ""
echo "Step 3: Verify tables created..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "\dt"

echo ""
echo "Step 4: Test farm table..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT count(*) FROM farms"

echo ""
echo "Step 5: Test users table..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT count(*) FROM users"

echo ""
echo "✅ Migration completed successfully!"

unset PGPASSWORD
