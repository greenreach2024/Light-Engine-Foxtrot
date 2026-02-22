-- ============================================================
-- Light-Engine-Foxtrot  ·  Migration 002: Delivery Platform
-- Driver onboarding, shipments, tracking, settlement, payouts
-- ============================================================

-- ─── NEW ENUM TYPES ──────────────────────────────────────────

CREATE TYPE driver_status AS ENUM (
  'applicant','docs_pending','bg_check','banking','agreement',
  'training','active','suspended','deactivated'
);

CREATE TYPE doc_type AS ENUM (
  'licence','insurance','right_to_work','vehicle_photo','food_safety'
);

CREATE TYPE doc_status AS ENUM ('pending','accepted','rejected','expired');

CREATE TYPE bg_check_status AS ENUM ('not_started','submitted','passed','failed','expired');

CREATE TYPE agreement_status AS ENUM ('pending','signed','expired','superseded');

CREATE TYPE member_role AS ENUM ('admin','receiver','viewer');

CREATE TYPE shipment_status AS ENUM (
  'pending','assigned','pickup_started','pickup_complete',
  'in_transit','arriving','delivered','exception','cancelled'
);

CREATE TYPE delivery_event_type AS ENUM (
  'shipment.created','shipment.assigned','shipment.pickup_started',
  'shipment.pickup_complete','shipment.in_transit','shipment.arriving',
  'shipment.delivered','shipment.exception','shipment.cancelled',
  'stop.arriving','stop.delivered','stop.exception',
  'pod.uploaded','pod.accepted','pod.rejected',
  'route.started','route.completed','driver.location_update'
);

CREATE TYPE pay_statement_status AS ENUM ('draft','finalized','paid','disputed');

CREATE TYPE pay_line_type AS ENUM (
  'base','distance','engaged_time','stop_fee','wait_time',
  'minimum_guarantee_adj','hold','release','bonus','deduction'
);

CREATE TYPE payout_batch_status AS ENUM ('draft','approved','processing','completed','failed');

CREATE TYPE exception_outcome AS ENUM ('hold','release','adjusted');

-- ─── CUSTOMER MEMBERS ────────────────────────────────────────
-- Role-based access for buyer/receiver within a customer org.

CREATE TABLE customer_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        member_role NOT NULL DEFAULT 'receiver',
  invited_by  UUID REFERENCES users(id),
  invited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, user_id)
);

-- ─── DRIVER ONBOARDING ──────────────────────────────────────

-- Add status to existing drivers table
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS status driver_status NOT NULL DEFAULT 'applicant';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS preferred_zone TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS capacity_totes_applied INT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS stripe_connect_id TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

CREATE TABLE driver_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  doc_type    doc_type NOT NULL,
  file_url    TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  file_size   INT,
  status      doc_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  expires_at  DATE,
  reject_reason TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE driver_background_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  status          bg_check_status NOT NULL DEFAULT 'not_started',
  provider        TEXT NOT NULL DEFAULT 'internal',
  provider_ref    TEXT,                                       -- external reference
  submitted_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  expires_at      DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE driver_payout_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id         UUID UNIQUE NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL,
  account_status    TEXT NOT NULL DEFAULT 'pending',          -- pending, verified, restricted
  bank_last4        TEXT,
  currency          TEXT NOT NULL DEFAULT 'CAD',
  payouts_enabled   BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE driver_agreements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  agreement_type  TEXT NOT NULL DEFAULT 'contractor_v1',     -- contractor_v1, dpwra_disclosure_v1
  version         TEXT NOT NULL,
  status          agreement_status NOT NULL DEFAULT 'pending',
  document_url    TEXT,
  signed_at       TIMESTAMPTZ,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PICK / PACK ─────────────────────────────────────────────
-- Tracks the physical picking and packing of order items before shipment.

CREATE TABLE pick_packs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  picker_id   UUID REFERENCES users(id),
  started_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  tote_count  INT NOT NULL DEFAULT 0,
  weight_kg   DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── SHIPMENTS ───────────────────────────────────────────────
-- A shipment groups one or more orders for physical transport.
-- Order → Shipment is many-to-one via shipment_orders join.

CREATE TABLE shipments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_number TEXT UNIQUE NOT NULL,                       -- SH-20260115-001
  route_id        UUID REFERENCES routes(id),
  driver_id       UUID REFERENCES drivers(id),
  status          shipment_status NOT NULL DEFAULT 'pending',
  -- Aggregates
  total_orders    INT NOT NULL DEFAULT 0,
  total_totes     INT NOT NULL DEFAULT 0,
  total_weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_stops     INT NOT NULL DEFAULT 0,
  -- Timing
  pickup_eta      TIMESTAMPTZ,
  pickup_actual   TIMESTAMPTZ,
  complete_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Orders included in this shipment
CREATE TABLE shipment_orders (
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_id    UUID NOT NULL REFERENCES orders(id),
  PRIMARY KEY (shipment_id, order_id)
);

-- Orders at a particular stop
CREATE TABLE stop_orders (
  stop_id  UUID NOT NULL REFERENCES route_stops(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id),
  PRIMARY KEY (stop_id, order_id)
);

-- ─── DELIVERY EVENTS (event sourcing) ────────────────────────
-- Immutable event log for every state change in the delivery lifecycle.

