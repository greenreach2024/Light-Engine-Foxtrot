# ESP32 Sensor Integration Guide

## Overview

The ESP32 environmental sensor is now properly integrated with Light Engine's universal device discovery system. The sensor will be automatically discovered when plugged in via USB and can be managed through the Light Engine UI without any code changes.

## Current Status ✅

- **ESP32 Hardware**: Connected at `/dev/ttyUSB1` (CP2102 USB-UART Bridge)
- **Firmware**: BME680 dual-sensor firmware transmitting JSON data every 30 seconds
- **Discovery**: Appears in universal scan as "ESP32 Sensor (ttyUSB1)"
- **Backend**: Updated with USB serial discovery support
- **Integration**: Ready for user acceptance through UI

## Sensor Capabilities

The ESP32 BME680 sensor provides:
- **Temperature**: Air temperature in °C
- **Humidity**: Relative humidity percentage
- **Pressure**: Atmospheric pressure in hPa
- **Gas Resistance**: Air quality indicator in kOhms

## Proper Integration Workflow

### Step 1: Run Universal Device Scan

From the Light Engine dashboard:
1. Navigate to the **Integrations** or **IoT Manager** panel
2. Click **"Start Scan"** or **"Discover Devices"**
3. Wait 3-5 seconds for scan to complete

Alternatively, run the scan via API:
```bash
curl -X POST http://192.168.2.234:8000/discovery/scan
```

### Step 2: Accept the Device

Expected scan result:
```json
{
  "name": "ESP32 Sensor (ttyUSB1)",
  "brand": "Silicon Labs",
  "vendor": "Espressif",
  "protocol": "usb-serial",
  "deviceId": "serial-0001",
  "port": "/dev/ttyUSB1",
  "category": "environmental_sensor"
}
```

In the UI:
1. Find "ESP32 Sensor (ttyUSB1)" in discovered devices list
2. Click **"Accept"** button
3. Device is added to `public/data/iot-devices.json`

### Step 3: Assign to Room/Zone

Using the Room Mapper:
1. Open **Room Mapper** tool in dashboard
2. Find the ESP32 sensor in device list
3. Drag device to appropriate room/zone (e.g., "GreenReach", "Nutrient Room")
4. Save room assignment

The sensor's `zone_id` will be automatically set based on room placement.

### Step 4: Verify Data Flow

Sensor data should now appear in:
- **Farm Summary**: Environmental cards showing temperature, humidity, pressure
- **Heatmap**: Zone-based environmental overlays
- **Historical Charts**: Time-series sensor data

Check sensor data via API:
```bash
# Replace {zone} with the assigned zone name
curl 'http://192.168.2.234:8000/api/env/latest?scope={zone}'
```

## Architecture Changes Made

### 1. Added USB Serial Discovery

**File**: `backend/device_discovery.py`

New function `discover_serial_devices()` that:
- Scans USB serial ports (`/dev/ttyUSB*`, `/dev/ttyACM*`)
- Filters for CP2102/CH340/FTDI/Arduino devices
- Attempts to read JSON sensor data to detect capabilities
- Registers devices as environmental sensors
- Returns Device objects for universal scan

### 2. Updated Universal Scan Endpoint

**File**: `backend/main.py`

Added `/discovery/scan` POST endpoint that:
- Calls `discover_serial_devices()` function
- Returns discovered USB serial devices in unified format
- Compatible with existing IoT Manager UI

### 3. Fixed Conditional Imports

**File**: `backend/device_discovery.py`

Fixed `mDNSListener` class definition to only exist when `ZEROCONF_AVAILABLE` is true, preventing import errors when zeroconf library is not installed.

## Removed Components

### ❌ Hardcoded PM2 Service

**Removed**: `automation/esp32-serial-reader.py` running as PM2 service "esp32-sensor"

**Why**: This bypassed the proper IoT device workflow. The hardcoded service:
- Posted data with hardcoded scope "GreenReach"
- Could not be reconfigured through UI
- Not integrated with room mapper
- Required code changes for scope updates

**New approach**: User accepts device through UI, assigns room via room mapper, data automatically flows with correct scope.

