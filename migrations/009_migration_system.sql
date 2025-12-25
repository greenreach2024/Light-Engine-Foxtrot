-- Cloud-to-Edge Migration Database Tables
-- Supports export, import, validation, and rollback operations

-- Migration exports table
-- Tracks all export operations from cloud deployments
CREATE TABLE IF NOT EXISTS migration_exports (
  id SERIAL PRIMARY KEY,
  export_id VARCHAR(255) UNIQUE NOT NULL,
  farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
  export_date TIMESTAMP NOT NULL,
  checksum VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  file_size_bytes BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_migration_exports_farm_id (farm_id),
  INDEX idx_migration_exports_export_id (export_id)
);

-- Migrations table
-- Tracks all import operations and their status
CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  export_id VARCHAR(255) NOT NULL,
  rollback_id VARCHAR(255) UNIQUE NOT NULL,
  farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
  imported_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  import_duration_ms INTEGER,
  stats JSONB,
  error_message TEXT,
  INDEX idx_migrations_farm_id (farm_id),
  INDEX idx_migrations_rollback_id (rollback_id),
  INDEX idx_migrations_status (status)
);

-- Migration rollback data
-- Stores pre-migration snapshots for rollback capability
CREATE TABLE IF NOT EXISTS migration_rollback (
  id SERIAL PRIMARY KEY,
  rollback_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  table_name VARCHAR(255) NOT NULL,
  backup_data JSONB NOT NULL,
  INDEX idx_rollback_rollback_id (rollback_id),
  INDEX idx_rollback_table_name (table_name)
);

-- Migration validation results
-- Tracks validation checks before import
CREATE TABLE IF NOT EXISTS migration_validations (
  id SERIAL PRIMARY KEY,
  export_id VARCHAR(255) NOT NULL,
  validated_at TIMESTAMP DEFAULT NOW(),
  valid BOOLEAN NOT NULL,
  errors JSONB,
  warnings JSONB,
  stats JSONB,
  INDEX idx_validations_export_id (export_id)
);

-- Migration logs
-- Detailed logging for troubleshooting
CREATE TABLE IF NOT EXISTS migration_logs (
  id SERIAL PRIMARY KEY,
  migration_id INTEGER REFERENCES migrations(id) ON DELETE CASCADE,
  log_level VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_migration_logs_migration_id (migration_id),
  INDEX idx_migration_logs_created_at (created_at)
);

-- Comments for documentation
COMMENT ON TABLE migration_exports IS 'Tracks cloud deployment data exports for migration';
COMMENT ON TABLE migrations IS 'Tracks import operations and status';
COMMENT ON TABLE migration_rollback IS 'Stores pre-migration backups for rollback';
COMMENT ON TABLE migration_validations IS 'Records validation checks before import';
COMMENT ON TABLE migration_logs IS 'Detailed logs for migration troubleshooting';

COMMENT ON COLUMN migrations.status IS 'Status: pending, in_progress, completed, failed, rolled_back';
COMMENT ON COLUMN migration_exports.status IS 'Status: pending, completed, failed, downloaded';
COMMENT ON COLUMN migration_rollback.backup_data IS 'JSONB snapshot of table data before migration';
