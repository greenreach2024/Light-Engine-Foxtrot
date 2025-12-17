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

	fmt.Println("Light Engine Go SDK Examples")
	fmt.Println("=" * 50)

	// Example 1: Health Check
	fmt.Println("\n1. Health Check")
	if err := exampleHealthCheck(ctx, client); err != nil {
		log.Printf("Health check failed: %v", err)
	}

	// Example 2: Ingest Sensor Data
	fmt.Println("\n2. Ingest Sensor Data")
	if err := exampleIngestSensorData(ctx, client); err != nil {
		log.Printf("Ingest sensor data failed: %v", err)
	}

	// Example 3: Get Latest Readings
	fmt.Println("\n3. Get Latest Readings")
	if err := exampleGetLatestReadings(ctx, client); err != nil {
		log.Printf("Get latest readings failed: %v", err)
	}

	// Example 4: Get Environmental History
	fmt.Println("\n4. Get Environmental History")
	if err := exampleGetEnvHistory(ctx, client); err != nil {
		log.Printf("Get env history failed: %v", err)
	}

	// Example 5: Trigger Device Discovery
	fmt.Println("\n5. Trigger Device Discovery")
	if err := exampleTriggerDiscovery(ctx, client); err != nil {
		log.Printf("Trigger discovery failed: %v", err)
	}

	// Example 6: Get Discovered Devices
	fmt.Println("\n6. Get Discovered Devices")
	if err := exampleGetDiscoveredDevices(ctx, client); err != nil {
		log.Printf("Get discovered devices failed: %v", err)
	}

	// Example 7: WiFi Scan
	fmt.Println("\n7. WiFi Network Scan")
	if err := exampleScanWiFi(ctx, client); err != nil {
		log.Printf("WiFi scan failed: %v", err)
	}

	// Example 8: Network Connectivity Test
	fmt.Println("\n8. Network Connectivity Test")
	if err := exampleTestNetwork(ctx, client); err != nil {
		log.Printf("Network test failed: %v", err)
	}

	// Example 9: Get Lighting Fixtures
	fmt.Println("\n9. Get Lighting Fixtures")
	if err := exampleGetLightingFixtures(ctx, client); err != nil {
		log.Printf("Get lighting fixtures failed: %v", err)
	}

	// Example 10: List Automation Rules
	fmt.Println("\n10. List Automation Rules")
	if err := exampleListRules(ctx, client); err != nil {
		log.Printf("List rules failed: %v", err)
	}

	// Example 11: Create Automation Rule
	fmt.Println("\n11. Create Automation Rule")
	if err := exampleCreateRule(ctx, client); err != nil {
		log.Printf("Create rule failed: %v", err)
	}

	// Example 12: AI Setup Assistance
	fmt.Println("\n12. AI Setup Assistance")
	if err := exampleSetupAssist(ctx, client); err != nil {
		log.Printf("Setup assist failed: %v", err)
	}

	fmt.Println("\n" + "="*50)
	fmt.Println("All examples completed!")
}

func exampleHealthCheck(ctx context.Context, client *lightengine.Client) error {
	health, err := client.Health(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("✓ API Status: %s\n", health.Status)
	fmt.Printf("  Version: %s\n", health.Version)
	fmt.Printf("  Timestamp: %s\n", health.Timestamp)
	return nil
}

func exampleIngestSensorData(ctx context.Context, client *lightengine.Client) error {
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
		return err
	}
	fmt.Printf("✓ Status: %s\n", result.Status)
	fmt.Printf("  Message: %s\n", result.Message)
	return nil
}

func exampleGetLatestReadings(ctx context.Context, client *lightengine.Client) error {
	readings, err := client.GetLatestReadings(ctx, "demo-farm")
	if err != nil {
		return err
	}
	fmt.Printf("✓ Found %d readings\n", readings.Count)
	for i, reading := range readings.Readings {
		fmt.Printf("  [%d] %s/%s/%s\n", i+1, reading.Farm, reading.Room, reading.Zone)
		if reading.Sensors.Temperature != nil {
			fmt.Printf("      Temperature: %.1f%s\n", *reading.Sensors.Temperature, reading.Units.Temperature)
		}
		if reading.Sensors.Humidity != nil {
			fmt.Printf("      Humidity: %.1f%s\n", *reading.Sensors.Humidity, reading.Units.Humidity)
		}
	}
	return nil
}