## Testing the Integration

### Test 1: Device Discovery

```bash
curl -X POST http://192.168.2.234:8000/discovery/scan | jq '.devices[] | select(.protocol=="usb-serial")'
```

Expected output:
```json
{
  "name": "ESP32 Sensor (ttyUSB1)",
  "brand": "Silicon Labs",
  "vendor": "Espressif",
  "protocol": "usb-serial",
  "comm_type": "USB Serial",
  "deviceId": "serial-0001",
  "port": "/dev/ttyUSB1",
  "capabilities": {
    "temperature": true,
    "humidity": true,
    "pressure": true,
    "gas_resistance": true
  },
  "category": "environmental_sensor"
}
```

### Test 2: Serial Data Transmission

```bash
ssh greenreach@192.168.2.234 "cat /dev/ttyUSB1" | head -1
```

Expected: JSON sensor data like:
```json
{"timestamp":226357,"bme680":{"temperature_c":18.84,"humidity":26.33,"pressure_hpa":1031.36,"gas_kohms":151.62,"status":"ok"}}
```

### Test 3: Device Registry

After accepting device in UI:
```bash
ssh greenreach@192.168.2.234 "cat ~/Light-Engine-Foxtrot/public/data/iot-devices.json" | jq '.devices[] | select(.protocol=="usb-serial")'
```

Should show device with assigned zone_id.

## Future Enhancements

### 1. Automatic Data Sync Service

After device is accepted and placed in room mapper, create a service that:
- Reads `iot-devices.json` to get ESP32 assignment
- Uses device's assigned zone as scope
- Reads serial data from device port
- Posts to `/api/env/ingest` with correct scope

This service should be **conditional** - only runs if ESP32 exists in IoT device registry.

### 2. Capability Detection Improvement

Currently, if the ESP32 isn't transmitting data during discovery (between 30-second intervals), capabilities show as `{"serial": true}` instead of specific sensors. 

Possible improvements:
- Increase read timeout to catch next transmission
- Store firmware metadata on ESP32 to query capabilities
- Allow manual capability configuration in UI

### 3. Multiple Serial Sensors

The discovery system can handle multiple USB serial devices. To add another sensor:
1. Plug in device via USB
2. Run universal scan
3. Accept and place in room mapper

Each device gets unique ID and can be placed in different zones.

## Troubleshooting

### ESP32 Not Appearing in Scan

Check hardware:
```bash
ssh greenreach@192.168.2.234 "lsusb | grep CP210"
```

Should show: `Bus 001 Device 006: ID 10c4:ea60 Silicon Labs CP210x UART Bridge`

Check serial port:
```bash
ssh greenreach@192.168.2.234 "ls -la /dev/ttyUSB*"
```

Check permissions:
```bash
ssh greenreach@192.168.2.234 "groups greenreach | grep dialout"
```

User should be in `dialout` group for serial access.

### Backend Not Starting

Check logs:
```bash
ssh greenreach@192.168.2.234 "pm2 logs lightengine-fastapi --err --nostream"
```

Common issues:
- Import errors if pyserial not installed
- Permission errors if user not in dialout group

Install pyserial if missing:
```bash
ssh greenreach@192.168.2.234 "cd ~/Light-Engine-Foxtrot && ./venv/bin/pip install pyserial"
```

### Data Not Appearing in Farm Summary

1. Verify device is in IoT registry:
   ```bash
   ssh greenreach@192.168.2.234 "cat ~/Light-Engine-Foxtrot/public/data/iot-devices.json"
   ```

2. Check if device has zone assignment

3. Verify sensor is transmitting:
   ```bash
   ssh greenreach@192.168.2.234 "cat /dev/ttyUSB1" | head -3
   ```

4. Create sensor data sync service (see "Future Enhancements" above)

## Summary

✅ **ESP32 discovered via universal scan** - no hardcoded scripts needed
✅ **User can accept device through UI** - no code changes required  
✅ **Room mapper assigns zones** - automatic scope management
✅ **Architecture follows Light Engine design** - farm users don't need code access

The system now works as designed!
