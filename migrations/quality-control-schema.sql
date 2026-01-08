-- Quality Control System Database Schema
-- Migration: Create QA tables for checkpoints, photos, and standards

-- Table: qa_checkpoints
-- Stores quality control checkpoint records with results and photos
CREATE TABLE IF NOT EXISTS qa_checkpoints (
    id SERIAL PRIMARY KEY,
    batch_id VARCHAR(255) NOT NULL,
    checkpoint_type VARCHAR(50) NOT NULL,
    inspector VARCHAR(255) NOT NULL,
    result VARCHAR(50) NOT NULL,
    notes TEXT,
    photo_data TEXT,
    metrics JSONB,
    corrective_action TEXT,
    farm_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for qa_checkpoints
CREATE INDEX IF NOT EXISTS idx_qa_checkpoints_batch_id ON qa_checkpoints(batch_id);
CREATE INDEX IF NOT EXISTS idx_qa_checkpoints_checkpoint_type ON qa_checkpoints(checkpoint_type);
CREATE INDEX IF NOT EXISTS idx_qa_checkpoints_result ON qa_checkpoints(result);
CREATE INDEX IF NOT EXISTS idx_qa_checkpoints_farm_id ON qa_checkpoints(farm_id);
CREATE INDEX IF NOT EXISTS idx_qa_checkpoints_created_at ON qa_checkpoints(created_at DESC);

-- Table: qa_standards
-- Stores quality criteria definitions for each checkpoint type
CREATE TABLE IF NOT EXISTS qa_standards (
    id SERIAL PRIMARY KEY,
    checkpoint_type VARCHAR(50) NOT NULL UNIQUE,
    crop_type VARCHAR(100) DEFAULT 'all',
    criteria JSONB NOT NULL,
    pass_threshold VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default QA standards
INSERT INTO qa_standards (checkpoint_type, criteria, pass_threshold) VALUES
('seeding', 
 '["Seeds placed correctly in medium", "Proper spacing maintained", "Medium moisture level adequate", "No contamination visible", "Tray labels applied correctly"]'::jsonb,
 'All criteria met'),
('germination',
 '["Germination rate above 85%", "Seedlings uniform in size", "No mold or fungus present", "Root development visible", "Cotyledons fully opened"]'::jsonb,
 'Minimum 85% germination'),
('transplant',
 '["Plants transferred without damage", "Roots properly positioned", "Proper depth in growing medium", "No wilting observed", "Spacing meets specifications"]'::jsonb,
 'Less than 5% damage'),
('growth_midpoint',
 '["Growth rate on target", "Color and vigor good", "No pest damage visible", "No nutrient deficiency signs", "Proper size for stage"]'::jsonb,
 'No major issues'),
('pre_harvest',
 '["Size meets harvest specifications", "Color appropriate for variety", "No pest damage or disease", "Firmness and texture correct", "Ready for harvest timing"]'::jsonb,
 'Meets all harvest criteria'),
('post_harvest',
 '["Harvest completed without damage", "Proper handling maintained", "Temperature controlled", "No wilting or bruising", "Trimming and cleaning adequate"]'::jsonb,
 'Less than 2% waste'),
('packing',
 '["Proper packaging materials used", "Weight meets specifications", "Labeling correct and legible", "No damaged product included", "Temperature maintained"]'::jsonb,
 'All packing standards met'),
('pre_shipment',
 '["Final visual inspection passed", "Temperature logs verified", "Documentation complete", "Packaging integrity intact", "Ready for customer delivery"]'::jsonb,
 'Ready to ship')
ON CONFLICT (checkpoint_type) DO NOTHING;

-- Table: qa_photos (for future use - separate photo storage)
-- Currently photos are stored in qa_checkpoints.photo_data
CREATE TABLE IF NOT EXISTS qa_photos (
    id SERIAL PRIMARY KEY,
    checkpoint_id INTEGER REFERENCES qa_checkpoints(id) ON DELETE CASCADE,
    photo_data TEXT NOT NULL,
    photo_url VARCHAR(500),
    file_size INTEGER,
    mime_type VARCHAR(50) DEFAULT 'image/jpeg',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for qa_photos
CREATE INDEX IF NOT EXISTS idx_qa_photos_checkpoint_id ON qa_photos(checkpoint_id);

-- Comments for documentation
COMMENT ON TABLE qa_checkpoints IS 'Quality control checkpoint records with AI analysis and photos';
COMMENT ON TABLE qa_standards IS 'Quality criteria definitions for each checkpoint type';
COMMENT ON TABLE qa_photos IS 'Separate photo storage for QA checkpoints (future S3 migration)';

COMMENT ON COLUMN qa_checkpoints.batch_id IS 'Batch QR code or identifier';
COMMENT ON COLUMN qa_checkpoints.checkpoint_type IS 'Type: seeding, germination, transplant, growth_midpoint, pre_harvest, post_harvest, packing, pre_shipment';
COMMENT ON COLUMN qa_checkpoints.result IS 'Result: pass, pass_with_notes, fail, pending';
COMMENT ON COLUMN qa_checkpoints.metrics IS 'AI analysis results: health_score, assessment, color_quality, etc.';
COMMENT ON COLUMN qa_checkpoints.photo_data IS 'Base64 encoded image data (data:image/jpeg;base64,...)';
