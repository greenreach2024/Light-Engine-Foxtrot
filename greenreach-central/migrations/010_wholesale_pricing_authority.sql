-- P5 Wholesale Pricing Authority - Database Schema
-- Migration: 010_wholesale_pricing_authority
-- Created: January 31, 2026
-- Purpose: Central marketplace pricing with farm acceptance/rejection tracking

-- ==============================================================================
-- TABLE 1: Farm Cost Surveys
-- Purpose: Store farm cost data for cost-basis protection (price > cost + 20%)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS farm_cost_surveys (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(50) NOT NULL,
  crop VARCHAR(100) NOT NULL,
  cost_per_unit DECIMAL(10, 2) NOT NULL,  -- Cost per lb/unit
  unit VARCHAR(20) NOT NULL DEFAULT 'lb',
  cost_breakdown JSONB,  -- {seeds: 0.50, labor: 2.00, electricity: 1.20, etc.}
  survey_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,  -- Cost data expires (quarterly surveys)
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(farm_id, crop, survey_date)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_farm_cost_surveys_farm_id ON farm_cost_surveys(farm_id);
CREATE INDEX IF NOT EXISTS idx_farm_cost_surveys_crop ON farm_cost_surveys(crop);
CREATE INDEX IF NOT EXISTS idx_farm_cost_surveys_valid ON farm_cost_surveys(valid_until);

-- ==============================================================================
-- TABLE 2: Pricing Offers
-- Purpose: Store wholesale price offers from Central to farms
-- ==============================================================================

CREATE TABLE IF NOT EXISTS pricing_offers (
  offer_id VARCHAR(50) PRIMARY KEY,
  crop VARCHAR(100) NOT NULL,
  wholesale_price DECIMAL(10, 2) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'lb',
  reasoning TEXT,  -- AI/admin explanation for this price
  confidence DECIMAL(3, 2),  -- AI confidence score (0.00-1.00)
  predicted_acceptance DECIMAL(3, 2),  -- Predicted acceptance rate (0.00-1.00)
  offer_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_date DATE,  -- When price becomes active
  expires_at TIMESTAMP WITH TIME ZONE,  -- Offer expiration (7-14 days)
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'active', 'expired', 'cancelled'
  created_by VARCHAR(100),  -- Admin email or 'ai-auto-apply'
  tier VARCHAR(50),  -- Pricing tier: 'demand-based', 'competitive', 'ai-optimized'
  metadata JSONB,  -- Store extra data (supply/demand ratio, market comparisons, etc.)
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CHECK (predicted_acceptance IS NULL OR (predicted_acceptance >= 0 AND predicted_acceptance <= 1))
);

-- Indexes for querying offers
CREATE INDEX IF NOT EXISTS idx_pricing_offers_crop ON pricing_offers(crop);
CREATE INDEX IF NOT EXISTS idx_pricing_offers_status ON pricing_offers(status);
CREATE INDEX IF NOT EXISTS idx_pricing_offers_offer_date ON pricing_offers(offer_date DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_offers_active ON pricing_offers(status, crop);

-- ==============================================================================
-- TABLE 3: Pricing Responses
-- Purpose: Track farm acceptance/rejection/counter-offers for pricing offers
-- ==============================================================================

CREATE TABLE IF NOT EXISTS pricing_responses (
  response_id SERIAL PRIMARY KEY,
  offer_id VARCHAR(50) NOT NULL REFERENCES pricing_offers(offer_id) ON DELETE CASCADE,
  farm_id VARCHAR(50) NOT NULL,
  response VARCHAR(10) NOT NULL,  -- 'accept', 'reject', 'counter'
  counter_price DECIMAL(10, 2),  -- Only if response = 'counter'
  justification TEXT,  -- Farm's reason for rejection or counter-offer
  notes TEXT,  -- Additional comments from farm
  responded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (response IN ('accept', 'reject', 'counter')),
  CHECK (response != 'counter' OR counter_price IS NOT NULL),
  UNIQUE(offer_id, farm_id)  -- One response per farm per offer
);

-- Indexes for analytics and monitoring
CREATE INDEX IF NOT EXISTS idx_pricing_responses_offer_id ON pricing_responses(offer_id);
CREATE INDEX IF NOT EXISTS idx_pricing_responses_farm_id ON pricing_responses(farm_id);
CREATE INDEX IF NOT EXISTS idx_pricing_responses_response ON pricing_responses(response);
CREATE INDEX IF NOT EXISTS idx_pricing_responses_responded_at ON pricing_responses(responded_at DESC);

-- ==============================================================================
-- TABLE 4: Pricing History (Archived decisions for AI learning)
-- Purpose: Store historical pricing decisions and actual acceptance rates
-- ==============================================================================

CREATE TABLE IF NOT EXISTS pricing_history (
  history_id SERIAL PRIMARY KEY,
  crop VARCHAR(100) NOT NULL,
  wholesale_price DECIMAL(10, 2) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'lb',
  offer_date DATE NOT NULL,
  total_farms_offered INT NOT NULL DEFAULT 0,
  farms_accepted INT NOT NULL DEFAULT 0,
  farms_rejected INT NOT NULL DEFAULT 0,
  farms_countered INT NOT NULL DEFAULT 0,
  acceptance_rate DECIMAL(5, 4),  -- Calculated: farms_accepted / total_farms_offered
  avg_counter_price DECIMAL(10, 2),  -- Average counter-offer price
  reasoning TEXT,
  tier VARCHAR(50),
  metadata JSONB,
  archived_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for AI training queries
CREATE INDEX IF NOT EXISTS idx_pricing_history_crop ON pricing_history(crop);
CREATE INDEX IF NOT EXISTS idx_pricing_history_offer_date ON pricing_history(offer_date DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_history_acceptance_rate ON pricing_history(acceptance_rate);

-- ==============================================================================
-- Utility Functions
-- ==============================================================================

-- Function to calculate acceptance rate when offer closes
CREATE OR REPLACE FUNCTION update_pricing_history()
RETURNS TRIGGER AS $$
BEGIN
  -- When offer status changes to 'expired' or 'cancelled', archive to history
  IF NEW.status IN ('expired', 'cancelled') AND OLD.status NOT IN ('expired', 'cancelled') THEN
    INSERT INTO pricing_history (
      crop,
      wholesale_price,
      unit,
      offer_date,
      total_farms_offered,
      farms_accepted,
      farms_rejected,
      farms_countered,
      acceptance_rate,
      avg_counter_price,
      reasoning,
      tier,
      metadata
    )
    SELECT
      NEW.crop,
      NEW.wholesale_price,
      NEW.unit,
      NEW.offer_date::DATE,
      COUNT(*) as total_farms_offered,
      COUNT(*) FILTER (WHERE r.response = 'accept') as farms_accepted,
      COUNT(*) FILTER (WHERE r.response = 'reject') as farms_rejected,
      COUNT(*) FILTER (WHERE r.response = 'counter') as farms_countered,
      COUNT(*) FILTER (WHERE r.response = 'accept')::DECIMAL / NULLIF(COUNT(*), 0) as acceptance_rate,
      AVG(r.counter_price) FILTER (WHERE r.response = 'counter') as avg_counter_price,
      NEW.reasoning,
      NEW.tier,
      NEW.metadata
    FROM pricing_responses r
    WHERE r.offer_id = NEW.offer_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-archive when offer closes
CREATE TRIGGER trigger_update_pricing_history
AFTER UPDATE ON pricing_offers
FOR EACH ROW
EXECUTE FUNCTION update_pricing_history();

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all relevant tables
CREATE TRIGGER trigger_farm_cost_surveys_updated_at
BEFORE UPDATE ON farm_cost_surveys
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_pricing_offers_updated_at
BEFORE UPDATE ON pricing_offers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_pricing_responses_updated_at
BEFORE UPDATE ON pricing_responses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ==============================================================================
-- Initial Data: Default cost surveys for demo farm
-- ==============================================================================

-- Insert default cost data for Light Engine Demo farm (for testing)
INSERT INTO farm_cost_surveys (farm_id, crop, cost_per_unit, unit, cost_breakdown, survey_date, valid_until, notes)
VALUES
  ('light-engine-demo', 'Butterhead Lettuce', 3.80, 'lb', '{"seeds": 0.45, "labor": 1.80, "electricity": 1.00, "water": 0.25, "overhead": 0.30}'::jsonb, CURRENT_DATE, CURRENT_DATE + INTERVAL '90 days', 'Hydroponic production cost baseline'),
  ('light-engine-demo', 'Baby Arugula', 8.20, 'lb', '{"seeds": 1.20, "labor": 4.50, "electricity": 1.80, "water": 0.40, "overhead": 0.30}'::jsonb, CURRENT_DATE, CURRENT_DATE + INTERVAL '90 days', 'Premium specialty green - hand harvested'),
  ('light-engine-demo', 'Genovese Basil', 9.50, 'lb', '{"seeds": 2.00, "labor": 5.00, "electricity": 1.90, "water": 0.30, "overhead": 0.30}'::jsonb, CURRENT_DATE, CURRENT_DATE + INTERVAL '90 days', 'Organic herbs - premium pricing'),
  ('light-engine-demo', 'Lacinato Kale', 4.20, 'lb', '{"seeds": 0.60, "labor": 2.00, "electricity": 1.10, "water": 0.30, "overhead": 0.20}'::jsonb, CURRENT_DATE, CURRENT_DATE + INTERVAL '90 days', 'Hardy green - lower production cost'),
  ('light-engine-demo', 'Mei Qing Pak Choi', 4.50, 'lb', '{"seeds": 0.65, "labor": 2.20, "electricity": 1.15, "water": 0.30, "overhead": 0.20}'::jsonb, CURRENT_DATE, CURRENT_DATE + INTERVAL '90 days', 'Asian specialty green')
ON CONFLICT (farm_id, crop, survey_date) DO NOTHING;

-- ==============================================================================
-- Comments for Documentation
-- ==============================================================================

COMMENT ON TABLE farm_cost_surveys IS 'Farm cost data for cost-basis pricing protection (price must be > cost + 20%)';
COMMENT ON TABLE pricing_offers IS 'Wholesale price offers from GreenReach Central to farms in the network';
COMMENT ON TABLE pricing_responses IS 'Farm responses (accept/reject/counter) to pricing offers';
COMMENT ON TABLE pricing_history IS 'Historical archive of pricing decisions and acceptance rates for AI learning';

COMMENT ON COLUMN pricing_offers.confidence IS 'AI confidence score (0.00-1.00) for this pricing recommendation';
COMMENT ON COLUMN pricing_offers.predicted_acceptance IS 'AI predicted farm acceptance rate (0.00-1.00)';
COMMENT ON COLUMN pricing_offers.tier IS 'Pricing tier: demand-based (Tier 1), competitive (Tier 2), ai-optimized (Tier 3)';

COMMENT ON COLUMN pricing_responses.response IS 'Farm response: accept (participate at offered price), reject (opt out), counter (propose different price)';
COMMENT ON COLUMN pricing_responses.counter_price IS 'Farm proposed price if response=counter (must include justification)';
COMMENT ON COLUMN pricing_responses.justification IS 'Farm explanation for rejection or counter-offer (e.g., "Price below cost", "Organic premium needed")';

COMMENT ON COLUMN pricing_history.acceptance_rate IS 'Historical acceptance rate (0.0000-1.0000) used for AI learning and prediction models';
