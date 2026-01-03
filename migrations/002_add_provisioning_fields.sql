-- Migration: 002_add_provisioning_fields
-- Created: 2026-01-03
-- Description: Add POS instance, Online Store subdomain, and Central linking fields

-- Add provisioning fields to farms table
ALTER TABLE farms ADD COLUMN IF NOT EXISTS pos_instance_id VARCHAR(100);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS store_subdomain VARCHAR(100) UNIQUE;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS central_linked BOOLEAN DEFAULT false;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS central_linked_at TIMESTAMP;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS setup_completed BOOLEAN DEFAULT false;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMP;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS farm_size VARCHAR(50);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS crop_types JSONB;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS hardware_config JSONB;

-- Add index for subdomain lookups
CREATE INDEX IF NOT EXISTS idx_farms_store_subdomain ON farms(store_subdomain) WHERE store_subdomain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_farms_central_linked ON farms(central_linked);

-- Comment the columns
COMMENT ON COLUMN farms.pos_instance_id IS 'Unique POS system instance identifier (tenant-scoped)';
COMMENT ON COLUMN farms.store_subdomain IS 'Unique online store subdomain (e.g., my-farm.greenreach.store)';
COMMENT ON COLUMN farms.central_linked IS 'Whether farm is registered with GreenReach Central';
COMMENT ON COLUMN farms.central_linked_at IS 'Timestamp when farm was linked to Central';
COMMENT ON COLUMN farms.setup_completed IS 'Whether first-time setup wizard has been completed';
COMMENT ON COLUMN farms.setup_completed_at IS 'Timestamp when setup wizard was completed';
