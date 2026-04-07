#!/bin/bash
# GreenReach Migration - Phase 3: Database Migration
# Dump from AWS RDS PostgreSQL, restore to AlloyDB
#
# Run this from a machine that can reach BOTH the RDS instance
# and the AlloyDB instance (Cloud Shell with VPC connector, or
# a temporary GCE VM in the greenreach-vpc).
#
# AlloyDB has no public IP -- you need VPC access.

set -euo pipefail

# ============================================================
# CONFIGURATION
# ============================================================
# Source: AWS RDS
# These values come from the EB environment (RDS_HOSTNAME, etc.)
# Check greenreach-central/.env or EB console for actual values.
RDS_HOST=""          # e.g., greenreach-central.xxxxx.us-east-1.rds.amazonaws.com
RDS_PORT="5432"
RDS_DB="greenreach_central"
RDS_USER=""          # e.g., postgres
RDS_PASSWORD=""      # From EB env vars

# Target: AlloyDB
ALLOYDB_IP=""        # From setup-infrastructure.sh output
ALLOYDB_DB="greenreach_central"
ALLOYDB_USER="postgres"
ALLOYDB_PASSWORD=""  # Same as ALLOYDB_PASSWORD in setup script

DUMP_FILE="greenreach_central_$(date +%Y%m%d_%H%M%S).dump"

echo "============================================"
echo "Database Migration: RDS -> AlloyDB"
echo "============================================"

# ============================================================
# Validate
# ============================================================
if [ -z "$RDS_HOST" ] || [ -z "$ALLOYDB_IP" ]; then
  echo "ERROR: Set RDS_HOST and ALLOYDB_IP before running."
  exit 1
fi

# ============================================================
# Step 1: Dump from RDS
# ============================================================
echo ""
echo ">>> Step 1: Dumping from RDS..."
echo "  Source: ${RDS_HOST}:${RDS_PORT}/${RDS_DB}"

PGPASSWORD="${RDS_PASSWORD}" pg_dump \
  -h "${RDS_HOST}" \
  -p "${RDS_PORT}" \
  -U "${RDS_USER}" \
  -d "${RDS_DB}" \
  -Fc \
  --no-owner \
  --no-privileges \
  -f "${DUMP_FILE}"

echo "  Dump complete: ${DUMP_FILE} ($(du -h ${DUMP_FILE} | cut -f1))"

# ============================================================
# Step 2: Create database on AlloyDB
# ============================================================
echo ""
echo ">>> Step 2: Creating database on AlloyDB..."

PGPASSWORD="${ALLOYDB_PASSWORD}" psql \
  -h "${ALLOYDB_IP}" \
  -U "${ALLOYDB_USER}" \
  -d postgres \
  -c "CREATE DATABASE ${ALLOYDB_DB};" 2>/dev/null || echo "  Database already exists"

# Enable required extensions
PGPASSWORD="${ALLOYDB_PASSWORD}" psql \
  -h "${ALLOYDB_IP}" \
  -U "${ALLOYDB_USER}" \
  -d "${ALLOYDB_DB}" \
  -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS uuid-ossp;"

echo "  Database ready."

# ============================================================
# Step 3: Restore to AlloyDB
# ============================================================
echo ""
echo ">>> Step 3: Restoring to AlloyDB..."
echo "  Target: ${ALLOYDB_IP}:5432/${ALLOYDB_DB}"

PGPASSWORD="${ALLOYDB_PASSWORD}" pg_restore \
  -h "${ALLOYDB_IP}" \
  -U "${ALLOYDB_USER}" \
  -d "${ALLOYDB_DB}" \
  --no-owner \
  --no-privileges \
  --if-exists \
  --clean \
  "${DUMP_FILE}"

echo "  Restore complete."

# ============================================================
# Step 4: Verify
# ============================================================
echo ""
echo ">>> Step 4: Verifying..."

PGPASSWORD="${ALLOYDB_PASSWORD}" psql \
  -h "${ALLOYDB_IP}" \
  -U "${ALLOYDB_USER}" \
  -d "${ALLOYDB_DB}" \
  -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" \
  -c "SELECT COUNT(*) AS farm_count FROM farms;" \
  -c "SELECT COUNT(*) AS user_count FROM users;"

echo ""
echo "============================================"
echo "Database migration complete."
echo "Dump file retained at: ${DUMP_FILE}"
echo "============================================"
