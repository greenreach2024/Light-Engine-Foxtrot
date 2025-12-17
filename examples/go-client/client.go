package lightengine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client represents a Light Engine API client
type Client struct {
	baseURL    string
	httpClient *http.Client
	apiKey     string
}

// ClientOption is a function that configures a Client
type ClientOption func(*Client)

// WithTimeout sets a custom timeout for the HTTP client
func WithTimeout(timeout time.Duration) ClientOption {
	return func(c *Client) {
		c.httpClient.Timeout = timeout
	}
}

// WithAPIKey sets the API key for authentication
func WithAPIKey(apiKey string) ClientOption {
	return func(c *Client) {
		c.apiKey = apiKey
	}
}

// WithHTTPClient sets a custom HTTP client
func WithHTTPClient(httpClient *http.Client) ClientOption {
	return func(c *Client) {
		c.httpClient = httpClient
	}
}

// NewClient creates a new Light Engine API client
func NewClient(baseURL string, opts ...ClientOption) *Client {
	client := &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	for _, opt := range opts {
		opt(client)
	}

	return client
}

// doRequest performs an HTTP request with context support
func (c *Client) doRequest(ctx context.Context, method, endpoint string, body interface{}, result interface{}) error {
	var reqBody io.Reader
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonData)
	}

	url := c.baseURL + endpoint
	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		var errResp struct {
			Detail  string `json:"detail"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(respBody, &errResp); err == nil {
			return NewError(resp.StatusCode, resp.Status, errResp.Detail)
		}
		return NewError(resp.StatusCode, resp.Status, string(respBody))
	}

	if result != nil {
		if err := json.Unmarshal(respBody, result); err != nil {
			return fmt.Errorf("failed to unmarshal response: %w", err)
		}
	}

	return nil
}

// ========================================================================
// Health & Status
// ========================================================================

// Health checks the API health status
func (c *Client) Health(ctx context.Context) (*HealthResponse, error) {
	var result HealthResponse
	if err := c.doRequest(ctx, http.MethodGet, "/health", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ========================================================================
// Environmental Sensors
// ========================================================================

// IngestSensorData ingests environmental sensor data
func (c *Client) IngestSensorData(ctx context.Context, payload *SensorPayload) (*APIResponse, error) {
	var result APIResponse
	if err := c.doRequest(ctx, http.MethodPost, "/api/env/ingest", payload, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetLatestReadings retrieves the latest sensor readings
func (c *Client) GetLatestReadings(ctx context.Context, tenant string) (*LatestReadingsResponse, error) {
	endpoint := "/api/env/latest"
	if tenant != "" {
		endpoint += "?tenant=" + tenant
	}
	var result LatestReadingsResponse
	if err := c.doRequest(ctx, http.MethodGet, endpoint, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetEnvHistory retrieves historical environmental data
func (c *Client) GetEnvHistory(ctx context.Context, scope, metric string, hours int) (*EnvHistoryResponse, error) {
	endpoint := fmt.Sprintf("/api/env/history?scope=%s&metric=%s", scope, metric)
	if hours > 0 {
		endpoint += fmt.Sprintf("&hours=%d", hours)
	}
	var result EnvHistoryResponse
	if err := c.doRequest(ctx, http.MethodGet, endpoint, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ========================================================================
// Device Discovery
// ========================================================================

// TriggerDiscovery triggers asynchronous device discovery
func (c *Client) TriggerDiscovery(ctx context.Context) (*DiscoveryTriggerResponse, error) {
	var result DiscoveryTriggerResponse
	if err := c.doRequest(ctx, http.MethodPost, "/discovery/run", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetDiscoveredDevices retrieves all discovered devices
func (c *Client) GetDiscoveredDevices(ctx context.Context) (*DiscoveryDevicesResponse, error) {
	var result DiscoveryDevicesResponse
	if err := c.doRequest(ctx, http.MethodGet, "/discovery/devices", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetKasaDevices retrieves TP-Link Kasa devices
func (c *Client) GetKasaDevices(ctx context.Context) (*DiscoveryDevicesResponse, error) {
	var result DiscoveryDevicesResponse
	if err := c.doRequest(ctx, http.MethodGet, "/api/devices/kasa", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetMQTTDevices retrieves MQTT devices
func (c *Client) GetMQTTDevices(ctx context.Context) (*DiscoveryDevicesResponse, error) {
	var result DiscoveryDevicesResponse
	if err := c.doRequest(ctx, http.MethodGet, "/api/devices/mqtt", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetBLEDevices retrieves Bluetooth Low Energy devices
func (c *Client) GetBLEDevices(ctx context.Context) (*DiscoveryDevicesResponse, error) {
	var result DiscoveryDevicesResponse
	if err := c.doRequest(ctx, http.MethodGet, "/api/devices/ble", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetMDNSDevices retrieves mDNS/Bonjour discovered devices
func (c *Client) GetMDNSDevices(ctx context.Context) (*DiscoveryDevicesResponse, error) {
	var result DiscoveryDevicesResponse
	if err := c.doRequest(ctx, http.MethodGet, "/api/devices/mdns", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetDevices retrieves consolidated device list
func (c *Client) GetDevices(ctx context.Context) (*DiscoveryDevicesResponse, error) {
	var result DiscoveryDevicesResponse
	if err := c.doRequest(ctx, http.MethodGet, "/devices", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ========================================================================
// Network Diagnostics
// ========================================================================

// ScanWiFi scans for available WiFi networks
func (c *Client) ScanWiFi(ctx context.Context) (*WiFiScanResponse, error) {
	var result WiFiScanResponse
	if err := c.doRequest(ctx, http.MethodGet, "/api/network/wifi/scan", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// TestNetwork tests network connectivity to a host
func (c *Client) TestNetwork(ctx context.Context, req *NetworkTestRequest) (*NetworkTestResponse, error) {
	var result NetworkTestResponse
	if err := c.doRequest(ctx, http.MethodPost, "/api/network/test", req, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ========================================================================
// Device Control
// ========================================================================

// SendDeviceCommand sends a command to a device
func (c *Client) SendDeviceCommand(ctx context.Context, req *DeviceCommandRequest) (*DeviceCommandResponse, error) {
	var result DeviceCommandResponse
	if err := c.doRequest(ctx, http.MethodPost, "/api/device/command", req, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ========================================================================
// Lighting Control
// ========================================================================

// GetLightingFixtures retrieves all lighting fixtures
func (c *Client) GetLightingFixtures(ctx context.Context) (*LightingFixturesResponse, error) {
	var result LightingFixturesResponse
	if err := c.doRequest(ctx, http.MethodGet, "/lighting/fixtures", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// FailsafePower executes emergency lighting power control
func (c *Client) FailsafePower(ctx context.Context, req *FailsafePowerRequest) (*FailsafePowerResponse, error) {
	var result FailsafePowerResponse
	if err := c.doRequest(ctx, http.MethodPost, "/lighting/failsafe", req, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ========================================================================
// Automation Engine
// ========================================================================

// ListRules retrieves all automation rules
func (c *Client) ListRules(ctx context.Context) (*RulesListResponse, error) {
	var result RulesListResponse
	if err := c.doRequest(ctx, http.MethodGet, "/rules", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// CreateRule creates a new automation rule
func (c *Client) CreateRule(ctx context.Context, rule *AutomationRule) (*RuleCreateResponse, error) {
	var result RuleCreateResponse
	if err := c.doRequest(ctx, http.MethodPost, "/rules", rule, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// UpdateRule updates an existing automation rule
func (c *Client) UpdateRule(ctx context.Context, ruleID string, rule *AutomationRule) (*APIResponse, error) {
	var result APIResponse
	endpoint := fmt.Sprintf("/rules/%s", ruleID)
	if err := c.doRequest(ctx, http.MethodPatch, endpoint, rule, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// DeleteRule deletes an automation rule
func (c *Client) DeleteRule(ctx context.Context, ruleID string) (*APIResponse, error) {
	var result APIResponse
	endpoint := fmt.Sprintf("/rules/%s", ruleID)
	if err := c.doRequest(ctx, http.MethodDelete, endpoint, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ========================================================================
// AI Setup Assistant
// ========================================================================

// SetupAssist requests AI-powered setup guidance
func (c *Client) SetupAssist(ctx context.Context, req *AISetupRequest) (*AISetupResponse, error) {
	var result AISetupResponse
	if err := c.doRequest(ctx, http.MethodPost, "/ai/setup-assist", req, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
