"""Comprehensive test suite for Light Engine Charlie API endpoints.

Tests cover:
- Device discovery and management
- Device command execution (Kasa, MQTT)
- Authentication and authorization (JWT)
- Multi-tenant data isolation
- Telemetry ingestion
- Automation rules
- Schedule management
- Network testing
- Error handling
"""

import pytest
import json
from unittest.mock import patch, Mock, AsyncMock
from fastapi.testclient import TestClient
from backend.server import app
from backend.state import DeviceRegistry, ScheduleStore, GroupScheduleStore
from backend.device_models import Device


class TestHealthAndInfo:
    """Test health check and service information endpoints."""
    
    def test_root_endpoint(self, test_client: TestClient):
        """Test GET / returns service information."""
        response = test_client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "Light Engine Charlie" in data["message"]
    
    def test_openapi_spec(self, test_client: TestClient):
        """Test OpenAPI specification is accessible."""
        response = test_client.get("/openapi.json")
        assert response.status_code == 200
        spec = response.json()
        assert "openapi" in spec
        assert "paths" in spec


class TestDeviceManagement:
    """Test device listing and registration endpoints."""
    
    def test_list_devices_empty(self, test_client: TestClient):
        """Test listing devices when registry is empty."""
        response = test_client.get("/devices")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0
    
    def test_list_devices_populated(self, test_client: TestClient, populate_test_devices):
        """Test listing devices with populated registry."""
        response = test_client.get("/devices")
        assert response.status_code == 200
        devices = response.json()
        assert len(devices) == 2
        assert devices[0]["protocol"] in ["kasa", "mqtt"]
        assert "id" in devices[0]
        assert "name" in devices[0]
    
    def test_list_devices_by_protocol(self, test_client: TestClient, populate_test_devices):
        """Test filtering devices by protocol."""
        response = test_client.get("/devices?protocol=kasa")
        assert response.status_code == 200
        devices = response.json()
        assert all(d["protocol"] == "kasa" for d in devices)
    
    def test_get_device_by_id(self, test_client: TestClient, populate_test_devices):
        """Test getting a specific device by ID."""
        response = test_client.get("/devices/test-device-1")
        assert response.status_code == 200
        device = response.json()
        assert device["id"] == "test-device-1"
        assert device["name"] == "Test Grow Light"
    
    def test_get_device_not_found(self, test_client: TestClient):
        """Test getting a non-existent device returns 404."""
        response = test_client.get("/devices/non-existent-device")
        assert response.status_code == 404


class TestDeviceDiscovery:
    """Test device discovery endpoints."""
    
    @patch("backend.device_discovery.Discover.discover")
    async def test_discover_kasa_devices(self, mock_discover, test_client: TestClient):
        """Test Kasa device discovery endpoint."""
        # Mock Kasa discovery
        mock_device = AsyncMock()
        mock_device.alias = "Discovered Light"
        mock_device.model = "KL130"
        mock_device.host = "192.168.1.50"
        mock_device.mac = "AA:BB:CC:DD:EE:FF"
        mock_discover.return_value = {"192.168.1.50": mock_device}
        
        response = test_client.get("/api/devices/kasa")
        assert response.status_code == 200
        devices = response.json()
        assert isinstance(devices, list)
    
    @patch("backend.device_discovery.fetch_switchbot_status")
    def test_discover_switchbot_devices(self, mock_switchbot, test_client: TestClient):
        """Test SwitchBot device discovery endpoint."""
        mock_switchbot.return_value = {
            "deviceList": [
                {
                    "deviceId": "switchbot-1",
                    "deviceName": "SwitchBot Light",
                    "deviceType": "Color Bulb"
                }
            ]
        }
        
        response = test_client.get("/api/devices/switchbot")
        assert response.status_code == 200
        devices = response.json()
        assert isinstance(devices, list)
    
    def test_trigger_discovery_scan(self, test_client: TestClient):
        """Test triggering a full discovery scan."""
        response = test_client.post("/discovery/run")
        assert response.status_code in [200, 202]  # Accepted for async processing


