/**
 * Light Engine Charlie API - TypeScript Type Definitions
 * Generated for all REST API endpoints
 * @version 1.0.0
 */

// ============================================================================
// Common Types
// ============================================================================

export interface ApiResponse<T = any> {
  success?: boolean;
  message?: string;
  timestamp: string;
  data?: T;
}

export interface ErrorResponse {
  detail: string;
  status?: number;
}

// ============================================================================
// Environmental Sensor Types (/api/env/*)
// ============================================================================

export interface SensorReading {
  value: number;
  unit?: string;
}

export interface SensorPayload {
  scope: string;
  ts: string; // ISO 8601 timestamp
  sensors: Record<string, SensorReading>;
}

export interface LatestReadingsResponse {
  scope: string;
  sensors: Record<string, any>;
  observedAt: string;
}

export interface SensorHistory {
  value: number;
  ts: string;
}

export interface SensorData {
  value?: number;
  unit?: string;
  observedAt?: string;
  history: SensorHistory[];
}

export interface ScopeMetadata {
  name: string;
  createdAt: string;
}

export interface ScopeData {
  sensors: Record<string, SensorData>;
  metadata: ScopeMetadata;
}

export interface EnvCacheResponse {
  scopes: Record<string, ScopeData>;
  meta: {
    updatedAt: string | null;
    source: string;
  };
}

export interface EnvScopesResponse {
  scopes: string[];
  count: number;
  timestamp: string;
}

export interface EnvHistoryParams {
  scope: string;
  metric: string;
  hours?: number;
}

export interface EnvHistoryResponse {
  scope: string;
  metric: string;
  data: SensorHistory[];
  count: number;
  timestamp: string;
}

// ============================================================================
// Device Discovery Types (/discovery/*, /api/devices/*)
// ============================================================================

export type DeviceProtocol = "kasa" | "mqtt" | "ble" | "mdns";

export interface DiscoveryDevice {
  id: string;
  name: string;
  protocol: DeviceProtocol;
  host?: string;
  mac?: string;
  model?: string;
  metadata?: Record<string, any>;
}

export interface DiscoveryTriggerResponse {
  status: "accepted";
  message: string;
  timestamp: string;
}

export interface DiscoveryDevicesResponse {
  devices: DiscoveryDevice[];
  count: number;
  timestamp: string;
}

export interface ProtocolDevicesResponse {
  protocol: DeviceProtocol;
  devices: DiscoveryDevice[];
  count: number;
  timestamp: string;
}

export interface DevicesListResponse {
  devices: DiscoveryDevice[];
  count: number;
  timestamp: string;
}

// ============================================================================
// Network Diagnostics Types (/api/network/*)
// ============================================================================

export interface WifiNetwork {
  ssid: string;
  signal?: number;
  security?: string;
}

export interface WifiScanResponse {
  available: boolean;
  networks?: WifiNetwork[];
  count?: number;
  message?: string;
  timestamp: string;
}

export interface NetworkTestRequest {
  host: string;
  port?: number;
  protocol?: string;
}

export interface NetworkTestResponse {
  success: boolean;
  reachable: boolean;
  host: string;
  port: number;
  protocol: string;
  message: string;
  error?: string;
  timestamp: string;
}

// ============================================================================
// Device Control Types (/api/device/*)
// ============================================================================

export interface DeviceCommandRequest {
  device_id: string;
  command: Record<string, any>;
}

export interface DeviceCommandResponse {
  success: boolean;
  device_id: string;
  command: Record<string, any>;
  message: string;
  timestamp: string;
}

// ============================================================================
// Lighting Types (/lighting/*)
// ============================================================================

export interface LightingFixture {
  id: string;
  name: string;
  protocol: string;
  channels?: string[];
  max_brightness?: number;
}

export interface LightingFixturesResponse {
  fixtures: LightingFixture[];
  count: number;
  timestamp: string;
}

export interface FailsafePowerRequest {
  fixtures: string[];
  power: "on" | "off";
  brightness?: number;
}

export interface FailsafeResult {
  fixture_id: string;
  success: boolean;
  power?: string;
  brightness?: number;
  error?: string;
}

export interface FailsafePowerResponse {
  results: FailsafeResult[];
  total: number;
  successful: number;
  timestamp: string;
}

// ============================================================================
// Automation Rules Types (/rules/*)
// ============================================================================

export interface RuleCondition {
  sensor?: string;
  operator?: "gt" | "lt" | "eq" | "gte" | "lte";
  value?: number;
  time_range?: {
    start: string;
    end: string;
  };
  [key: string]: any;
}

export interface RuleAction {
  device_id?: string;
  command?: string;
  brightness?: number;
  power?: "on" | "off";
  [key: string]: any;
}

export interface AutomationRule {
  rule_id?: string;
  name: string;
  enabled?: boolean;
  conditions: Record<string, any>;
  actions: Record<string, any>;
  priority?: number;
}

export interface RulesListResponse {
  rules: AutomationRule[];
  count: number;
  timestamp: string;
}

export interface RuleCreateResponse {
  success: boolean;
  rule_id: string;
  message: string;
  timestamp: string;
}

export interface RuleUpdateResponse {
  success: boolean;
  rule_id: string;
  message: string;
  timestamp: string;
}

export interface RuleDeleteResponse {
  success: boolean;
  rule_id: string;
  message: string;
  timestamp: string;
}

// ============================================================================
// AI Setup Assistant Types (/ai/*)
// ============================================================================

export interface SetupContext {
  device_type?: string;
  protocol?: string;
  network?: string;
  [key: string]: any;
}

export interface SetupAssistRequest {
  query: string;
  context?: SetupContext;
}

export interface SetupStep {
  step: number;
  instruction: string;
  details?: string;
}

export interface SetupAssistResponse {
  response: string;
  steps?: SetupStep[];
  confidence?: number;
  timestamp: string;
}

// ============================================================================
// Health Check Types
// ============================================================================

export interface HealthResponse {
  service: string;
  status: "running" | "degraded" | "down";
  version: string;
  timestamp?: string;
}

// ============================================================================
// API Client Types
// ============================================================================

export interface ApiClientConfig {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, any>;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isErrorResponse(response: any): response is ErrorResponse {
  return response && typeof response.detail === "string";
}

export function isSuccessResponse(response: any): response is ApiResponse {
  return response && "timestamp" in response;
}

// ============================================================================
// Utility Types
// ============================================================================

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type AsyncResponse<T> = Promise<T>;
