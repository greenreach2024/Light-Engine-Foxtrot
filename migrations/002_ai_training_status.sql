-- AI Training Status Tracking
-- Monitors progress toward ML model activation
-- Required: 500+ decisions, 100+ cycles, >70% acceptance rate

CREATE TABLE IF NOT EXISTS ai_training_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id TEXT NOT NULL DEFAULT 'SYSTEM',
  
  -- Current recommendation engine
  engine_type TEXT NOT NULL DEFAULT 'rules', -- 'rules' or 'ml'
  engine_version TEXT NOT NULL DEFAULT 'v1.0.0-bridge',
  
  -- Training progress metrics
  total_decisions INTEGER NOT NULL DEFAULT 0,
  accepted_decisions INTEGER NOT NULL DEFAULT 0,
  rejected_decisions INTEGER NOT NULL DEFAULT 0,
  overridden_decisions INTEGER NOT NULL DEFAULT 0,
  
  total_crop_cycles INTEGER NOT NULL DEFAULT 0,
  acceptance_rate REAL DEFAULT 0.0,
  
  -- Readiness thresholds
  min_decisions_required INTEGER NOT NULL DEFAULT 500,
  min_cycles_required INTEGER NOT NULL DEFAULT 100,
  min_acceptance_rate REAL NOT NULL DEFAULT 0.70,
  
  -- ML training status
  ml_ready BOOLEAN NOT NULL DEFAULT 0,
  ml_training_started_at TEXT,
  ml_training_completed_at TEXT,
  ml_model_accuracy REAL,
  ml_activated_at TEXT,
  
  -- Progress tracking
  days_since_launch INTEGER NOT NULL DEFAULT 0,
  target_activation_date TEXT, -- 6 months from launch
  
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert initial status row
INSERT OR IGNORE INTO ai_training_status (
  id, 
  farm_id, 
  engine_type,
  target_activation_date
) VALUES (
  1,
  'SYSTEM',
  'rules',
  date('now', '+180 days') -- 6 months from now
);

-- View for calculating readiness percentage
CREATE VIEW IF NOT EXISTS ai_readiness_dashboard AS
SELECT 
  engine_type,
  engine_version,
  total_decisions,
  accepted_decisions,
  rejected_decisions,
  acceptance_rate,
  total_crop_cycles,
  
  -- Progress percentages
  CAST((total_decisions * 100.0 / min_decisions_required) AS INTEGER) AS decisions_pct,
  CAST((total_crop_cycles * 100.0 / min_cycles_required) AS INTEGER) AS cycles_pct,
  CAST((acceptance_rate * 100.0) AS INTEGER) AS acceptance_pct,
  
  -- Overall readiness
  CASE 
    WHEN total_decisions >= min_decisions_required 
     AND total_crop_cycles >= min_cycles_required 
     AND acceptance_rate >= min_acceptance_rate 
    THEN 100
    ELSE CAST((
      (CAST(total_decisions AS REAL) / min_decisions_required * 33.3) +
      (CAST(total_crop_cycles AS REAL) / min_cycles_required * 33.3) +
      (acceptance_rate / min_acceptance_rate * 33.4)
    ) AS INTEGER)
  END AS overall_readiness_pct,
  
  ml_ready,
  ml_training_started_at,
  ml_model_accuracy,
  days_since_launch,
  target_activation_date,
  
  -- Days remaining until target
  CAST((julianday(target_activation_date) - julianday('now')) AS INTEGER) AS days_remaining,
  
  updated_at
FROM ai_training_status
WHERE id = 1;

-- Trigger to update acceptance rate automatically
CREATE TRIGGER IF NOT EXISTS update_acceptance_rate
AFTER UPDATE OF total_decisions, accepted_decisions ON ai_training_status
BEGIN
  UPDATE ai_training_status 
  SET 
    acceptance_rate = CAST(accepted_decisions AS REAL) / NULLIF(total_decisions, 0),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

-- Trigger to check ML readiness
CREATE TRIGGER IF NOT EXISTS check_ml_readiness
AFTER UPDATE ON ai_training_status
BEGIN
  UPDATE ai_training_status
  SET ml_ready = (
    NEW.total_decisions >= NEW.min_decisions_required
    AND NEW.total_crop_cycles >= NEW.min_cycles_required
    AND NEW.acceptance_rate >= NEW.min_acceptance_rate
  )
  WHERE id = NEW.id;
END;
