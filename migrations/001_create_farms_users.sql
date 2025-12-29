-- Light Engine Foxtrot Database Schema
-- Migration: 001_create_farms_users
-- Created: 2025-12-29
-- Description: Initial schema for farms, users, and rooms tables

-- Enable UUID extension if needed (for future use)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- FARMS TABLE
-- ============================================================================
-- Core table for farm accounts created through purchase flow
-- Each farm has unique API credentials and payment tracking

CREATE TABLE IF NOT EXISTS farms (
  farm_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  contact_name VARCHAR(255) NOT NULL,
  plan_type VARCHAR(50) NOT NULL CHECK (plan_type IN ('cloud', 'edge')),
  
  -- API Credentials (generated during purchase)
  api_key VARCHAR(255) NOT NULL UNIQUE,
  api_secret VARCHAR(255) NOT NULL,
  jwt_secret VARCHAR(255) NOT NULL,
  
  -- Payment Info (Square integration)
  square_payment_id VARCHAR(255),
  square_amount INTEGER, -- in cents
  
  -- Account Status
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
  
  -- Metadata (optional fields for future use)
  timezone VARCHAR(100) DEFAULT 'America/Toronto',
  business_hours JSONB,
  certifications JSONB,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for farms table
CREATE INDEX IF NOT EXISTS idx_farms_email ON farms(email);
CREATE INDEX IF NOT EXISTS idx_farms_status ON farms(status);
CREATE INDEX IF NOT EXISTS idx_farms_created_at ON farms(created_at);

-- ============================================================================
-- USERS TABLE
-- ============================================================================
-- User accounts for accessing farm dashboards
-- Primary user created automatically during purchase flow
-- Additional users can be added later

CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  farm_id VARCHAR(50) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
  
  -- Authentication
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL, -- bcrypt hashed
  
  -- Profile
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'admin' CHECK (role IN ('admin', 'manager', 'operator', 'viewer')),
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  email_verified BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_farm_id ON users(farm_id);
CREATE INDEX IF NOT EXISTS idx_users_farm_email ON users(farm_id, email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- ============================================================================
-- ROOMS TABLE
-- ============================================================================
-- Grow rooms/zones configured during first-time setup wizard
-- Used for environmental monitoring and crop management

CREATE TABLE IF NOT EXISTS rooms (
  room_id SERIAL PRIMARY KEY,
  farm_id VARCHAR(50) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
  
  -- Room Info
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50), -- e.g., 'vegetation', 'flowering', 'drying', 'storage'
  capacity INTEGER, -- number of plants or trays
  
  -- Metadata
  description TEXT,
  configuration JSONB, -- flexible storage for room-specific settings
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for rooms table
CREATE INDEX IF NOT EXISTS idx_rooms_farm_id ON rooms(farm_id);
CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(type);

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================
-- Automatically update the updated_at timestamp on record changes

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to farms table
DROP TRIGGER IF EXISTS update_farms_updated_at ON farms;
CREATE TRIGGER update_farms_updated_at
  BEFORE UPDATE ON farms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to users table
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to rooms table
DROP TRIGGER IF EXISTS update_rooms_updated_at ON rooms;
CREATE TRIGGER update_rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE farms IS 'Core farm accounts created through purchase flow';
COMMENT ON TABLE users IS 'User accounts with authentication for accessing farm dashboards';
COMMENT ON TABLE rooms IS 'Grow rooms/zones configured during first-time setup';

COMMENT ON COLUMN farms.farm_id IS 'Unique identifier, format: farm_XXXXXXXXXXXX';
COMMENT ON COLUMN farms.api_key IS 'API key for device authentication';
COMMENT ON COLUMN farms.api_secret IS 'API secret for device authentication (hashed)';
COMMENT ON COLUMN farms.jwt_secret IS 'JWT secret for session tokens (unique per farm)';
COMMENT ON COLUMN farms.square_amount IS 'Payment amount in cents';

COMMENT ON COLUMN users.password_hash IS 'bcrypt hashed password, never store plain text';
COMMENT ON COLUMN users.email_verified IS 'Whether user clicked verification link in welcome email';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these queries to verify the migration succeeded

-- Check table existence
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('farms', 'users', 'rooms');

-- Check indexes
-- SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('farms', 'users', 'rooms');

-- Check foreign key constraints
-- SELECT conname, conrelid::regclass, confrelid::regclass FROM pg_constraint WHERE contype = 'f';

-- ============================================================================
-- ROLLBACK (if needed)
-- ============================================================================
-- To rollback this migration, run:
-- DROP TABLE IF EXISTS rooms CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;
-- DROP TABLE IF EXISTS farms CASCADE;
-- DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
