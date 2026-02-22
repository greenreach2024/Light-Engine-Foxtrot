// ─── Shared domain types used across modules ─────────────────

// Re-export delivery platform types
export * from "./driver-states.js";
export * from "./delivery-events.js";

export type UserRole = "customer_admin" | "customer_user" | "driver" | "ops" | "admin";
export type OrderStatus = "draft" | "confirmed" | "picking" | "packed" | "staged" | "dispatched" | "in_transit" | "delivered" | "cancelled" | "exception";
export type TempClass = "ambient" | "chilled" | "frozen";
export type RouteStatus = "planned" | "published" | "offered" | "accepted" | "in_progress" | "completed" | "cancelled";
export type WaveStatus = "open" | "cutoff" | "planning" | "published" | "completed" | "cancelled";
export type DriverOfferStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";
export type InvoiceStatus = "draft" | "issued" | "sent" | "paid" | "overdue" | "disputed" | "credited";
export type PayoutStatus = "pending" | "processing" | "paid" | "failed" | "disputed";
export type PodException = "none" | "partial_delivery" | "refused" | "damaged" | "wrong_items" | "temp_breach" | "access_issue" | "other";
export type VehicleType = "car" | "van" | "refrigerated_van" | "small_truck" | "refrigerated_truck";
export type SurchargeType = "tight_window" | "rush" | "oversize" | "heavy" | "difficult_access" | "fuel_adjustment" | "extra_totes";

