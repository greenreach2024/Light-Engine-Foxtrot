-- GreenReach Wholesale Database Schema
-- Migration 001: Core wholesale system tables
-- Created: 2025-12-15
-- 
-- This migration creates all tables for the wholesale system,
-- replacing in-memory Map storage with persistent database storage.

-- ============================================================================
-- FARMS AND BUYER ACCOUNTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS farms (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'inactive',
  region VARCHAR(100),
  default_pickup_windows TEXT, -- JSON array
  payment_provider VARCHAR(50),
  square_merchant_id VARCHAR(255),
  square_location_id VARCHAR(255),
  square_access_token TEXT, -- Encrypted
  square_refresh_token TEXT, -- Encrypted
  square_token_expiry TIMESTAMP,
  light_engine_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('active', 'inactive', 'onboarding', 'suspended'))
);

CREATE INDEX idx_farms_status ON farms(status);
CREATE INDEX idx_farms_square_merchant ON farms(square_merchant_id);

CREATE TABLE IF NOT EXISTS buyer_accounts (
  id VARCHAR(255) PRIMARY KEY,
  org_name VARCHAR(255) NOT NULL,
  contact_users TEXT NOT NULL, -- JSON array
  addresses TEXT NOT NULL, -- JSON array
  delivery_preferences TEXT, -- JSON object
  tax_settings TEXT NOT NULL, -- JSON object
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_buyers_org_name ON buyer_accounts(org_name);

-- ============================================================================
-- CATALOG AND INVENTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS catalog_skus (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  pack_size DECIMAL(10,2) NOT NULL,
  category VARCHAR(100) NOT NULL,
  subcategory VARCHAR(100),
  attributes TEXT, -- JSON object
  default_wholesale_units VARCHAR(50) NOT NULL,
  gtin VARCHAR(50), -- Global Trade Item Number
  allergen_info TEXT, -- JSON object
  certifications TEXT, -- JSON object
  product_tags TEXT, -- JSON array
  shelf_life_days INTEGER,
  storage_requirements TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_catalog_category ON catalog_skus(category);
CREATE INDEX idx_catalog_gtin ON catalog_skus(gtin);

CREATE TABLE IF NOT EXISTS farm_inventory_lots (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL,
  sku_id VARCHAR(255) NOT NULL,
  lot_id VARCHAR(255) NOT NULL,
  qty_available DECIMAL(10,2) NOT NULL DEFAULT 0,
  qty_reserved DECIMAL(10,2) NOT NULL DEFAULT 0,
  harvest_date_start TIMESTAMP NOT NULL,
  harvest_date_end TIMESTAMP NOT NULL,
  quality_flags TEXT, -- JSON array
  traceability TEXT NOT NULL, -- JSON object
  food_safety TEXT NOT NULL, -- JSON object
  certifications TEXT, -- JSON object
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE,
  FOREIGN KEY (sku_id) REFERENCES catalog_skus(id),
  UNIQUE (farm_id, sku_id, lot_id)
);

CREATE INDEX idx_inventory_farm ON farm_inventory_lots(farm_id);
CREATE INDEX idx_inventory_sku ON farm_inventory_lots(sku_id);
CREATE INDEX idx_inventory_lot ON farm_inventory_lots(lot_id);
CREATE INDEX idx_inventory_harvest_date ON farm_inventory_lots(harvest_date_start);

CREATE TABLE IF NOT EXISTS farm_sku_prices (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL,
  sku_id VARCHAR(255) NOT NULL,
  price_per_unit DECIMAL(10,2) NOT NULL,
  pack_pricing TEXT, -- JSON object
  min_order_qty DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE,
  FOREIGN KEY (sku_id) REFERENCES catalog_skus(id),
  UNIQUE (farm_id, sku_id)
);

CREATE INDEX idx_prices_farm ON farm_sku_prices(farm_id);
CREATE INDEX idx_prices_sku ON farm_sku_prices(sku_id);

-- ============================================================================
-- ORDERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS master_orders (
  id VARCHAR(255) PRIMARY KEY,
  buyer_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  broker_fee_total DECIMAL(10,2) NOT NULL,
  tax_total DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  delivery_window_start TIMESTAMP NOT NULL,
  delivery_window_end TIMESTAMP NOT NULL,
  delivery_address TEXT NOT NULL, -- JSON object
  logistics_plan TEXT, -- JSON object
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (buyer_id) REFERENCES buyer_accounts(id),
  CHECK (status IN ('draft', 'reserved', 'payment_pending', 'confirmed', 'in_fulfillment', 'completed', 'cancelled'))
);

CREATE INDEX idx_orders_buyer ON master_orders(buyer_id);
CREATE INDEX idx_orders_status ON master_orders(status);
CREATE INDEX idx_orders_created ON master_orders(created_at);
CREATE INDEX idx_orders_delivery ON master_orders(delivery_window_start);

CREATE TABLE IF NOT EXISTS farm_sub_orders (
  id VARCHAR(255) PRIMARY KEY,
  master_order_id VARCHAR(255) NOT NULL,
  farm_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  line_items TEXT NOT NULL, -- JSON array
  subtotal DECIMAL(10,2) NOT NULL,
  broker_fee_amount DECIMAL(10,2) NOT NULL,
  tax_amount DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  pickup_window_start TIMESTAMP NOT NULL,
  pickup_window_end TIMESTAMP NOT NULL,
  invoice_id VARCHAR(255),
  invoice_url TEXT,
  invoice_issued_at TIMESTAMP,
  fulfillment_status VARCHAR(50),
  tracking_number VARCHAR(255),
  carrier VARCHAR(100),
  shipped_at TIMESTAMP,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (master_order_id) REFERENCES master_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (farm_id) REFERENCES farms(id),
  CHECK (status IN ('allocated', 'reserved', 'confirmed', 'picked', 'staged', 'handed_off', 'completed', 'cancelled')),
  CHECK (fulfillment_status IN ('pending', 'picked', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'))
);

CREATE INDEX idx_sub_orders_master ON farm_sub_orders(master_order_id);
CREATE INDEX idx_sub_orders_farm ON farm_sub_orders(farm_id);
CREATE INDEX idx_sub_orders_status ON farm_sub_orders(status);
CREATE INDEX idx_sub_orders_fulfillment ON farm_sub_orders(fulfillment_status);
CREATE INDEX idx_sub_orders_invoice ON farm_sub_orders(invoice_id);

-- ============================================================================
-- PAYMENTS AND FEES
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_records (
  id VARCHAR(255) PRIMARY KEY,
  farm_sub_order_id VARCHAR(255) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  provider_payment_id VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(50) NOT NULL,
  gross_amount DECIMAL(10,2) NOT NULL,
  broker_fee_amount DECIMAL(10,2) NOT NULL,
  net_to_farm DECIMAL(10,2) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  provider_response TEXT, -- JSON object
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (farm_sub_order_id) REFERENCES farm_sub_orders(id) ON DELETE CASCADE,
  CHECK (provider IN ('square', 'stripe', 'paypal')),
  CHECK (status IN ('created', 'authorized', 'completed', 'failed', 'refunded', 'partially_refunded', 'disputed'))
);

CREATE INDEX idx_payments_sub_order ON payment_records(farm_sub_order_id);
CREATE INDEX idx_payments_provider_id ON payment_records(provider_payment_id);
CREATE INDEX idx_payments_status ON payment_records(status);
CREATE INDEX idx_payments_created ON payment_records(created_at);

CREATE TABLE IF NOT EXISTS broker_fee_records (
  id VARCHAR(255) PRIMARY KEY,
  payment_record_id VARCHAR(255) NOT NULL,
  fee_percent DECIMAL(5,2) NOT NULL,
  fee_amount DECIMAL(10,2) NOT NULL,
  settlement_status VARCHAR(50) NOT NULL,
  settlement_date TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_record_id) REFERENCES payment_records(id) ON DELETE CASCADE,
  CHECK (settlement_status IN ('pending', 'settled', 'reversed'))
);

CREATE INDEX idx_broker_fees_payment ON broker_fee_records(payment_record_id);
CREATE INDEX idx_broker_fees_settlement ON broker_fee_records(settlement_status);

CREATE TABLE IF NOT EXISTS refund_records (
  id VARCHAR(255) PRIMARY KEY,
  payment_record_id VARCHAR(255) NOT NULL,
  provider_refund_id VARCHAR(255),
  refund_amount DECIMAL(10,2) NOT NULL,
  broker_fee_refund_policy VARCHAR(50) NOT NULL,
  broker_fee_refunded DECIMAL(10,2) NOT NULL,
  reason TEXT,
  status VARCHAR(50) NOT NULL,
  initiated_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_record_id) REFERENCES payment_records(id) ON DELETE CASCADE,
  CHECK (broker_fee_refund_policy IN ('proportional', 'full', 'none')),
  CHECK (status IN ('pending', 'completed', 'failed'))
);

CREATE INDEX idx_refunds_payment ON refund_records(payment_record_id);
CREATE INDEX idx_refunds_status ON refund_records(status);
CREATE INDEX idx_refunds_created ON refund_records(created_at);

-- ============================================================================
-- RESERVATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id VARCHAR(255) PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL,
  sku_id VARCHAR(255) NOT NULL,
  lot_id VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  master_order_id VARCHAR(255),
  reservation_key VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE,
  FOREIGN KEY (sku_id) REFERENCES catalog_skus(id),
  CHECK (status IN ('active', 'confirmed', 'released', 'expired'))
);

CREATE INDEX idx_reservations_farm ON inventory_reservations(farm_id);
CREATE INDEX idx_reservations_sku ON inventory_reservations(sku_id);
CREATE INDEX idx_reservations_key ON inventory_reservations(reservation_key);
CREATE INDEX idx_reservations_expires ON inventory_reservations(expires_at);
CREATE INDEX idx_reservations_status ON inventory_reservations(status);

-- ============================================================================
-- FULFILLMENT AND INVOICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS fulfillment_status_log (
  id SERIAL PRIMARY KEY,
  sub_order_id VARCHAR(255) NOT NULL,
  farm_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  location VARCHAR(255),
  notes TEXT,
  tracking_number VARCHAR(255),
  carrier VARCHAR(100),
  updated_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sub_order_id) REFERENCES farm_sub_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (farm_id) REFERENCES farms(id),
  CHECK (status IN ('pending', 'picked', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'))
);

CREATE INDEX idx_fulfillment_sub_order ON fulfillment_status_log(sub_order_id);
CREATE INDEX idx_fulfillment_farm ON fulfillment_status_log(farm_id);
CREATE INDEX idx_fulfillment_status ON fulfillment_status_log(status);
CREATE INDEX idx_fulfillment_created ON fulfillment_status_log(created_at);

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(255) PRIMARY KEY,
  sub_order_id VARCHAR(255) NOT NULL,
  master_order_id VARCHAR(255) NOT NULL,
  buyer_info TEXT NOT NULL, -- JSON object
  line_items TEXT NOT NULL, -- JSON array
  subtotal DECIMAL(10,2) NOT NULL,
  tax DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  broker_fee_amount DECIMAL(10,2) NOT NULL,
  broker_fee_disclosure TEXT NOT NULL,
  invoice_url TEXT,
  issued_at TIMESTAMP NOT NULL,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sub_order_id) REFERENCES farm_sub_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (master_order_id) REFERENCES master_orders(id) ON DELETE CASCADE,
  CHECK (status IN ('issued', 'paid', 'overdue', 'cancelled'))
);

