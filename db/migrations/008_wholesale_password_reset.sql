-- GreenReach Wholesale Database Schema
-- Migration 008: Add Password Reset Fields to Wholesale Buyers
-- Created: 2026-01-05
--
-- This migration adds password reset token and expiry fields

ALTER TABLE wholesale_buyers 
  ADD COLUMN IF NOT EXISTS password_reset_token TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP;

-- Index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_wholesale_buyers_reset_token 
  ON wholesale_buyers(password_reset_token) 
  WHERE password_reset_token IS NOT NULL;
