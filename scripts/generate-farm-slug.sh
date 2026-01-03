#!/bin/bash

# Generate farm_slug for existing farm in database
# This script adds farm slugs to the FARM-MJUE2BUO-1CBE farm

DB_HOST="light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com"
DB_USER="foxtrot_admin"
DB_NAME="light_engine_db"

echo "Fetching database password from Secrets Manager..."
DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id foxtrot/db-password --region us-east-1 --query SecretString --output text 2>/dev/null)

if [ -z "$DB_PASSWORD" ]; then
  echo "Error: Could not retrieve database password"
  exit 1
fi

echo "Generating farm_slug for existing farm..."

# Generate slug for "Green" farm → "green"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" <<EOF
-- Add farm_slug column if it doesn't exist
ALTER TABLE farms ADD COLUMN IF NOT EXISTS farm_slug VARCHAR(100) UNIQUE;

-- Create index
CREATE INDEX IF NOT EXISTS idx_farms_slug ON farms(farm_slug);

-- Update the existing farm with a slug
UPDATE farms 
SET farm_slug = lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'), '^-|-$', '', 'g'))
WHERE farm_id = 'FARM-MJUE2BUO-1CBE' AND farm_slug IS NULL;

-- Display the result
SELECT farm_id, name, farm_slug, email 
FROM farms 
WHERE farm_id = 'FARM-MJUE2BUO-1CBE';
EOF

echo "Farm slug generated successfully!"
echo "Farm store URL: https://green.greenreachgreens.com"