CREATE INDEX idx_invoices_sub_order ON invoices(sub_order_id);
CREATE INDEX idx_invoices_master_order ON invoices(master_order_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_issued ON invoices(issued_at);

-- ============================================================================
-- SLA AND SUBSTITUTION
-- ============================================================================

CREATE TABLE IF NOT EXISTS sla_rules (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  delivery_window_hours INTEGER NOT NULL,
  cutoff_time VARCHAR(10),
  penalty_type VARCHAR(20) NOT NULL,
  penalty_amount DECIMAL(10,2) NOT NULL,
  applies_to VARCHAR(255),
  priority INTEGER,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (penalty_type IN ('percentage', 'fixed'))
);

CREATE INDEX idx_sla_rules_priority ON sla_rules(priority);
CREATE INDEX idx_sla_rules_active ON sla_rules(active);

CREATE TABLE IF NOT EXISTS sla_violations (
  id VARCHAR(255) PRIMARY KEY,
  sub_order_id VARCHAR(255) NOT NULL,
  farm_id VARCHAR(255) NOT NULL,
  rule_id VARCHAR(255) NOT NULL,
  promised_delivery TIMESTAMP NOT NULL,
  actual_delivery TIMESTAMP NOT NULL,
  delay_hours DECIMAL(5,2) NOT NULL,
  penalty_amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(50) NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sub_order_id) REFERENCES farm_sub_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (farm_id) REFERENCES farms(id),
  FOREIGN KEY (rule_id) REFERENCES sla_rules(id),
  CHECK (status IN ('pending', 'notified', 'refunded'))
);

