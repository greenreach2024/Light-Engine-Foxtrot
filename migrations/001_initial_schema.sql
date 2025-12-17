-- ============================================================================
-- GreenReach Central Admin Database Schema
-- Version: 1.0.0
-- Phase: 2 (Database + Pagination for 50-500 Farms)
-- ============================================================================

-- Drop existing tables (for clean install)
DROP TABLE IF EXISTS farm_energy CASCADE;
DROP TABLE IF EXISTS farm_alerts CASCADE;
DROP TABLE IF EXISTS farm_inventory CASCADE;
DROP TABLE IF EXISTS farm_devices CASCADE;
DROP TABLE IF EXISTS farm_zones CASCADE;
DROP TABLE IF EXISTS farm_rooms CASCADE;
DROP TABLE IF EXISTS farm_metrics CASCADE;
DROP TABLE IF EXISTS farms CASCADE;

-- ============================================================================
-- Core Tables
-- ============================================================================

-- Farms table: Master registry of all farms
CREATE TABLE farms (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(500) NOT NULL,
  region VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'warning', 'critical')),
  enabled BOOLEAN DEFAULT true,
  description TEXT,
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP
);

-- Farm metrics: Time-series aggregated metrics per farm
CREATE TABLE farm_metrics (
  id SERIAL PRIMARY KEY,
  farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
  room_count INTEGER DEFAULT 0,
  zone_count INTEGER DEFAULT 0,
  device_count INTEGER DEFAULT 0,
  tray_count INTEGER DEFAULT 0,
  plant_count INTEGER DEFAULT 0,
  energy_24h DECIMAL(10,2) DEFAULT 0,
  alert_count INTEGER DEFAULT 0,
  online_device_count INTEGER DEFAULT 0,
  offline_device_count INTEGER DEFAULT 0,
  recorded_at TIMESTAMP DEFAULT NOW()
);

-- Farm rooms: Physical spaces within each farm
CREATE TABLE farm_rooms (
  id SERIAL PRIMARY KEY,
  farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
  room_id VARCHAR(100) NOT NULL,
  room_name VARCHAR(255) NOT NULL,
  floor INTEGER,
  zone_count INTEGER DEFAULT 0,
  device_count INTEGER DEFAULT 0,
  temp_c DECIMAL(5,2),
  humidity DECIMAL(5,2),
  co2_ppm INTEGER,
  vpd_kpa DECIMAL(4,2),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(farm_id, room_id)
);

-- Farm zones: Environmental control areas within rooms
CREATE TABLE farm_zones (
  id SERIAL PRIMARY KEY,
  farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES farm_rooms(id) ON DELETE CASCADE,
  zone_id VARCHAR(100) NOT NULL,
  zone_name VARCHAR(255) NOT NULL,
  device_count INTEGER DEFAULT 0,
  temp_c DECIMAL(5,2),
  humidity DECIMAL(5,2),
  co2_ppm INTEGER,
  vpd_kpa DECIMAL(4,2),
  ppfd DECIMAL(6,2),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(farm_id, zone_id)
);

-- Farm devices: Individual lights, sensors, HVAC, irrigation
CREATE TABLE farm_devices (
  id SERIAL PRIMARY KEY,
  farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
  zone_id INTEGER REFERENCES farm_zones(id) ON DELETE CASCADE,
  device_id VARCHAR(100) NOT NULL,
  device_name VARCHAR(255),
  device_type VARCHAR(50) NOT NULL CHECK (device_type IN ('light', 'sensor', 'hvac', 'irrigation', 'fan', 'other')),
  vendor VARCHAR(100),
  model VARCHAR(100),
  firmware_version VARCHAR(50),
  status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'warning', 'error')),
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(farm_id, device_id)
);

-- Farm inventory: Active trays and plant tracking
CREATE TABLE farm_inventory (
  id SERIAL PRIMARY KEY,
  farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
  zone_id INTEGER REFERENCES farm_zones(id) ON DELETE CASCADE,
  tray_id VARCHAR(100) NOT NULL,
  recipe_name VARCHAR(255),
  crop_type VARCHAR(100),
  plant_count INTEGER DEFAULT 0,
  seed_date DATE,
  harvest_date DATE,
  age_days INTEGER,
  status VARCHAR(50) DEFAULT 'growing' CHECK (status IN ('seeded', 'germinating', 'growing', 'flowering', 'ready', 'harvested')),
  location VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(farm_id, tray_id)
);

-- Farm energy: Energy consumption tracking
CREATE TABLE farm_energy (
  id SERIAL PRIMARY KEY,
  farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
  kwh DECIMAL(10,2) NOT NULL,
  cost DECIMAL(10,2),
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  system_type VARCHAR(50) CHECK (system_type IN ('lighting', 'hvac', 'irrigation', 'other')),
  recorded_at TIMESTAMP DEFAULT NOW()
);

