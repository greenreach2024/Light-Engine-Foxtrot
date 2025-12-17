# ESP32 Nutrient Controller

## Overview
This firmware controls an ESP32-based nutrient dosing system with Atlas Scientific sensors and peristaltic pumps.

## Hardware
- **ESP32 DevKit**
- **Atlas Scientific I²C Sensors:**
  - pH sensor @ 0x63
  - EC sensor @ 0x64
  - RTD temperature sensor @ 0x66
- **Peristaltic Pumps:**
  - pH Up (GPIO 25)
  - pH Down (GPIO 26)
  - Nutrient A (GPIO 27)
  - Nutrient B (GPIO 14)
  - Mixing pump (GPIO 12)
- **Flow Sensor:** GPIO 35 (pulse counter)

## Network Configuration
- Update `WIFI_SSID` and `WIFI_PASSWORD` in `src/main.cpp` (or via a private `secrets.h`) before flashing
- Default MQTT broker host is `192.168.2.42:1883`; change `MQTT_SERVER` if your broker runs elsewhere

## MQTT Topics

### Published (by ESP32)
- `sensors/nutrient/reading` - Sensor readings every 5 seconds
- `sensors/nutrient/status` - System status every 60 seconds
- `sensors/nutrient/pump` - Pump event notifications

### Subscribed (commands to ESP32)
- `sensors/nutrient/command/dose` - Dose pump command
- `sensors/nutrient/command/cal` - Sensor calibration
- `sensors/nutrient/command/mix` - Run mixing pump

## Upload Instructions

```bash
cd /Users/petergilbert/Light-Engine-Echo/firmware/esp32-nutrient-controller

# Build firmware
pio run

# Upload to ESP32 (auto-detect port)
pio run -t upload

# Or specify port
pio run -t upload --upload-port /dev/tty.usbserial-02898B21

# Monitor serial output
pio device monitor --baud 115200
```

## Expected Boot Sequence
```
=== ESP32 Nutrient Controller ===
Version: 1.0
Starting...

✓ I2C initialized
✓ Pump pins configured
✓ Flow sensor attached
Connecting to WiFi: Greenreach
..........
✓ WiFi connected
  IP address: 192.168.2.XX
  RSSI: -XX dBm
Connecting to MQTT broker: 192.168.2.42
✓ MQTT connected
✓ Subscribed to command topics

=== System Ready ===
```

## Troubleshooting

### Atlas Sensors Not Responding
- Verify I²C connections (SDA, SCL, power, ground)
- Check sensor addresses with I²C scanner
- Ensure sensors are powered (3.3V or 5V)
- Verify pull-up resistors on I²C bus

### WiFi Connection Failed
- Verify SSID and password in `src/main.cpp`
- Check network availability
- Verify ESP32 within WiFi range

### MQTT Connection Failed
- Verify broker IP address (192.168.2.42)
- Check broker is running: `mosquitto_sub -h 192.168.2.42 -t '#'`
- Verify network connectivity

## Safety Features
- Maximum single dose: 50ml
- Minimum interval between doses: 30 seconds
- Maximum pump runtime: 30 seconds
- Flow sensor monitoring for all doses

## Development Notes
This firmware is compatible with the Light Engine Charlie nutrient monitoring system. It publishes data to the same MQTT broker used by the reTerminal dashboard.
