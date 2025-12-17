/**
 * Light Engine Charlie API Client
 * Demonstrates type-safe API interactions using TypeScript
 */

// Using global fetch (Node 18+ or polyfill)
import type {
  ApiResponse,
  SensorPayload,
  LatestReadingsResponse,
  EnvHistoryResponse,
  DiscoveryTriggerResponse,
  DiscoveryDevicesResponse,
  NetworkTestRequest,
  NetworkTestResponse,
  DeviceCommandRequest,
  DeviceCommandResponse,
  LightingFixturesResponse,
  FailsafePowerRequest,
  FailsafePowerResponse,
  AutomationRule,
  RulesListResponse,
  RuleCreateResponse,
  HealthResponse,
} from './types';

export interface ClientConfig {
  baseUrl: string;
  timeout?: number;
  apiKey?: string;
}

export class LightEngineClient {
  private baseUrl: string;
  private timeout: number;
  private apiKey?: string;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout || 5000;
    this.apiKey = config.apiKey;
  }

  /**
   * Make a type-safe HTTP request
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error: any = await response.json().catch(() => ({
          detail: `HTTP ${response.status}: ${response.statusText}`,
        }));
        throw new Error(error.detail || error.message);
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  // =========================================================================
  // Health & Status
  // =========================================================================

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  // =========================================================================
  // Environmental Sensors
  // =========================================================================

  async ingestSensorData(payload: SensorPayload): Promise<ApiResponse> {
    return this.request<ApiResponse>('/api/env/ingest', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getLatestReadings(scope: string): Promise<LatestReadingsResponse> {
    return this.request<LatestReadingsResponse>(
      `/api/env/latest?scope=${encodeURIComponent(scope)}`
    );
  }

  async getSensorHistory(
    scope: string,
    metric: string,
    hours: number = 24
  ): Promise<EnvHistoryResponse> {
    const params = new URLSearchParams({
      scope,
      metric,
      hours: hours.toString(),
    });
    return this.request<EnvHistoryResponse>(`/api/env/history?${params}`);
  }

  async getScopes(): Promise<{ scopes: string[]; count: number; timestamp: string }> {
    return this.request('/api/env/scopes');
  }

  // =========================================================================
  // Device Discovery
  // =========================================================================

  async triggerDiscovery(): Promise<DiscoveryTriggerResponse> {
    return this.request<DiscoveryTriggerResponse>('/discovery/run', {
      method: 'POST',
    });
  }

  async getDiscoveredDevices(): Promise<DiscoveryDevicesResponse> {
    return this.request<DiscoveryDevicesResponse>('/discovery/devices');
  }

  async getKasaDevices(): Promise<DiscoveryDevicesResponse> {
    return this.request<DiscoveryDevicesResponse>('/api/devices/kasa');
  }

  async getMqttDevices(): Promise<DiscoveryDevicesResponse> {
    return this.request<DiscoveryDevicesResponse>('/api/devices/mqtt');
  }

  async getBleDevices(): Promise<DiscoveryDevicesResponse> {
    return this.request<DiscoveryDevicesResponse>('/api/devices/ble');
  }

  async getMdnsDevices(): Promise<DiscoveryDevicesResponse> {
    return this.request<DiscoveryDevicesResponse>('/api/devices/mdns');
  }

  // =========================================================================
  // Network Diagnostics
  // =========================================================================

  async testNetworkConnection(
    request: NetworkTestRequest
  ): Promise<NetworkTestResponse> {
    return this.request<NetworkTestResponse>('/api/network/test', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async scanWifiNetworks(): Promise<{
    available: boolean;
    networks?: Array<{ ssid: string; signal?: number }>;
    count?: number;
    timestamp: string;
  }> {
    return this.request('/api/network/wifi/scan');
  }

  // =========================================================================
  // Device Control
  // =========================================================================

  async sendDeviceCommand(
    request: DeviceCommandRequest
  ): Promise<DeviceCommandResponse> {
    return this.request<DeviceCommandResponse>('/api/device/command', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // =========================================================================
  // Lighting Management
  // =========================================================================

  async getLightingFixtures(): Promise<LightingFixturesResponse> {
    return this.request<LightingFixturesResponse>('/lighting/fixtures');
  }

  async lightingFailsafe(
    request: FailsafePowerRequest
  ): Promise<FailsafePowerResponse> {
    return this.request<FailsafePowerResponse>('/lighting/failsafe', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // =========================================================================
  // Automation Rules
  // =========================================================================

  async listRules(): Promise<RulesListResponse> {
    return this.request<RulesListResponse>('/rules');
  }

  async createRule(rule: AutomationRule): Promise<RuleCreateResponse> {
    return this.request<RuleCreateResponse>('/rules', {
      method: 'POST',
      body: JSON.stringify(rule),
    });
  }

  async updateRule(
    ruleId: string,
    updates: Partial<AutomationRule>
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(`/rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async deleteRule(ruleId: string): Promise<ApiResponse> {
    return this.request<ApiResponse>(`/rules/${ruleId}`, {
      method: 'DELETE',
    });
  }
}

export default LightEngineClient;
