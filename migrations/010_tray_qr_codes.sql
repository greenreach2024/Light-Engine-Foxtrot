-- QR Code Bulk Generator Database Schema
-- Stores pre-registered QR codes for tray labels

CREATE TABLE IF NOT EXISTS tray_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    farm_id VARCHAR(50) NOT NULL,
    registered BOOLEAN DEFAULT false,
    tray_id VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    registered_at TIMESTAMP,
    
    CONSTRAINT fk_tray FOREIGN KEY (tray_id) 
        REFERENCES trays(tray_id) 
        ON DELETE SET NULL,
    
    INDEX idx_code (code),
    INDEX idx_farm_id (farm_id),
    INDEX idx_registered (registered)
);

-- Add comments
COMMENT ON TABLE tray_codes IS 'Pre-registered QR codes for tray labels';
COMMENT ON COLUMN tray_codes.code IS 'Unique QR code value (e.g., FARM-TRAY-0001)';
COMMENT ON COLUMN tray_codes.farm_id IS 'Farm that owns this code';
COMMENT ON COLUMN tray_codes.registered IS 'True when tray is first scanned and linked';
COMMENT ON COLUMN tray_codes.tray_id IS 'Linked tray after first scan (NULL until registered)';
