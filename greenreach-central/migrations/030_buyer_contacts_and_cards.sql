-- Migration 030: Buyer contacts, card-on-file, and subscription support
-- Adds key_contact, backup_contact, backup_phone to wholesale_buyers
-- Adds Square customer_id and card_id for card-on-file payments
-- Adds wholesale_subscriptions table for recurring orders

ALTER TABLE wholesale_buyers ADD COLUMN IF NOT EXISTS key_contact VARCHAR(255);
ALTER TABLE wholesale_buyers ADD COLUMN IF NOT EXISTS backup_contact VARCHAR(255);
ALTER TABLE wholesale_buyers ADD COLUMN IF NOT EXISTS backup_phone VARCHAR(50);
ALTER TABLE wholesale_buyers ADD COLUMN IF NOT EXISTS square_customer_id VARCHAR(255);
ALTER TABLE wholesale_buyers ADD COLUMN IF NOT EXISTS square_card_id VARCHAR(255);

CREATE TABLE IF NOT EXISTS wholesale_subscriptions (
  id VARCHAR(255) PRIMARY KEY,
  buyer_id VARCHAR(255) NOT NULL REFERENCES wholesale_buyers(id),
  farm_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  cadence VARCHAR(50) NOT NULL DEFAULT 'weekly',
  next_order_date DATE NOT NULL,
  cart JSONB NOT NULL DEFAULT '[]',
  delivery_address JSONB,
  fulfillment_method VARCHAR(50) DEFAULT 'delivery',
  payment_method VARCHAR(50) DEFAULT 'card_on_file',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_buyer ON wholesale_subscriptions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_date ON wholesale_subscriptions(next_order_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON wholesale_subscriptions(status);
