-- Migration 027: Producer Portal — self-service registration, approval, and product management
-- Supports multi-vendor wholesale expansion (Phase 1)

-- Producer applications: tracks the registration-to-approval pipeline
CREATE TABLE IF NOT EXISTS producer_applications (
  id SERIAL PRIMARY KEY,
  business_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(50),
  website VARCHAR(500),
  location JSONB DEFAULT '{}',
  certifications TEXT[] DEFAULT '{}',
  practices TEXT[] DEFAULT '{}',
  product_types TEXT[] DEFAULT '{}',
  description TEXT,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  reviewed_by VARCHAR(100),
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  farm_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Producer accounts: login credentials for approved producers
CREATE TABLE IF NOT EXISTS producer_accounts (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'owner',
  last_login TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_producer_applications_status ON producer_applications(status);
CREATE INDEX IF NOT EXISTS idx_producer_applications_email ON producer_applications(email);
CREATE INDEX IF NOT EXISTS idx_producer_accounts_farm_id ON producer_accounts(farm_id);
CREATE INDEX IF NOT EXISTS idx_producer_accounts_email ON producer_accounts(email);
