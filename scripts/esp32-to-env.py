#!/usr/bin/env python3
"""
ESP32 Sensor Integration for Light Engine
Reads BME680 sensor data via USB serial and updates env.json
"""

import serial
import serial.tools.list_ports
import json
import urllib.request
import urllib.error
import time
import sys
from pathlib import Path
from datetime import datetime, timezone

# Configuration
SERIAL_PORT = None  # Auto-detect
BAUD_RATE = 115200
ENV_JSON_PATH = '/home/greenreach/Light-Engine-Foxtrot/public/data/env.json'
IOT_DEVICES_PATH = '/home/greenreach/Light-Engine-Foxtrot/public/data/iot-devices.json'
ZONE_ID = 'zone-1'
ZONE_NAME = 'Zone 1'
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

def connect_esp32(serial_port):
    """Connect to ESP32, retrying until available."""
    while True:
        port_name = serial_port or find_esp32_port()
        if not port_name:
            print("✗ No ESP32 detected, retrying in 2s")
            time.sleep(2)
            continue
        try:
            port = serial.Serial(port_name, BAUD_RATE, timeout=1)
            print(f"✓ Connected to ESP32 ({port_name})")
            return port
        except serial.SerialException as e:
            print(f"✗ Failed to connect: {e}")
            time.sleep(2)

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
    """Update env.json with sensor data in proper server format"""
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
    now = datetime.now(timezone.utc).isoformat()
    temp_c = avg.get('temperature_c')
    humidity = avg.get('humidity')
    pressure_hpa = avg.get('pressure_hpa') or data.get('bme680', {}).get('pressure_hpa')
    gas_kohms = avg.get('gas_kohms') or data.get('bme680', {}).get('gas_kohms')
    vpd_value = None
    
    # Find or create zone
    zones = env_data.get('zones', [])
    zone = None
    for i, z in enumerate(zones):
        if z.get('id') == ZONE_ID:
            zone = z
            break
    
    if not zone:
        zone = {
            'id': ZONE_ID,
            'name': ZONE_NAME,
            'location': ZONE_NAME,
            'sensors': {},
            'meta': {}
        }
        zones.append(zone)
    
    # Ensure sensors object exists
    if 'sensors' not in zone:
        zone['sensors'] = {}
    
    # Update sensor data in correct format (matching server expectations)
    def update_sensor(key, value, unit='', setpoint_min=None, setpoint_max=None):
        if value is None:
            return
        
        if key not in zone['sensors']:
            zone['sensors'][key] = {
                'current': None,
                'unit': unit,
                'history': [],
                'setpoint': {'min': setpoint_min, 'max': setpoint_max},
                'updatedAt': now
            }
        
        sensor = zone['sensors'][key]
        sensor['current'] = value
        sensor['updatedAt'] = now
        
        # Keep last 100 history points
        if 'history' not in sensor:
            sensor['history'] = []
        sensor['history'].insert(0, value)
        sensor['history'] = sensor['history'][:100]
    
    # Update temperature (°C)
    if temp_c is not None:
        update_sensor('tempC', temp_c, '°C', 20, 24)
    
    # Update humidity (%)
    if humidity is not None:
        update_sensor('rh', humidity, '%', 58, 65)
    
    # Update pressure (hPa) - NEW
    if pressure_hpa is not None:
        update_sensor('pressureHpa', pressure_hpa, 'hPa', None, None)
    
    # Update gas resistance (kΩ) - NEW  
    if gas_kohms is not None:
        update_sensor('gasKohm', gas_kohms, 'kΩ', None, None)
    
    # Calculate and update VPD
    if temp_c is not None and humidity is not None:
        # VPD calculation: SVP * (1 - RH/100)
        svp = 0.6108 * (2.71828 ** ((17.27 * temp_c) / (temp_c + 237.3)))
        vpd_value = svp * (1 - humidity / 100)
        update_sensor('vpd', round(vpd_value, 2), 'kPa', 0.9, 1.05)
    
    # Update metadata
    zone['meta']['source'] = 'esp32-bme680'
    zone['meta']['lastUpdated'] = now
    zone['meta']['lastSync'] = now
    zone['meta']['lastSampleAt'] = now
    zone['meta']['uptime_s'] = data.get('uptime_s', 0)
    
    env_data['zones'] = zones
    env_data['updatedAt'] = now
    
    # Register as IoT device
    was_registered = register_iot_device()
    if was_registered:
        print(f"✓ IoT device already registered: {DEVICE_ID}")
    
    # Write atomically
    temp_path = env_path.with_suffix('.tmp')
    with open(temp_path, 'w') as f:
        json.dump(env_data, f, indent=2)
    temp_path.replace(env_path)
    
    post_ingest_env(temp_c, humidity, vpd_value, pressure_hpa, gas_kohms)

    temp = temp_c if temp_c is not None else '?'
    rh = humidity if humidity is not None else '?'
    pressure = pressure_hpa if pressure_hpa is not None else '?'
    gas = gas_kohms if gas_kohms is not None else '?'
    print(f"[{now}] {temp}°C, {rh}%, {pressure}hPa, {gas}kΩ")

def post_ingest_env(temp_c, humidity, vpd_value, pressure_hpa, gas_kohms):
    """Send latest readings to Light Engine ingest endpoint to refresh cache."""
    payload = {
        'zoneId': ZONE_ID,
        'name': ZONE_NAME,
        'temperature': temp_c,
        'humidity': humidity,
        'vpd': round(vpd_value, 2) if isinstance(vpd_value, float) else vpd_value,
        'pressureHpa': pressure_hpa,
        'gasKohm': gas_kohms,
        'source': 'esp32-bme680'
    }

    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            'http://127.0.0.1:8091/ingest/env',
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status >= 400:
                print(f"[ingest] Failed: HTTP {resp.status}")
    except urllib.error.URLError as err:
        print(f"[ingest] Error posting to Light Engine: {err}")

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
    
    # Connect to ESP32 (retry on failure)
    port = connect_esp32(serial_port)
    
    print("✓ Waiting for sensor data...")
    print()
    
    last_update = 0
    
    try:
        while True:
            try:
                data = read_sensor_data(port)
            except serial.SerialException as e:
                print(f"✗ Serial error: {e}")
                try:
                    port.close()
                except Exception:
                    pass
                print("↻ Reconnecting to ESP32...")
                port = connect_esp32(None)
                continue

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
