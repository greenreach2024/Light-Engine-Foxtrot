-- Field of Dreams Campaign: "If you grow it, I'd buy it"
-- Demand heatmap + community competition

CREATE TABLE IF NOT EXISTS campaign_supporters (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(320) NOT NULL UNIQUE,
  postal_code VARCHAR(7) NOT NULL,
  postal_prefix VARCHAR(3) NOT NULL,
  city VARCHAR(200),
  province VARCHAR(50),
  ip_address VARCHAR(45),
  referral_source VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_supporters_postal ON campaign_supporters(postal_prefix);
CREATE INDEX IF NOT EXISTS idx_campaign_supporters_created ON campaign_supporters(created_at);
CREATE INDEX IF NOT EXISTS idx_campaign_supporters_email ON campaign_supporters(email);
