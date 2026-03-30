# Script to register a sample dehumidifier device in the backend DeviceRegistry
# Run this script in the backend directory to add a dehumidifier for testing

from backend.device_models import Device
from backend.state import DeviceRegistry

# Example dehumidifier from equipment-kb.json
sample_dehumidifier = Device(
    device_id="dehum-quest-155",
    name="Quest Dual 155",
    category="dehumidifier",
    protocol="wifi",
    online=True,
    capabilities={
        "capacity": "155 pints/day",
        "control": "WiFi",
        "features": ["remote-monitoring", "app-control", "variable-speed-compressor"],
        "power": "2100W",
        "vendor": "Quest",
        "model": "Quest Dual 155"
    },
    details={
        "description": "High-capacity commercial dehumidifier with WiFi connectivity and app control"
    }
)

# Register the device
REGISTRY = DeviceRegistry()
REGISTRY.upsert(sample_dehumidifier)

print("Sample dehumidifier registered in DeviceRegistry.")