CREATE INDEX idx_sla_violations_sub_order ON sla_violations(sub_order_id);
CREATE INDEX idx_sla_violations_farm ON sla_violations(farm_id);
CREATE INDEX idx_sla_violations_rule ON sla_violations(rule_id);
CREATE INDEX idx_sla_violations_status ON sla_violations(status);

CREATE TABLE IF NOT EXISTS substitution_policies (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  match_criteria TEXT NOT NULL, -- JSON object
  requires_buyer_approval BOOLEAN DEFAULT FALSE,
  notification_required BOOLEAN DEFAULT TRUE,
  approval_timeout_minutes INTEGER,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_substitution_policies_active ON substitution_policies(active);

CREATE TABLE IF NOT EXISTS substitution_approvals (
  id VARCHAR(255) PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL,
  buyer_id VARCHAR(255) NOT NULL,
  original_sku TEXT NOT NULL, -- JSON object
  substitute_sku TEXT NOT NULL, -- JSON object
  reason TEXT,
  status VARCHAR(50) NOT NULL,
  response_notes TEXT,
  requested_at TIMESTAMP NOT NULL,
  responded_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  FOREIGN KEY (order_id) REFERENCES master_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_id) REFERENCES buyer_accounts(id),
  CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
);

CREATE INDEX idx_substitution_approvals_order ON substitution_approvals(order_id);
CREATE INDEX idx_substitution_approvals_buyer ON substitution_approvals(buyer_id);
CREATE INDEX idx_substitution_approvals_status ON substitution_approvals(status);
CREATE INDEX idx_substitution_approvals_expires ON substitution_approvals(expires_at);

