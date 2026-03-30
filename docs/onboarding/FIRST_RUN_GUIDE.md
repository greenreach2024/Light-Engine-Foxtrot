# First-Run Setup Guide

## Overview

The GreenReach First-Run Setup Wizard provides a touchscreen-optimized interface for provisioning new edge devices. This guide covers the complete setup process from unboxing to operational status.

## Hardware Requirements

### Required Components
- **Raspberry Pi 5** (8GB RAM recommended)
- **Symcod W101M** 10.1" capacitive touchscreen display
- **Power Supply**: 5V/5A USB-C for Raspberry Pi 5
- **Network Connection**: Ethernet cable (recommended) or WiFi
- **MicroSD Card**: 64GB+ with GreenReach Edge OS image

### Optional Components
- USB sensors (temperature, humidity, CO2)
- RS-485 Modbus devices (environmental controllers)
- IP cameras for monitoring
- External storage (USB drive for logs/backups)

## Pre-Installation Checklist

Before starting the setup wizard, ensure you have:

1. ✅ Registration code from GreenReach Central (8 characters)
2. ✅ Network credentials (WiFi SSID/password if using wireless)
3. ✅ Farm details (name, address, contact information)
4. ✅ Hardware inventory list
5. ✅ Internet connectivity test completed

## Setup Wizard Walkthrough

### Step 1: Welcome Screen

The wizard starts with a welcome screen that provides an overview of the setup process.

**Actions:**
- Review the 5-step process overview
- Tap **Start Setup** button to begin

**Estimated Time:** 5-10 minutes total

---

### Step 2: Network Configuration

Configure how your edge device will connect to the internet and GreenReach Central.

#### Option A: Ethernet (Recommended)

**Advantages:**
- More reliable connection
- Higher bandwidth
- Lower latency
- No credential management

**Steps:**
1. Connect Ethernet cable to Raspberry Pi
2. Tap **Ethernet** button in wizard
3. System automatically detects connection
4. IP address is assigned via DHCP
5. Connection test runs automatically

**Troubleshooting:**
- **No Connection:** Check cable is securely connected
- **No IP Address:** Verify DHCP is enabled on router
- **Connection Test Failed:** Check firewall settings

#### Option B: WiFi

**When to Use:**
- Ethernet not available in installation location
- Temporary setup during testing
- Mobile/portable installations

**Steps:**
1. Tap **WiFi** button in wizard
2. Wait for network scan to complete (10-30 seconds)
3. Select your network from the list
4. Use on-screen keyboard to enter password
5. Tap **Connect** to establish connection
6. Wait for connection test (10-15 seconds)

**WiFi Requirements:**
- 2.4GHz or 5GHz network
- WPA2 or WPA3 security
- Minimum signal strength: -70 dBm
- Outbound ports 443, 3000, 3001 open

**On-Screen Keyboard:**
- Tap keys to type
- **Backspace** to delete characters
- **Done** to hide keyboard
- Case-sensitive password entry

---

### Step 3: Farm Registration

Register your edge device with GreenReach Central to enable data synchronization and remote management.

#### Registration Process

1. **Obtain Registration Code:**
   - Log into GreenReach Central dashboard
   - Navigate to **Farms** → **Add New Farm**
   - Click **Generate Registration Code**
   - Copy the 8-character code (e.g., `A7F2B1C9`)

2. **Enter Code in Wizard:**
   - Tap the registration code input field
   - On-screen keyboard appears automatically
   - Type the 8-character code
   - Code is validated in real-time

3. **Registration Verification:**
   - Wizard calls GreenReach Central API
   - Validates registration code
   - Retrieves farm configuration
   - Downloads API credentials
   - Establishes secure connection

**Security Notes:**
- Registration codes expire after 24 hours
- Each code can only be used once
- API credentials are encrypted at rest
- TLS 1.3 used for all communication

