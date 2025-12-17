export type CommType =
  | "MANAGED_BY_LIGHT_ENGINE"
  | "WIFI"
  | "BLE"
  | "ZIGBEE"
  | "RS485"
  | "ANALOG_0_10V"
  | "PWM"
  | "IFTTT"
  | "WEBHOOK"
  | "OTHER";

export type SupportBadge = "NATIVE" | "GENERIC" | "MANAGED" | "CUSTOM";

export interface LightDefinition {
  id: string;
  brand: string;
  model: string;
  productName?: string;
  dynamicSpectrum: boolean | "UNKNOWN";
  channels?: string[];
  maxPowerW?: number;
  inputPowerSpec?: string;
  efficacy_umolPerJ?: number;
  ppf_umolPerS?: number;
  cct_or_peak?: string;
  commType: CommType;
  controlMethod?: string;
  setupGuideId: string;
  supportBadge: SupportBadge;
  researchRequired?: string[];
  notes?: string;
  warrantyYears?: number;
  ipRating?: string;
  lifetimeHoursL70?: number;
  manufacturer?: string;
  qualifiedProductId?: string;
}

export interface SetupGuideStep {
  title: string;
  bodyMd: string;
  requiresExternalLogin?: boolean;
  openUrl?: string;
}

export interface SetupGuide {
  id: string;
  title: string;
  steps: SetupGuideStep[];
}

// GreenReach Wholesale Types
export type PaymentProvider = 'square' | 'stripe' | 'paypal';
export type PaymentStatus = 'created' | 'authorized' | 'completed' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed';
export type OrderStatus = 'draft' | 'reserved' | 'payment_pending' | 'confirmed' | 'in_fulfillment' | 'completed' | 'cancelled';
export type SubOrderStatus = 'allocated' | 'reserved' | 'confirmed' | 'picked' | 'staged' | 'handed_off' | 'completed' | 'cancelled';

export interface Farm {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'onboarding';
  region: string;
  default_pickup_windows?: string[];
  payment_provider?: PaymentProvider;
  square_merchant_id?: string;
  square_location_id?: string;
  square_access_token?: string; // encrypted in database
  square_refresh_token?: string; // encrypted in database
  square_token_expiry?: Date;
  light_engine_url: string;
  created_at: Date;
  updated_at: Date;
}

export interface BuyerAccount {
  id: string;
  org_name: string;
  contact_users: Array<{
    name: string;
    email: string;
    phone?: string;
  }>;
  addresses: Array<{
    label: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    delivery_instructions?: string;
  }>;
  delivery_preferences?: {
    preferred_days?: string[];
    preferred_time?: string;
  };
  tax_settings: {
    tax_exempt: boolean;
    tax_id?: string;
    exempt_certificate?: string;
  };
  created_at: Date;
  updated_at: Date;
}

export interface CatalogSKU {
  id: string;
  name: string;
  unit: string; // 'lb', 'oz', 'bunch', 'head', 'case'
  pack_size: number;
  category: string; // 'leafy_greens', 'herbs', 'microgreens', 'produce'
  subcategory?: string; // 'lettuce', 'basil', 'radish_shoots', etc.
  attributes: {
    organic?: boolean;
    variety?: string;
    grade?: string;
  };
  default_wholesale_units: string; // 'case', 'lb', 'each'
  // Traceability & Compliance Fields
  gtin?: string; // Global Trade Item Number (barcode)
  allergen_info?: {
    contains: string[]; // e.g., ['soy', 'wheat']
    may_contain: string[]; // cross-contamination warnings
    allergen_free_claims: string[]; // e.g., ['gluten_free', 'nut_free']
  };
  certifications?: {
    organic?: {
      certified: boolean;
      certifier: string; // e.g., 'USDA', 'CCOF'
      cert_number: string;
      expiry_date: Date;
    };
    food_safety?: Array<{
      type: 'GAP' | 'GFSI' | 'SQF' | 'GLOBALG.A.P' | 'FSMA' | 'HACCP';
      certified: boolean;
      certifier: string;
      cert_number: string;
      expiry_date: Date;
    }>;
    other?: Array<{
      name: string; // e.g., 'Biodynamic', 'Rainforest Alliance'
      cert_number: string;
      expiry_date: Date;
    }>;
  };
  product_tags?: string[]; // 'local', 'greenhouse_grown', 'hydroponic', 'soil_grown'
  shelf_life_days?: number;
  storage_requirements?: string; // 'Refrigerate at 34-38°F', 'Keep dry'
  created_at: Date;
  updated_at: Date;
}

export interface FarmInventoryLot {
  farm_id: string;
  sku_id: string;
  lot_id: string; // Farm's internal lot number
  qty_available: number;
  qty_reserved: number;
  harvest_date_start: Date;
  harvest_date_end: Date;
  quality_flags: string[]; // 'certified_organic', 'gfsi_compliant', 'local'
  // Chain of Custody & Traceability
  traceability: {
    lot_number: string; // External-facing lot number (for buyer traceability)
    gtin?: string; // Matches CatalogSKU.gtin if applicable
    harvest_date: Date;
    pack_date?: Date;
    packhouse_location: string; // Physical location where packed
    packer_id?: string; // Employee/crew ID
    field_location?: string; // Field/greenhouse identifier
    growing_method: 'soil' | 'hydroponic' | 'aquaponic' | 'aeroponic' | 'greenhouse';
    irrigation_source?: string; // Water source traceability
    production_zone?: string; // Internal farm zone/block
  };
  // Food Safety Compliance
  food_safety: {
    testing_status: 'pending' | 'passed' | 'failed' | 'not_required';
    test_date?: Date;
    test_results?: {
      pathogen_screen: boolean; // E.coli, Salmonella, Listeria
      heavy_metals?: boolean; // Lead, arsenic, etc.
      pesticide_residue?: boolean;
      lab_name?: string;
      lab_cert_number?: string;
    };
    cold_chain_verified: boolean;
    temperature_log_url?: string; // Link to temperature monitoring data
  };
  // Certifications (lot-specific)
  certifications: {
    organic_certified: boolean;
    organic_cert_number?: string;
    food_safety_audit_date?: Date;
    food_safety_cert_type?: 'GAP' | 'GFSI' | 'SQF' | 'GLOBALG.A.P' | 'FSMA' | 'HACCP';
  };
  created_at: Date;
  updated_at: Date;
}

