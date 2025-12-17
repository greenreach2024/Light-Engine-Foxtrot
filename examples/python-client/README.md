# Light Engine Charlie - Python SDK

[![Python Version](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Type-safe Python client for the Light Engine Charlie API. Supports both synchronous and asynchronous patterns with full type hints.

## Features

✅ **Type-Safe** - Full type hints with dataclasses  
✅ **Sync & Async** - Choose your preferred pattern  
✅ **Comprehensive** - All 21 API endpoints covered  
✅ **Error Handling** - Custom exceptions for better debugging  
✅ **Pythonic** - Follows Python best practices  
✅ **Well Documented** - Docstrings and examples included

## Installation

```bash
pip install -e .
```

For development with testing tools:

```bash
pip install -e ".[dev]"
```

## Quick Start

### Synchronous Usage

```python
from light_engine import LightEngineClient, SensorPayload, SensorReading
from datetime import datetime

# Initialize client
client = LightEngineClient("http://localhost:8000")

# Health check
health = client.health()
print(f"Status: {health['status']}")

# Ingest sensor data
payload = SensorPayload(
    scope="VegRoom1",
    ts=datetime.utcnow().isoformat() + "Z",
    sensors={
        "temperature": SensorReading(value=75.2, unit="F"),
        "humidity": SensorReading(value=60.5, unit="%")
    }
)
result = client.ingest_sensor_data(payload)

# Get latest readings
latest = client.get_latest_readings("VegRoom1")
print(f"Temperature: {latest['sensors']['temperature']['value']}°F")
```

### Asynchronous Usage

```python
import asyncio
from light_engine import AsyncLightEngineClient

async def main():
    async with AsyncLightEngineClient("http://localhost:8000") as client:
        # Parallel requests
        results = await asyncio.gather(
            client.health(),
            client.get_scopes(),
            client.get_devices()
        )
        
        health, scopes, devices = results
        print(f"Status: {health['status']}")
        print(f"Scopes: {scopes['count']}")
        print(f"Devices: {devices['count']}")

asyncio.run(main())
```

### Context Managers

Both clients support context managers for automatic cleanup:

```python
# Synchronous
with LightEngineClient("http://localhost:8000") as client:
    health = client.health()

# Asynchronous
async with AsyncLightEngineClient("http://localhost:8000") as client:
    health = await client.health()
```

## API Reference

### Clients

#### `LightEngineClient(base_url, timeout=10, api_key=None)`

Synchronous HTTP client.

**Parameters:**
- `base_url` (str): API base URL (default: "http://localhost:8000")
- `timeout` (int): Request timeout in seconds (default: 10)
- `api_key` (str, optional): JWT token for authentication

#### `AsyncLightEngineClient(base_url, timeout=10, api_key=None)`

Asynchronous HTTP client with the same parameters as `LightEngineClient`.

### Methods

#### Health & Status

```python
# Synchronous
health = client.health()

# Asynchronous
health = await client.health()
```

#### Environmental Sensors

```python
# Ingest sensor data
from light_engine import SensorPayload, SensorReading

payload = SensorPayload(
    scope="VegRoom1",
    ts="2025-12-06T12:00:00Z",
    sensors={
        "temperature": SensorReading(value=75.2, unit="F"),
        "humidity": SensorReading(value=60.5, unit="%"),
        "co2": SensorReading(value=1200, unit="ppm")
    }
)
result = client.ingest_sensor_data(payload)

# Get latest readings
latest = client.get_latest_readings("VegRoom1")

# Get sensor history
history = client.get_sensor_history("VegRoom1", "temperature", hours=24)

# List all scopes
scopes = client.get_scopes()
```

#### Device Discovery

```python
# Trigger discovery scan
discovery = client.trigger_discovery()

# Get all discovered devices
devices = client.get_discovered_devices()

# Get protocol-specific devices
kasa_devices = client.get_kasa_devices()
mqtt_devices = client.get_mqtt_devices()
ble_devices = client.get_ble_devices()
mdns_devices = client.get_mdns_devices()

# Get all registered devices
all_devices = client.get_devices()
```

#### Network Diagnostics

```python
from light_engine import NetworkTestRequest

# Test network connectivity
test = NetworkTestRequest(host="mqtt.broker.com", port=1883, protocol="mqtt")
result = client.test_network_connection(test)

# Scan WiFi networks
networks = client.scan_wifi_networks()
```

#### Device Control

```python
from light_engine import DeviceCommandRequest

# Send device command
command = DeviceCommandRequest(
    device_id="fixture_001",
    command={"action": "set_brightness", "value": 80}
)
result = client.send_device_command(command)
```

#### Lighting Management

```python
from light_engine import FailsafePowerRequest

# Get lighting fixtures
fixtures = client.get_lighting_fixtures()

# Emergency failsafe control
failsafe = FailsafePowerRequest(
    fixtures=["fixture_001", "fixture_002"],
    power="off",
    brightness=0
)
result = client.lighting_failsafe(failsafe)
```

#### Automation Rules

```python
from light_engine import AutomationRule

# List all rules
rules = client.list_rules()

# Create automation rule
rule = AutomationRule(
    name="High Temperature Alert",
    enabled=True,
    conditions={"sensor": "temperature", "operator": "gt", "value": 85},
    actions={"notification": {"type": "alert"}},
    priority=10
)
created = client.create_rule(rule)

# Update rule
updated = client.update_rule("rule_id", {"enabled": False})

# Delete rule
deleted = client.delete_rule("rule_id")
```

## Data Models

All request/response models use Python dataclasses with type hints:

- `SensorReading` - Individual sensor reading
- `SensorPayload` - Sensor data ingestion
- `DiscoveryDevice` - Discovered device metadata
- `NetworkTestRequest` - Network connectivity test
- `DeviceCommandRequest` - Device command
- `LightingFixture` - Lighting fixture info
- `FailsafePowerRequest` - Emergency power control
- `AutomationRule` - Automation rule definition

## Error Handling

```python
from light_engine.exceptions import APIError, TimeoutError, AuthenticationError

try:
    health = client.health()
except TimeoutError as e:
    print(f"Request timed out: {e}")
except APIError as e:
    print(f"API error: {e.detail} (status: {e.status_code})")
except AuthenticationError as e:
    print(f"Authentication failed: {e}")
```

## Type Checking

The SDK includes full type hints for static analysis:

```bash
# Install mypy
pip install mypy

# Run type checker
mypy examples.py
```

## Examples

Run the comprehensive examples:

```bash
python examples.py
```

This demonstrates:
- ✅ Synchronous API calls
- ✅ Asynchronous parallel requests
- ✅ Error handling patterns
- ✅ Type hints and dataclasses
- ✅ Context manager usage
- ✅ All major endpoints

## Development

### Install Development Dependencies

```bash
pip install -e ".[dev]"
```

### Run Tests

```bash
pytest
```

### Format Code

```bash
black light_engine/ examples.py
```

### Type Check

```bash
mypy light_engine/
```

## Requirements

- Python 3.8+
- requests >= 2.31.0
- aiohttp >= 3.9.0

## License

MIT

## Contributing

Contributions welcome! Please follow PEP 8 style guide and include type hints.

## Support

- Documentation: See `docs/API_REFERENCE.md` in main project
- Issues: https://github.com/greenreach2024/Light-Engine-Echo/issues