// ─── Row types ───────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  first_name: string;
  last_name: string;
  phone: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Customer {
  id: string;
  name: string;
  billing_email: string;
  payment_terms_days: number;
  tax_id: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CustomerLocation {
  id: string;
  customer_id: string;
  label: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  lat: number;
  lng: number;
  receiving_open: string;       // TIME as string "HH:mm"
  receiving_close: string;
  dock_rules: string | null;
  unload_time_min: number;
  has_dock: boolean;
  requires_stairs: boolean;
  special_instructions: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  weight_kg: number | null;
  volume_l: number | null;
  temp_class: TempClass;
  is_active: boolean;
  created_at: Date;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id: string;
  location_id: string;
  placed_by: string;
  status: OrderStatus;
  requested_date: string;       // DATE string
  window_open: Date;
  window_close: Date;
  total_weight_kg: number;
  total_volume_l: number;
  tote_count: number;
  temp_class: TempClass;
  product_total: number;
  delivery_fee: number | null;
  total_amount: number | null;
  recurring_schedule_id: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderLine {
  id: string;
  order_id: string;
  product_id: string;
  qty: number;
  unit_price: number;
  line_total: number;
  weight_kg: number;
  volume_l: number;
  temp_class: TempClass;
  qty_picked: number;
  qty_packed: number;
  substitution_product_id: string | null;
  created_at: Date;
}

export interface Driver {
  id: string;
  user_id: string;
  vehicle_type: VehicleType;
  vehicle_plate: string | null;
  capacity_weight_kg: number;
  capacity_volume_l: number;
  capacity_totes: number;
  insurance_expiry: string | null;
  license_expiry: string | null;
  has_food_safety_cert: boolean;
  home_zone_lat: number | null;
  home_zone_lng: number | null;
  home_zone_radius_km: number | null;
  reliability_score: number;
  acceptance_rate: number;
  risk_flags: number;
  is_available: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Wave {
  id: string;
  wave_date: string;
  wave_label: string;
  cutoff_at: Date;
  departure_at: Date | null;
  status: WaveStatus;
  created_at: Date;
  updated_at: Date;
}

export interface Route {
  id: string;
  wave_id: string;
  route_number: string;
  driver_id: string | null;
  status: RouteStatus;
  planned_km: number;
  planned_duration_min: number;
  planned_stops: number;
  planned_wait_min: number;
  actual_km: number | null;
  actual_duration_min: number | null;
  actual_start_at: Date | null;
  actual_end_at: Date | null;
  route_cost: number | null;
  driver_pay: number | null;
  total_revenue: number | null;
  route_margin: number | null;
  max_weight_kg: number | null;
  max_volume_l: number | null;
  temp_class: TempClass;
  created_at: Date;
  updated_at: Date;
}

export interface RouteStop {
  id: string;
  route_id: string;
  order_id: string;
  location_id: string;
  stop_sequence: number;
  planned_arrival: Date | null;
  planned_departure: Date | null;
  window_open: Date;
  window_close: Date;
  service_time_min: number;
  marginal_km: number;
  marginal_min: number;
  volume_share: number;
  cost_share: number;
  allocated_cost: number | null;
  delivery_fee: number | null;
  actual_arrival: Date | null;
  actual_departure: Date | null;
  created_at: Date;
}

export interface DriverOffer {
  id: string;
  route_id: string;
  driver_id: string;
  status: DriverOfferStatus;
  offered_pay: number;
  score: number | null;
  offered_at: Date;
  expires_at: Date;
  responded_at: Date | null;
  created_at: Date;
}

export interface ProofOfDelivery {
  id: string;
  route_stop_id: string;
  driver_id: string;
  signature_url: string | null;
  photo_urls: string[];
  recipient_name: string | null;
  temp_reading: number | null;
  condition_notes: string | null;
  exception_code: PodException;
  exception_notes: string | null;
  delivered_at: Date;
  created_at: Date;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  status: InvoiceStatus;
  issued_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  subtotal: number;
  tax: number;
  total: number;
  amount_paid: number;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PricingConfig {
  id: string;
  label: string;
  effective_from: string;
  effective_to: string | null;
  cost_per_km: number;
  cost_per_min: number;
  cost_per_stop: number;
  cost_per_wait_min: number;
  alloc_w_km: number;
  alloc_w_min: number;
  alloc_w_vol: number;
  alloc_w_equal: number;
  default_margin: number;
  pay_base: number;
  pay_per_km: number;
  pay_per_active_min: number;
  pay_per_stop: number;
  pay_per_wait_min: number;
  min_earnings_rate: number;
  wait_grace_min: number;
  is_active: boolean;
  created_at: Date;
}

// ── Phase 2: Delivery Platform Types ──────────────────────────────
// All types/enums below match 002_delivery_platform.sql exactly.

export type DriverOnboardingStatusType =
  | "applicant"
  | "docs_pending"
  | "bg_check"
  | "banking"
  | "agreement"
  | "training"
  | "active"
  | "suspended"
  | "deactivated";

export type DocType = "licence" | "insurance" | "right_to_work" | "vehicle_photo" | "food_safety";
export type DocStatus = "pending" | "accepted" | "rejected" | "expired";
export type BgCheckStatus = "not_started" | "submitted" | "passed" | "failed" | "expired";
export type AgreementStatus = "pending" | "signed" | "expired" | "superseded";
export type MemberRole = "admin" | "receiver" | "viewer";
export type ShipmentStatus =
  | "pending"
  | "assigned"
  | "pickup_started"
  | "pickup_complete"
  | "in_transit"
  | "arriving"
  | "delivered"
  | "exception"
  | "cancelled";
export type PayStatementStatus = "draft" | "finalized" | "paid" | "disputed";
export type PayLineType =
  | "base"
  | "distance"
  | "engaged_time"
  | "stop_fee"
  | "wait_time"
  | "minimum_guarantee_adj"
  | "hold"
  | "release"
  | "bonus"
  | "deduction";
export type PayoutBatchStatus =
  | "draft"
  | "approved"
  | "processing"
  | "completed"
  | "failed";
export type ExceptionOutcome = "hold" | "release" | "adjusted";

export interface CustomerMember {
  id: string;
  customer_id: string;
  user_id: string;
  role: MemberRole;
  invited_by: string | null;
  invited_at: Date;
  accepted_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DriverDocument {
  id: string;
  driver_id: string;
  doc_type: DocType;
  file_url: string;
  file_name: string;
  file_size: number | null;
  status: DocStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  expires_at: Date | null;
  reject_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DriverBackgroundCheck {
  id: string;
  driver_id: string;
  status: BgCheckStatus;
  provider: string;
  provider_ref: string | null;
  submitted_at: Date | null;
  completed_at: Date | null;
  expires_at: Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DriverPayoutAccount {
  id: string;
  driver_id: string;
  stripe_account_id: string;
  account_status: string;
  bank_last4: string | null;
  currency: string;
  payouts_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DriverAgreement {
  id: string;
  driver_id: string;
  agreement_type: string;
  version: string;
  status: AgreementStatus;
  document_url: string | null;
  signed_at: Date | null;
  ip_address: string | null;
  created_at: Date;
}

export interface Shipment {
  id: string;
  shipment_number: string;
  route_id: string | null;
  driver_id: string | null;
  status: ShipmentStatus;
  total_orders: number;
  total_totes: number;
  total_weight_kg: number;
  total_stops: number;
  pickup_eta: Date | null;
  pickup_actual: Date | null;
  complete_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface FeeQuote {
  id: string;
  route_id: string;
  driver_id: string;
  base_fee: number;
  distance_fee: number;
  time_fee: number;
  stop_fee: number;
  wait_fee: number;
  total_fee: number;
  estimated_km: number;
  estimated_min: number;
  estimated_stops: number;
  estimated_wait_min: number;
  policy_version: string;
  created_at: Date;
}

export interface PayStatement {
  id: string;
  driver_id: string;
  status: PayStatementStatus;
  period_start: Date;
  period_end: Date;
  pay_date: Date;
  total_routes: number;
  total_stops: number;
  total_km: number;
  total_engaged_min: number;
  gross_pay: number;
  holds: number;
  adjustments: number;
  net_pay: number;
  ytd_fees: number;
  t4a_threshold: boolean;
  policy_version: string;
  finalized_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PayStatementLine {
  id: string;
  statement_id: string;
  line_type: PayLineType;
  route_id: string | null;
  stop_id: string | null;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  exception_ref: string | null;
  exception_outcome: ExceptionOutcome | null;
  created_at: Date;
}

export interface PayoutBatch {
  id: string;
  batch_number: string;
  status: PayoutBatchStatus;
  pay_date: Date;
  total_drivers: number;
  total_amount: number;
  approved_by: string | null;
  approved_at: Date | null;
  processed_at: Date | null;
  stripe_batch_ref: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Payout {
  id: string;
  batch_id: string;
  driver_id: string;
  statement_id: string;
  amount: number;
  currency: string;
  stripe_transfer_id: string | null;
  status: string;
  paid_at: Date | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}
