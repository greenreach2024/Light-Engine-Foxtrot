-- ============================================================
-- Dev Seed Data for Light-Engine-Foxtrot
-- Matches 001_initial_schema.sql + 002_delivery_platform.sql
-- Uses deterministic UUIDs for reproducible dev environments
-- ============================================================

-- ── Users ────────────────────────────────────────────────────
INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone) VALUES
  ('00000000-0000-4000-a000-000000000001', 'admin@lef.dev',          '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'admin',          'Platform', 'Admin',  NULL),
  ('00000000-0000-4000-a000-000000000002', 'ops@lef.dev',            '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'ops',            'Ops',      'Manager', NULL),
  ('00000000-0000-4000-a000-000000000011', 'alice@freshharvest.co',  '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'customer_admin', 'Alice',    'Green',   '+15551001001'),
  ('00000000-0000-4000-a000-000000000012', 'bob@freshharvest.co',    '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'customer_user',  'Bob',      'Green',   '+15551001002'),
  ('00000000-0000-4000-a000-000000000021', 'carol@urbangrocer.co',   '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'customer_admin', 'Carol',    'White',   '+15551002001'),
  ('00000000-0000-4000-a000-000000000091', 'dave@drivers.dev',       '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'driver',         'Dave',     'Ruiz',    '+15559001001'),
  ('00000000-0000-4000-a000-000000000092', 'eve@drivers.dev',        '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'driver',         'Eve',      'Kim',     '+15559001002')
ON CONFLICT (id) DO NOTHING;

-- ── Customers ────────────────────────────────────────────────
INSERT INTO customers (id, name, billing_email, payment_terms_days) VALUES
  ('10000000-0000-4000-a000-000000000001', 'Fresh Harvest Farms', 'billing@freshharvest.co', 14),
  ('10000000-0000-4000-a000-000000000002', 'Urban Grocer Supply', 'billing@urbangrocer.co',  30)
ON CONFLICT (id) DO NOTHING;

-- Link customer-admin users via customer_users join table
INSERT INTO customer_users (user_id, customer_id) VALUES
  ('00000000-0000-4000-a000-000000000011', '10000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-a000-000000000012', '10000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-a000-000000000021', '10000000-0000-4000-a000-000000000002')
ON CONFLICT (user_id, customer_id) DO NOTHING;

-- ── Customer Locations ───────────────────────────────────────
INSERT INTO customer_locations (id, customer_id, label, address_line1, city, state, postal_code, lat, lng, receiving_open, receiving_close, dock_rules, unload_time_min, has_dock) VALUES
  ('20000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'Warehouse A',   '110 Warehouse Way', 'Salinas',       'CA', '93901', 36.6777, -121.6555, '06:00', '14:00', 'Max truck height 14 ft',       20, true),
  ('20000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', 'Cold Storage B', '120 Cold Rd',       'Salinas',       'CA', '93902', 36.6800, -121.6600, '07:00', '12:00', 'Requires dock appointment',    30, true),
  ('20000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000002', 'Market Dock',    '210 Market St Bay', 'San Francisco', 'CA', '94105', 37.7937, -122.3952, '05:00', '11:00', 'Loading bay 2',                15, true),
  ('20000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000002', 'Midtown Annex',  '250 Midtown Dr',    'San Francisco', 'CA', '94103', 37.7849, -122.4094, '08:00', '16:00', NULL,                           10, false)
ON CONFLICT (id) DO NOTHING;

-- ── Products ─────────────────────────────────────────────────
INSERT INTO products (id, sku, name, unit, weight_kg, volume_l, temp_class) VALUES
  ('30000000-0000-4000-a000-000000000001', 'STR-001', 'Organic Strawberries', 'tote', 12.0,  60.0,  'chilled'),
  ('30000000-0000-4000-a000-000000000002', 'TOM-002', 'Heirloom Tomatoes',    'tote', 15.0,  70.0,  'chilled'),
  ('30000000-0000-4000-a000-000000000003', 'SPN-003', 'Baby Spinach',          'tote',  8.0,  50.0,  'chilled'),
  ('30000000-0000-4000-a000-000000000004', 'POT-004', 'Russet Potatoes',       'tote', 20.0,  80.0,  'ambient'),
  ('30000000-0000-4000-a000-000000000005', 'ICE-005', 'Ice Cream Tubs',        'tote', 10.0,  40.0,  'frozen')
ON CONFLICT (id) DO NOTHING;

-- ── Customer Catalog (negotiated prices) ─────────────────────
INSERT INTO customer_catalog (customer_id, product_id, price) VALUES
  ('10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 42.00),
  ('10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000002', 35.00),
  ('10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000003', 28.00),
  ('10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000004', 18.00),
  ('10000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000002', 36.50),
  ('10000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000004', 17.50),
  ('10000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000005', 55.00)
ON CONFLICT (customer_id, product_id) DO NOTHING;

-- ── Drivers ──────────────────────────────────────────────────
INSERT INTO drivers (id, user_id, vehicle_type, capacity_weight_kg, capacity_volume_l, license_expiry, insurance_expiry, is_available, home_zone_lat, home_zone_lng, reliability_score, acceptance_rate) VALUES
  ('40000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000091', 'van',               1200,  800,  '2026-06-30', '2026-06-30', true,  36.6700, -121.6500, 0.92, 0.88),
  ('40000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000092', 'refrigerated_truck', 3000, 1800, '2026-12-31', '2026-12-31', true,  37.7750, -122.4180, 0.87, 0.91)
ON CONFLICT (id) DO NOTHING;

-- ── Pricing Config ───────────────────────────────────────────
INSERT INTO pricing_config (id, label, effective_from, cost_per_km, cost_per_min, cost_per_stop, cost_per_wait_min, alloc_w_km, alloc_w_min, alloc_w_vol, alloc_w_equal, default_margin, pay_base, pay_per_km, pay_per_active_min, pay_per_stop, pay_per_wait_min, min_earnings_rate, wait_grace_min) VALUES
  ('50000000-0000-4000-a000-000000000001', 'Default Pricing', '2025-01-01',
    0.35, 0.12, 3.50, 0.08,
    0.45, 0.35, 0.15, 0.05,
    0.55,
    15.00, 0.55, 0.18, 1.25, 0.20, 0.35, 10)
ON CONFLICT (id) DO NOTHING;

-- ── Sample Orders ────────────────────────────────────────────
INSERT INTO orders (id, order_number, customer_id, location_id, placed_by, requested_date, window_open, window_close, status, total_weight_kg, total_volume_l, tote_count, temp_class, product_total) VALUES
  ('60000000-0000-4000-a000-000000000001', 'LE-20250115-001', '10000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000011', '2025-01-15', '2025-01-15 08:00:00-05', '2025-01-15 12:00:00-05', 'confirmed', 35.0, 180.0, 3, 'chilled',  105.00),
  ('60000000-0000-4000-a000-000000000002', 'LE-20250115-002', '10000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000011', '2025-01-15', '2025-01-15 08:00:00-05', '2025-01-15 11:00:00-05', 'confirmed', 40.0, 160.0, 2, 'ambient',  36.00),
  ('60000000-0000-4000-a000-000000000003', 'LE-20250115-003', '10000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000021', '2025-01-15', '2025-01-15 06:00:00-05', '2025-01-15 10:00:00-05', 'confirmed', 35.0, 150.0, 3, 'frozen',  146.50),
  ('60000000-0000-4000-a000-000000000004', 'LE-20250115-004', '10000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000021', '2025-01-15', '2025-01-15 09:00:00-05', '2025-01-15 15:00:00-05', 'confirmed', 20.0,  80.0, 1, 'ambient',  17.50)
ON CONFLICT (id) DO NOTHING;

INSERT INTO order_lines (id, order_id, product_id, qty, unit_price, line_total) VALUES
  ('70000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 1, 42.00,  42.00),
  ('70000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000002', 1, 35.00,  35.00),
  ('70000000-0000-4000-a000-000000000003', '60000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000003', 1, 28.00,  28.00),
  ('70000000-0000-4000-a000-000000000004', '60000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000004', 2, 18.00,  36.00),
  ('70000000-0000-4000-a000-000000000005', '60000000-0000-4000-a000-000000000003', '30000000-0000-4000-a000-000000000002', 1, 36.50,  36.50),
  ('70000000-0000-4000-a000-000000000006', '60000000-0000-4000-a000-000000000003', '30000000-0000-4000-a000-000000000005', 2, 55.00, 110.00),
  ('70000000-0000-4000-a000-000000000007', '60000000-0000-4000-a000-000000000004', '30000000-0000-4000-a000-000000000004', 1, 17.50,  17.50)
ON CONFLICT (id) DO NOTHING;

-- ── Phase 2: Driver Onboarding Seed Data ─────────────────────

INSERT INTO driver_documents (id, driver_id, doc_type, file_url, file_name, status, expires_at) VALUES
  ('80000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', 'licence',       'https://s3.example.com/docs/drv-001-licence.pdf',   'licence.pdf',       'accepted', '2026-06-30'),
  ('80000000-0000-4000-a000-000000000002', '40000000-0000-4000-a000-000000000001', 'insurance',     'https://s3.example.com/docs/drv-001-insurance.pdf', 'insurance.pdf',     'accepted', '2026-06-30'),
  ('80000000-0000-4000-a000-000000000003', '40000000-0000-4000-a000-000000000002', 'licence',       'https://s3.example.com/docs/drv-002-licence.pdf',   'licence.pdf',       'accepted', '2026-12-31'),
  ('80000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000002', 'insurance',     'https://s3.example.com/docs/drv-002-insurance.pdf', 'insurance.pdf',     'accepted', '2026-12-31'),
  ('80000000-0000-4000-a000-000000000005', '40000000-0000-4000-a000-000000000002', 'vehicle_photo', 'https://s3.example.com/docs/drv-002-vehicle.jpg',   'vehicle-photo.jpg', 'accepted', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO driver_background_checks (id, driver_id, provider, status, submitted_at, completed_at) VALUES
  ('81000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', 'certn', 'passed', '2024-12-02T10:00:00Z', '2024-12-05T16:00:00Z'),
  ('81000000-0000-4000-a000-000000000002', '40000000-0000-4000-a000-000000000002', 'certn', 'passed', '2024-12-16T10:00:00Z', '2024-12-19T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO driver_agreements (id, driver_id, agreement_type, version, status, signed_at) VALUES
  ('82000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', 'contractor_v1', 'v1.0', 'signed', '2024-12-10T09:00:00Z'),
  ('82000000-0000-4000-a000-000000000002', '40000000-0000-4000-a000-000000000002', 'contractor_v1', 'v1.0', 'signed', '2024-12-22T11:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ── Phase 2: Customer Members ────────────────────────────────
INSERT INTO customer_members (id, customer_id, user_id, role, invited_by) VALUES
  ('83000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000011', 'admin',    NULL),
  ('83000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000012', 'receiver', '00000000-0000-4000-a000-000000000011'),
  ('83000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000021', 'admin',    NULL)
ON CONFLICT (id) DO NOTHING;
