#!/usr/bin/env python3
"""
ESP32 Sensor Integration for Light Engine
Reads BME680 sensor data via USB serial and updates env.json
"""

import serial
import serial.tools.list_ports
import json
import time
import sys
from pathlib import Path
from datetime import datetime, timezone

# Configuration
SERIAL_PORT = None  # Auto-detect
BAUD_RATE = 115200
ENV_JSON_PATH = '/home/admin/light-engine/public/data/env.json'
IOT_DEVICES_PATH = '/home/admin/light-engine/public/data/iot-devices.json'
ZONE_ID = 'zone-main'
ZONE_NAME = 'GreenReach Room'
DEVICE_ID = 'esp32-bme680-sensor-01'
DEVICE_NAME = 'ESP32 Environmental Sensor'
UPDATE_INTERVAL = 10  # Write to env.json every 10 seconds

def find_esp32_port():
    """Auto-detect ESP32 serial port"""
    ports = serial.tools.list_ports.comports()
    
    # Look for CP2102 USB-to-UART bridge or any USB serial
    for port in ports:
        port_name = port.device
        description = port.description.lower()
        
        # Check for CP2102 (ESP32 USB bridge)
        if 'cp210' in description or 'uart' in description:
            return port_name
        
        # Check for common USB serial devices
        if port_name.startswith('/dev/ttyUSB') or port_name.startswith('/dev/ttyACM'):
            return port_name
    
    # Fallback: return first USB serial port found
    for port in ports:
        if port.device.startswith('/dev/tty'):
            return port.device
    
    return None

def read_sensor_data(port):
    """Read one JSON line from ESP32"""
    try:
        if port.in_waiting > 0:
            line = port.readline().decode('utf-8', errors='ignore').strip()
            if line and line.startswith('{'):
                return json.loads(line)
    except (json.JSONDecodeError, UnicodeDecodeError):
        pass
    return None

def register_iot_device():
    """Register ESP32 as an IoT device"""
    iot_path = Path(IOT_DEVICES_PATH)
    
    # Load existing devices or create new
    if iot_path.exists():
        with open(iot_path, 'r') as f:
            devices = json.load(f)
    else:
        devices = []
    
    # Check if device already registered
    device_exists = any(d.get('id') == DEVICE_ID for d in devices)
    
    if not device_exists:
        device = {
            'id': DEVICE_ID,
            'name': DEVICE_NAME,
            'type': 'environmental_sensor',
            'category': 'sensor',
            'model': 'ESP32-BME680',
            'manufacturer': 'Custom',
            'capabilities': ['temperature', 'humidity', 'pressure', 'gas'],
            'status': 'online',
            'zone_id': ZONE_ID,
            'position': {
                'x': None,
                'y': None,
                'z': None
            },
            'metadata': {
                'serial_port': find_esp32_port() or 'auto-detect',
                'update_interval': UPDATE_INTERVAL,
                'sensor_types': ['BME680'],
                'added': datetime.now(timezone.utc).isoformat()
            }
        }
        devices.append(device)
        
        # Write atomically
        temp_path = iot_path.with_suffix('.tmp')
        with open(temp_path, 'w') as f:
            json.dump(devices, f, indent=2)
        temp_path.replace(iot_path)
        
        print(f"✓ Registered as IoT device: {DEVICE_ID}")
    
    return device_exists

def update_env_json(data):
    """Update env.json with sensor data"""
    env_path = Path(ENV_JSON_PATH)
    
    # Load existing env.json or create new
    if env_path.exists():
        with open(env_path, 'r') as f:
            env_data = json.load(f)
    else:
        env_data = {'zones': [], 'scopes': [], 'rooms': []}
    
    # Extract averaged sensor data
    if 'averaged' not in data:
        return
    
    avg = data['averaged']
    
    # Create or update zone entry
    zone = {
        'id': ZONE_ID,
        'name': ZONE_NAME,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'source': 'esp32-bme680',
        'uptime_s': data.get('uptime_s', 0)
    }
    
    if 'temperature_c' in avg:
        zone['temperature_c'] = avg['temperature_c']
    if 'humidity' in avg:
        zone['humidity'] = avg['humidity']
    if 'pressure_hpa' in avg:
        zone['pressure_hpa'] = avg['pressure_hpa']
    # Register as IoT device
    was_registered = register_iot_device()
    if was_registered:
        print(f"✓ IoT device already registered: {DEVICE_ID}")
    print()
    
    if 'gas_kohms' in avg:
        zone['gas_kohms'] = avg['gas_kohms']
    
    # Update or append zone
    zones = env_data.get('zones', [])
    zone_exists = False
    for i, z in enumerate(zones):
        if z.get('id') == ZONE_ID:
            zones[i] = zone
            zone_exists = True
            break
    
    if not zone_exists:
        zones.append(zone)
    
    env_data['zones'] = zones
    
    # Write atomically
    temp_path = env_path.with_suffix('.tmp')
    with open(temp_path, 'w') as f:
        json.dump(env_data, f, indent=2)
    temp_path.replace(env_path)
    
    print(f"[{zone['timestamp']}] Updated: {zone['temperature_c']}°C, {zone['humidity']}%")

def main():
    print("=" * 60)
    print("ESP32 Sensor → Light Engine Integration")
    print("=" * 60)
    
    # Auto-detect ESP32 port
    serial_port = find_esp32_port()
    
    if not serial_port:
        print("✗ No ESP32 detected")
        print()
        print("Available ports:")
        ports = serial.tools.list_ports.comports()
        if ports:
            for port in ports:
                print(f"  {port.device}: {port.description}")
        else:
            print("  (none)")
        print()
        print("Troubleshooting:")
        print("1. Check ESP32 is plugged into USB port")
        print("2. Check USB cable (must support data, not just power)")
        print("3. Check permissions: sudo usermod -a -G dialout $USER")
        print("4. Verify with: lsusb | grep CP210")
        sys.exit(1)
    
    print(f"Serial Port: {serial_port} (auto-detected)")
    print(f"Output: {ENV_JSON_PATH}")
    print(f"Update Interval: {UPDATE_INTERVAL}s")
    print()
    
    # Connect to ESP32
    try:
        port = serial.Serial(serial_port, BAUD_RATE, timeout=1)
        print(f"✓ Connected to ESP32")
    except serial.SerialException as e:
        print(f"✗ Failed to connect: {e}")
        sys.exit(1)
    
    print("✓ Waiting for sensor data...")
    print()
    
    last_update = 0
    
    try:
        while True:
            data = read_sensor_data(port)
            
            if data and 'averaged' in data:
                now = time.time()
                
                # Update env.json at interval
                if now - last_update >= UPDATE_INTERVAL:
                    update_env_json(data)
                    last_update = now
            
            time.sleep(0.1)
    
    except KeyboardInterrupt:
        print("\n\nStopping...")
    finally:
        port.close()
        print("✓ Disconnected")

if __name__ == '__main__':
    main()
