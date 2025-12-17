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

export * from "./api-types";
