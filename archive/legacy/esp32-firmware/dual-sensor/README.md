# ESP32 Dual Environmental Sensor Firmware

**For Light Engine Foxtrot Temperature Forecasting**

## Hardware
- **MCU**: ESP32 DevKit
- **Sensors**: 
  - Adafruit HDC302x (Temperature + Humidity)
  - Adafruit BME680 (Temperature + Humidity + Pressure + Gas)
- **Communication**: USB Serial (115200 baud)

## I2C Connections
```
ESP32 GPIO 21 (SDA) → HDC302x SDA + BME680 SDA
ESP32 GPIO 22 (SCL) → HDC302x SCL + BME680 SCL
ESP32 3.3V → Sensor VIN (or 5V if available)
ESP32 GND → Sensor GND
```

**I2C Addresses:**
- HDC302x: 0x44 (default)
- BME680: 0x76 or 0x77 (check jumper/solder bridge)

## Features
- ✅ Reads from both sensors every 2 seconds
- ✅ Averages temperature and humidity readings
- ✅ JSON output via serial for easy parsing
- ✅ Individual sensor data + averaged data
- ✅ Fallback to single sensor if one fails
- ✅ 5-second warmup period
- ✅ BME680 gas sensor for air quality
- ✅ No WiFi required (direct USB connection)

## JSON Output Format
```json
{
  "timestamp": 12345,
  "uptime_s": 12,
  "hdc302x": {
    "temperature_c": 22.45,
    "humidity": 45.23,
    "status": "ok"
  },
  "bme680": {
    "temperature_c": 22.38,
    "humidity": 46.12,
    "pressure_hpa": 1013.25,
    "gas_kohms": 123.45,
    "status": "ok"
  },
  "averaged": {
    "temperature_c": 22.42,
    "temperature_sources": 2,
    "humidity": 45.68,
    "humidity_sources": 2,
    "pressure_hpa": 1013.25,
    "gas_kohms": 123.45
  }
}
```

## Installation

### Using PlatformIO (Recommended)
```bash
cd esp32-firmware/dual-sensor
pio run --target upload
pio device monitor
```

### Using Arduino IDE
1. Install libraries via Library Manager:
   - Adafruit HDC302x
   - Adafruit BME680 Library
   - Adafruit Unified Sensor
   - ArduinoJson (v7.x)

2. Open `src/main.cpp` in Arduino IDE
3. Select **Tools → Board → ESP32 Dev Module**
4. Select **Tools → Port** (your USB serial port)
5. Upload

## Deployment to Edge Device

### 1. Test on Mac First
```bash
# Monitor output
screen /dev/cu.usbserial-0001 115200

# Or with Python
python3 scripts/esp32-sensor-reader.py
```

### 2. Deploy to reTerminal Edge Device
```bash
# SSH to edge device
ssh admin@100.65.187.59

# Create sensor integration service
sudo nano /etc/systemd/system/esp32-sensor.service
```

**Service file:**
```ini
[Unit]
Description=ESP32 Environmental Sensor Reader
After=network.target

[Service]
Type=simple
User=admin
WorkingDirectory=/home/admin/light-engine
ExecStart=/home/admin/light-engine/venv/bin/python3 scripts/esp32-sensor-reader.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable esp32-sensor.service
sudo systemctl start esp32-sensor.service
sudo systemctl status esp32-sensor.service
```

### 3. Update env.json with Sensor Data
The sensor reader script should write to `/home/admin/light-engine/public/data/env.json`:

```json
{
  "zones": [
    {
      "id": "zone-main",
      "name": "GreenReach Room",
      "temperature_c": 22.42,
      "humidity": 45.68,
      "source": "esp32-dual-sensor",
      "timestamp": "2026-01-21T14:30:00Z"
    }
  ]
}
```

### 4. Wait 72 Hours for Forecast
Once data is flowing:
```bash
# Check data collection progress
ssh admin@100.65.187.59
tail -f /home/admin/light-engine/public/data/env.json

# After 72 hours, test forecast
cd /home/admin/light-engine
source venv/bin/activate
python3 backend/predictive_forecast.py --zone main --hours 4
```

## Troubleshooting

### No Sensors Detected
- Check I2C wiring (SDA, SCL, VIN, GND)
- Verify I2C addresses with scanner: `i2cdetect -y 1`
- Try 0x77 for BME680 if 0x76 fails

### Brownout Detector Triggered
- Use powered USB hub (not direct Mac USB port)
- Or use external 5V power supply (500mA minimum)
- Disable WiFi code (already done in this firmware)

### Serial Output Garbled
- Verify baud rate is 115200
- Check USB cable quality (data + power lines)
- Use `screen` instead of `cat` for serial monitoring

### Only One Sensor Working
- Check individual I2C addresses
- Firmware will fallback to single sensor automatically
- averaged.temperature_sources will show count

## Power Requirements
- **HDC302x**: 1.8-5.5V, ~0.15mA active
- **BME680**: 1.71-3.6V, ~3.7mA active (18mA peak during gas measurement)
- **ESP32**: 3.3V, ~80mA active (160mA WiFi - disabled)
- **Total**: ~100mA (use quality USB cable or powered hub)

## Next Steps
1. Upload this firmware to ESP32
2. Test serial output on Mac
3. Deploy ESP32 to edge device via USB
4. Run sensor reader script as systemd service
5. Wait 72 hours for forecast data collection
6. Enable temperature forecasting in UI