**Troubleshooting:**
- **Invalid Code:** Verify code matches exactly (case-sensitive)
- **Expired Code:** Generate a new code from Central dashboard
- **Network Error:** Check internet connectivity
- **API Timeout:** Verify Central API is accessible

---

### Step 4: Hardware Detection

Automatic discovery and enumeration of connected devices.

#### Detection Process

The wizard scans for:

1. **USB Devices:**
   - Temperature/humidity sensors
   - CO2 sensors
   - Webcams
   - Serial adapters (FTDI, CH340)

2. **Serial Ports (RS-485/Modbus):**
   - Environmental controllers
   - Industrial sensors
   - HVAC equipment
   - Lighting controllers

3. **Network Devices:**
   - IP cameras (RTSP/ONVIF)
   - Network sensors
   - PoE devices
   - IoT gateways

#### Detection Results

Devices are categorized automatically:

- **Lights:** LED controllers, grow lights, spectrum controllers
- **Fans:** Exhaust fans, circulation fans, HVAC blowers
- **Sensors:** Temperature, humidity, CO2, pH, EC, lux
- **Cameras:** IP cameras, USB webcams, monitoring systems
- **Other:** Uncategorized or unknown devices

**Manual Override:**
- Tap any device to view details
- Change device type if miscategorized
- Assign device to zone/room
- Set custom device name

**Scan Duration:**
- USB scan: 2-5 seconds
- Serial scan: 5-10 seconds
- Network scan: 10-30 seconds
- Total time: ~30-45 seconds

---

### Step 5: Completion

Setup is complete! The wizard displays a summary of configured settings.

**Final Steps:**
1. Review configuration summary
2. Tap **Go to Dashboard** to access main interface
3. First-time login redirects to farm profile setup

**What Happens Next:**
- Edge device registers with Central API
- Initial data sync begins (inventory, zones, settings)
- Hardware devices are added to farm database
- Automation rules are downloaded
- Monitoring starts immediately

---

## Post-Setup Configuration

After completing the wizard, configure these additional settings:

### Farm Profile

1. **Basic Information:**
   - Farm name and legal entity
   - Physical address
   - Contact information
   - Business hours

2. **Layout Configuration:**
   - Number of rooms
   - Zones per room
   - Tray capacity per zone
   - Growing method (NFT, DWC, media-based)

3. **Crop Selection:**
   - Primary crops (lettuce, herbs, microgreens)
   - Growing cycles
   - Target harvest dates
   - Inventory SKUs

### Zone Assignment

Map hardware devices to physical zones:

1. Navigate to **Setup** → **Zones**
2. Select a zone (e.g., "Room 1 - Zone A")
3. Assign detected devices:
   - Lights (1-4 per zone)
   - Fans (1-2 per zone)
   - Sensors (1-3 per zone)
4. Configure zone-specific settings:
   - Target temperature/humidity
   - Light schedule
   - Airflow settings

### Automation Rules

Configure basic automation rules:

1. **Climate Control:**
   - Temperature range (65-75°F default)
   - Humidity range (60-70% default)
   - CO2 supplementation (if equipped)

2. **Lighting Schedule:**
   - On/off times
   - Spectrum profiles (vegetative/flowering)
   - DLI targets (12-18 mol/m²/day)
   - Sunrise/sunset simulation

3. **Fan Control:**
   - Circulation schedule
   - Exhaust triggers (temp/humidity)
   - Fresh air exchange rates

---

## Touchscreen Calibration

If the touchscreen is misaligned or unresponsive:

### 5-Point Calibration

1. Navigate to **Settings** → **Touchscreen** → **Calibrate**
2. Tap each target as it appears:
   - Top-left corner
   - Top-right corner
   - Bottom-right corner
   - Bottom-left corner
   - Center point
3. Test calibration with test points
4. Save calibration if accurate
5. Restart if issues persist

**Common Issues:**
- **Inverted X/Y:** Re-run calibration
- **Offset Touch:** Check display mounting
- **No Response:** Verify USB connection
- **Erratic Behavior:** Check for interference

