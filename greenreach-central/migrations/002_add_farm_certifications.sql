-- Migration: Add farm certifications and differentiators
-- Date: 2024
-- Description: Adds certifications, practices, and attributes columns for farm filtering

-- Add new columns to farms table
ALTER TABLE farms 
ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS practices JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '[]';

-- Add index for better query performance on certifications filtering
CREATE INDEX IF NOT EXISTS idx_farms_certifications ON farms USING GIN (certifications);
CREATE INDEX IF NOT EXISTS idx_farms_practices ON farms USING GIN (practices);
CREATE INDEX IF NOT EXISTS idx_farms_attributes ON farms USING GIN (attributes);

-- Add comments for documentation
COMMENT ON COLUMN farms.certifications IS 'Array of farm certifications: GAP, USDA Organic, Food Safety (GFSI/SQF), Greenhouse';
COMMENT ON COLUMN farms.practices IS 'Array of growing practices: Pesticide Free, Non-GMO, Hydroponic, Local, Year-Round';
COMMENT ON COLUMN farms.attributes IS 'Array of farm attributes: Woman-Owned, Veteran-Owned, Minority-Owned, Family Farm, Sustainable';
