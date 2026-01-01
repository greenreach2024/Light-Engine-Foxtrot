-- Add farm_slug column for multi-tenant URL routing
-- Each farm gets a unique subdomain: {farm_slug}.greenreachgreens.com

-- Add farm_slug column
ALTER TABLE farms ADD COLUMN IF NOT EXISTS farm_slug VARCHAR(100) UNIQUE;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_farms_slug ON farms(farm_slug);

-- Generate slugs for existing farms (converts name to URL-safe slug)
UPDATE farms 
SET farm_slug = lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'), '^-|-$', '', 'g'))
WHERE farm_slug IS NULL;

-- Example: "Sunrise Acres Farm" → "sunrise-acres-farm"
-- Example: "Green Valley" → "green-valley"

-- Make farm_slug required for new farms
-- ALTER TABLE farms ALTER COLUMN farm_slug SET NOT NULL;
