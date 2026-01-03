-- GreenReach Wholesale Database Schema
-- Migration 002: Order Audit Logging System
-- Created: 2026-01-01
-- 
-- This migration creates audit logging table for tracking all order actions
-- performed by farm workers through the Activity Hub interface.

-- ============================================================================
-- ORDER AUDIT LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS wholesale_order_logs (
  id SERIAL PRIMARY KEY,
  sub_order_id VARCHAR(255) NOT NULL,
  farm_id VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL,
  details JSONB,
  performed_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign key constraints (if sub_orders table exists)
  -- FOREIGN KEY (sub_order_id) REFERENCES wholesale_sub_orders(id) ON DELETE CASCADE,
  -- FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE,
  
  CHECK (action IN ('accept', 'modify', 'decline', 'pick', 'pack', 'ship', 'other'))
);

-- Indexes for efficient querying
CREATE INDEX idx_order_logs_sub_order ON wholesale_order_logs(sub_order_id);
CREATE INDEX idx_order_logs_farm ON wholesale_order_logs(farm_id);
CREATE INDEX idx_order_logs_action ON wholesale_order_logs(action);
CREATE INDEX idx_order_logs_created ON wholesale_order_logs(created_at DESC);
CREATE INDEX idx_order_logs_details ON wholesale_order_logs USING GIN(details);

-- Combined index for common queries
CREATE INDEX idx_order_logs_farm_action_date ON wholesale_order_logs(farm_id, action, created_at DESC);

-- ============================================================================
-- AUDIT LOG QUERY VIEWS
-- ============================================================================

-- View: Recent order actions (last 7 days)
CREATE OR REPLACE VIEW recent_order_actions AS
SELECT 
  l.id,
  l.sub_order_id,
  l.farm_id,
  f.name as farm_name,
  l.action,
  l.details,
  l.performed_by,
  l.created_at
FROM wholesale_order_logs l
LEFT JOIN farms f ON l.farm_id = f.id
WHERE l.created_at >= NOW() - INTERVAL '7 days'
ORDER BY l.created_at DESC;

-- View: Order action timeline (for traceability)
CREATE OR REPLACE VIEW order_action_timeline AS
SELECT 
  l.sub_order_id,
  l.farm_id,
  f.name as farm_name,
  l.action,
  l.performed_by,
  l.created_at,
  l.details->>'lot_codes' as lot_codes,
  l.details->>'reason' as reason,
  l.details->>'modifications' as modifications
FROM wholesale_order_logs l
LEFT JOIN farms f ON l.farm_id = f.id
ORDER BY l.sub_order_id, l.created_at ASC;

-- View: Farm activity summary
CREATE OR REPLACE VIEW farm_order_activity_summary AS
SELECT 
  l.farm_id,
  f.name as farm_name,
  l.action,
  COUNT(*) as action_count,
  COUNT(DISTINCT l.sub_order_id) as unique_orders,
  MAX(l.created_at) as last_action_time
FROM wholesale_order_logs l
LEFT JOIN farms f ON l.farm_id = f.id
WHERE l.created_at >= NOW() - INTERVAL '30 days'
GROUP BY l.farm_id, f.name, l.action
ORDER BY l.farm_id, action_count DESC;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function: Get complete order audit trail
CREATE OR REPLACE FUNCTION get_order_audit_trail(p_sub_order_id VARCHAR)
RETURNS TABLE (
  log_id INTEGER,
  action VARCHAR(50),
  performed_by VARCHAR(255),
  action_time TIMESTAMP,
  details JSONB,
  farm_name VARCHAR(255)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.id as log_id,
    l.action,
    l.performed_by,
    l.created_at as action_time,
    l.details,
    f.name as farm_name
  FROM wholesale_order_logs l
  LEFT JOIN farms f ON l.farm_id = f.id
  WHERE l.sub_order_id = p_sub_order_id
  ORDER BY l.created_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Function: Get farm activity for date range
CREATE OR REPLACE FUNCTION get_farm_activity(
  p_farm_id VARCHAR,
  p_start_date TIMESTAMP,
  p_end_date TIMESTAMP
)
RETURNS TABLE (
  action VARCHAR(50),
  action_count BIGINT,
  unique_orders BIGINT,
  avg_actions_per_order NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.action,
    COUNT(*) as action_count,
    COUNT(DISTINCT l.sub_order_id) as unique_orders,
    ROUND(COUNT(*)::NUMERIC / NULLIF(COUNT(DISTINCT l.sub_order_id), 0), 2) as avg_actions_per_order
  FROM wholesale_order_logs l
  WHERE l.farm_id = p_farm_id
    AND l.created_at BETWEEN p_start_date AND p_end_date
  GROUP BY l.action
  ORDER BY action_count DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS AND DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE wholesale_order_logs IS 'Audit trail for all wholesale order actions performed by farms';
COMMENT ON COLUMN wholesale_order_logs.sub_order_id IS 'Sub-order ID (farm-specific portion of wholesale order)';
COMMENT ON COLUMN wholesale_order_logs.farm_id IS 'Farm ID that performed the action';
COMMENT ON COLUMN wholesale_order_logs.action IS 'Action type: accept, modify, decline, pick, pack, ship';
COMMENT ON COLUMN wholesale_order_logs.details IS 'JSON details specific to the action (lot codes, modifications, reasons)';
COMMENT ON COLUMN wholesale_order_logs.performed_by IS 'Name of farm worker who performed the action';
COMMENT ON COLUMN wholesale_order_logs.created_at IS 'Timestamp when action was logged';

-- ============================================================================
-- SAMPLE QUERIES
-- ============================================================================

-- Get complete audit trail for an order:
-- SELECT * FROM get_order_audit_trail('SUB-ABC123');

-- Get farm activity for last 30 days:
-- SELECT * FROM get_farm_activity('farm_001', NOW() - INTERVAL '30 days', NOW());

-- Find all declined orders with reasons:
-- SELECT sub_order_id, performed_by, details->>'reason' as decline_reason, created_at
-- FROM wholesale_order_logs
-- WHERE action = 'decline'
-- ORDER BY created_at DESC;

-- Find orders with lot codes generated:
-- SELECT sub_order_id, details->>'lot_codes' as lot_codes, created_at
-- FROM wholesale_order_logs
-- WHERE action = 'pick'
-- ORDER BY created_at DESC;

-- Farm performance metrics:
-- SELECT farm_id, farm_name, action, action_count, unique_orders
-- FROM farm_order_activity_summary
-- ORDER BY unique_orders DESC, action_count DESC;