---

## Network Connectivity

### Verifying Connection

Check network status:

1. **Method 1:** Dashboard widget shows connection status
2. **Method 2:** Navigate to **Settings** → **Network**
3. **Method 3:** API call to `/health` endpoint

**Expected Values:**
- Ethernet: 1000 Mbps, <1ms latency
- WiFi: 50+ Mbps, <10ms latency
- Internet: Ping to 8.8.8.8 succeeds
- Central API: WebSocket connected

### Changing Network Settings

To switch networks after setup:

1. Navigate to **Settings** → **Network**
2. Select new network type (Ethernet/WiFi)
3. Enter credentials if needed
4. Apply changes (will disconnect briefly)
5. Verify new connection established

---

## Troubleshooting

### Wizard Won't Start

**Symptoms:** Blank screen or frozen at welcome screen

**Solutions:**
1. Check power supply (5V/5A minimum)
2. Verify display cable is connected
3. Restart Raspberry Pi
4. Re-flash SD card if persistent

### Network Connection Failed

**Symptoms:** "Connection Error" message in Step 2

**Solutions:**
1. **Ethernet:**
   - Verify cable is CAT5e or better
   - Check router DHCP pool not exhausted
   - Try different port on router
   - Check for PoE compatibility

2. **WiFi:**
   - Verify password is correct (case-sensitive)
   - Check signal strength (min -70 dBm)
   - Disable 5GHz if issues persist
   - Check WiFi not on isolated VLAN

### Registration Failed

**Symptoms:** "Invalid Code" or "API Timeout" in Step 3

**Solutions:**
1. Verify code is exactly 8 characters
2. Check code hasn't expired (24hr limit)
3. Verify internet connectivity
4. Check firewall allows outbound port 443
5. Verify Central API is online (status.greenreach.com)

### No Devices Detected

**Symptoms:** Hardware scan shows 0 devices in Step 4

**Solutions:**
1. **USB Devices:**
   - Run `lsusb` in terminal to verify
   - Check USB cable quality
   - Try different USB port
   - Verify device has power

2. **Serial Devices:**
   - Check `/dev/ttyUSB*` and `/dev/ttyACM*` exist
   - Verify baud rate matches device (9600/19200/115200)
   - Check RS-485 termination resistors
   - Verify Modbus address configuration

3. **Network Devices:**
   - Verify devices on same subnet
   - Check devices not behind firewall
   - Ping device IP manually
   - Verify ONVIF/RTSP enabled

### Wizard Crashes or Freezes

**Symptoms:** Unresponsive UI, no touch feedback

**Solutions:**
1. Wait 30 seconds for timeout
2. Tap **Back** button to retry
3. Restart Edge Device service:
   ```bash
   sudo systemctl restart greenreach-edge
   ```
4. Check logs:
   ```bash
   sudo journalctl -u greenreach-edge -f
   ```
5. Reboot if necessary

---

## Advanced Configuration

### Manual Device Registration

If automatic hardware detection fails:

1. SSH into Raspberry Pi:
   ```bash
   ssh pi@<ip-address>
   ```

2. List USB devices:
   ```bash
   lsusb -v
   ```

3. List serial ports:
   ```bash
   ls -l /dev/ttyUSB* /dev/ttyACM*
   ```

4. Manually add device to database:
   ```bash
   curl -X POST http://localhost:3000/api/devices \
     -H "Content-Type: application/json" \
     -d '{
       "id": "custom-device-001",
       "name": "Manual Sensor",
       "type": "sensor",
       "interface": "USB",
       "port": "/dev/ttyUSB0"
     }'
   ```

### Network Diagnostics

Run network tests:

```bash
# Test internet connectivity
ping -c 4 8.8.8.8

# Test DNS resolution
nslookup api.greenreach.com

# Test Central API connectivity
curl -v https://api.greenreach.com/health

# Test WebSocket connection
wscat -c wss://api.greenreach.com/ws

# Check routing
traceroute api.greenreach.com

# Monitor bandwidth
sudo iftop
```

