ALTER TABLE grant_programs
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

ALTER TABLE grant_programs
  ADD COLUMN IF NOT EXISTS verified_by VARCHAR(255);

ALTER TABLE grant_programs
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE;

ALTER TABLE grant_program_snapshots
  ADD COLUMN IF NOT EXISTS scraping_confidence VARCHAR(20) DEFAULT 'medium';

CREATE TABLE IF NOT EXISTS grant_program_change_alerts (
  id SERIAL PRIMARY KEY,
  program_id INTEGER REFERENCES grant_programs(id),
  change_type VARCHAR(50),
  details JSONB DEFAULT '{}',
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grant_program_change_alerts_program ON grant_program_change_alerts(program_id);
CREATE INDEX IF NOT EXISTS idx_grant_program_change_alerts_ack ON grant_program_change_alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_grant_program_change_alerts_created ON grant_program_change_alerts(created_at);
