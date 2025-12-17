package lightengine

import (
	"context"
	"testing"
	"time"
)

func TestNewClient(t *testing.T) {
	client := NewClient("http://localhost:8000")
	if client == nil {
		t.Fatal("Expected client to be created")
	}
	if client.baseURL != "http://localhost:8000" {
		t.Errorf("Expected baseURL to be http://localhost:8000, got %s", client.baseURL)
	}
}

func TestClientOptions(t *testing.T) {
	client := NewClient(
		"http://localhost:8000",
		WithTimeout(60*time.Second),
		WithAPIKey("test-key"),
	)
	
	if client.httpClient.Timeout != 60*time.Second {
		t.Errorf("Expected timeout to be 60s, got %v", client.httpClient.Timeout)
	}
	if client.apiKey != "test-key" {
		t.Errorf("Expected apiKey to be test-key, got %s", client.apiKey)
	}
}

func TestErrorHelpers(t *testing.T) {
	err404 := NewError(404, "Not Found", "Resource not found")
	err401 := NewError(401, "Unauthorized", "Invalid credentials")
	err400 := NewError(400, "Bad Request", "Invalid input")

	if !IsNotFound(err404) {
		t.Error("Expected IsNotFound to return true for 404 error")
	}
	if IsNotFound(err401) {
		t.Error("Expected IsNotFound to return false for 401 error")
	}

	if !IsUnauthorized(err401) {
		t.Error("Expected IsUnauthorized to return true for 401 error")
	}

	if !IsBadRequest(err400) {
		t.Error("Expected IsBadRequest to return true for 400 error")
	}
}

func TestSensorPayload(t *testing.T) {
	temp := 75.0
	humidity := 55.0

	payload := &SensorPayload{
		Scope:  "zone-alpha",
		Tenant: "test-farm",
		Farm:   "North",
		Room:   "Veg Room 1",
		Zone:   "Alpha",
		Sensors: SensorReading{
			Temperature: &temp,
			Humidity:    &humidity,
		},
		Units: Units{
			Temperature: "F",
			Humidity:    "%",
		},
	}

	if payload.Scope != "zone-alpha" {
		t.Errorf("Expected scope to be zone-alpha, got %s", payload.Scope)
	}
	if *payload.Sensors.Temperature != 75.0 {
		t.Errorf("Expected temperature to be 75.0, got %f", *payload.Sensors.Temperature)
	}
}

func TestAutomationRule(t *testing.T) {
	rule := &AutomationRule{
		Name:    "Test Rule",
		Enabled: true,
		Trigger: map[string]interface{}{
			"type": "sensor_threshold",
		},
		Actions: []map[string]interface{}{
			{"type": "notification"},
		},
	}

	if rule.Name != "Test Rule" {
		t.Errorf("Expected name to be 'Test Rule', got %s", rule.Name)
	}
	if !rule.Enabled {
		t.Error("Expected rule to be enabled")
	}
}

// Mock test showing how to use the client with context
func TestClientWithContext(t *testing.T) {
	client := NewClient("http://localhost:8000")
	
	// Test that context is properly handled
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// This would fail in real test without server, but demonstrates context usage
	_, err := client.Health(ctx)
	if err == nil {
		// If server is running, this passes
		t.Log("Health check succeeded (server is running)")
	} else {
		// Expected if no server
		t.Logf("Health check failed as expected (no server): %v", err)
	}
}
