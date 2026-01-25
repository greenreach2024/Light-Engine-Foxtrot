#!/usr/bin/env python3
"""
ESP32 BME680 Sensor Reader Service
Reads sensor data from USB serial and posts to FastAPI backend
"""

import serial
import serial.tools.list_ports
import requests
import json
import time
from datetime import datetime, timezone

# Configuration
BACKEND_URL = "http://localhost:8000/api/env/ingest"
SCOPE = "GreenReach"  # Main farm environmental scope
CHECK_INTERVAL = 30  # seconds between readings

def find_esp32_port():
    """Auto-detect ESP32 serial port"""
    ports = serial.tools.list_ports.comports()
    
    for port in ports:
        description = port.description.lower()
        if 'cp210' in description or 'uart' in description:
            return port.device
        if port.device.startswith('/dev/ttyUSB') or port.device.startswith('/dev/ttyACM'):
            return port.device
    
    return None

def read_esp32_data(ser):
    """Read one JSON line from ESP32"""
    try:
        if ser.in_waiting > 0:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if line and line.startswith('{'):
                return json.loads(line)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        print(f"Parse error: {e}")
    return None

def post_to_backend(sensor_data):
    """Post sensor data to FastAPI backend"""
    try:
        # Extract averaged sensor readings from ESP32 data
        averaged = sensor_data.get('averaged', {})
        bme680 = sensor_data.get('bme680', {})
        
        # Build payload for backend
        sensors = {}
        
        if 'temperature_c' in averaged:
            sensors['temperature'] = {'value': averaged['temperature_c'], 'unit': 'C'}
        
        if 'humidity' in averaged:
            sensors['humidity'] = {'value': averaged['humidity'], 'unit': '%'}
        
        if 'pressure_hpa' in averaged:
            sensors['pressure'] = {'value': averaged['pressure_hpa'], 'unit': 'hPa'}
        
        if 'gas_kohms' in averaged:
            sensors['gas_resistance'] = {'value': averaged['gas_kohms'], 'unit': 'kOhms'}
        
        if not sensors:
            return False
        
        payload = {
            'scope': SCOPE,
            'ts': datetime.now(timezone.utc).isoformat(),
            'sensors': sensors
        }
        
        response = requests.post(BACKEND_URL, json=payload, timeout=5)
        response.raise_for_status()
        
        print(f"✓ Posted: temp={averaged.get('temperature_c')}°C, humid={averaged.get('humidity')}%, pressure={averaged.get('pressure_hpa')}hPa")
        return True
        
    except Exception as e:
        print(f"✗ Backend error: {e}")
        return False

def main():
    print("🌡️  ESP32 Environmental Sensor Service")
    print(f"   Backend: {BACKEND_URL}")
    print(f"   Scope: {SCOPE}")
    print()
    
    ser = None
    last_post_time = 0
    
    while True:
        try:
            # Find and connect to ESP32 if not connected
            if ser is None or not ser.is_open:
                port = find_esp32_port()
                if port:
                    print(f"Connecting to ESP32 at {port}...")
                    ser = serial.Serial(port, 115200, timeout=2)
                    ser.reset_input_buffer()
                    time.sleep(2)
                    print(f"✓ Connected to {port}")
                else:
                    print("✗ No ESP32 found. Retrying in 60s...")
                    time.sleep(60)
                    continue
            
            # Read sensor data
            sensor_data = read_esp32_data(ser)
            
            if sensor_data:
                current_time = time.time()
                
                # Post data at configured interval
                if current_time - last_post_time >= CHECK_INTERVAL:
                    if post_to_backend(sensor_data):
                        last_post_time = current_time
            
            time.sleep(1)  # Check serial port every second
            
        except serial.SerialException as e:
            print(f"✗ Serial error: {e}")
            if ser:
                ser.close()
            ser = None
            time.sleep(10)
            
        except KeyboardInterrupt:
            print("\n👋 Shutting down ESP32 sensor service")
            break
            
        except Exception as e:
            print(f"✗ Service error: {e}")
            time.sleep(10)
    
    if ser and ser.is_open:
        ser.close()

if __name__ == '__main__':
    main()
