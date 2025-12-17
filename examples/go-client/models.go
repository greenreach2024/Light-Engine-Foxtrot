package lightengine

import "time"

// SensorReading represents environmental sensor measurements
type SensorReading struct {
	Temperature *float64 `json:"temperature,omitempty"`
	Humidity    *float64 `json:"humidity,omitempty"`
	CO2         *float64 `json:"co2,omitempty"`
	VPD         *float64 `json:"vpd,omitempty"`
	PPFD        *float64 `json:"ppfd,omitempty"`
	DLI         *float64 `json:"dli,omitempty"`
}

// Units represents the measurement units for sensor readings
type Units struct {
	Temperature string `json:"temperature,omitempty"`
	Humidity    string `json:"humidity,omitempty"`
	CO2         string `json:"co2,omitempty"`
	VPD         string `json:"vpd,omitempty"`
	PPFD        string `json:"ppfd,omitempty"`
	DLI         string `json:"dli,omitempty"`
}

// SensorPayload represents the request body for sensor data ingestion
type SensorPayload struct {
	Scope     string        `json:"scope"`
	Tenant    string        `json:"tenant"`
	Farm      string        `json:"farm"`
	Room      string        `json:"room"`
	Zone      string        `json:"zone"`
	Sensors   SensorReading `json:"sensors"`
	Units     Units         `json:"units,omitempty"`
	Timestamp *time.Time    `json:"timestamp,omitempty"`
}

