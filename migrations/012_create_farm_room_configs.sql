-- Create farm_room_configs table for durable room wizard persistence
-- Safe to run multiple times

CREATE TABLE IF NOT EXISTS farm_room_configs (
  id SERIAL PRIMARY KEY,
  farm_id TEXT NOT NULL,
  rooms_json JSONB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_farm_room_configs_farm_id
  ON farm_room_configs (farm_id);

CREATE INDEX IF NOT EXISTS idx_farm_room_configs_updated_at
  ON farm_room_configs (updated_at DESC);
