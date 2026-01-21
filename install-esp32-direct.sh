#!/bin/bash
# Direct ESP32 Sensor Installation Script for reTerminal
# Run this ON the reTerminal: bash install-esp32-direct.sh

set -e

echo "=== ESP32 Sensor Integration Installation ==="
echo

# Check ESP32 hardware
echo "1. Checking ESP32 Hardware..."
if lsusb | grep -qi "cp210"; then
    echo "✓ ESP32 USB bridge detected"
else
    echo "✗ ESP32 not found! Please connect ESP32 to USB port"
    exit 1
fi

if [ -e /dev/ttyUSB0 ]; then
    echo "✓ Serial port /dev/ttyUSB0 found"
else
    echo "✗ /dev/ttyUSB0 not found! Check USB connection"
    exit 1
fi

# Create directories
echo
echo "2. Creating directories..."
mkdir -p /home/greenreach/light-engine/scripts
mkdir -p /home/greenreach/light-engine/public/data
echo "✓ Directories created"

# Create Python integration script
echo
echo "3. Creating ESP32 integration script..."
cat > /home/greenreach/light-engine/scripts/esp32-to-env.py << 'EOFPYTHON'
#!/usr/bin/env python3
"""
ESP32 Environmental Sensor Integration
Reads BME680 sensor data from ESP32 via USB serial and updates Light Engine env.json
"""

import serial
import serial.tools.list_ports
import json
import time
from pathlib import Path
from datetime import datetime

# Configuration
DATA_DIR = Path("/home/greenreach/light-engine/public/data")
ENV_JSON = DATA_DIR / "env.json"
IOT_DEVICES_JSON = DATA_DIR / "iot-devices.json"
BAUD_RATE = 115200
UPDATE_INTERVAL = 10  # seconds

def find_esp32_port():
    """Auto-detect ESP32 serial port"""
    ports = serial.tools.list_ports.comports()
    
    # Look for CP210x USB bridge
    for port in ports:
        if "CP210" in port.description or "CP210" in str(port.manufacturer):
            print(f"Found ESP32 at {port.device}")
            return port.device
    
    # Fallback to any USB serial device
    for port in ports:
        if port.device.startswith("/dev/ttyUSB") or port.device.startswith("/dev/ttyACM"):
            print(f"Found USB serial at {port.device}")
            return port.device
    
    return None

def read_sensor_data(ser):
    """Read and parse JSON sensor data from ESP32"""
    try:
        line = ser.readline().decode('utf-8').strip()
        if line:
            data = json.loads(line)
            return data
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        print(f"Parse error: {e}")
    except Exception as e:
        print(f"Read error: {e}")
    return None

