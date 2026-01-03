-- GreenReach Wholesale Database Schema
-- Migration 002: Wholesale Buyers Table
-- Created: 2026-01-03
--
-- This migration creates the wholesale_buyers table for grocer/restaurant authentication

CREATE TABLE IF NOT EXISTS wholesale_buyers (
  id SERIAL PRIMARY KEY,
  business_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  buyer_type VARCHAR(50) NOT NULL,
  location JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (buyer_type IN ('restaurant', 'grocery', 'food_service', 'distributor', 'other'))
);

CREATE INDEX idx_wholesale_buyers_email ON wholesale_buyers(email);
CREATE INDEX idx_wholesale_buyers_buyer_type ON wholesale_buyers(buyer_type);
CREATE INDEX idx_wholesale_buyers_created_at ON wholesale_buyers(created_at);
