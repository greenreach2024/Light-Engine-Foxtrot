"""Pytest configuration and fixtures for Light Engine Charlie API tests."""

import os
import pytest
from typing import Generator, Dict, Any
from unittest.mock import Mock, patch, AsyncMock

# Set test environment variables before importing backend modules
os.environ["ENVIRONMENT"] = "testing"
os.environ["AUTH_ENABLED"] = "false"  # Disable auth for most tests
os.environ["MQTT_HOST"] = "test-mqtt-broker"
os.environ["MQTT_PORT"] = "1883"

from fastapi.testclient import TestClient
from backend.server import app
from backend.state import DeviceRegistry, ScheduleStore, GroupScheduleStore
from backend.device_models import Device, Schedule, GroupSchedule


@pytest.fixture(scope="session")
def test_client() -> TestClient:
    """Create a test client for the FastAPI application."""
    return TestClient(app)


@pytest.fixture(autouse=True)
def reset_state():
    """Reset all state stores before each test."""
    # Clear all registries
    DeviceRegistry._instance = None
    ScheduleStore._instance = None
    GroupScheduleStore._instance = None
    
    # Re-initialize singletons
    device_registry = DeviceRegistry()
    device_registry._devices.clear()
    
    schedule_store = ScheduleStore()
    schedule_store._schedules.clear()
    
    group_schedule_store = GroupScheduleStore()
    group_schedule_store._entries.clear()  # Correct attribute name
    
    yield
    
    # Cleanup after test
    device_registry._devices.clear()
    schedule_store._schedules.clear()
    group_schedule_store._entries.clear()


@pytest.fixture
def sample_device() -> Device:
    """Create a sample device for testing."""
    return Device(
        id="test-device-1",
        name="Test Grow Light",
        protocol="kasa",
        ip_address="192.168.1.100",
        mac_address="AA:BB:CC:DD:EE:FF",
        model="KL130",
        status="online",
        tenant_id="test-farm",
        metadata={
            "firmware": "1.0.5",
            "location": "Veg Room 1"
        }
    )


@pytest.fixture
def sample_mqtt_device() -> Device:
    """Create a sample MQTT device for testing."""
    return Device(
        id="mqtt-device-1",
        name="MQTT Light Controller",
        protocol="mqtt",
        status="online",
        tenant_id="test-farm",
        metadata={
            "topic": "zigbee2mqtt/light-1",
            "command_topic": "zigbee2mqtt/light-1/set"
        }
    )


@pytest.fixture
def sample_schedule() -> Schedule:
    """Create a sample schedule for testing."""
    return Schedule(
        id="schedule-1",
        device_id="test-device-1",
        group="zone-alpha",
        time="08:00:00",
        action="turn_on",
        enabled=True,
        tenant_id="test-farm"
    )


@pytest.fixture
def sample_group_schedule() -> GroupSchedule:
    """Create a sample group schedule for testing."""
    return GroupSchedule(
        device_id="test-device-1",
        group="zone-alpha",
        schedules=[
            {"time": "06:00", "brightness": 80, "enabled": True},
            {"time": "18:00", "brightness": 40, "enabled": True},
            {"time": "22:00", "brightness": 0, "enabled": True}
        ],
        tenant_id="test-farm"
    )


@pytest.fixture
def mock_kasa_device():
    """Mock a Kasa SmartDevice."""
    device = AsyncMock()
    device.alias = "Test Kasa Light"
    device.model = "KL130"
    device.host = "192.168.1.100"
    device.mac = "AA:BB:CC:DD:EE:FF"
    device.is_on = False
    
    # Mock async methods
    device.turn_on = AsyncMock()
    device.turn_off = AsyncMock()
    device.set_brightness = AsyncMock()
    device.set_color_temp = AsyncMock()
    device.update = AsyncMock()
    
    return device


@pytest.fixture
def mock_mqtt_client():
    """Mock an MQTT client."""
    client = Mock()
    client.connect = Mock(return_value=0)  # Success
    client.publish = Mock(return_value=(0, 1))  # (rc, mid)
    client.disconnect = Mock()
    return client


@pytest.fixture
def auth_headers() -> Dict[str, str]:
    """Create authorization headers with a test JWT token."""
    # This would normally come from calling /auth/token
    # For simplicity in tests, we'll use a mock token
    return {
        "Authorization": "Bearer test-jwt-token-operator",
        "Content-Type": "application/json"
    }


