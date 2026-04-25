-- Migration 033: Add loss_events and accounting_ledger_entries tables
-- loss_events: receives harvest loss data from LE via /api/sync/experiment-records
-- accounting_ledger_entries: double-entry ledger checked by nightly-checklist.js

CREATE TABLE IF NOT EXISTS loss_events (
  id                   SERIAL PRIMARY KEY,
  farm_id              VARCHAR(255) NOT NULL,
  tray_run_id          VARCHAR(255),
  crop                 VARCHAR(255),
  loss_reason          TEXT,
  lost_quantity        INTEGER,
  environment_snapshot JSONB        NOT NULL DEFAULT '{}',
  expected_conditions  JSONB        NOT NULL DEFAULT '{}',
  notes                TEXT,
  recorded_at          TIMESTAMPTZ  NOT NULL,
  ingested_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loss_events_farm_id     ON loss_events(farm_id);
CREATE INDEX IF NOT EXISTS idx_loss_events_recorded_at ON loss_events(recorded_at);
CREATE INDEX IF NOT EXISTS idx_loss_events_crop        ON loss_events(farm_id, crop);

CREATE TABLE IF NOT EXISTS accounting_ledger_entries (
  id           SERIAL PRIMARY KEY,
  farm_id      VARCHAR(255) NOT NULL,
  entry_type   VARCHAR(20)  NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  amount       NUMERIC(12, 2) NOT NULL,
  account_code VARCHAR(50),
  description  TEXT,
  reference_id VARCHAR(255),
  reference_type VARCHAR(50),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_ledger_farm_id    ON accounting_ledger_entries(farm_id);
CREATE INDEX IF NOT EXISTS idx_accounting_ledger_created_at ON accounting_ledger_entries(created_at);
