#!/usr/bin/env python3
"""
ESP32 Environmental Sensor Integration Service
Supports both USB serial and WiFi HTTP connections
Posts sensor data to FastAPI backend
"""

import asyncio
import httpx
import json
import time
import sys
from datetime import datetime, timezone
from pathlib import Path

# Configuration
ESP32_WIFI_IP = "10.42.0.40"  # WiFi-connected ESP32
ESP32_HTTP_ENDPOINTS = ["/", "/sensor", "/data", "/metrics", "/status"]
BACKEND_URL = "http://localhost:8000/api/env"
SCOPE = "NutrientRoom"  # Environmental zone
CHECK_INTERVAL = 30  # seconds
RETRY_INTERVAL = 60  # seconds on failure

class ESP32Sensor:
    def __init__(self):
        self.backend_url = BACKEND_URL
        self.scope = SCOPE
        self.connection_mode = None  # 'wifi', 'serial', or None
        
    async def try_wifi_connection(self):
        """Attempt to connect to ESP32 via WiFi"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                # Try common ESP32 HTTP endpoints
                for endpoint in ESP32_HTTP_ENDPOINTS:
                    url = f"http://{ESP32_WIFI_IP}{endpoint}"
                    try:
                        response = await client.get(url)
                        if response.status_code == 200:
                            data = response.text
                            # Try to parse as JSON
                            try:
                                json_data = response.json()
                                print(f"✓ ESP32 WiFi connected at {url}")
                                self.connection_mode = 'wifi'
                                self.wifi_endpoint = url
                                return True, json_data
                            except:
                                # Not JSON, might be HTML or plain text
                                if len(data) > 0:
                                    print(f"✓ ESP32 WiFi connected at {url} (non-JSON)")
                                    self.connection_mode = 'wifi'
                                    self.wifi_endpoint = url
                                    return True, None
                    except:
                        continue
                        
            print(f"✗ ESP32 not responding on WiFi ({ESP32_WIFI_IP})")
            return False, None
            
        except Exception as e:
            print(f"✗ WiFi connection error: {e}")
            return False, None
    
    async def read_sensor_data_wifi(self):
        """Read sensor data via WiFi HTTP"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(self.wifi_endpoint)
                response.raise_for_status()
                
                try:
                    data = response.json()
                    # Extract sensor values
                    return {
                        'temperature': data.get('temperature', data.get('temp')),
                        'humidity': data.get('humidity', data.get('humid')),
                        'pressure': data.get('pressure'),
                        'co2': data.get('co2'),
                        'tvoc': data.get('tvoc'),
                        'iaq': data.get('iaq')
                    }
                except:
                    return None
                    
        except Exception as e:
            print(f"✗ WiFi read error: {e}")
            self.connection_mode = None
            return None
    
    async def post_to_backend(self, sensor_data):
        """Post sensor data to FastAPI backend"""
        try:
            # Filter out None values
            clean_data = {k: v for k, v in sensor_data.items() if v is not None}
            
            if not clean_data:
                return False
            
            payload = {
                'scope': self.scope,
                'timestamp': datetime.now(timezone.utc).isoformat(),
                **clean_data
            }
            
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(self.backend_url, json=payload)
                response.raise_for_status()
                print(f"✓ Sensor data posted: {clean_data}")
                return True
                
        except Exception as e:
            print(f"✗ Backend post error: {e}")
            return False
    
    async def run(self):
        """Main loop"""
        print(f"🌡️  ESP32 Environmental Sensor Service")
        print(f"   Backend: {self.backend_url}")
        print(f"   Scope: {self.scope}")
        print()
        
        while True:
            try:
                # Try to establish connection if not connected
                if self.connection_mode is None:
                    print("Attempting WiFi connection...")
                    connected, initial_data = await self.try_wifi_connection()
                    
                    if not connected:
                        print(f"⏳ No ESP32 found. Retrying in {RETRY_INTERVAL}s...")
                        await asyncio.sleep(RETRY_INTERVAL)
                        continue
                
                # Read sensor data based on connection mode
                if self.connection_mode == 'wifi':
                    sensor_data = await self.read_sensor_data_wifi()
                    
                    if sensor_data:
                        await self.post_to_backend(sensor_data)
                    
                # Wait before next reading
                await asyncio.sleep(CHECK_INTERVAL)
                
            except KeyboardInterrupt:
                print("\n👋 Shutting down ESP32 sensor service")
                break
            except Exception as e:
                print(f"✗ Service error: {e}")
                await asyncio.sleep(RETRY_INTERVAL)

async def main():
    sensor = ESP32Sensor()
    await sensor.run()

if __name__ == '__main__':
    asyncio.run(main())