-- Farm alerts: Real-time alert tracking
CREATE TABLE farm_alerts (
  id SERIAL PRIMARY KEY,
  farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
  alert_type VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  message TEXT NOT NULL,
  zone_id VARCHAR(100),
  device_id VARCHAR(100),
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_by VARCHAR(255),
  acknowledged_at TIMESTAMP,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Farms indexes
CREATE INDEX idx_farms_status ON farms(status);
CREATE INDEX idx_farms_region ON farms(region);
CREATE INDEX idx_farms_enabled ON farms(enabled);
CREATE INDEX idx_farms_last_seen ON farms(last_seen);

-- Farm metrics indexes
CREATE INDEX idx_metrics_farm_id ON farm_metrics(farm_id);
CREATE INDEX idx_metrics_recorded_at ON farm_metrics(recorded_at);
CREATE INDEX idx_metrics_farm_time ON farm_metrics(farm_id, recorded_at DESC);

-- Farm rooms indexes
CREATE INDEX idx_rooms_farm_id ON farm_rooms(farm_id);
CREATE INDEX idx_rooms_updated_at ON farm_rooms(updated_at);

-- Farm zones indexes
CREATE INDEX idx_zones_farm_id ON farm_zones(farm_id);
CREATE INDEX idx_zones_room_id ON farm_zones(room_id);
CREATE INDEX idx_zones_updated_at ON farm_zones(updated_at);

-- Farm devices indexes
CREATE INDEX idx_devices_farm_id ON farm_devices(farm_id);
CREATE INDEX idx_devices_zone_id ON farm_devices(zone_id);
CREATE INDEX idx_devices_type ON farm_devices(device_type);
CREATE INDEX idx_devices_status ON farm_devices(status);
CREATE INDEX idx_devices_last_seen ON farm_devices(last_seen);

-- Farm inventory indexes
CREATE INDEX idx_inventory_farm_id ON farm_inventory(farm_id);
CREATE INDEX idx_inventory_zone_id ON farm_inventory(zone_id);
CREATE INDEX idx_inventory_status ON farm_inventory(status);
CREATE INDEX idx_inventory_harvest_date ON farm_inventory(harvest_date);
CREATE INDEX idx_inventory_recipe ON farm_inventory(recipe_name);

-- Farm energy indexes
CREATE INDEX idx_energy_farm_id ON farm_energy(farm_id);
CREATE INDEX idx_energy_period ON farm_energy(period_start, period_end);
CREATE INDEX idx_energy_system_type ON farm_energy(system_type);

-- Farm alerts indexes
CREATE INDEX idx_alerts_farm_id ON farm_alerts(farm_id);
CREATE INDEX idx_alerts_severity ON farm_alerts(severity);
CREATE INDEX idx_alerts_acknowledged ON farm_alerts(acknowledged);
CREATE INDEX idx_alerts_resolved ON farm_alerts(resolved);
CREATE INDEX idx_alerts_created_at ON farm_alerts(created_at DESC);

-- ============================================================================
-- Views for Common Queries
-- ============================================================================

-- Latest metrics per farm
CREATE VIEW v_farm_latest_metrics AS
SELECT DISTINCT ON (fm.farm_id)
  f.farm_id,
  f.name,
  f.region,
  f.status,
  fm.room_count,
  fm.zone_count,
  fm.device_count,
  fm.tray_count,
  fm.plant_count,
  fm.energy_24h,
  fm.alert_count,
  fm.recorded_at
FROM farms f
LEFT JOIN farm_metrics fm ON f.id = fm.farm_id
WHERE f.enabled = true
ORDER BY fm.farm_id, fm.recorded_at DESC;

-- Active alerts by farm
CREATE VIEW v_farm_active_alerts AS
SELECT
  f.farm_id,
  f.name,
  COUNT(*) as alert_count,
  SUM(CASE WHEN fa.severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
  SUM(CASE WHEN fa.severity = 'warning' THEN 1 ELSE 0 END) as warning_count,
  SUM(CASE WHEN fa.severity = 'info' THEN 1 ELSE 0 END) as info_count
FROM farms f
LEFT JOIN farm_alerts fa ON f.id = fa.farm_id
WHERE fa.resolved = false
GROUP BY f.farm_id, f.name;

-- Farm summary with latest metrics
CREATE VIEW v_farm_summary AS
SELECT
  f.id,
  f.farm_id,
  f.name,
  f.url,
  f.region,
  f.status,
  f.last_seen,
  COALESCE(m.room_count, 0) as rooms,
  COALESCE(m.zone_count, 0) as zones,
  COALESCE(m.device_count, 0) as devices,
  COALESCE(m.tray_count, 0) as trays,
  COALESCE(m.plant_count, 0) as plants,
  COALESCE(m.energy_24h, 0) as energy_24h,
  COALESCE(a.alert_count, 0) as alerts
FROM farms f
LEFT JOIN LATERAL (
  SELECT *
  FROM farm_metrics
  WHERE farm_id = f.id
  ORDER BY recorded_at DESC
  LIMIT 1
) m ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) as alert_count
  FROM farm_alerts
  WHERE farm_id = f.id AND resolved = false
) a ON true
WHERE f.enabled = true;

