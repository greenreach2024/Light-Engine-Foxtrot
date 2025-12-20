-- GreenReach Central Database Schema
-- PostgreSQL 14+

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Farms table - Core farm information
CREATE TABLE farms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farm_id VARCHAR(20) UNIQUE NOT NULL, -- e.g., GR-00001
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    
    -- Contact Information
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    
    -- Address
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    postal_code VARCHAR(20),
    country VARCHAR(2) DEFAULT 'US',
    
    -- Geo coordinates for mapping
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Registration
    registration_code VARCHAR(50) UNIQUE NOT NULL,
    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activation_date TIMESTAMP,
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, active, suspended, inactive
    tier VARCHAR(20) DEFAULT 'starter', -- starter, professional, enterprise
    
    -- Farm Certifications and Differentiators
    certifications JSONB DEFAULT '[]', -- Array of certification types: GAP, USDA Organic, Food Safety, Greenhouse
    practices JSONB DEFAULT '[]', -- Array of practices: Pesticide Free, Non-GMO, Hydroponic, Local, Year-Round
    attributes JSONB DEFAULT '[]', -- Array of attributes: Woman-Owned, Veteran-Owned, Family Farm, etc.
    
    -- Configuration
    edge_device_id VARCHAR(100), -- Unique device identifier
    edge_device_type VARCHAR(50), -- raspberry-pi, symcod-w101m, etc.
    software_version VARCHAR(20),
    last_sync TIMESTAMP,
    last_heartbeat TIMESTAMP,
    
    -- API Access
    api_key VARCHAR(255) UNIQUE,
    api_secret_hash VARCHAR(255),
    webhook_url VARCHAR(500),
    webhook_secret VARCHAR(255),
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    
    CONSTRAINT valid_status CHECK (status IN ('pending', 'active', 'suspended', 'inactive')),
    CONSTRAINT valid_tier CHECK (tier IN ('starter', 'professional', 'enterprise'))
);

-- Farm users table
CREATE TABLE farm_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farm_id UUID REFERENCES farms(id) ON DELETE CASCADE,
    
    -- User Information
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(50),
    
    -- Role and Permissions
    role VARCHAR(20) DEFAULT 'user', -- admin, manager, user, viewer
    permissions JSONB DEFAULT '[]',
    
    -- Authentication
    email_verified BOOLEAN DEFAULT FALSE,
    email_verification_token VARCHAR(255),
    reset_password_token VARCHAR(255),
    reset_password_expires TIMESTAMP,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active',
    last_login TIMESTAMP,
    login_count INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_farm_email UNIQUE (farm_id, email),
    CONSTRAINT valid_role CHECK (role IN ('admin', 'manager', 'user', 'viewer'))
);

-- Farm configuration table
CREATE TABLE farm_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farm_id UUID REFERENCES farms(id) ON DELETE CASCADE UNIQUE,
    
    -- Production Setup
    total_rooms INTEGER DEFAULT 0,
    total_zones INTEGER DEFAULT 0,
    total_devices INTEGER DEFAULT 0,
    total_trays INTEGER DEFAULT 0,
    
    -- Crop Types (JSON array)
    crop_types JSONB DEFAULT '[]',
    
    -- Equipment Inventory
    equipment JSONB DEFAULT '{}',
    
    -- Business Settings
    business_hours JSONB DEFAULT '{}',
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Wholesale Settings
    wholesale_enabled BOOLEAN DEFAULT TRUE,
    wholesale_minimum_order DECIMAL(10, 2) DEFAULT 0,
    wholesale_delivery_radius_miles INTEGER DEFAULT 50,
    
    -- Sync Settings
    sync_enabled BOOLEAN DEFAULT TRUE,
    sync_interval_minutes INTEGER DEFAULT 5,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Farm inventory table (aggregated from edge)
CREATE TABLE farm_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farm_id UUID REFERENCES farms(id) ON DELETE CASCADE,
    
    -- Product Information
    product_id VARCHAR(100), -- SKU or identifier from farm
    product_name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    variety VARCHAR(100),
    
    -- Inventory
    quantity_available INTEGER DEFAULT 0,
    quantity_reserved INTEGER DEFAULT 0,
    quantity_unit VARCHAR(20) DEFAULT 'units', -- units, lbs, oz, kg, etc.
    
    -- Pricing
    wholesale_price DECIMAL(10, 2),
    retail_price DECIMAL(10, 2),
    
    -- Status
    status VARCHAR(20) DEFAULT 'available', -- available, low_stock, out_of_stock
    
    -- Sync Metadata
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source_data JSONB, -- Full data from farm
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_farm_product UNIQUE (farm_id, product_id)
);

-- Farm health metrics table
CREATE TABLE farm_health (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farm_id UUID REFERENCES farms(id) ON DELETE CASCADE,
    
    -- Health Status
    overall_status VARCHAR(20) DEFAULT 'unknown', -- healthy, warning, critical, offline
    
    -- System Metrics
    cpu_usage DECIMAL(5, 2),
    memory_usage DECIMAL(5, 2),
    disk_usage DECIMAL(5, 2),
    
    -- Application Metrics
    active_devices INTEGER DEFAULT 0,
    offline_devices INTEGER DEFAULT 0,
    alert_count INTEGER DEFAULT 0,
    
    -- Environmental (aggregated)
    avg_temperature DECIMAL(5, 2),
    avg_humidity DECIMAL(5, 2),
    avg_co2 INTEGER,
    
    -- Connectivity
    uptime_seconds BIGINT,
    last_heartbeat TIMESTAMP,
    
    -- Timestamp
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_health_status CHECK (overall_status IN ('healthy', 'warning', 'critical', 'offline', 'unknown'))
);

