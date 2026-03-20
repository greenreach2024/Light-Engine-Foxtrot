-- Migration 021: AI Market Analysis table
-- Stores daily GPT-4o-mini analysis of market price trends per crop.
-- Farm-agnostic: market analysis is global (not per-farm).

CREATE TABLE IF NOT EXISTS market_ai_analysis (
  id              SERIAL PRIMARY KEY,
  product         VARCHAR(100) NOT NULL,            -- resolveAs name from crop-registry
  analysis_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  outlook         VARCHAR(20) DEFAULT 'stable',     -- bullish | bearish | stable | volatile
  confidence      VARCHAR(10) DEFAULT 'medium',     -- high | medium | low
  price_forecast  NUMERIC(8,2),                     -- AI predicted price (CAD) for next 7 days
  action          VARCHAR(50),                       -- e.g. 'increase_production', 'hold', 'reduce_price', 'opportunistic_sell'
  reasoning       TEXT,                              -- AI explanation (1-2 sentences)
  data_points     INT DEFAULT 0,                    -- # of observations the AI had to work with
  model           VARCHAR(50) DEFAULT 'gpt-4o-mini',
  prompt_tokens   INT DEFAULT 0,
  completion_tokens INT DEFAULT 0,
  estimated_cost  NUMERIC(8,6) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product, analysis_date)                    -- one analysis per crop per day
);

CREATE INDEX IF NOT EXISTS idx_mai_product ON market_ai_analysis(product);
CREATE INDEX IF NOT EXISTS idx_mai_date ON market_ai_analysis(analysis_date DESC);
CREATE INDEX IF NOT EXISTS idx_mai_outlook ON market_ai_analysis(outlook);