-- ============================================================================
-- Functions for Data Aggregation
-- ============================================================================

-- Function to calculate aggregate platform metrics
CREATE OR REPLACE FUNCTION get_platform_aggregate_metrics()
RETURNS TABLE (
  total_farms INTEGER,
  online_farms INTEGER,
  total_rooms BIGINT,
  total_zones BIGINT,
  total_devices BIGINT,
  total_trays BIGINT,
  total_plants BIGINT,
  total_energy_24h NUMERIC,
  active_alerts BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER as total_farms,
    COUNT(*) FILTER (WHERE status = 'online')::INTEGER as online_farms,
    COALESCE(SUM(rooms), 0)::BIGINT as total_rooms,
    COALESCE(SUM(zones), 0)::BIGINT as total_zones,
    COALESCE(SUM(devices), 0)::BIGINT as total_devices,
    COALESCE(SUM(trays), 0)::BIGINT as total_trays,
    COALESCE(SUM(plants), 0)::BIGINT as total_plants,
    COALESCE(SUM(energy_24h), 0)::NUMERIC as total_energy_24h,
    (SELECT COUNT(*) FROM farm_alerts WHERE resolved = false)::BIGINT as active_alerts
  FROM v_farm_summary;
END;
$$ LANGUAGE plpgsql;

-- Function to update farm metrics
CREATE OR REPLACE FUNCTION update_farm_metrics(
  p_farm_id VARCHAR(20),
  p_room_count INTEGER,
  p_zone_count INTEGER,
  p_device_count INTEGER,
  p_tray_count INTEGER,
  p_plant_count INTEGER,
  p_energy_24h DECIMAL,
  p_alert_count INTEGER
) RETURNS VOID AS $$
DECLARE
  v_farm_pk INTEGER;
BEGIN
  -- Get farm primary key
  SELECT id INTO v_farm_pk FROM farms WHERE farm_id = p_farm_id;
  
  IF v_farm_pk IS NULL THEN
    RAISE EXCEPTION 'Farm not found: %', p_farm_id;
  END IF;
  
  -- Insert metrics record
  INSERT INTO farm_metrics (
    farm_id,
    room_count,
    zone_count,
    device_count,
    tray_count,
    plant_count,
    energy_24h,
    alert_count,
    recorded_at
  ) VALUES (
    v_farm_pk,
    p_room_count,
    p_zone_count,
    p_device_count,
    p_tray_count,
    p_plant_count,
    p_energy_24h,
    p_alert_count,
    NOW()
  );
  
  -- Update farm last_seen
  UPDATE farms
  SET last_seen = NOW(), updated_at = NOW()
  WHERE id = v_farm_pk;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Triggers
-- ============================================================================

-- Update farm updated_at timestamp on changes
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_farms_updated_at BEFORE UPDATE ON farms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_rooms_updated_at BEFORE UPDATE ON farm_rooms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_zones_updated_at BEFORE UPDATE ON farm_zones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_devices_updated_at BEFORE UPDATE ON farm_devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_inventory_updated_at BEFORE UPDATE ON farm_inventory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Seed Data (Optional)
-- ============================================================================

-- Example: Insert a test farm
-- INSERT INTO farms (farm_id, name, url, region, status, enabled)
-- VALUES ('GR-00001', 'Test Farm 1', 'http://localhost:8091', 'west', 'online', true);

-- ============================================================================
-- Cleanup Functions
-- ============================================================================

-- Function to archive old metrics (keep last 90 days)
CREATE OR REPLACE FUNCTION archive_old_metrics()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM farm_metrics
  WHERE recorded_at < NOW() - INTERVAL '90 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up resolved alerts (keep last 30 days)
CREATE OR REPLACE FUNCTION archive_old_alerts()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM farm_alerts
  WHERE resolved = true
    AND resolved_at < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE farms IS 'Master registry of all farms in the GreenReach network';
COMMENT ON TABLE farm_metrics IS 'Time-series aggregated metrics per farm for historical trending';
COMMENT ON TABLE farm_rooms IS 'Physical spaces within each farm';
COMMENT ON TABLE farm_zones IS 'Environmental control areas within rooms';
COMMENT ON TABLE farm_devices IS 'Individual devices (lights, sensors, HVAC, etc.)';
COMMENT ON TABLE farm_inventory IS 'Active trays and plant inventory tracking';
COMMENT ON TABLE farm_energy IS 'Energy consumption data by farm and system type';
COMMENT ON TABLE farm_alerts IS 'Real-time alert tracking across all farms';

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Count tables
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE 'farm%'
ORDER BY tablename;

-- Count indexes
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename LIKE 'farm%'
ORDER BY indexname;

-- Test aggregate function
-- SELECT * FROM get_platform_aggregate_metrics();

-- End of migration script
