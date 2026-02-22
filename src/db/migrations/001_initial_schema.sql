-- ============================================================
-- Light-Engine-Foxtrot  ·  Initial Schema
-- B2B Farm → Wholesale Last-Mile Delivery Platform
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ENUM TYPES ──────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('customer_admin','customer_user','driver','ops','admin');
CREATE TYPE order_status AS ENUM ('draft','confirmed','picking','packed','staged','dispatched','in_transit','delivered','cancelled','exception');
CREATE TYPE temp_class AS ENUM ('ambient','chilled','frozen');
CREATE TYPE route_status AS ENUM ('planned','published','offered','accepted','in_progress','completed','cancelled');
CREATE TYPE wave_status AS ENUM ('open','cutoff','planning','published','completed','cancelled');
CREATE TYPE driver_offer_status AS ENUM ('pending','accepted','declined','expired','cancelled');
CREATE TYPE invoice_status AS ENUM ('draft','issued','sent','paid','overdue','disputed','credited');
CREATE TYPE payout_status AS ENUM ('pending','processing','paid','failed','disputed');
CREATE TYPE pod_exception AS ENUM ('none','partial_delivery','refused','damaged','wrong_items','temp_breach','access_issue','other');
CREATE TYPE vehicle_type AS ENUM ('car','van','refrigerated_van','small_truck','refrigerated_truck');
CREATE TYPE surcharge_type AS ENUM ('tight_window','rush','oversize','heavy','difficult_access','fuel_adjustment','extra_totes');

-- ─── USERS & AUTH ────────────────────────────────────────────

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  phone         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  details     JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── CUSTOMERS ───────────────────────────────────────────────

CREATE TABLE customers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,                          -- business name
  billing_email     TEXT NOT NULL,
  payment_terms_days INT NOT NULL DEFAULT 14,               -- Net 7/14/30
  tax_id            TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_users (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, customer_id)
);

CREATE TABLE customer_locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,                            -- "Main Kitchen", "Warehouse #2"
  address_line1   TEXT NOT NULL,
  address_line2   TEXT,
  city            TEXT NOT NULL,
  state           TEXT NOT NULL,
  postal_code     TEXT NOT NULL,
  country         TEXT NOT NULL DEFAULT 'US',
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  -- Receiving constraints
  receiving_open  TIME NOT NULL DEFAULT '06:00',
  receiving_close TIME NOT NULL DEFAULT '18:00',
  dock_rules      TEXT,                                     -- "Use rear entrance, call on arrival"
  unload_time_min INT NOT NULL DEFAULT 15,                  -- estimated service time
  has_dock        BOOLEAN NOT NULL DEFAULT false,
  requires_stairs BOOLEAN NOT NULL DEFAULT false,
  special_instructions TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PRODUCT CATALOG (per-customer pricing) ──────────────────

CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  unit        TEXT NOT NULL DEFAULT 'each',                 -- each, kg, case, tote
  weight_kg   DOUBLE PRECISION,
  volume_l    DOUBLE PRECISION,
  temp_class  temp_class NOT NULL DEFAULT 'ambient',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_catalog (
  customer_id UUID NOT NULL REFERENCES customers(id),
  product_id  UUID NOT NULL REFERENCES products(id),
  price       NUMERIC(10,2) NOT NULL,                       -- customer-specific price
  is_active   BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (customer_id, product_id)
);

-- ─── ORDERS ──────────────────────────────────────────────────