### Database Access

View setup configuration:

```bash
# Connect to SQLite database
sqlite3 /var/lib/greenreach/edge.db

# Query setup status
SELECT * FROM setup_config;

# View registered devices
SELECT * FROM devices;

# Check farm registration
SELECT * FROM farm_config;
```

---

## Security Best Practices

### API Credentials

- ✅ Never share API keys publicly
- ✅ Rotate credentials every 90 days
- ✅ Use unique credentials per farm
- ✅ Enable 2FA on Central dashboard

### Network Security

- ✅ Use WPA3 for WiFi if available
- ✅ Isolate farm network from guest WiFi
- ✅ Enable firewall on router
- ✅ Use VPN for remote access
- ✅ Disable unused ports/services

### Physical Security

- ✅ Mount touchscreen securely
- ✅ Restrict physical access to device
- ✅ Use cable locks if in public area
- ✅ Enable screen lock after 5 min idle

---

## Support

### Getting Help

- 📧 Email: support@greenreach.com
- 💬 Chat: dashboard.greenreach.com/support
- 📞 Phone: 1-800-GREEN-REACH (1-800-473-3673)
- 📚 Docs: docs.greenreach.com

### Reporting Issues

When contacting support, provide:

1. Farm ID (from **Settings** → **About**)
2. Edge device serial number
3. GreenReach Edge OS version
4. Description of issue
5. Steps to reproduce
6. Screenshots if applicable
7. Log files (if requested by support)

### Diagnostic Logs

Export logs for support:

```bash
# Generate support bundle
sudo greenreach-edge diagnostic-export

# Output: /tmp/greenreach-diagnostic-YYYYMMDD-HHMMSS.tar.gz
# Upload this file when requested by support
```

---

## Appendix

### Registration Code Format

Registration codes are 8-character hexadecimal strings:
- Format: `[A-F0-9]{8}`
- Example: `A7F2B1C9`
- Case-insensitive
- No special characters
- Expires after 24 hours

### Supported Hardware

#### USB Sensors
- FTDI USB-to-Serial (FT232, FT2232)
- CH340/CH341 Serial adapters
- SHT31 temperature/humidity sensors
- MH-Z19 CO2 sensors
- Generic webcams (UVC compatible)

#### Network Devices
- ONVIF-compliant IP cameras
- RTSP streaming cameras
- Modbus TCP devices
- Custom HTTP/WebSocket sensors

#### Serial Devices (RS-485)
- Modbus RTU devices
- Industrial sensors
- HVAC controllers
- Custom serial protocols

### System Requirements

**Minimum:**
- Raspberry Pi 4B (4GB RAM)
- 32GB microSD card
- 10/100 Mbps Ethernet
- 5V/3A power supply

**Recommended:**
- Raspberry Pi 5 (8GB RAM)
- 64GB+ microSD card (Class 10/UHS-I)
- Gigabit Ethernet
- 5V/5A power supply
- Active cooling (fan or heatsink)

**Storage:**
- OS: 8GB
- Application: 4GB
- Logs: 2GB (rolling)
- Database: 2GB
- Free space: 16GB minimum

---

## Changelog

### Version 1.0.0 (2024-01)
- Initial release
- Touchscreen-optimized UI
- Ethernet and WiFi support
- USB/Serial/Network device detection
- GreenReach Central registration
- 5-step wizard flow

### Version 1.1.0 (Planned)
- WiFi network scanning improvements
- Advanced hardware configuration
- Bulk device import
- Touchscreen calibration utility
- Multi-language support
- Accessibility features

---

**Document Version:** 1.0.0  
**Last Updated:** 2024-01-15  
**Maintained By:** GreenReach Engineering Team  
**License:** Proprietary - GreenReach Systems, Inc.
