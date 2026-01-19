-- Wholesale Product Requests Table
-- Allows buyers to request products not in catalog, notifies farms

CREATE TABLE IF NOT EXISTS wholesale_product_requests (
  id SERIAL PRIMARY KEY,
  buyer_id INTEGER NOT NULL REFERENCES wholesale_buyers(id) ON DELETE CASCADE,
  product_name VARCHAR(255) NOT NULL,
  quantity DECIMAL(10, 2) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  needed_by_date DATE NOT NULL,
  description TEXT,
  max_price_per_unit DECIMAL(10, 2),
  certifications_required JSONB DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'open', -- open, matched, fulfilled, expired, cancelled
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_product_requests_buyer ON wholesale_product_requests(buyer_id);
CREATE INDEX IF NOT EXISTS idx_product_requests_status ON wholesale_product_requests(status);
CREATE INDEX IF NOT EXISTS idx_product_requests_created ON wholesale_product_requests(created_at DESC);

-- Comment
COMMENT ON TABLE wholesale_product_requests IS 'Product requests from wholesale buyers - notifies all local farms';
