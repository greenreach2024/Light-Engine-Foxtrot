-- Migration: 002_add_missing_farms_columns
-- Created: 2026-02-02
-- Description: Add missing columns to production farms table
-- Context: Production DB has minimal schema (farm_id, name, status, last_heartbeat, metadata)
--          Need to add columns from 001_create_farms_users.sql that were never created

-- Add missing columns with NULL allowed first (to avoid constraint violations on existing rows)
ALTER TABLE farms 
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS plan_type VARCHAR(50) CHECK (plan_type IN ('cloud', 'edge')),
  ADD COLUMN IF NOT EXISTS api_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS api_secret VARCHAR(255),
  ADD COLUMN IF NOT EXISTS jwt_secret VARCHAR(255),
  ADD COLUMN IF NOT EXISTS square_payment_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS square_amount INTEGER,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'America/Toronto',
  ADD COLUMN IF NOT EXISTS business_hours JSONB,
  ADD COLUMN IF NOT EXISTS certifications JSONB,
  ADD COLUMN IF NOT EXISTS registration_code VARCHAR(50);

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_farms_email ON farms(email);
CREATE INDEX IF NOT EXISTS idx_farms_api_key ON farms(api_key);

-- Note: NOT setting NOT NULL constraints on existing columns yet
-- This allows existing farms to continue working
-- New farms created via heartbeat UPSERT will populate all required fields
