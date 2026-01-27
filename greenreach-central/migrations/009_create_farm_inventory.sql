-- Create farm_inventory table to store synced inventory from edge devices
CREATE TABLE IF NOT EXISTS farm_inventory (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(50) NOT NULL,
  product_id VARCHAR(100) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit VARCHAR(20) NOT NULL DEFAULT 'unit',
  price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  available_for_wholesale BOOLEAN NOT NULL DEFAULT FALSE,
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(farm_id, product_id)
);

-- Index for fast lookups by farm
CREATE INDEX IF NOT EXISTS idx_farm_inventory_farm_id ON farm_inventory(farm_id);

-- Index for searching by SKU
CREATE INDEX IF NOT EXISTS idx_farm_inventory_sku ON farm_inventory(sku);

-- Index for filtering available products
CREATE INDEX IF NOT EXISTS idx_farm_inventory_available ON farm_inventory(available_for_wholesale) WHERE available_for_wholesale = TRUE;