@pytest.fixture
def admin_headers() -> Dict[str, str]:
    """Create authorization headers for an admin user."""
    return {
        "Authorization": "Bearer test-jwt-token-admin",
        "Content-Type": "application/json"
    }


@pytest.fixture
def viewer_headers() -> Dict[str, str]:
    """Create authorization headers for a viewer user."""
    return {
        "Authorization": "Bearer test-jwt-token-viewer",
        "Content-Type": "application/json"
    }


@pytest.fixture
def sample_telemetry_payload() -> Dict[str, Any]:
    """Create a sample telemetry payload."""
    return {
        "scope": "zone-alpha",
        "tenant": "test-farm",
        "farm": "North Farm",
        "room": "Veg Room 1",
        "zone": "Alpha",
        "sensors": {
            "temperature": 75.5,
            "humidity": 60.0,
            "co2": 1200,
            "ppfd": 450
        },
        "units": {
            "temperature": "F",
            "humidity": "%",
            "co2": "ppm",
            "ppfd": "umol/m2/s"
        }
    }


@pytest.fixture
def sample_automation_rule() -> Dict[str, Any]:
    """Create a sample automation rule."""
    return {
        "name": "Sunrise Automation",
        "enabled": True,
        "conditions": [
            {
                "type": "time",
                "operator": "equals",
                "value": "06:00"
            }
        ],
        "actions": [
            {
                "type": "device_command",
                "device_id": "test-device-1",
                "command": {
                    "action": "turn_on"
                }
            }
        ],
        "tenant_id": "test-farm"
    }


@pytest.fixture
def mock_switchbot_api():
    """Mock SwitchBot API responses."""
    with patch("backend.device_discovery.requests.get") as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {
            "statusCode": 100,
            "body": {
                "deviceList": [
                    {
                        "deviceId": "switchbot-1",
                        "deviceName": "SwitchBot Light",
                        "deviceType": "Color Bulb",
                        "hubDeviceId": "hub-1"
                    }
                ]
            }
        }
        yield mock_get


@pytest.fixture
def mock_kasa_discovery():
    """Mock Kasa device discovery."""
    async def mock_discover(*args, **kwargs):
        device = AsyncMock()
        device.alias = "Discovered Kasa Light"
        device.model = "KL130"
        device.host = "192.168.1.101"
        device.mac = "11:22:33:44:55:66"
        return {"192.168.1.101": device}
    
    with patch("backend.device_discovery.Discover.discover", side_effect=mock_discover):
        yield


@pytest.fixture
def mock_mqtt_connection():
    """Mock MQTT broker connection."""
    with patch("backend.device_discovery.mqtt.Client") as mock_client:
        client = Mock()
        client.connect = Mock(return_value=0)
        client.disconnect = Mock()
        mock_client.return_value = client
        yield client


@pytest.fixture
def populate_test_devices(sample_device: Device, sample_mqtt_device: Device):
    """Populate the device registry with test devices."""
    registry = DeviceRegistry()
    registry.register(sample_device)
    registry.register(sample_mqtt_device)
    yield registry
    registry._devices.clear()


@pytest.fixture
def populate_test_schedules(sample_schedule: Schedule):
    """Populate the schedule store with test schedules."""
    store = ScheduleStore()
    store.upsert(sample_schedule)  # Use upsert instead of add
    yield store
    store._schedules.clear()


# Parametrize fixtures for multi-tenant testing
@pytest.fixture(params=["test-farm", "demo-farm", None])
def tenant_id(request):
    """Parametrized fixture for testing multiple tenant scenarios."""
    return request.param


@pytest.fixture
def multi_tenant_devices():
    """Create devices across multiple tenants."""
    registry = DeviceRegistry()
    
    # Farm 1 devices
    device1 = Device(
        id="farm1-device-1",
        name="Farm 1 Light",
        protocol="kasa",
        ip_address="192.168.1.10",
        status="online",
        tenant_id="farm-1"
    )
    
    # Farm 2 devices
    device2 = Device(
        id="farm2-device-1",
        name="Farm 2 Light",
        protocol="mqtt",
        status="online",
        tenant_id="farm-2"
    )
    
    # Shared/public device
    device3 = Device(
        id="shared-device-1",
        name="Shared Light",
        protocol="kasa",
        ip_address="192.168.1.20",
        status="online",
        tenant_id=None  # Shared resource
    )
    
    registry.register(device1)
    registry.register(device2)
    registry.register(device3)
    
    yield registry
    registry._devices.clear()
