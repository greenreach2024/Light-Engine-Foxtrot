-- Migration: Add purchase and onboarding fields to farms table
-- Date: 2025-01-XX
-- Purpose: Support automated farm account creation from marketing purchase flow

-- Add API keys and auth fields
ALTER TABLE farms ADD COLUMN IF NOT EXISTS api_key VARCHAR(255) UNIQUE;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS api_secret VARCHAR(255);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS jwt_secret VARCHAR(255);

-- Add payment tracking
ALTER TABLE farms ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20) CHECK (plan_type IN ('cloud', 'edge'));
ALTER TABLE farms ADD COLUMN IF NOT EXISTS square_customer_id VARCHAR(255);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS square_payment_id VARCHAR(255);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS square_order_id VARCHAR(255);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS square_amount INTEGER; -- cents

-- Add contact fields (if not already exist)
ALTER TABLE farms ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE farms ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

-- Create index for fast API key lookups
CREATE INDEX IF NOT EXISTS idx_farms_api_key ON farms(api_key);
CREATE INDEX IF NOT EXISTS idx_farms_email ON farms(email);

-- Create users table if doesn't exist
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(20) REFERENCES farms(farm_id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'admin' CHECK (role IN ('admin', 'manager', 'operator', 'viewer')),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_farm_id ON users(farm_id);

-- Create sessions table for auth (if doesn't exist)
CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);

-- Add comment explaining new fields
COMMENT ON COLUMN farms.api_key IS 'Public API key for programmatic access';
COMMENT ON COLUMN farms.api_secret IS 'Secret API key (hashed)';
COMMENT ON COLUMN farms.jwt_secret IS 'JWT signing secret for this farm';
COMMENT ON COLUMN farms.plan_type IS 'Subscription plan: cloud (monthly) or edge (one-time)';
COMMENT ON COLUMN farms.square_customer_id IS 'Square customer ID for billing';
COMMENT ON COLUMN farms.square_payment_id IS 'Square payment ID';
COMMENT ON COLUMN farms.square_order_id IS 'Square order ID';
COMMENT ON COLUMN farms.square_amount IS 'Payment amount in cents';