export interface FarmSKUPrice {
  farm_id: string;
  sku_id: string;
  price_per_unit: number; // wholesale price
  pack_pricing?: {
    pack_size: number;
    price_per_pack: number;
  };
  min_order_qty?: number;
  created_at: Date;
  updated_at: Date;
}

export interface MasterOrder {
  id: string;
  buyer_id: string;
  status: OrderStatus;
  subtotal: number;
  broker_fee_total: number;
  tax_total: number;
  total: number;
  delivery_window_start: Date;
  delivery_window_end: Date;
  delivery_address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    delivery_instructions?: string;
  };
  logistics_plan?: {
    consolidation_point?: string;
    routing?: string;
  };
  created_at: Date;
  updated_at: Date;
}

export interface FarmSubOrder {
  id: string;
  master_order_id: string;
  farm_id: string;
  status: SubOrderStatus;
  line_items: Array<{
    sku_id: string;
    lot_id: string;
    qty: number;
    unit_price: number;
    line_total: number;
    // Enhanced Traceability
    traceability: {
      harvest_date: Date;
      lot_number: string; // External-facing lot number
      gtin?: string;
      packhouse_location: string;
      growing_method: string;
      field_location?: string;
      food_safety_cert?: string;
      organic_cert_number?: string;
      test_date?: Date;
      test_lab?: string;
      cold_chain_verified: boolean;
    };
    // Allergen & Safety Info (from CatalogSKU)
    allergen_info?: {
      contains: string[];
      may_contain: string[];
    };
    certifications?: string[]; // e.g., ['USDA Organic', 'GAP Certified']
  }>;
  subtotal: number;
  broker_fee_amount: number;
  tax_amount: number;
  total: number;
  pickup_window_start: Date;
  pickup_window_end: Date;
  // Invoice Reference (Farm is MoR)
  invoice_id?: string;
  invoice_url?: string;
  invoice_issued_at?: Date;
  // Fulfillment Tracking
  fulfillment_status?: 'pending' | 'picked' | 'packed' | 'shipped' | 'delivered';
  tracking_number?: string;
  carrier?: string;
  shipped_at?: Date;
  delivered_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentRecord {
  id: string;
  farm_sub_order_id: string;
  provider: PaymentProvider;
  provider_payment_id: string;
  status: PaymentStatus;
  gross_amount: number;
  broker_fee_amount: number;
  net_to_farm: number;
  idempotency_key: string;
  provider_response?: any;
  created_at: Date;
  updated_at: Date;
}

export interface BrokerFeeRecord {
  id: string;
  payment_record_id: string;
  fee_percent: number;
  fee_amount: number;
  settlement_status: 'pending' | 'settled' | 'reversed';
  settlement_date?: Date;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export type GroupKind = "light" | "equip";

export interface GroupMatch {
  room?: string;
  zone?: string;
  [key: string]: string | undefined;
}

export interface GroupMember {
  kind: GroupKind;
  deviceId: number | string;
}

export interface DeviceGroup {
  id: string;
  label: string;
  kind: GroupKind;
  match?: GroupMatch;
  members: GroupMember[];
}

export interface EnvControlTuning {
  enable: boolean;
  step?: number;
  dwell?: number;
  [key: string]: number | boolean | undefined;
}

export interface EnvTargets {
  temp?: number;
  rh?: number;
  rhBand?: number;
  [metric: string]: number | undefined;
}

export interface EnvSensorConfig {
  id: string;
  metrics: string[];
  primary?: boolean;
  weight?: number;
}

export interface EnvActuatorConfig {
  id: string;
  controlledType: string;
  controlMethod: string;
}

export interface ZoneEnvironmentConfig {
  zoneId: string;
  targets: EnvTargets;
  control: EnvControlTuning;
  sensors: EnvSensorConfig[];
  actuators: EnvActuatorConfig[];
}

// ============================================================================
// Device Registry Types
// ============================================================================

export interface DeviceMetadata {
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;
  ipAddress?: string;
  macAddress?: string;
  lastSeen?: string;
}

export interface RegisteredDevice {
  id: string;
  name: string;
  type: string;
  protocol: string;
  status: "online" | "offline" | "unknown";
  metadata?: DeviceMetadata;
  capabilities?: string[];
  groupId?: string;
  zoneId?: string;
}

// ============================================================================
// Network Configuration Types
// ============================================================================

export interface NetworkConfig {
  ssid?: string;
  security?: string;
  mqttBroker?: string;
  mqttPort?: number;
  apiEndpoint?: string;
}

// ============================================================================
// Re-export API types
// ============================================================================

export * from "./api";