CREATE TABLE orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        TEXT UNIQUE NOT NULL,                  -- human-readable LE-20260221-001
  customer_id         UUID NOT NULL REFERENCES customers(id),
  location_id         UUID NOT NULL REFERENCES customer_locations(id),
  placed_by           UUID NOT NULL REFERENCES users(id),
  status              order_status NOT NULL DEFAULT 'draft',
  -- Delivery window
  requested_date      DATE NOT NULL,
  window_open         TIMESTAMPTZ NOT NULL,
  window_close        TIMESTAMPTZ NOT NULL,
  -- Aggregates (computed on line changes)
  total_weight_kg     DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_volume_l      DOUBLE PRECISION NOT NULL DEFAULT 0,
  tote_count          INT NOT NULL DEFAULT 0,
  temp_class          temp_class NOT NULL DEFAULT 'ambient', -- highest temp requirement
  -- Product total (sum of line items)
  product_total       NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_fee        NUMERIC(10,2),                         -- filled by pricing engine
  total_amount        NUMERIC(10,2),
  -- Standing order link
  recurring_schedule_id UUID,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  qty         DOUBLE PRECISION NOT NULL,
  unit_price  NUMERIC(10,2) NOT NULL,
  line_total  NUMERIC(10,2) NOT NULL,
  weight_kg   DOUBLE PRECISION NOT NULL DEFAULT 0,
  volume_l    DOUBLE PRECISION NOT NULL DEFAULT 0,
  temp_class  temp_class NOT NULL DEFAULT 'ambient',
  -- Pick/pack
  qty_picked  DOUBLE PRECISION NOT NULL DEFAULT 0,
  qty_packed  DOUBLE PRECISION NOT NULL DEFAULT 0,
  substitution_product_id UUID REFERENCES products(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recurring_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id),
  location_id   UUID NOT NULL REFERENCES customer_locations(id),
  cron_expr     TEXT NOT NULL,                               -- "0 0 * * 1,3,5" = MWF
  window_open   TIME NOT NULL,
  window_close  TIME NOT NULL,
  template_lines JSONB NOT NULL DEFAULT '[]',                -- [{product_id, qty}]
  is_active     BOOLEAN NOT NULL DEFAULT true,
  next_run_date DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── DRIVERS ─────────────────────────────────────────────────

CREATE TABLE drivers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID UNIQUE NOT NULL REFERENCES users(id),
  vehicle_type      vehicle_type NOT NULL,
  vehicle_plate     TEXT,
  capacity_weight_kg DOUBLE PRECISION NOT NULL,
  capacity_volume_l  DOUBLE PRECISION NOT NULL,
  capacity_totes    INT NOT NULL DEFAULT 50,
  insurance_expiry  DATE,
  license_expiry    DATE,
  has_food_safety_cert BOOLEAN NOT NULL DEFAULT false,
  home_zone_lat     DOUBLE PRECISION,
  home_zone_lng     DOUBLE PRECISION,
  home_zone_radius_km DOUBLE PRECISION DEFAULT 30,
  -- Scoring inputs
  reliability_score DOUBLE PRECISION NOT NULL DEFAULT 0.8,   -- 0..1
  acceptance_rate   DOUBLE PRECISION NOT NULL DEFAULT 0.9,   -- 0..1
  risk_flags        INT NOT NULL DEFAULT 0,
  is_available      BOOLEAN NOT NULL DEFAULT false,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── WAVES & ROUTES ──────────────────────────────────────────