CREATE TABLE delivery_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  delivery_event_type NOT NULL,
  -- Polymorphic references
  shipment_id UUID REFERENCES shipments(id),
  route_id    UUID REFERENCES routes(id),
  stop_id     UUID REFERENCES route_stops(id),
  driver_id   UUID REFERENCES drivers(id),
  order_id    UUID REFERENCES orders(id),
  -- Payload
  payload     JSONB NOT NULL DEFAULT '{}',
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  actor_id    UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── FEE QUOTES ──────────────────────────────────────────────
-- Snapshot of fee calculation shown to driver before acceptance (DPWRA).

CREATE TABLE fee_quotes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id        UUID NOT NULL REFERENCES routes(id),
  driver_id       UUID NOT NULL REFERENCES drivers(id),
  -- Breakdown
  base_fee        NUMERIC(10,2) NOT NULL,
  distance_fee    NUMERIC(10,2) NOT NULL,
  time_fee        NUMERIC(10,2) NOT NULL,
  stop_fee        NUMERIC(10,2) NOT NULL,
  wait_fee        NUMERIC(10,2) NOT NULL,
  total_fee       NUMERIC(10,2) NOT NULL,
  -- Parameters used
  estimated_km    DOUBLE PRECISION NOT NULL,
  estimated_min   INT NOT NULL,
  estimated_stops INT NOT NULL,
  estimated_wait_min INT NOT NULL DEFAULT 0,
  policy_version  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PAY STATEMENTS ──────────────────────────────────────────
-- Detailed pay breakdown for a driver within a pay period.

CREATE TABLE pay_statements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES drivers(id),
  status          pay_statement_status NOT NULL DEFAULT 'draft',
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  pay_date        DATE NOT NULL,
  -- Aggregates
  total_routes    INT NOT NULL DEFAULT 0,
  total_stops     INT NOT NULL DEFAULT 0,
  total_km        DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_engaged_min INT NOT NULL DEFAULT 0,
  -- Amounts
  gross_pay       NUMERIC(10,2) NOT NULL DEFAULT 0,
  holds           NUMERIC(10,2) NOT NULL DEFAULT 0,
  adjustments     NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_pay         NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- CRA
  ytd_fees        NUMERIC(10,2) NOT NULL DEFAULT 0,
  t4a_threshold   BOOLEAN NOT NULL DEFAULT false,
  policy_version  TEXT NOT NULL,
  finalized_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pay_statement_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id    UUID NOT NULL REFERENCES pay_statements(id) ON DELETE CASCADE,
  line_type       pay_line_type NOT NULL,
  route_id        UUID REFERENCES routes(id),
  stop_id         UUID REFERENCES route_stops(id),
  description     TEXT NOT NULL,
  quantity        DOUBLE PRECISION NOT NULL DEFAULT 1,
  rate            NUMERIC(8,4) NOT NULL DEFAULT 0,
  amount          NUMERIC(10,2) NOT NULL,
  -- Exception handling
  exception_ref   UUID,                                      -- references delivery_event if hold/release
  exception_outcome exception_outcome,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PAYOUT BATCHES ──────────────────────────────────────────
-- Groups finalized pay statements for bulk disbursement.

CREATE TABLE payout_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number    TEXT UNIQUE NOT NULL,                       -- PB-20260117-001
  status          payout_batch_status NOT NULL DEFAULT 'draft',
  pay_date        DATE NOT NULL,
  total_drivers   INT NOT NULL DEFAULT 0,
  total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Processing
  approved_by     UUID REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  processed_at    TIMESTAMPTZ,
  stripe_batch_ref TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
  driver_id       UUID NOT NULL REFERENCES drivers(id),
  statement_id    UUID NOT NULL REFERENCES pay_statements(id),
  amount          NUMERIC(10,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'CAD',
  stripe_transfer_id TEXT,
  status          payout_status NOT NULL DEFAULT 'pending',
  paid_at         TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── INDEXES ─────────────────────────────────────────────────

CREATE INDEX idx_customer_members_customer ON customer_members (customer_id);
CREATE INDEX idx_customer_members_user ON customer_members (user_id);
CREATE INDEX idx_driver_documents_driver ON driver_documents (driver_id);
CREATE INDEX idx_driver_bg_checks_driver ON driver_background_checks (driver_id);
CREATE INDEX idx_driver_agreements_driver ON driver_agreements (driver_id);
CREATE INDEX idx_shipments_route ON shipments (route_id);
CREATE INDEX idx_shipments_driver ON shipments (driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX idx_shipments_status ON shipments (status);
CREATE INDEX idx_delivery_events_shipment ON delivery_events (shipment_id, created_at);
CREATE INDEX idx_delivery_events_route ON delivery_events (route_id, created_at);
CREATE INDEX idx_delivery_events_type ON delivery_events (event_type, created_at);
CREATE INDEX idx_delivery_events_driver ON delivery_events (driver_id, created_at) WHERE driver_id IS NOT NULL;
CREATE INDEX idx_fee_quotes_route ON fee_quotes (route_id, driver_id);
CREATE INDEX idx_pay_statements_driver ON pay_statements (driver_id, period_start);
CREATE INDEX idx_pay_statement_lines_stmt ON pay_statement_lines (statement_id);
CREATE INDEX idx_pay_statement_lines_route ON pay_statement_lines (route_id) WHERE route_id IS NOT NULL;
CREATE INDEX idx_payout_batches_date ON payout_batches (pay_date);
CREATE INDEX idx_payouts_batch ON payouts (batch_id);
CREATE INDEX idx_payouts_driver ON payouts (driver_id);
CREATE INDEX idx_pick_packs_order ON pick_packs (order_id);
CREATE INDEX idx_stop_orders_order ON stop_orders (order_id);