// APIResponse represents a generic API response
type APIResponse struct {
	Status    string      `json:"status"`
	Message   string      `json:"message,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Timestamp string      `json:"timestamp,omitempty"`
}

// HealthResponse represents the health check response
type HealthResponse struct {
	Status    string `json:"status"`
	Version   string `json:"version,omitempty"`
	Timestamp string `json:"timestamp"`
}

// LatestReading represents a single latest sensor reading
type LatestReading struct {
	Scope     string        `json:"scope"`
	Tenant    string        `json:"tenant"`
	Farm      string        `json:"farm"`
	Room      string        `json:"room"`
	Zone      string        `json:"zone"`
	Sensors   SensorReading `json:"sensors"`
	Units     Units         `json:"units"`
	Timestamp string        `json:"timestamp"`
}

// LatestReadingsResponse represents the latest readings response
type LatestReadingsResponse struct {
	Status    string          `json:"status"`
	Count     int             `json:"count"`
	Readings  []LatestReading `json:"readings"`
	Timestamp string          `json:"timestamp"`
}

// EnvDataPoint represents a single environmental data point
type EnvDataPoint struct {
	Timestamp string  `json:"timestamp"`
	Value     float64 `json:"value"`
}

// EnvHistoryResponse represents historical environmental data
type EnvHistoryResponse struct {
	Status    string         `json:"status"`
	Scope     string         `json:"scope"`
	Metric    string         `json:"metric"`
	Data      []EnvDataPoint `json:"data"`
	Timestamp string         `json:"timestamp"`
}

// DiscoveryDevice represents a discovered device
type DiscoveryDevice struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Type         string            `json:"type"`
	Protocol     string            `json:"protocol"`
	IPAddress    string            `json:"ip_address,omitempty"`
	MACAddress   string            `json:"mac_address,omitempty"`
	Manufacturer string            `json:"manufacturer,omitempty"`
	Model        string            `json:"model,omitempty"`
	Capabilities []string          `json:"capabilities,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// DiscoveryTriggerResponse represents the discovery trigger response
type DiscoveryTriggerResponse struct {
	Status    string `json:"status"`
	Message   string `json:"message"`
	TaskID    string `json:"task_id,omitempty"`
	Timestamp string `json:"timestamp"`
}

// DiscoveryDevicesResponse represents discovered devices list
type DiscoveryDevicesResponse struct {
	Status    string            `json:"status"`
	Count     int               `json:"count"`
	Devices   []DiscoveryDevice `json:"devices"`
	Timestamp string            `json:"timestamp"`
}

// NetworkTestRequest represents a network connectivity test request
type NetworkTestRequest struct {
	Host    string `json:"host"`
	Port    int    `json:"port"`
	Timeout int    `json:"timeout,omitempty"`
}

// NetworkTestResponse represents a network test result
type NetworkTestResponse struct {
	Status      string  `json:"status"`
	Reachable   bool    `json:"reachable"`
	Host        string  `json:"host"`
	Port        int     `json:"port"`
	Latency     float64 `json:"latency,omitempty"`
	Error       string  `json:"error,omitempty"`
	Timestamp   string  `json:"timestamp"`
	TestResults string  `json:"test_results,omitempty"`
}

// WiFiNetwork represents a WiFi network
type WiFiNetwork struct {
	SSID      string `json:"ssid"`
	BSSID     string `json:"bssid,omitempty"`
	Signal    int    `json:"signal,omitempty"`
	Channel   int    `json:"channel,omitempty"`
	Security  string `json:"security,omitempty"`
	Frequency string `json:"frequency,omitempty"`
}

// WiFiScanResponse represents WiFi scan results
type WiFiScanResponse struct {
	Status    string        `json:"status"`
	Count     int           `json:"count"`
	Networks  []WiFiNetwork `json:"networks"`
	Timestamp string        `json:"timestamp"`
}

// DeviceCommandRequest represents a device command request
type DeviceCommandRequest struct {
	DeviceID string                 `json:"device_id"`
	Command  string                 `json:"command"`
	Params   map[string]interface{} `json:"params,omitempty"`
}

// DeviceCommandResponse represents a device command response
type DeviceCommandResponse struct {
	Status    string      `json:"status"`
	DeviceID  string      `json:"device_id"`
	Command   string      `json:"command"`
	Result    interface{} `json:"result,omitempty"`
	Error     string      `json:"error,omitempty"`
	Timestamp string      `json:"timestamp"`
}

// LightingFixture represents a lighting fixture
type LightingFixture struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Type         string            `json:"type"`
	Manufacturer string            `json:"manufacturer,omitempty"`
	Model        string            `json:"model,omitempty"`
	Channels     []string          `json:"channels,omitempty"`
	MaxPower     int               `json:"max_power,omitempty"`
	Location     string            `json:"location,omitempty"`
	Status       string            `json:"status,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// LightingFixturesResponse represents lighting fixtures list
type LightingFixturesResponse struct {
	Status    string            `json:"status"`
	Count     int               `json:"count"`
	Fixtures  []LightingFixture `json:"fixtures"`
	Timestamp string            `json:"timestamp"`
}

// FailsafePowerRequest represents a failsafe power control request
type FailsafePowerRequest struct {
	Action    string   `json:"action"`
	TargetIDs []string `json:"target_ids,omitempty"`
	Reason    string   `json:"reason,omitempty"`
}

// FailsafePowerResponse represents a failsafe power control response
type FailsafePowerResponse struct {
	Status    string `json:"status"`
	Message   string `json:"message"`
	Action    string `json:"action"`
	Affected  int    `json:"affected,omitempty"`
	Timestamp string `json:"timestamp"`
}

// AutomationRule represents an automation rule
type AutomationRule struct {
	ID          string                 `json:"id,omitempty"`
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Enabled     bool                   `json:"enabled"`
	Trigger     map[string]interface{} `json:"trigger"`
	Conditions  []map[string]interface{} `json:"conditions,omitempty"`
	Actions     []map[string]interface{} `json:"actions"`
	Priority    int                    `json:"priority,omitempty"`
	CreatedAt   string                 `json:"created_at,omitempty"`
	UpdatedAt   string                 `json:"updated_at,omitempty"`
}

// RulesListResponse represents a list of automation rules
type RulesListResponse struct {
	Status    string           `json:"status"`
	Count     int              `json:"count"`
	Rules     []AutomationRule `json:"rules"`
	Timestamp string           `json:"timestamp"`
}

// RuleCreateResponse represents the response after creating a rule
type RuleCreateResponse struct {
	Status    string         `json:"status"`
	Message   string         `json:"message"`
	Rule      AutomationRule `json:"rule"`
	Timestamp string         `json:"timestamp"`
}

// AISetupRequest represents an AI setup assistance request
type AISetupRequest struct {
	DeviceType string                 `json:"device_type"`
	Context    map[string]interface{} `json:"context,omitempty"`
	Question   string                 `json:"question,omitempty"`
}

// AISetupResponse represents an AI setup assistance response
type AISetupResponse struct {
	Status        string   `json:"status"`
	Guidance      string   `json:"guidance"`
	Steps         []string `json:"steps,omitempty"`
	Warnings      []string `json:"warnings,omitempty"`
	NextActions   []string `json:"next_actions,omitempty"`
	Timestamp     string   `json:"timestamp"`
}