def update_env_json(sensor_data):
    """Update env.json with sensor readings"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    # Load existing data or create new
    if ENV_JSON.exists():
        try:
            with open(ENV_JSON, 'r') as f:
                env_data = json.load(f)
        except:
            env_data = {"zones": []}
    else:
        env_data = {"zones": []}
    
    # Update or create zone data
    timestamp = datetime.now().isoformat()
    zone_data = {
        "zone_id": "zone-main",
        "name": "GreenReach Room",
        "temperature_c": sensor_data.get("temperature_c"),
        "humidity": sensor_data.get("humidity"),
        "pressure_hpa": sensor_data.get("pressure_hpa"),
        "gas_kohm": sensor_data.get("gas_kohm"),
        "timestamp": timestamp
    }
    
    # Find and update existing zone or append new
    zone_found = False
    for i, zone in enumerate(env_data["zones"]):
        if zone.get("zone_id") == "zone-main":
            env_data["zones"][i] = zone_data
            zone_found = True
            break
    
    if not zone_found:
        env_data["zones"].append(zone_data)
    
    # Write atomically
    temp_file = ENV_JSON.with_suffix('.tmp')
    with open(temp_file, 'w') as f:
        json.dump(env_data, f, indent=2)
    temp_file.replace(ENV_JSON)
    
    print(f"Updated env.json: {sensor_data['temperature_c']:.1f}°C, {sensor_data['humidity']:.1f}%")

def register_iot_device():
    """Register ESP32 as IoT device for Room Mapper"""
    device_entry = {
        "id": "esp32-bme680-sensor-01",
        "type": "environmental_sensor",
        "name": "ESP32 BME680 Sensor",
        "zone_id": "zone-main",
        "location": "GreenReach Room",
        "capabilities": ["temperature", "humidity", "pressure", "gas"],
        "status": "active",
        "last_seen": datetime.now().isoformat()
    }
    
    # Load or create IoT devices registry
    if IOT_DEVICES_JSON.exists():
        try:
            with open(IOT_DEVICES_JSON, 'r') as f:
                devices = json.load(f)
                if not isinstance(devices, dict):
                    devices = {"devices": []}
        except:
            devices = {"devices": []}
    else:
        devices = {"devices": []}
    
    # Update or add device
    device_found = False
    for i, dev in enumerate(devices.get("devices", [])):
        if dev.get("id") == "esp32-bme680-sensor-01":
            devices["devices"][i] = device_entry
            device_found = True
            break
    
    if not device_found:
        if "devices" not in devices:
            devices["devices"] = []
        devices["devices"].append(device_entry)
    
    # Write atomically
    temp_file = IOT_DEVICES_JSON.with_suffix('.tmp')
    with open(temp_file, 'w') as f:
        json.dump(devices, f, indent=2)
    temp_file.replace(IOT_DEVICES_JSON)

def main():
    print("ESP32 Environmental Sensor Reader")
    print("=" * 50)
    
    # Find ESP32
    port = find_esp32_port()
    if not port:
        print("ERROR: ESP32 not found. Check USB connection.")
        return 1
    
    # Register device
    register_iot_device()
    print("✓ IoT device registered")
    
    # Connect to ESP32
    try:
        ser = serial.Serial(port, BAUD_RATE, timeout=2)
        print(f"✓ Connected to {port} at {BAUD_RATE} baud")
        
        # Allow ESP32 to initialize
        time.sleep(2)
        ser.reset_input_buffer()
        
        last_update = 0
        
        while True:
            sensor_data = read_sensor_data(ser)
            
            if sensor_data and time.time() - last_update >= UPDATE_INTERVAL:
                update_env_json(sensor_data)
                last_update = time.time()
            
            time.sleep(0.5)  # Poll twice per second
            
    except serial.SerialException as e:
        print(f"ERROR: Serial connection failed: {e}")
        return 1
    except KeyboardInterrupt:
        print("\nShutting down...")
        return 0
    finally:
        if 'ser' in locals():
            ser.close()

if __name__ == "__main__":
    exit(main())
EOFPYTHON

chmod +x /home/greenreach/light-engine/scripts/esp32-to-env.py
echo "✓ Python script created"

# Create systemd service
echo
echo "4. Creating systemd service..."
sudo tee /etc/systemd/system/esp32-sensor.service > /dev/null << 'EOFSERVICE'
[Unit]
Description=ESP32 Environmental Sensor Reader
After=network.target

[Service]
Type=simple
User=greenreach
WorkingDirectory=/home/greenreach/light-engine
ExecStart=/usr/bin/python3 /home/greenreach/light-engine/scripts/esp32-to-env.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOFSERVICE

echo "✓ Service file created"

# Add user to dialout group for serial port access
echo
echo "5. Configuring permissions..."
sudo usermod -a -G dialout greenreach
echo "✓ User added to dialout group"

# Reload and start service
echo
echo "6. Starting service..."
sudo systemctl daemon-reload
sudo systemctl enable esp32-sensor
sudo systemctl start esp32-sensor

# Wait a moment for startup
sleep 2

# Show status
echo
echo "=== Service Status ==="
sudo systemctl status esp32-sensor --no-pager

echo
echo "=== Installation Complete ==="
echo
echo "Check data flow:"
echo "  tail -f /home/greenreach/light-engine/public/data/env.json"
echo
echo "View logs:"
echo "  sudo journalctl -u esp32-sensor -f"
echo
echo "Note: You may need to logout/login or reboot for dialout group to take effect"
