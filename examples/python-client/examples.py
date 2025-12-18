"""
Example usage scenarios for Light Engine Python SDK
Demonstrates both synchronous and asynchronous patterns
"""

import asyncio
from datetime import datetime
from light_engine import (
    LightEngineClient,
    AsyncLightEngineClient,
    SensorPayload,
    SensorReading,
    NetworkTestRequest,
    DeviceCommandRequest,
    FailsafePowerRequest,
    AutomationRule,
)


def synchronous_examples():
    """Synchronous API usage examples"""
    print("🌱 Light Engine Charlie - Python SDK Examples (Sync)\n")
    
    with LightEngineClient("http://localhost:8000") as client:
        # Example 1: Health Check
        print("1⃣ Health Check")
        health = client.health()
        print(f"   Status: {health.get('status')}")
        print(f"   Version: {health.get('version', 'N/A')}\n")
        
        # Example 2: Ingest Sensor Data
        print("2⃣ Ingest Sensor Data")
        payload = SensorPayload(
            scope="VegRoom1",
            ts=datetime.utcnow().isoformat() + "Z",
            sensors={
                "temperature": SensorReading(value=75.2, unit="F"),
                "humidity": SensorReading(value=60.5, unit="%"),
                "co2": SensorReading(value=1200, unit="ppm")
            }
        )
        result = client.ingest_sensor_data(payload)
        print(f"   Ingested: {result.get('success', True)}\n")
        
        # Example 3: Get Latest Readings
        print("3⃣ Get Latest Readings")
        latest = client.get_latest_readings("VegRoom1")
        print(f"   Scope: {latest['scope']}")
        print(f"   Sensors: {', '.join(latest['sensors'].keys())}\n")
        
        # Example 4: Trigger Discovery
        print("4⃣ Trigger Device Discovery")
        discovery = client.trigger_discovery()
        print(f"   Status: {discovery['status']}")
        print(f"   Message: {discovery['message']}\n")
        
        # Example 5: Network Test
        print("5⃣ Network Connectivity Test")
        net_test = NetworkTestRequest(host="google.com", port=80, protocol="http")
        net_result = client.test_network_connection(net_test)
        print(f"   Host: {net_result['host']}:{net_result['port']}")
        print(f"   Reachable: {'' if net_result['reachable'] else ''}\n")
        
        # Example 6: Device Command
        print("6⃣ Send Device Command")
        command = DeviceCommandRequest(
            device_id="fixture_001",
            command={"action": "set_brightness", "value": 80}
        )
        cmd_result = client.send_device_command(command)
        print(f"   Device: {cmd_result['device_id']}")
        print(f"   Success: {'' if cmd_result['success'] else ''}\n")
        
        # Example 7: Create Automation Rule
        print("7⃣ Create Automation Rule")
        rule = AutomationRule(
            name="High Temperature Alert",
            enabled=True,
            conditions={
                "sensor": "temperature",
                "operator": "gt",
                "value": 85
            },
            actions={
                "notification": {"type": "alert"},
                "device_command": {"device_id": "fan_001", "action": "turn_on"}
            },
            priority=10
        )
        rule_result = client.create_rule(rule)
        print(f"   Rule ID: {rule_result['rule_id']}")
        print(f"   Success: {'' if rule_result['success'] else ''}\n")
        
        # Example 8: Emergency Failsafe
        print("8⃣ Emergency Failsafe")
        failsafe = FailsafePowerRequest(
            fixtures=["fixture_001", "fixture_002"],
            power="off",
            brightness=0
        )
        failsafe_result = client.lighting_failsafe(failsafe)
        print(f"   Total: {failsafe_result['total']} fixtures")
        print(f"   Successful: {failsafe_result['successful']}/{failsafe_result['total']}\n")
        
        print(" All synchronous examples completed!\n")


async def asynchronous_examples():
    """Asynchronous API usage examples"""
    print("🌱 Light Engine Charlie - Python SDK Examples (Async)\n")
    
    async with AsyncLightEngineClient("http://localhost:8000") as client:
        # Example 1: Health Check
        print("1⃣ Health Check (Async)")
        health = await client.health()
        print(f"   Status: {health.get('status')}")
        print(f"   Version: {health.get('version', 'N/A')}\n")
        
        # Example 2: Parallel Requests
        print("2⃣ Parallel Requests (Async)")
        results = await asyncio.gather(
            client.get_scopes(),
            client.get_devices(),
            client.list_rules(),
            return_exceptions=True
        )
        print(f"   Scopes: {results[0].get('count', 0)}")
        print(f"   Devices: {results[1].get('count', 0)}")
        print(f"   Rules: {results[2].get('count', 0)}\n")
        
        # Example 3: Sensor History
        print("3⃣ Get Sensor History (Async)")
        history = await client.get_sensor_history("VegRoom1", "temperature", limit=20)
        print(f"   Scope: {history['scope']}")
        print(f"   Sensor: {history['sensor']}")
        print(f"   Data points: {len(history.get('history', []))}\n")
        
        # Example 4: Device Discovery
        print("4⃣ Device Discovery (Async)")
        await client.trigger_discovery()
        await asyncio.sleep(2)  # Wait for scan
        devices = await client.get_discovered_devices()
        print(f"   Discovered: {len(devices.get('devices', []))} devices\n")
        
        print(" All asynchronous examples completed!\n")


def error_handling_example():
    """Demonstrate error handling"""
    print("🛡 Error Handling Example\n")
    
    from light_engine.exceptions import APIError, TimeoutError
    
    client = LightEngineClient("http://localhost:8000", timeout=5)
    
    try:
        # This will work
        health = client.health()
        print(f" Health check succeeded: {health['status']}\n")
        
        # This might fail if scope doesn't exist
        try:
            latest = client.get_latest_readings("NonExistentScope")
        except APIError as e:
            print(f" Expected API error: {e}\n")
        
    except TimeoutError as e:
        print(f" Timeout: {e}\n")
    except APIError as e:
        print(f" API Error: {e} (Status: {e.status_code})\n")
    finally:
        client.session.close()


def type_hints_example():
    """Demonstrate type hints and IDE support"""
    print(" Type Hints Example\n")
    
    # Type hints help IDEs provide autocomplete
    client: LightEngineClient = LightEngineClient("http://localhost:8000")
    
    # IDE knows the return types
    health: dict = client.health()
    
    # Dataclasses provide structure
    payload: SensorPayload = SensorPayload(
        scope="TestRoom",
        ts=datetime.utcnow().isoformat() + "Z",
        sensors={
            "temp": SensorReading(value=72.0, unit="F")
        }
    )
    
    # Type checkers (mypy) can validate this
    result: dict = client.ingest_sensor_data(payload)
    
    print(" Type hints enable:")
    print("   - IDE autocomplete")
    print("   - Static type checking with mypy")
    print("   - Better documentation")
    print("   - Fewer runtime errors\n")
    
    client.session.close()


if __name__ == "__main__":
    print("=" * 60)
    print("Light Engine Charlie - Python SDK Examples")
    print("=" * 60 + "\n")
    
    # Run synchronous examples
    synchronous_examples()
    
    # Run asynchronous examples
    asyncio.run(asynchronous_examples())
    
    # Demonstrate error handling
    error_handling_example()
    
    # Show type hints benefits
    type_hints_example()
    
    print("=" * 60)
    print(" All examples completed successfully!")
    print("=" * 60)
