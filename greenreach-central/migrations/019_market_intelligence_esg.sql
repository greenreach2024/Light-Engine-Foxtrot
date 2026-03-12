-- Migration 022: Market Intelligence price history + ESG scoring tables
-- Supports claims #4 (real market intelligence) and #12 (real ESG scoring)

-- Store historical market price observations (replaces hardcoded data)
CREATE TABLE IF NOT EXISTS market_price_observations (
  id            SERIAL PRIMARY KEY,
  product       VARCHAR(100) NOT NULL,         -- e.g. 'Tomatoes', 'Basil', 'Kale'
  retailer      VARCHAR(100) NOT NULL,         -- e.g. 'Whole Foods', 'Sobeys'
  price_cad     NUMERIC(8,2) NOT NULL,
  unit          VARCHAR(30) DEFAULT 'per_lb',  -- per_lb, per_bunch, per_oz
  source        VARCHAR(50) DEFAULT 'manual',  -- manual | scrape | api
  observed_at   TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mpo_product ON market_price_observations(product);
CREATE INDEX IF NOT EXISTS idx_mpo_observed ON market_price_observations(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpo_retailer ON market_price_observations(retailer);

-- Store computed price trends (updated by refresh job)
CREATE TABLE IF NOT EXISTS market_price_trends (
  id            SERIAL PRIMARY KEY,
  product       VARCHAR(100) NOT NULL UNIQUE,
  avg_price_cad NUMERIC(8,2),
  price_7d_ago  NUMERIC(8,2),
  price_30d_ago NUMERIC(8,2),
  trend         VARCHAR(20) DEFAULT 'stable',  -- increasing | decreasing | stable
  trend_percent NUMERIC(6,2) DEFAULT 0,
  retailer_count INT DEFAULT 0,
  observation_count INT DEFAULT 0,
  last_observation TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ESG assessment records per farm
CREATE TABLE IF NOT EXISTS esg_assessments (
  id            SERIAL PRIMARY KEY,
  farm_id       VARCHAR(100) NOT NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,

  -- Environmental scores (0-100)
  energy_efficiency_score   NUMERIC(5,2) DEFAULT 0,
  water_efficiency_score    NUMERIC(5,2) DEFAULT 0,
  carbon_intensity_score    NUMERIC(5,2) DEFAULT 0,
  food_miles_score          NUMERIC(5,2) DEFAULT 0,
  waste_diversion_score     NUMERIC(5,2) DEFAULT 0,

  -- Social scores (0-100)
  local_employment_score    NUMERIC(5,2) DEFAULT 0,
  community_engagement_score NUMERIC(5,2) DEFAULT 0,
  food_access_score         NUMERIC(5,2) DEFAULT 0,

  -- Governance scores (0-100)
  traceability_score        NUMERIC(5,2) DEFAULT 0,
  data_transparency_score   NUMERIC(5,2) DEFAULT 0,
  compliance_score          NUMERIC(5,2) DEFAULT 0,

  -- Composite
  environmental_score       NUMERIC(5,2) DEFAULT 0,
  social_score              NUMERIC(5,2) DEFAULT 0,
  governance_score          NUMERIC(5,2) DEFAULT 0,
  total_score               NUMERIC(5,2) DEFAULT 0,
  grade                     VARCHAR(5) DEFAULT 'N/A',

  -- Raw metrics used for scoring
  metrics_json              JSONB DEFAULT '{}',

  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_esg_farm ON esg_assessments(farm_id);
CREATE INDEX IF NOT EXISTS idx_esg_period ON esg_assessments(period_end DESC);
