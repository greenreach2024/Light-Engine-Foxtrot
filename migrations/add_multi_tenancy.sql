-- Multi-Tenant Database Migration
-- Adds tenant_id column to all tables for multi-tenancy support

-- Create tenants table
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  subdomain VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  tier VARCHAR(50) DEFAULT 'inventory-only',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on subdomain for fast lookups
CREATE INDEX idx_tenants_subdomain ON tenants(subdomain);
CREATE INDEX idx_tenants_active ON tenants(active);

-- Add tenant_id to existing tables
-- This is a template - adjust table names as needed

ALTER TABLE IF EXISTS crops ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS inventory ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS harvest_schedule ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS zones ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;

-- Create indexes on tenant_id for query performance
CREATE INDEX IF NOT EXISTS idx_crops_tenant ON crops(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON inventory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_harvest_schedule_tenant ON harvest_schedule(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_zones_tenant ON zones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_devices_tenant ON devices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- Create default tenant for existing data
INSERT INTO tenants (subdomain, name, contact_email, active, tier)
VALUES ('default', 'Default Farm', 'admin@example.com', TRUE, 'full')
ON CONFLICT (subdomain) DO NOTHING;

-- Update existing records to use default tenant
-- WARNING: Run these only if you have existing data
UPDATE crops SET tenant_id = (SELECT id FROM tenants WHERE subdomain = 'default') WHERE tenant_id IS NULL;
UPDATE inventory SET tenant_id = (SELECT id FROM tenants WHERE subdomain = 'default') WHERE tenant_id IS NULL;
UPDATE harvest_schedule SET tenant_id = (SELECT id FROM tenants WHERE subdomain = 'default') WHERE tenant_id IS NULL;
UPDATE orders SET tenant_id = (SELECT id FROM tenants WHERE subdomain = 'default') WHERE tenant_id IS NULL;
UPDATE customers SET tenant_id = (SELECT id FROM tenants WHERE subdomain = 'default') WHERE tenant_id IS NULL;
UPDATE zones SET tenant_id = (SELECT id FROM tenants WHERE subdomain = 'default') WHERE tenant_id IS NULL;
UPDATE devices SET tenant_id = (SELECT id FROM tenants WHERE subdomain = 'default') WHERE tenant_id IS NULL;
UPDATE users SET tenant_id = (SELECT id FROM tenants WHERE subdomain = 'default') WHERE tenant_id IS NULL;

-- Make tenant_id NOT NULL after backfilling
-- Uncomment after verifying all records have tenant_id
-- ALTER TABLE crops ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE inventory ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE harvest_schedule ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE orders ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE customers ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE zones ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE devices ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_inventory_tenant_crop ON inventory(tenant_id, crop_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_harvest_schedule_tenant_date ON harvest_schedule(tenant_id, scheduled_date);

-- Create function to automatically set updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for tenants table
DROP TRIGGER IF EXISTS update_tenants_updated_at ON tenants;
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add row-level security (optional, for extra isolation)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenants
  FOR ALL
  TO PUBLIC
  USING (id = current_setting('app.current_tenant_id', TRUE)::INTEGER);

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON crops TO app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON inventory TO app_user;
-- ... etc for all tables