CREATE TABLE IF NOT EXISTS buyer_preferences (
  buyer_id VARCHAR(255) PRIMARY KEY,
  default_policy_id VARCHAR(255),
  auto_approve_price_difference DECIMAL(10,2),
  never_substitute TEXT, -- JSON array
  preferred_substitutes TEXT, -- JSON object
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (buyer_id) REFERENCES buyer_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (default_policy_id) REFERENCES substitution_policies(id)
);

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  user_id VARCHAR(255),
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL,
  old_value TEXT, -- JSON object
  new_value TEXT, -- JSON object
  ip_address VARCHAR(50),
  user_agent TEXT,
  metadata TEXT -- JSON object
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);

-- Add trigger function for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to all tables with updated_at
CREATE TRIGGER update_farms_updated_at BEFORE UPDATE ON farms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_buyer_accounts_updated_at BEFORE UPDATE ON buyer_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_catalog_skus_updated_at BEFORE UPDATE ON catalog_skus
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_inventory_lots_updated_at BEFORE UPDATE ON farm_inventory_lots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_sku_prices_updated_at BEFORE UPDATE ON farm_sku_prices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_master_orders_updated_at BEFORE UPDATE ON master_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_farm_sub_orders_updated_at BEFORE UPDATE ON farm_sub_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_records_updated_at BEFORE UPDATE ON payment_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_broker_fee_records_updated_at BEFORE UPDATE ON broker_fee_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_refund_records_updated_at BEFORE UPDATE ON refund_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventory_reservations_updated_at BEFORE UPDATE ON inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_buyer_preferences_updated_at BEFORE UPDATE ON buyer_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
