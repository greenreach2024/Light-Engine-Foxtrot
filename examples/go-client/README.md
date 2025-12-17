# Light Engine Go Client

Go client library for the Light Engine Charlie API - Indoor farming automation platform.

[![Go Report Card](https://goreportcard.com/badge/github.com/greenreach2024/light-engine-client)](https://goreportcard.com/report/github.com/greenreach2024/light-engine-client)
[![GoDoc](https://godoc.org/github.com/greenreach2024/light-engine-client?status.svg)](https://godoc.org/github.com/greenreach2024/light-engine-client)

## Features

✅ **Type-Safe API Client** - Full Go structs for all API models  
✅ **Context Support** - Native context.Context for cancellation and timeouts  
✅ **Zero Dependencies** - Uses only Go standard library  
✅ **Idiomatic Go** - Follows Go best practices and conventions  
✅ **Comprehensive Coverage** - All 21 API endpoints supported  
✅ **Error Handling** - Custom error types with helper functions  
✅ **Goroutine-Safe** - Safe for concurrent use  

## Installation

```bash
go get github.com/greenreach2024/light-engine-client
```

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    "log"
    "time"

    lightengine "github.com/greenreach2024/light-engine-client"
)

func main() {
    // Create a new client
    client := lightengine.NewClient(
        "http://localhost:8000",
        lightengine.WithTimeout(10*time.Second),
    )

    ctx := context.Background()

    // Check API health
    health, err := client.Health(ctx)
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("API Status: %s\n", health.Status)

    // Ingest sensor data
    temp := 75.0
    humidity := 55.0
    co2 := 1200.0

    payload := &lightengine.SensorPayload{
        Scope:  "zone-alpha",
        Tenant: "demo-farm",
        Farm:   "North Facility",
        Room:   "Veg Room 1",
        Zone:   "Alpha",
        Sensors: lightengine.SensorReading{
            Temperature: &temp,
            Humidity:    &humidity,
            CO2:         &co2,
        },
        Units: lightengine.Units{
            Temperature: "F",
            Humidity:    "%",
            CO2:         "ppm",
        },
    }

    result, err := client.IngestSensorData(ctx, payload)
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Ingestion Status: %s\n", result.Status)
}
```

## Configuration

### Client Options

```go
// Default client (30 second timeout)
client := lightengine.NewClient("http://localhost:8000")

// Custom timeout
client := lightengine.NewClient(
    "http://localhost:8000",
    lightengine.WithTimeout(60*time.Second),
)

// With API key authentication
client := lightengine.NewClient(
    "http://localhost:8000",
    lightengine.WithAPIKey("your-api-key-here"),
)

// Custom HTTP client
httpClient := &http.Client{
    Transport: &http.Transport{
        MaxIdleConns:       10,
        IdleConnTimeout:    30 * time.Second,
    },
}
client := lightengine.NewClient(
    "http://localhost:8000",
    lightengine.WithHTTPClient(httpClient),
)
```

### Context Support

All methods accept `context.Context` for cancellation and timeouts:

```go
// With timeout
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

health, err := client.Health(ctx)

// With cancellation
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

// Cancel after some condition
go func() {
    time.Sleep(2 * time.Second)
    cancel()
}()

devices, err := client.GetDiscoveredDevices(ctx)
```

## API Reference

### Health & Status

```go
// Check API health
health, err := client.Health(ctx)
```

### Environmental Sensors

```go
// Ingest sensor data
result, err := client.IngestSensorData(ctx, payload)

// Get latest readings
readings, err := client.GetLatestReadings(ctx, "tenant-id")

// Get historical data
history, err := client.GetEnvHistory(ctx, "zone-alpha", "temperature", 24)
```

### Device Discovery

```go
// Trigger async discovery
trigger, err := client.TriggerDiscovery(ctx)

// Get all discovered devices
devices, err := client.GetDiscoveredDevices(ctx)

// Get protocol-specific devices
kasaDevices, err := client.GetKasaDevices(ctx)
mqttDevices, err := client.GetMQTTDevices(ctx)
bleDevices, err := client.GetBLEDevices(ctx)
mdnsDevices, err := client.GetMDNSDevices(ctx)

// Get consolidated device list
allDevices, err := client.GetDevices(ctx)
```

### Network Diagnostics

```go
// Scan WiFi networks
networks, err := client.ScanWiFi(ctx)

// Test network connectivity
testReq := &lightengine.NetworkTestRequest{
    Host:    "google.com",
    Port:    80,
    Timeout: 5,
}
result, err := client.TestNetwork(ctx, testReq)
```

### Device Control

```go
// Send device command
cmdReq := &lightengine.DeviceCommandRequest{
    DeviceID: "device-123",
    Command:  "set_brightness",
    Params: map[string]interface{}{
        "level": 80,
    },
}
response, err := client.SendDeviceCommand(ctx, cmdReq)
```

### Lighting Control

```go
// Get all lighting fixtures
fixtures, err := client.GetLightingFixtures(ctx)

// Emergency power control
failsafe := &lightengine.FailsafePowerRequest{
    Action:    "shutdown",
    TargetIDs: []string{"fixture-1", "fixture-2"},
    Reason:    "Emergency temperature threshold",
}
result, err := client.FailsafePower(ctx, failsafe)
```

### Automation Engine

```go
// List all rules
rules, err := client.ListRules(ctx)

// Create a new rule
rule := &lightengine.AutomationRule{
    Name:        "Temperature Alert",
    Description: "Alert when temperature exceeds 80°F",
    Enabled:     true,
    Trigger: map[string]interface{}{
        "type":   "sensor_threshold",
        "sensor": "temperature",
        "op":     ">",
        "value":  80,
    },
    Actions: []map[string]interface{}{
        {
            "type":    "notification",
            "channel": "email",
            "message": "Temperature exceeded 80°F",
        },
    },
}
created, err := client.CreateRule(ctx, rule)

// Update a rule
updated, err := client.UpdateRule(ctx, "rule-123", rule)

// Delete a rule
deleted, err := client.DeleteRule(ctx, "rule-123")
```

### AI Setup Assistant

```go
// Get AI-powered setup guidance
aiReq := &lightengine.AISetupRequest{
    DeviceType: "tp-link-kasa",
    Context: map[string]interface{}{
        "location": "greenhouse",
        "network":  "2.4GHz",
    },
    Question: "How do I configure this device?",
}
guidance, err := client.SetupAssist(ctx, aiReq)
```

## Error Handling

The client provides typed errors with helper functions:

```go
devices, err := client.GetDiscoveredDevices(ctx)
if err != nil {
    if lightengine.IsNotFound(err) {
        fmt.Println("No devices found")
    } else if lightengine.IsUnauthorized(err) {
        fmt.Println("Authentication failed")
    } else if lightengine.IsBadRequest(err) {
        fmt.Println("Invalid request")
    } else {
        fmt.Printf("Error: %v\n", err)
    }
}
```

### Custom Error Type

```go
if apiErr, ok := err.(*lightengine.Error); ok {
    fmt.Printf("Status Code: %d\n", apiErr.StatusCode)
    fmt.Printf("Message: %s\n", apiErr.Message)
    fmt.Printf("Detail: %s\n", apiErr.Detail)
}
```

## Examples

See the `examples/` directory for comprehensive usage examples covering all API endpoints:

```bash
cd examples
go run main.go
```

## Testing

```bash
# Run tests
go test ./...

# Run tests with coverage
go test -cover ./...

# Run tests with race detector
go test -race ./...
```

## Development

### Requirements

- Go 1.21 or later
- Light Engine API running on `http://localhost:8000`

### Building

```bash
# Build the library
go build

# Build examples
cd examples
go build
```

### Code Style

This library follows standard Go conventions:
- Run `gofmt` to format code
- Run `go vet` to check for issues
- Run `golint` for style suggestions

## Documentation

Full API documentation is available at [GoDoc](https://godoc.org/github.com/greenreach2024/light-engine-client).

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run `go fmt` and `go vet`
6. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/greenreach2024/Light-Engine-Echo/issues)
- **Documentation**: [API Reference](https://github.com/greenreach2024/Light-Engine-Echo/blob/main/docs/API_REFERENCE.md)
- **Repository**: [Light-Engine-Echo](https://github.com/greenreach2024/Light-Engine-Echo)

## Related Projects

- **Python SDK**: [light-engine-client](https://test.pypi.org/project/light-engine-client/) on PyPI
- **TypeScript SDK**: [@light-engine/client](https://www.npmjs.com/package/@light-engine/client) on npm
- **REST API**: [Light Engine Charlie Backend](https://github.com/greenreach2024/Light-Engine-Echo/tree/main/backend)

## Changelog

### v1.0.0 (2025-12-06)

- Initial release
- Support for all 21 API endpoints
- Full type safety with Go structs
- Context support for cancellation and timeouts
- Zero external dependencies
- Comprehensive examples
- Complete documentation
