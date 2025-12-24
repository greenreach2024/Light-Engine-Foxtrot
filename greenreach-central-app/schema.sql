-- GreenReach Central Database Schema
-- PostgreSQL schema for monitoring and managing deployed farms

-- Farms table (central registry)
CREATE TABLE IF NOT EXISTS farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subdomain VARCHAR(63) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255),
  tier VARCHAR(50) NOT NULL DEFAULT 'inventory-only',
  deployment_mode VARCHAR(50) NOT NULL DEFAULT 'cloud',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  CONSTRAINT farms_tier_check CHECK (tier IN ('inventory-only', 'full', 'enterprise')),
  CONSTRAINT farms_deployment_check CHECK (deployment_mode IN ('cloud', 'edge', 'desktop'))
);

-- Licenses table
CREATE TABLE IF NOT EXISTS licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  hardware_fingerprint VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  grace_period_ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  update_channel VARCHAR(50) NOT NULL DEFAULT 'stable',
  current_version VARCHAR(50),
  last_update_check_at TIMESTAMPTZ,
  features JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT licenses_status_check CHECK (status IN ('active', 'expired', 'suspended', 'revoked')),
  CONSTRAINT licenses_channel_check CHECK (update_channel IN ('stable', 'beta', 'alpha'))
);

-- Farm activity log
CREATE TABLE IF NOT EXISTS farm_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Farm logs (errors, warnings, etc.)
CREATE TABLE IF NOT EXISTS farm_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  level VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT farm_logs_level_check CHECK (level IN ('error', 'warn', 'info', 'debug'))
);

-- Update rollouts
CREATE TABLE IF NOT EXISTS update_rollouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(50) NOT NULL UNIQUE,
  channel VARCHAR(50) NOT NULL DEFAULT 'stable',
  rollout_percentage INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT rollout_percentage_check CHECK (rollout_percentage BETWEEN 0 AND 100),
  CONSTRAINT rollout_channel_check CHECK (channel IN ('stable', 'beta', 'alpha'))
);

-- Activation codes
CREATE TABLE IF NOT EXISTS activation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  code_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API keys for enterprise farms
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  last_used_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_farms_subdomain ON farms(subdomain);
CREATE INDEX IF NOT EXISTS idx_farms_active ON farms(active);
CREATE INDEX IF NOT EXISTS idx_farms_tier ON farms(tier);
CREATE INDEX IF NOT EXISTS idx_farms_last_seen ON farms(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_licenses_farm_id ON licenses(farm_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_expires_at ON licenses(expires_at);

CREATE INDEX IF NOT EXISTS idx_farm_activity_farm_id ON farm_activity(farm_id);
CREATE INDEX IF NOT EXISTS idx_farm_activity_event_type ON farm_activity(event_type);
CREATE INDEX IF NOT EXISTS idx_farm_activity_created_at ON farm_activity(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_farm_logs_farm_id ON farm_logs(farm_id);
CREATE INDEX IF NOT EXISTS idx_farm_logs_level ON farm_logs(level);
CREATE INDEX IF NOT EXISTS idx_farm_logs_created_at ON farm_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activation_codes_code_hash ON activation_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_activation_codes_farm_id ON activation_codes(farm_id);
CREATE INDEX IF NOT EXISTS idx_activation_codes_used ON activation_codes(used);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_farm_id ON api_keys(farm_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_farms_updated_at
  BEFORE UPDATE ON farms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_licenses_updated_at
  BEFORE UPDATE ON licenses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rollouts_updated_at
  BEFORE UPDATE ON update_rollouts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Sample data for development
INSERT INTO farms (subdomain, name, contact_email, tier, deployment_mode, last_seen_at)
VALUES
  ('butterhead', 'Butterhead Greens Farm', 'contact@butterhead.farm', 'inventory-only', 'cloud', NOW() - INTERVAL '2 minutes'),
  ('oakridge', 'Oak Ridge Urban Farm', 'admin@oakridge.farm', 'full', 'edge', NOW() - INTERVAL '1 hour'),
  ('sunset', 'Sunset Valley Organics', 'info@sunsetvalley.com', 'enterprise', 'cloud', NOW() - INTERVAL '15 minutes')
ON CONFLICT (subdomain) DO NOTHING;
