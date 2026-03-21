-- Migration 024: Manual Inventory Support
-- Adds dual-quantity columns to farm_inventory so growers can enter
-- crop inventory by weight without using the tray-based automation.
-- Auto-sync writes auto_quantity_lbs; manual growers write manual_quantity_lbs.
-- Wholesale/retail reads the resolved total.

-- ── New columns ─────────────────────────────────────────────────────────────

-- Weight-based auto quantity populated by Light Engine sync
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS auto_quantity_lbs DECIMAL(10, 2) DEFAULT 0;

-- Weight-based manual quantity entered by grower
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS manual_quantity_lbs DECIMAL(10, 2) DEFAULT 0;

-- How this row gets its inventory: 'auto' (tray sync), 'manual' (grower entry), 'hybrid' (both)
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS inventory_source VARCHAR(10) DEFAULT 'auto';

-- Extended columns that the wholesale catalog (DB path) already expects
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS quantity_available DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(20) DEFAULT 'lb';
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS wholesale_price DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS retail_price DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS category VARCHAR(100);
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS variety VARCHAR(100);
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'available';
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS source_data JSONB DEFAULT '{}';

-- ── Backfill existing rows ──────────────────────────────────────────────────

-- Seed auto_quantity_lbs from existing integer quantity column
UPDATE farm_inventory
SET auto_quantity_lbs  = COALESCE(quantity, 0),
    quantity_available = COALESCE(quantity, 0),
    quantity_unit      = COALESCE(unit, 'lb'),
    wholesale_price    = COALESCE(price, 0),
    retail_price       = COALESCE(price, 0),
    inventory_source   = 'auto',
    synced_at          = COALESCE(last_updated, NOW())
WHERE inventory_source IS NULL OR auto_quantity_lbs = 0;

-- ── Index for filtering by source ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_farm_inventory_source ON farm_inventory(inventory_source);
CREATE INDEX IF NOT EXISTS idx_farm_inventory_available_qty ON farm_inventory(quantity_available) WHERE quantity_available > 0;