func exampleGetEnvHistory(ctx context.Context, client *lightengine.Client) error {
	history, err := client.GetEnvHistory(ctx, "zone-alpha", "temperature", 24)
	if err != nil {
		return err
	}
	fmt.Printf("✓ Historical data for %s (scope: %s)\n", history.Metric, history.Scope)
	fmt.Printf("  Data points: %d\n", len(history.Data))
	if len(history.Data) > 0 {
		fmt.Printf("  First: %.2f at %s\n", history.Data[0].Value, history.Data[0].Timestamp)
		fmt.Printf("  Last: %.2f at %s\n", history.Data[len(history.Data)-1].Value, history.Data[len(history.Data)-1].Timestamp)
	}
	return nil
}

func exampleTriggerDiscovery(ctx context.Context, client *lightengine.Client) error {
	result, err := client.TriggerDiscovery(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("✓ Status: %s\n", result.Status)
	fmt.Printf("  Message: %s\n", result.Message)
	if result.TaskID != "" {
		fmt.Printf("  Task ID: %s\n", result.TaskID)
	}
	return nil
}

func exampleGetDiscoveredDevices(ctx context.Context, client *lightengine.Client) error {
	devices, err := client.GetDiscoveredDevices(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("✓ Found %d devices\n", devices.Count)
	for i, device := range devices.Devices {
		fmt.Printf("  [%d] %s (%s)\n", i+1, device.Name, device.Type)
		fmt.Printf("      Protocol: %s\n", device.Protocol)
		if device.IPAddress != "" {
			fmt.Printf("      IP: %s\n", device.IPAddress)
		}
	}
	return nil
}

func exampleScanWiFi(ctx context.Context, client *lightengine.Client) error {
	networks, err := client.ScanWiFi(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("✓ Found %d WiFi networks\n", networks.Count)
	for i, network := range networks.Networks {
		if i >= 5 { // Show only first 5
			fmt.Printf("  ... and %d more\n", networks.Count-5)
			break
		}
		fmt.Printf("  [%d] %s (Signal: %d)\n", i+1, network.SSID, network.Signal)
	}
	return nil
}

func exampleTestNetwork(ctx context.Context, client *lightengine.Client) error {
	req := &lightengine.NetworkTestRequest{
		Host:    "google.com",
		Port:    80,
		Timeout: 5,
	}

	result, err := client.TestNetwork(ctx, req)
	if err != nil {
		return err
	}
	fmt.Printf("✓ Host: %s:%d\n", result.Host, result.Port)
	fmt.Printf("  Reachable: %v\n", result.Reachable)
	if result.Latency > 0 {
		fmt.Printf("  Latency: %.2fms\n", result.Latency)
	}
	return nil
}

func exampleGetLightingFixtures(ctx context.Context, client *lightengine.Client) error {
	fixtures, err := client.GetLightingFixtures(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("✓ Found %d lighting fixtures\n", fixtures.Count)
	for i, fixture := range fixtures.Fixtures {
		fmt.Printf("  [%d] %s (%s)\n", i+1, fixture.Name, fixture.Type)
		if fixture.Manufacturer != "" {
			fmt.Printf("      %s %s\n", fixture.Manufacturer, fixture.Model)
		}
		fmt.Printf("      Status: %s\n", fixture.Status)
	}
	return nil
}

func exampleListRules(ctx context.Context, client *lightengine.Client) error {
	rules, err := client.ListRules(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("✓ Found %d automation rules\n", rules.Count)
	for i, rule := range rules.Rules {
		fmt.Printf("  [%d] %s\n", i+1, rule.Name)
		fmt.Printf("      Enabled: %v\n", rule.Enabled)
		if rule.Description != "" {
			fmt.Printf("      Description: %s\n", rule.Description)
		}
	}
	return nil
}

func exampleCreateRule(ctx context.Context, client *lightengine.Client) error {
	rule := &lightengine.AutomationRule{
		Name:        "Temperature Alert - Go SDK",
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
		Priority: 5,
	}

	result, err := client.CreateRule(ctx, rule)
	if err != nil {
		return err
	}
	fmt.Printf("✓ Status: %s\n", result.Status)
	fmt.Printf("  Message: %s\n", result.Message)
	fmt.Printf("  Rule ID: %s\n", result.Rule.ID)
	return nil
}

func exampleSetupAssist(ctx context.Context, client *lightengine.Client) error {
	req := &lightengine.AISetupRequest{
		DeviceType: "tp-link-kasa",
		Context: map[string]interface{}{
			"location": "greenhouse",
			"network":  "2.4GHz",
		},
		Question: "How do I configure this device for grow lights?",
	}

	result, err := client.SetupAssist(ctx, req)
	if err != nil {
		return err
	}
	fmt.Printf("✓ Status: %s\n", result.Status)
	fmt.Printf("  Guidance: %s\n", result.Guidance)
	if len(result.Steps) > 0 {
		fmt.Printf("  Steps:\n")
		for i, step := range result.Steps {
			fmt.Printf("    %d. %s\n", i+1, step)
		}
	}
	return nil
}