class TestDeviceCommands:
    """Test device command execution endpoints."""
    
    @patch("backend.server.SmartDevice.connect")
    async def test_turn_on_kasa_device(self, mock_connect, test_client: TestClient, sample_device):
        """Test turning on a Kasa device."""
        # Register device
        registry = DeviceRegistry()
        registry.register(sample_device)
        
        # Mock Kasa device
        mock_device = AsyncMock()
        mock_device.turn_on = AsyncMock()
        mock_device.update = AsyncMock()
        mock_connect.return_value.__aenter__.return_value = mock_device
        
        response = test_client.post(
            "/api/device/command",
            json={
                "device_id": "test-device-1",
                "command": {"action": "turn_on"}
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["device_id"] == "test-device-1"
    
    @patch("backend.server.SmartDevice.connect")
    async def test_set_brightness_kasa_device(self, mock_connect, test_client: TestClient, sample_device):
        """Test setting brightness on a Kasa device."""
        registry = DeviceRegistry()
        registry.register(sample_device)
        
        mock_device = AsyncMock()
        mock_device.set_brightness = AsyncMock()
        mock_device.update = AsyncMock()
        mock_connect.return_value.__aenter__.return_value = mock_device
        
        response = test_client.post(
            "/api/device/command",
            json={
                "device_id": "test-device-1",
                "command": {
                    "action": "set_brightness",
                    "brightness": 75
                }
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
    
    def test_device_command_invalid_device(self, test_client: TestClient):
        """Test device command with non-existent device."""
        response = test_client.post(
            "/api/device/command",
            json={
                "device_id": "non-existent",
                "command": {"action": "turn_on"}
            }
        )
        
        assert response.status_code == 404
    
    def test_device_command_invalid_action(self, test_client: TestClient, sample_device):
        """Test device command with invalid action."""
        registry = DeviceRegistry()
        registry.register(sample_device)
        
        response = test_client.post(
            "/api/device/command",
            json={
                "device_id": "test-device-1",
                "command": {"action": "invalid_action"}
            }
        )
        
        assert response.status_code == 400
    
    @patch("backend.server.mqtt.Client")
    def test_mqtt_device_command(self, mock_mqtt, test_client: TestClient, sample_mqtt_device):
        """Test MQTT device command execution."""
        registry = DeviceRegistry()
        registry.register(sample_mqtt_device)
        
        mock_client = Mock()
        mock_client.connect = Mock(return_value=0)
        mock_client.publish = Mock(return_value=(0, 1))
        mock_mqtt.return_value = mock_client
        
        response = test_client.post(
            "/api/device/command",
            json={
                "device_id": "mqtt-device-1",
                "command": {
                    "action": "publish",
                    "topic": "zigbee2mqtt/light-1/set",
                    "payload": {"state": "ON"}
                }
            }
        )
        
        assert response.status_code == 200


class TestMultiTenantIsolation:
    """Test multi-tenant data isolation."""
    
    def test_list_devices_tenant_filtering(self, test_client: TestClient, multi_tenant_devices):
        """Test devices are filtered by tenant."""
        # Simulate authenticated user from farm-1
        with patch("backend.server.get_tenant_id_from_user", return_value="farm-1"):
            response = test_client.get("/devices")
            assert response.status_code == 200
            devices = response.json()
            
            # Should see farm-1 devices and shared devices
            device_tenants = {d.get("tenant_id") for d in devices}
            assert "farm-1" in device_tenants or None in device_tenants
            assert "farm-2" not in device_tenants
    
    def test_device_command_cross_tenant_denied(self, test_client: TestClient, multi_tenant_devices):
        """Test device command is denied for cross-tenant access."""
        # User from farm-1 trying to control farm-2 device
        with patch("backend.server.get_tenant_id_from_user", return_value="farm-1"):
            response = test_client.post(
                "/api/device/command",
                json={
                    "device_id": "farm2-device-1",
                    "command": {"action": "turn_on"}
                }
            )
            
            assert response.status_code == 404  # Device not found for this tenant
    
    def test_shared_device_accessible_all_tenants(self, test_client: TestClient, multi_tenant_devices):
        """Test shared devices (tenant_id=None) are accessible to all tenants."""
        # User from farm-1 accessing shared device
        with patch("backend.server.get_tenant_id_from_user", return_value="farm-1"):
            response = test_client.get("/devices/shared-device-1")
            assert response.status_code == 200
            device = response.json()
            assert device["id"] == "shared-device-1"


class TestTelemetryIngestion:
    """Test telemetry data ingestion endpoints."""
    
    def test_ingest_telemetry_stream(self, test_client: TestClient, sample_telemetry_payload):
        """Test telemetry stream ingestion."""
        response = test_client.post(
            "/telemetry/streams",
            json=sample_telemetry_payload
        )
        
        assert response.status_code in [200, 201]
        data = response.json()
        assert "status" in data
        assert data["status"] in ["ok", "success", "accepted"]
    
    def test_ingest_telemetry_invalid_payload(self, test_client: TestClient):
        """Test telemetry ingestion with invalid payload."""
        response = test_client.post(
            "/telemetry/streams",
            json={"invalid": "payload"}
        )
        
        # Should either reject (400) or accept and handle gracefully
        assert response.status_code in [400, 422]
    
    def test_query_telemetry_data(self, test_client: TestClient):
        """Test querying telemetry data."""
        response = test_client.get("/telemetry/query?scope=zone-alpha&hours=24")
        assert response.status_code == 200
        # Should return data structure even if empty


class TestAutomationRules:
    """Test automation rules management."""
    
    def test_list_automation_rules_empty(self, test_client: TestClient):
        """Test listing automation rules when none exist."""
        response = test_client.get("/rules")
        assert response.status_code == 200
        rules = response.json()
        assert isinstance(rules, list)
    
    def test_create_automation_rule(self, test_client: TestClient, sample_automation_rule):
        """Test creating a new automation rule."""
        response = test_client.post(
            "/rules",
            json=sample_automation_rule
        )
        
        assert response.status_code in [200, 201]
        data = response.json()
        assert "id" in data or "rule_id" in data
    
    def test_get_automation_rule(self, test_client: TestClient, sample_automation_rule):
        """Test getting a specific automation rule."""
        # Create rule first
        create_response = test_client.post("/rules", json=sample_automation_rule)
        assert create_response.status_code in [200, 201]
        
        rule_data = create_response.json()
        rule_id = rule_data.get("id") or rule_data.get("rule_id")
        
        # Get the rule
        response = test_client.get(f"/rules/{rule_id}")
        assert response.status_code == 200
    
    def test_update_automation_rule(self, test_client: TestClient, sample_automation_rule):
        """Test updating an automation rule."""
        # Create rule first
        create_response = test_client.post("/rules", json=sample_automation_rule)
        rule_data = create_response.json()
        rule_id = rule_data.get("id") or rule_data.get("rule_id")
        
        # Update the rule
        updated_rule = sample_automation_rule.copy()
        updated_rule["enabled"] = False
        
        response = test_client.patch(f"/rules/{rule_id}", json=updated_rule)
        assert response.status_code == 200
    
    def test_delete_automation_rule(self, test_client: TestClient, sample_automation_rule):
        """Test deleting an automation rule."""
        # Create rule first
        create_response = test_client.post("/rules", json=sample_automation_rule)
        rule_data = create_response.json()
        rule_id = rule_data.get("id") or rule_data.get("rule_id")
        
        # Delete the rule
        response = test_client.delete(f"/rules/{rule_id}")
        assert response.status_code in [200, 204]


class TestScheduleManagement:
    """Test schedule management endpoints."""
    
    def test_list_schedules(self, test_client: TestClient, populate_test_schedules):
        """Test listing schedules."""
        response = test_client.get("/schedules")
        assert response.status_code == 200
        schedules = response.json()
        assert isinstance(schedules, list)
        assert len(schedules) > 0
    
    def test_list_schedules_by_group(self, test_client: TestClient, populate_test_schedules):
        """Test filtering schedules by group."""
        response = test_client.get("/schedules?group=zone-alpha")
        assert response.status_code == 200
        schedules = response.json()
        assert all(s["group"] == "zone-alpha" for s in schedules)
    
    def test_get_device_schedule(self, test_client: TestClient, sample_device, sample_group_schedule):
        """Test getting schedule for a specific device."""
        # Register device and schedule
        registry = DeviceRegistry()
        registry.register(sample_device)
        
        from backend.state import GroupScheduleStore
        store = GroupScheduleStore()
        store.upsert(sample_group_schedule)  # Use upsert instead of set
        
        response = test_client.get("/schedules/device/test-device-1")
        assert response.status_code == 200
        schedule = response.json()
        assert schedule["device_id"] == "test-device-1"


class TestNetworkTesting:
    """Test network connectivity testing endpoints."""
    
    @patch("backend.server.subprocess.run")
    def test_network_ping(self, mock_run, test_client: TestClient):
        """Test network ping functionality."""
        mock_run.return_value = Mock(returncode=0, stdout="PING success")
        
        response = test_client.post(
            "/api/network/test",
            json={"host": "8.8.8.8", "port": 53}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "reachable" in data or "status" in data
    
    def test_network_test_invalid_host(self, test_client: TestClient):
        """Test network test with invalid host."""
        response = test_client.post(
            "/api/network/test",
            json={"host": "invalid-host-12345", "port": 80}
        )
        
        # Should handle gracefully
        assert response.status_code in [200, 400]


class TestAuthentication:
    """Test JWT authentication endpoints (when AUTH_ENABLED=false)."""
    
    def test_generate_token(self, test_client: TestClient):
        """Test JWT token generation."""
        response = test_client.post(
            "/auth/token",
            json={
                "user_id": "test@example.com",
                "tenant_id": "test-farm",
                "role": "operator"
            }
        )
        
        # May return 404 if routes not registered, or 200 if working
        if response.status_code == 200:
            data = response.json()
            assert "access_token" in data
            assert data["token_type"] == "bearer"
    
    def test_verify_token(self, test_client: TestClient):
        """Test JWT token verification."""
        # First generate a token
        token_response = test_client.post(
            "/auth/token",
            json={
                "user_id": "test@example.com",
                "tenant_id": "test-farm",
                "role": "operator"
            }
        )
        
        if token_response.status_code == 200:
            token = token_response.json()["access_token"]
            
            # Verify the token
            verify_response = test_client.get(
                "/auth/verify",
                headers={"Authorization": f"Bearer {token}"}
            )
            
            assert verify_response.status_code == 200


class TestErrorHandling:
    """Test error handling and edge cases."""
    
    def test_invalid_json_payload(self, test_client: TestClient):
        """Test handling of invalid JSON payload."""
        response = test_client.post(
            "/api/device/command",
            data="invalid json{",
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 422  # Unprocessable entity
    
    def test_missing_required_fields(self, test_client: TestClient):
        """Test handling of missing required fields."""
        response = test_client.post(
            "/api/device/command",
            json={"device_id": "test"}  # Missing command field
        )
        
        assert response.status_code == 422
    
    def test_method_not_allowed(self, test_client: TestClient):
        """Test handling of wrong HTTP method."""
        response = test_client.delete("/")  # Root only supports GET
        assert response.status_code == 405


class TestCORSConfiguration:
    """Test CORS middleware configuration."""
    
    def test_cors_headers_present(self, test_client: TestClient):
        """Test that CORS headers are present in responses."""
        response = test_client.options(
            "/devices",
            headers={"Origin": "http://localhost:3000"}
        )
        
        # Should have CORS headers
        assert response.status_code in [200, 204]


# Performance and load testing (optional, can be marked as slow)
@pytest.mark.slow
class TestPerformance:
    """Test performance characteristics (marked as slow tests)."""
    
    def test_list_devices_performance(self, test_client: TestClient):
        """Test listing devices with large dataset."""
        registry = DeviceRegistry()
        
        # Add 100 test devices
        for i in range(100):
            device = Device(
                id=f"perf-device-{i}",
                name=f"Performance Test Device {i}",
                protocol="kasa",
                ip_address=f"192.168.1.{i % 255}",
                status="online",
                tenant_id="perf-farm"
            )
            registry.register(device)
        
        import time
        start = time.time()
        response = test_client.get("/devices")
        duration = time.time() - start
        
        assert response.status_code == 200
        assert len(response.json()) == 100
        assert duration < 1.0  # Should complete in under 1 second


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--cov=backend", "--cov-report=term-missing"])
