-- ============================================================
-- Dev Seed Data for Light-Engine-Foxtrot
-- Matches 001_initial_schema.sql + 002_delivery_platform.sql
-- ============================================================

-- ── Users ────────────────────────────────────────────────────
INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone) VALUES
  ('u-admin-001',  'admin@lef.dev',          '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'admin',          'Platform', 'Admin',  NULL),
  ('u-ops-001',    'ops@lef.dev',            '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'ops',            'Ops',      'Manager', NULL),
  ('u-cust1-001',  'alice@freshharvest.co',  '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'customer_admin', 'Alice',    'Green',   '+15551001001'),
  ('u-cust1-002',  'bob@freshharvest.co',    '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'customer_user',  'Bob',      'Green',   '+15551001002'),
  ('u-cust2-001',  'carol@urbangrocer.co',   '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'customer_admin', 'Carol',    'White',   '+15551002001'),
  ('u-drv-001',    'dave@drivers.dev',       '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'driver',         'Dave',     'Ruiz',    '+15559001001'),
  ('u-drv-002',    'eve@drivers.dev',        '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ1234', 'driver',         'Eve',      'Kim',     '+15559001002')
ON CONFLICT (id) DO NOTHING;

-- ── Customers ────────────────────────────────────────────────
INSERT INTO customers (id, name, billing_email, payment_terms_days) VALUES
  ('cust-001', 'Fresh Harvest Farms', 'billing@freshharvest.co', 14),
  ('cust-002', 'Urban Grocer Supply', 'billing@urbangrocer.co',  30)
ON CONFLICT (id) DO NOTHING;

-- Link customer-admin users via customer_users join table
INSERT INTO customer_users (user_id, customer_id) VALUES
  ('u-cust1-001', 'cust-001'),
  ('u-cust1-002', 'cust-001'),
  ('u-cust2-001', 'cust-002')
ON CONFLICT (user_id, customer_id) DO NOTHING;

-- ── Customer Locations ───────────────────────────────────────
INSERT INTO customer_locations (id, customer_id, label, address_line1, city, state, postal_code, lat, lng, receiving_open, receiving_close, dock_rules, unload_time_min, has_dock) VALUES
  ('loc-001', 'cust-001', 'Warehouse A',   '110 Warehouse Way', 'Salinas',       'CA', '93901', 36.6777, -121.6555, '06:00', '14:00', 'Max truck height 14 ft',       20, true),
  ('loc-002', 'cust-001', 'Cold Storage B', '120 Cold Rd',       'Salinas',       'CA', '93902', 36.6800, -121.6600, '07:00', '12:00', 'Requires dock appointment',    30, true),
  ('loc-003', 'cust-002', 'Market Dock',    '210 Market St Bay', 'San Francisco', 'CA', '94105', 37.7937, -122.3952, '05:00', '11:00', 'Loading bay 2',                15, true),
  ('loc-004', 'cust-002', 'Midtown Annex',  '250 Midtown Dr',    'San Francisco', 'CA', '94103', 37.7849, -122.4094, '08:00', '16:00', NULL,                           10, false)
ON CONFLICT (id) DO NOTHING;

-- ── Products ─────────────────────────────────────────────────
INSERT INTO products (id, sku, name, unit, weight_kg, volume_l, temp_class) VALUES
  ('prod-001', 'STR-001', 'Organic Strawberries', 'tote', 12.0,  60.0,  'chilled'),
  ('prod-002', 'TOM-002', 'Heirloom Tomatoes',    'tote', 15.0,  70.0,  'chilled'),
  ('prod-003', 'SPN-003', 'Baby Spinach',          'tote',  8.0,  50.0,  'chilled'),
  ('prod-004', 'POT-004', 'Russet Potatoes',       'tote', 20.0,  80.0,  'ambient'),
  ('prod-005', 'ICE-005', 'Ice Cream Tubs',        'tote', 10.0,  40.0,  'frozen')
ON CONFLICT (id) DO NOTHING;

-- ── Customer Catalog (negotiated prices) ─────────────────────
INSERT INTO customer_catalog (customer_id, product_id, price) VALUES
  ('cust-001', 'prod-001', 42.00),
  ('cust-001', 'prod-002', 35.00),
  ('cust-001', 'prod-003', 28.00),
  ('cust-001', 'prod-004', 18.00),
  ('cust-002', 'prod-002', 36.50),
  ('cust-002', 'prod-004', 17.50),
  ('cust-002', 'prod-005', 55.00)
ON CONFLICT (customer_id, product_id) DO NOTHING;

-- ── Drivers ──────────────────────────────────────────────────
INSERT INTO drivers (id, user_id, vehicle_type, capacity_weight_kg, capacity_volume_l, license_expiry, insurance_expiry, is_available, home_zone_lat, home_zone_lng, reliability_score, acceptance_rate) VALUES
  ('drv-001', 'u-drv-001', 'van',               1200,  800,  '2026-06-30', '2026-06-30', true,  36.6700, -121.6500, 0.92, 0.88),
  ('drv-002', 'u-drv-002', 'refrigerated_truck', 3000, 1800, '2026-12-31', '2026-12-31', true,  37.7750, -122.4180, 0.87, 0.91)
ON CONFLICT (id) DO NOTHING;

-- ── Pricing Config ───────────────────────────────────────────
INSERT INTO pricing_config (id, label, effective_from, cost_per_km, cost_per_min, cost_per_stop, cost_per_wait_min, alloc_w_km, alloc_w_min, alloc_w_vol, alloc_w_equal, default_margin, pay_base, pay_per_km, pay_per_active_min, pay_per_stop, pay_per_wait_min, min_earnings_rate, wait_grace_min) VALUES
  ('price-default', 'Default Pricing', '2025-01-01',
    0.35, 0.12, 3.50, 0.08,
    0.45, 0.35, 0.15, 0.05,
    0.55,
    15.00, 0.55, 0.18, 1.25, 0.20, 0.35, 10)
ON CONFLICT (id) DO NOTHING;

-- ── Sample Orders ────────────────────────────────────────────
INSERT INTO orders (id, order_number, customer_id, location_id, placed_by, requested_date, window_open, window_close, status, total_weight_kg, total_volume_l, tote_count, temp_class, product_total) VALUES
  ('ord-001', 'LE-20250115-001', 'cust-001', 'loc-001', 'u-cust1-001', '2025-01-15', '2025-01-15 08:00:00-05', '2025-01-15 12:00:00-05', 'confirmed', 35.0, 180.0, 3, 'chilled',  105.00),
  ('ord-002', 'LE-20250115-002', 'cust-001', 'loc-002', 'u-cust1-001', '2025-01-15', '2025-01-15 08:00:00-05', '2025-01-15 11:00:00-05', 'confirmed', 40.0, 160.0, 2, 'ambient',  36.00),
  ('ord-003', 'LE-20250115-003', 'cust-002', 'loc-003', 'u-cust2-001', '2025-01-15', '2025-01-15 06:00:00-05', '2025-01-15 10:00:00-05', 'confirmed', 35.0, 150.0, 3, 'frozen',  146.50),
  ('ord-004', 'LE-20250115-004', 'cust-002', 'loc-004', 'u-cust2-001', '2025-01-15', '2025-01-15 09:00:00-05', '2025-01-15 15:00:00-05', 'confirmed', 20.0,  80.0, 1, 'ambient',  17.50)
ON CONFLICT (id) DO NOTHING;

INSERT INTO order_lines (id, order_id, product_id, qty, unit_price, line_total) VALUES
  ('ol-001', 'ord-001', 'prod-001', 1, 42.00,  42.00),
  ('ol-002', 'ord-001', 'prod-002', 1, 35.00,  35.00),
  ('ol-003', 'ord-001', 'prod-003', 1, 28.00,  28.00),
  ('ol-004', 'ord-002', 'prod-004', 2, 18.00,  36.00),
  ('ol-005', 'ord-003', 'prod-002', 1, 36.50,  36.50),
  ('ol-006', 'ord-003', 'prod-005', 2, 55.00, 110.00),
  ('ol-007', 'ord-004', 'prod-004', 1, 17.50,  17.50)
ON CONFLICT (id) DO NOTHING;

-- ── Phase 2: Driver Onboarding Seed Data ─────────────────────
INSERT INTO driver_applications (id, driver_id, status, submitted_at) VALUES
  ('app-001', 'drv-001', 'active',    '2024-12-01T10:00:00Z'),
  ('app-002', 'drv-002', 'active',    '2024-12-15T14:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO driver_documents (id, driver_id, doc_type, file_url, file_name, status, expires_at) VALUES
  ('doc-001', 'drv-001', 'licence',       'https://s3.example.com/docs/drv-001-licence.pdf',   'licence.pdf',       'accepted', '2026-06-30'),
  ('doc-002', 'drv-001', 'insurance',     'https://s3.example.com/docs/drv-001-insurance.pdf', 'insurance.pdf',     'accepted', '2026-06-30'),
  ('doc-003', 'drv-002', 'licence',       'https://s3.example.com/docs/drv-002-licence.pdf',   'licence.pdf',       'accepted', '2026-12-31'),
  ('doc-004', 'drv-002', 'insurance',     'https://s3.example.com/docs/drv-002-insurance.pdf', 'insurance.pdf',     'accepted', '2026-12-31'),
  ('doc-005', 'drv-002', 'vehicle_photo', 'https://s3.example.com/docs/drv-002-vehicle.jpg',   'vehicle-photo.jpg', 'accepted', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO driver_background_checks (id, driver_id, provider, status, submitted_at, completed_at) VALUES
  ('bg-001', 'drv-001', 'certn', 'passed', '2024-12-02T10:00:00Z', '2024-12-05T16:00:00Z'),
  ('bg-002', 'drv-002', 'certn', 'passed', '2024-12-16T10:00:00Z', '2024-12-19T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO driver_agreements (id, driver_id, agreement_type, version, status, signed_at) VALUES
  ('agr-001', 'drv-001', 'contractor', 'v1.0', 'signed', '2024-12-10T09:00:00Z'),
  ('agr-002', 'drv-002', 'contractor', 'v1.0', 'signed', '2024-12-22T11:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ── Phase 2: Customer Members ────────────────────────────────
INSERT INTO customer_members (id, customer_id, user_id, role, invited_by) VALUES
  ('cm-001', 'cust-001', 'u-cust1-001', 'admin',    NULL),
  ('cm-002', 'cust-001', 'u-cust1-002', 'receiver', 'u-cust1-001'),
  ('cm-003', 'cust-002', 'u-cust2-001', 'admin',    NULL)
ON CONFLICT (id) DO NOTHING;
