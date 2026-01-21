#!/usr/bin/env python3
"""
ESP32 Dual Sensor Reader
Reads temperature/humidity from HDC302x and BME680, averages readings
"""

import serial
import json
import time
import sys
from datetime import datetime

# Serial configuration
SERIAL_PORT = '/dev/cu.usbserial-0001'  # Mac local
SERIAL_PORT_EDGE = '/dev/ttyUSB0'        # Edge device
BAUD_RATE = 115200

def read_sensor_data(port, timeout_seconds=5):
    """Read and parse sensor data from ESP32"""
    try:
        ser = serial.Serial(port, BAUD_RATE, timeout=1)
        print(f"✓ Connected to {port} at {BAUD_RATE} baud")
        
        time.sleep(2)  # Let ESP32 stabilize
        
        start_time = time.time()
        readings = []
        
        while time.time() - start_time < timeout_seconds:
            if ser.in_waiting > 0:
                try:
                    line = ser.readline().decode('utf-8').strip()
                    
                    if not line:
                        continue
                    
                    print(f"Raw: {line}")
                    
                    # Try parsing as JSON
                    try:
                        data = json.loads(line)
                        readings.append(data)
                        print(f"✓ Parsed: {json.dumps(data, indent=2)}")
                    except json.JSONDecodeError:
                        # Not JSON, might be debug output
                        if any(keyword in line.lower() for keyword in ['temp', 'hum', 'sensor']):
                            print(f"  (debug output)")
                        
                except UnicodeDecodeError:
                    pass
        
        ser.close()
        return readings
        
    except serial.SerialException as e:
        print(f"✗ Serial error: {e}")
        return []
    except Exception as e:
        print(f"✗ Error: {e}")
        return []

def average_readings(readings):
    """Average temperature and humidity from both sensors"""
    if not readings:
        return None
    
    # Extract values
    temps = []
    humidities = []
    
    for reading in readings:
        # HDC302x
        if 'hdc302x' in reading:
            hdc = reading['hdc302x']
            if 'temperature' in hdc:
                temps.append(hdc['temperature'])
            if 'humidity' in hdc:
                humidities.append(hdc['humidity'])
        
        # BME680
        if 'bme680' in reading:
            bme = reading['bme680']
            if 'temperature' in bme:
                temps.append(bme['temperature'])
            if 'humidity' in bme:
                humidities.append(bme['humidity'])
        
        # Also check flat structure
        if 'temperature' in reading:
            temps.append(reading['temperature'])
        if 'humidity' in reading:
            humidities.append(reading['humidity'])
    
    if not temps and not humidities:
        return None
    
    result = {
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'source': 'esp32-dual-sensor',
        'sensor_count': len(readings)
    }
    
    if temps:
        result['temperature_c'] = round(sum(temps) / len(temps), 2)
        result['temperature_readings'] = temps
    
    if humidities:
        result['humidity'] = round(sum(humidities) / len(humidities), 2)
        result['humidity_readings'] = humidities
    
    return result

def main():
    print("=" * 60)
    print("ESP32 Dual Sensor Reader (HDC302x + BME680)")
    print("=" * 60)
    print()
    
    # Try Mac port first, then edge device port
    port = SERIAL_PORT if sys.platform == 'darwin' else SERIAL_PORT_EDGE
    
    print(f"Reading from {port} for 10 seconds...")
    print()
    
    readings = read_sensor_data(port, timeout_seconds=10)
    
    print()
    print("=" * 60)
    print(f"Received {len(readings)} readings")
    
    if readings:
        averaged = average_readings(readings)
        
        if averaged:
            print()
            print("AVERAGED RESULT:")
            print(json.dumps(averaged, indent=2))
            print()
            print(f"✓ Temperature: {averaged.get('temperature_c', 'N/A')}°C")
            print(f"✓ Humidity: {averaged.get('humidity', 'N/A')}%")
        else:
            print("⚠ Could not parse sensor values")
            print("Raw readings:")
            for r in readings:
                print(f"  {r}")
    else:
        print("⚠ No data received")
        print()
        print("Troubleshooting:")
        print("1. Check ESP32 is powered and code is running")
        print("2. Verify baud rate is 115200")
        print("3. ESP32 should output JSON like:")
        print('   {"hdc302x":{"temperature":22.5,"humidity":45.2},"bme680":{"temperature":22.3,"humidity":46.1}}')
    
    print("=" * 60)

if __name__ == '__main__':
    main()