-- Farm alerts table
CREATE TABLE farm_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farm_id UUID REFERENCES farms(id) ON DELETE CASCADE,
    
    -- Alert Information
    alert_type VARCHAR(50) NOT NULL, -- system, environmental, device, security
    severity VARCHAR(20) DEFAULT 'info', -- info, warning, error, critical
    title VARCHAR(255) NOT NULL,
    message TEXT,
    
    -- Context
    source VARCHAR(100), -- device_id, zone_id, etc.
    metadata JSONB,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active', -- active, acknowledged, resolved
    acknowledged_at TIMESTAMP,
    acknowledged_by UUID,
    resolved_at TIMESTAMP,
    resolved_by UUID,
    
    -- Notification
    notified BOOLEAN DEFAULT FALSE,
    notification_sent_at TIMESTAMP,
    
    -- Timestamp
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_alert_type CHECK (alert_type IN ('system', 'environmental', 'device', 'security', 'other')),
    CONSTRAINT valid_severity CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    CONSTRAINT valid_alert_status CHECK (status IN ('active', 'acknowledged', 'resolved'))
);

-- Wholesale orders table
CREATE TABLE wholesale_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(50) UNIQUE NOT NULL,
    
    -- Customer Information
    customer_id UUID,
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    
    -- Delivery Address
    delivery_address_line1 VARCHAR(255),
    delivery_address_line2 VARCHAR(255),
    delivery_city VARCHAR(100),
    delivery_state VARCHAR(50),
    delivery_postal_code VARCHAR(20),
    delivery_notes TEXT,
    
    -- Order Details
    items JSONB NOT NULL, -- Array of {farm_id, product_id, quantity, price}
    total_amount DECIMAL(10, 2) NOT NULL,
    tax_amount DECIMAL(10, 2) DEFAULT 0,
    delivery_fee DECIMAL(10, 2) DEFAULT 0,
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, confirmed, preparing, ready, delivered, cancelled
    payment_status VARCHAR(20) DEFAULT 'pending', -- pending, paid, refunded
    
    -- Fulfillment (can span multiple farms)
    assigned_farms JSONB, -- Array of farm_ids
    
    -- Dates
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    requested_delivery_date DATE,
    confirmed_delivery_date DATE,
    delivered_at TIMESTAMP,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_order_status CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled')),
    CONSTRAINT valid_payment_status CHECK (payment_status IN ('pending', 'paid', 'refunded'))
);

-- Order fulfillment tracking (per farm)
CREATE TABLE order_fulfillments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES wholesale_orders(id) ON DELETE CASCADE,
    farm_id UUID REFERENCES farms(id) ON DELETE CASCADE,
    
    -- Items from this farm
    items JSONB NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, preparing, packed, shipped, delivered
    
    -- Tracking
    tracking_number VARCHAR(100),
    carrier VARCHAR(50),
    
    -- Dates
    prepared_at TIMESTAMP,
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,
    
    -- Notes
    notes TEXT,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_fulfillment_status CHECK (status IN ('pending', 'preparing', 'packed', 'shipped', 'delivered'))
);

-- Sync log table
CREATE TABLE sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farm_id UUID REFERENCES farms(id) ON DELETE CASCADE,
    
    -- Sync Information
    sync_type VARCHAR(50) NOT NULL, -- inventory, health, config, full
    status VARCHAR(20) DEFAULT 'pending', -- pending, success, failed, partial
    
    -- Metrics
    records_synced INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    duration_ms INTEGER,
    
    -- Error Details
    error_message TEXT,
    error_stack TEXT,
    
    -- Timestamp
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    
    CONSTRAINT valid_sync_status CHECK (status IN ('pending', 'success', 'failed', 'partial'))
);

-- Indexes for performance
CREATE INDEX idx_farms_farm_id ON farms(farm_id);
CREATE INDEX idx_farms_status ON farms(status);
CREATE INDEX idx_farms_last_heartbeat ON farms(last_heartbeat);

CREATE INDEX idx_farm_users_farm_id ON farm_users(farm_id);
CREATE INDEX idx_farm_users_email ON farm_users(email);

CREATE INDEX idx_farm_inventory_farm_id ON farm_inventory(farm_id);
CREATE INDEX idx_farm_inventory_status ON farm_inventory(status);

CREATE INDEX idx_farm_health_farm_id ON farm_health(farm_id);
CREATE INDEX idx_farm_health_recorded_at ON farm_health(recorded_at);

CREATE INDEX idx_farm_alerts_farm_id ON farm_alerts(farm_id);
CREATE INDEX idx_farm_alerts_status ON farm_alerts(status);
CREATE INDEX idx_farm_alerts_severity ON farm_alerts(severity);

CREATE INDEX idx_wholesale_orders_status ON wholesale_orders(status);
CREATE INDEX idx_wholesale_orders_order_date ON wholesale_orders(order_date);

CREATE INDEX idx_order_fulfillments_order_id ON order_fulfillments(order_id);
CREATE INDEX idx_order_fulfillments_farm_id ON order_fulfillments(farm_id);

CREATE INDEX idx_sync_logs_farm_id ON sync_logs(farm_id);
CREATE INDEX idx_sync_logs_started_at ON sync_logs(started_at);

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_farms_updated_at BEFORE UPDATE ON farms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_users_updated_at BEFORE UPDATE ON farm_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_config_updated_at BEFORE UPDATE ON farm_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_inventory_updated_at BEFORE UPDATE ON farm_inventory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_alerts_updated_at BEFORE UPDATE ON farm_alerts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wholesale_orders_updated_at BEFORE UPDATE ON wholesale_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_order_fulfillments_updated_at BEFORE UPDATE ON order_fulfillments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
