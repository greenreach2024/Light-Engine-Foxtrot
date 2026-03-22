-- Migration 026: Application error telemetry for F.A.Y.E. diagnostics
-- Captures server-side errors so F.A.Y.E. can diagnose issues without code access.

CREATE TABLE IF NOT EXISTS app_errors (
  id            SERIAL PRIMARY KEY,
  method        TEXT NOT NULL,
  route         TEXT NOT NULL,
  status_code   INTEGER NOT NULL DEFAULT 500,
  error_type    TEXT,
  message       TEXT NOT NULL,
  stack_hash    TEXT,
  count         INTEGER NOT NULL DEFAULT 1,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata      JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_app_errors_last_seen ON app_errors (last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_app_errors_route ON app_errors (route);
CREATE INDEX IF NOT EXISTS idx_app_errors_stack_hash ON app_errors (stack_hash);
