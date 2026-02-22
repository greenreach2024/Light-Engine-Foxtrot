-- Migration: 017_device_integrations.sql
-- Description: Create device_integrations table for tracking device adoption across network
-- Ticket: I-1.8 (Integration Assistant Implementation Plan)
-- Date: 2026-02-22

-- Device integrations table
-- Stores anonymized integration records from farms for network learning
CREATE TABLE IF NOT EXISTS device_integrations (
  id SERIAL PRIMARY KEY,
  
  -- Farm identity (anonymized)
  farm_id_hash VARCHAR(64) NOT NULL,  -- SHA256 of farm_id, never stores plain farm_id
  
  -- Device information
  device_type VARCHAR(50),             -- sensor, relay, dimmer, controller, light
  device_make_model VARCHAR(255),      -- e.g., "Sonoff TH16", "SwitchBot Meter"
  driver_id VARCHAR(100),              -- e.g., "mqtt.generic.v1", "switchbot.meter.v1"
  driver_version VARCHAR(20),          -- semver, e.g., "1.0.0"
  protocol VARCHAR(50),                -- mqtt, http, modbus, ble, serial, zigbee
  
  -- Capabilities (JSONB for flexibility)
  capabilities JSONB DEFAULT '{"telemetry": [], "commands": []}',
  -- Example: {"telemetry": ["temp_c", "humidity_pct"], "commands": ["turnOn", "turnOff"]}
  
  -- Install context (for network learning)
  install_context JSONB DEFAULT '{}',
  -- Example: {"room_type": "grow_room", "system_type": "indoor_vertical", "mounting": "canopy_level"}
  
  -- Validation results
  validation_passed BOOLEAN DEFAULT true,
  signal_quality DECIMAL(3,2),         -- 0.00 to 1.00, calculated as: successful_reads / total_attempts
  dropout_rate DECIMAL(3,2),           -- 0.00 to 1.00, calculated as: failed_reads / total_attempts
  latency_ms INTEGER,                  -- Average response latency in milliseconds
  
  -- Grower feedback
  grower_rating VARCHAR(20),           -- 'thumbs_up', 'thumbs_down', null
  grower_comment TEXT,                 -- Optional comment from grower
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Record metadata
  record_id VARCHAR(100),              -- Original record ID from farm (e.g., "INT-20260222-001")
  synced_at TIMESTAMP DEFAULT NOW()    -- When this record was synced to Central
);

-- Indexes for efficient aggregation queries
CREATE INDEX IF NOT EXISTS idx_integrations_driver ON device_integrations(driver_id);
CREATE INDEX IF NOT EXISTS idx_integrations_protocol ON device_integrations(protocol);
CREATE INDEX IF NOT EXISTS idx_integrations_device_type ON device_integrations(device_type);
CREATE INDEX IF NOT EXISTS idx_integrations_created ON device_integrations(created_at);
CREATE INDEX IF NOT EXISTS idx_integrations_farm_hash ON device_integrations(farm_id_hash);
CREATE INDEX IF NOT EXISTS idx_integrations_validation ON device_integrations(validation_passed);

-- Composite index for driver analytics
CREATE INDEX IF NOT EXISTS idx_integrations_driver_version ON device_integrations(driver_id, driver_version);

-- Comments for documentation
COMMENT ON TABLE device_integrations IS 'Anonymized device integration records from farms for network learning';
COMMENT ON COLUMN device_integrations.farm_id_hash IS 'SHA256 hash of farm_id - never stores plain farm identity';
COMMENT ON COLUMN device_integrations.signal_quality IS 'Ratio of successful reads to total attempts (0.00-1.00)';
COMMENT ON COLUMN device_integrations.dropout_rate IS 'Ratio of failed reads to total attempts (0.00-1.00)';
