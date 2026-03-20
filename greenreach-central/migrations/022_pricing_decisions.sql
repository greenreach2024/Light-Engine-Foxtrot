-- Phase 3B: Pricing authority feedback loop
-- Records when a farmer accepts/rejects an AI pricing recommendation
-- so future AI analysis can incorporate real farm pricing behaviour.

CREATE TABLE IF NOT EXISTS pricing_decisions (
  id              SERIAL PRIMARY KEY,
  farm_id         VARCHAR(100) NOT NULL,
  crop            VARCHAR(150) NOT NULL,
  previous_price  NUMERIC(10,2),
  recommended_price NUMERIC(10,2),
  applied_price   NUMERIC(10,2) NOT NULL,
  market_average  NUMERIC(10,2),
  ai_outlook      VARCHAR(20),
  ai_action       VARCHAR(50),
  trend           VARCHAR(20),
  data_source     VARCHAR(20) DEFAULT 'static',
  decision        VARCHAR(20) DEFAULT 'accepted',   -- accepted | rejected | modified
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_decisions_farm ON pricing_decisions (farm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_decisions_crop ON pricing_decisions (crop, created_at DESC);