CREATE TABLE waves (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_date       DATE NOT NULL,
  wave_label      TEXT NOT NULL,                             -- "2026-02-21 AM", "2026-02-21 PM"
  cutoff_at       TIMESTAMPTZ NOT NULL,                      -- order intake deadline
  departure_at    TIMESTAMPTZ,                               -- planned farm departure
  status          wave_status NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE routes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id             UUID NOT NULL REFERENCES waves(id),
  route_number        TEXT UNIQUE NOT NULL,                   -- RT-20260221-AM-01
  driver_id           UUID REFERENCES drivers(id),
  status              route_status NOT NULL DEFAULT 'planned',
  -- Route plan summary
  planned_km          DOUBLE PRECISION NOT NULL DEFAULT 0,
  planned_duration_min INT NOT NULL DEFAULT 0,
  planned_stops       INT NOT NULL DEFAULT 0,
  planned_wait_min    INT NOT NULL DEFAULT 0,
  -- Actuals (filled during execution)
  actual_km           DOUBLE PRECISION,
  actual_duration_min INT,
  actual_start_at     TIMESTAMPTZ,
  actual_end_at       TIMESTAMPTZ,
  -- Cost & pay
  route_cost          NUMERIC(10,2),                          -- internal cost estimate
  driver_pay          NUMERIC(10,2),                          -- computed pay
  total_revenue       NUMERIC(10,2),                          -- sum of stop fees
  route_margin        NUMERIC(10,2),                          -- revenue - pay - overhead
  -- Constraints applied
  max_weight_kg       DOUBLE PRECISION,
  max_volume_l        DOUBLE PRECISION,
  temp_class          temp_class NOT NULL DEFAULT 'ambient',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE route_stops (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id            UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  order_id            UUID NOT NULL REFERENCES orders(id),
  location_id         UUID NOT NULL REFERENCES customer_locations(id),
  stop_sequence       INT NOT NULL,
  -- Time plan
  planned_arrival     TIMESTAMPTZ,
  planned_departure   TIMESTAMPTZ,
  window_open         TIMESTAMPTZ NOT NULL,
  window_close        TIMESTAMPTZ NOT NULL,
  service_time_min    INT NOT NULL DEFAULT 15,
  -- Marginal contribution (for pricing allocation)
  marginal_km         DOUBLE PRECISION NOT NULL DEFAULT 0,
  marginal_min        DOUBLE PRECISION NOT NULL DEFAULT 0,
  volume_share        DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- Cost allocation
  cost_share          DOUBLE PRECISION NOT NULL DEFAULT 0,    -- 0..1 fraction
  allocated_cost      NUMERIC(10,2),
  delivery_fee        NUMERIC(10,2),
  -- Actuals
  actual_arrival      TIMESTAMPTZ,
  actual_departure    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── DRIVER OFFERS ───────────────────────────────────────────

CREATE TABLE driver_offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id    UUID NOT NULL REFERENCES routes(id),
  driver_id   UUID NOT NULL REFERENCES drivers(id),
  status      driver_offer_status NOT NULL DEFAULT 'pending',
  offered_pay NUMERIC(10,2) NOT NULL,
  score       DOUBLE PRECISION,                              -- assignment score
  offered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── SURCHARGES ──────────────────────────────────────────────

CREATE TABLE stop_surcharges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_id     UUID NOT NULL REFERENCES route_stops(id) ON DELETE CASCADE,
  type        surcharge_type NOT NULL,
  label       TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PROOF OF DELIVERY ───────────────────────────────────────

CREATE TABLE proof_of_delivery (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_stop_id   UUID UNIQUE NOT NULL REFERENCES route_stops(id),
  driver_id       UUID NOT NULL REFERENCES drivers(id),
  signature_url   TEXT,
  photo_urls      TEXT[] DEFAULT '{}',
  recipient_name  TEXT,
  -- Condition
  temp_reading    DOUBLE PRECISION,                          -- °C at delivery
  condition_notes TEXT,
  exception_code  pod_exception NOT NULL DEFAULT 'none',
  exception_notes TEXT,
  delivered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── BILLING: INVOICES ───────────────────────────────────────

CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  TEXT UNIQUE NOT NULL,                       -- INV-20260221-001
  customer_id     UUID NOT NULL REFERENCES customers(id),
  status          invoice_status NOT NULL DEFAULT 'draft',
  -- Dates
  issued_date     DATE,
  due_date        DATE,
  paid_date       DATE,
  -- Amounts
  subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax             NUMERIC(10,2) NOT NULL DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_paid     NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoice_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_id    UUID REFERENCES orders(id),
  description TEXT NOT NULL,
  quantity    DOUBLE PRECISION NOT NULL DEFAULT 1,
  unit_price  NUMERIC(10,2) NOT NULL,
  line_total  NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── BILLING: DRIVER PAYOUTS ─────────────────────────────────

CREATE TABLE driver_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES drivers(id),
  status          payout_status NOT NULL DEFAULT 'pending',
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  total_routes    INT NOT NULL DEFAULT 0,
  total_km        DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_stops     INT NOT NULL DEFAULT 0,
  gross_pay       NUMERIC(10,2) NOT NULL DEFAULT 0,
  deductions      NUMERIC(10,2) NOT NULL DEFAULT 0,
  incentives      NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_pay         NUMERIC(10,2) NOT NULL DEFAULT 0,
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payout_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id   UUID NOT NULL REFERENCES driver_payouts(id) ON DELETE CASCADE,
  route_id    UUID NOT NULL REFERENCES routes(id),
  description TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── TELEMETRY ───────────────────────────────────────────────

CREATE TABLE gps_pings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES drivers(id),
  route_id    UUID REFERENCES routes(id),
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  speed_kmh   DOUBLE PRECISION,
  heading     DOUBLE PRECISION,
  accuracy_m  DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partition-friendly index (by time)
CREATE INDEX idx_gps_pings_driver_time ON gps_pings (driver_id, recorded_at DESC);
CREATE INDEX idx_gps_pings_route ON gps_pings (route_id) WHERE route_id IS NOT NULL;

-- ─── NOTIFICATIONS ───────────────────────────────────────────

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  channel     TEXT NOT NULL DEFAULT 'push',                  -- push, sms, email
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PRICING CONFIG (operational tuning) ─────────────────────

CREATE TABLE pricing_config (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label               TEXT NOT NULL,
  effective_from      DATE NOT NULL,
  effective_to        DATE,
  -- Route cost rates
  cost_per_km         NUMERIC(6,4) NOT NULL DEFAULT 0.35,
  cost_per_min        NUMERIC(6,4) NOT NULL DEFAULT 0.10,
  cost_per_stop       NUMERIC(6,4) NOT NULL DEFAULT 0.60,
  cost_per_wait_min   NUMERIC(6,4) NOT NULL DEFAULT 0.08,
  -- Allocation weights
  alloc_w_km          NUMERIC(4,2) NOT NULL DEFAULT 0.45,
  alloc_w_min         NUMERIC(4,2) NOT NULL DEFAULT 0.35,
  alloc_w_vol         NUMERIC(4,2) NOT NULL DEFAULT 0.15,
  alloc_w_equal       NUMERIC(4,2) NOT NULL DEFAULT 0.05,
  -- Margin
  default_margin      NUMERIC(4,2) NOT NULL DEFAULT 0.55,
  -- Driver pay rates
  pay_base            NUMERIC(8,2) NOT NULL DEFAULT 15.00,
  pay_per_km          NUMERIC(6,4) NOT NULL DEFAULT 0.55,
  pay_per_active_min  NUMERIC(6,4) NOT NULL DEFAULT 0.18,
  pay_per_stop        NUMERIC(6,4) NOT NULL DEFAULT 1.25,
  pay_per_wait_min    NUMERIC(6,4) NOT NULL DEFAULT 0.20,
  min_earnings_rate   NUMERIC(6,4) NOT NULL DEFAULT 0.35,
  wait_grace_min      INT NOT NULL DEFAULT 10,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── INDEXES ─────────────────────────────────────────────────

CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_date ON orders (requested_date);
CREATE INDEX idx_route_stops_route ON route_stops (route_id, stop_sequence);
CREATE INDEX idx_routes_wave ON routes (wave_id);
CREATE INDEX idx_routes_driver ON routes (driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX idx_driver_offers_route ON driver_offers (route_id);
CREATE INDEX idx_driver_offers_driver ON driver_offers (driver_id, status);
CREATE INDEX idx_invoices_customer ON invoices (customer_id);
CREATE INDEX idx_payouts_driver ON driver_payouts (driver_id);
CREATE INDEX idx_notifications_user ON notifications (user_id, is_read, created_at DESC);
