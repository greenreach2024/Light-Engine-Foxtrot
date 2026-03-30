# Raspberry Pi Refresh Preparation - greenreach-pi
**Date**: February 28, 2026  
**Purpose**: Prepare Pi for clean Light Engine farm deployment testing  
**Status**: ✅ AUDIT COMPLETE - Ready for refresh planning

---

## 🔍 System Discovery Summary

### Network Configuration
| Interface | IP Address | Purpose |
|-----------|------------|---------|
| **eth0** | 192.168.2.235/24 | Local network (primary) |
| **wlan0** | 10.42.0.1/24 | Access point / hotspot |
| **tailscale0** | 100.65.187.59/32 | Tailscale VPN (primary access) |
| **docker0** | 172.17.0.1/16 | Docker bridge network |
| **br-c68cdf625e78** | 172.18.0.1/16 | Docker custom bridge |

**Hostname**: `greach-pi`  
**Access**: `ssh -i ~/.ssh/id_ed25519 greenreach@100.65.187.59`

---

## 🖥️ Hardware Specification

| Component | Details |
|-----------|---------|
| **Model** | Raspberry Pi Compute Module 4 Rev 1.1 |
| **CPU** | BCM2835 ARM64 (aarch64) |
| **OS** | Debian GNU/Linux 11 (Bullseye) |
| **Kernel** | Linux 6.1.21-v8+ |
| **Storage** | 29GB (21GB used, 6.2GB free - **78% full**) |
| **Node.js** | v20.19.5 |
| **Python** | 3.9.2 |

**⚠️ Storage Warning**: System is 78% full - consider cleanup before refresh.

---

## 📡 Communication Ports & Services

### Active Listening Ports
| Port | Service | Protocol | Purpose |
|------|---------|----------|---------|
| **22** | SSH | TCP | Remote access |
| **53** | dnsmasq | TCP/UDP | DNS server |
| **631** | CUPS | TCP | Print server (localhost only) |
| **1883** | Mosquitto | TCP | MQTT (unencrypted) |
| **5900** | VNC | TCP | Remote desktop (RealVNC) |
| **8091** | Light Engine | TCP | **Farm application (Node.js)** |
| **8883** | Mosquitto | TCP | MQTT (TLS encrypted) |
| **9001** | Mosquitto | TCP6 | MQTT WebSocket |
| **41138** | Tailscale | TCP | VPN tunnel |

### Critical Services
```
✅ tailscaled.service     - Tailscale VPN (Tailnet access)
✅ vncserver-x11-serviced - VNC remote desktop
✅ mosquitto.service      - MQTT broker (sensor/control)
✅ docker.service         - Container runtime (unused)
✅ dnsmasq.service        - DNS/DHCP server (for wlan0 AP)
✅ lightdm.service        - Display manager (GUI)
```

---

## 🚀 Running Applications (PM2)

| ID | Name | Status | PID | Uptime | Restarts | Purpose |
|----|------|--------|-----|--------|----------|---------|
| **6** | lightengine-node | ✅ online | 1479 | 9m | 0 | **Main farm server** |
| **0** | lightengine-fastapi | ✅ online | N/A | 9m | 0 | Python API backend |
| **4** | ml-energy-forecast | ✅ online | 1423 | 9m | 0 | AI: Energy prediction |
| **3** | ml-forecast-zone1 | ✅ online | 1392 | 9m | 0 | AI: Climate forecast |
| **2** | ml-health-check | ✅ online | 4418 | 10s | 3 | AI: Health monitoring |
| **1** | ml-anomalies | ✅ online | 4421 | 10s | 2 | AI: Anomaly detection |
| **5** | sensor-ingester | ❌ errored | 0 | 0 | 15 | **FAILING** Sensor data |

**⚠️ Issues**:
- `sensor-ingester` is failing (15 restarts) - indicates sensor connectivity problem
- `ml-health-check` and `ml-anomalies` restarting (likely dependency on failed sensor data)

---

## 📁 Light Engine Installation

**Path**: `/home/greenreach/Light-Engine-Foxtrot/`  
**Last Updated**: Feb 2, 2026 (16:36)  
**Installation**: Active production farm setup

### Key Components Present
- ✅ Activity Hub (wholesale orders)
- ✅ Admin authentication system  
- ✅ ML/AI predictive modules
- ✅ Adaptive VPD control
- ✅ Farm management system
- ✅ Wholesale API endpoints

**Current State**: Fully configured production-like farm (not a clean test setup)

---

## 🔌 Private Network Architecture

Based on discovered services and existing documentation:

### Device Communication Network
```
greach-pi (192.168.2.235) - Central Controller
    ↓
    ├─ MQTT (1883/8883) ─→ ESP32 sensors, environmental monitors
    ├─ HTTP (192.168.2.80:3000) ─→ GROW3 Pro light controllers
    ├─ HTTP (192.168.2.42:1883) ─→ Nutrient dosing system (MQTT)
    └─ WiFi AP (10.42.0.1) ─→ Mobile devices (iPad, phones)
```

### External Communication
```
Internet ←→ Tailscale VPN (100.65.187.59) ←→ greach-pi
                                              ↓
                                         Local Farm Network (192.168.2.x)
```

**Network Roles**:
- **eth0 (192.168.2.235)**: Primary farm network, talks to:
  - Light controllers (192.168.2.80)
  - Nutrient systems (192.168.2.42)
  - Other sensor nodes (192.168.1.101-104 WiFi sensors)
- **wlan0 (10.42.0.1)**: WiFi access point for mobile devices (iPad QR scanning, etc.)
- **tailscale0 (100.65.187.59)**: Secure remote access for:
  - SSH administration
  - VNC remote desktop
  - Light Engine web interface (port 8091)

---

## 🧹 PRE-REFRESH CHECKLIST

### 1. Backup Current Configuration
```bash
# SSH to Pi
ssh -i ~/.ssh/id_ed25519 greenreach@100.65.187.59

# Backup farm data
mkdir -p ~/backups/pre-refresh-2026-02-28
cd ~/backups/pre-refresh-2026-02-28

# Critical data to backup
tar -czf light-engine-data.tar.gz ~/Light-Engine-Foxtrot/public/data/
tar -czf light-engine-db.tar.gz ~/Light-Engine-Foxtrot/data/*.json ~/Light-Engine-Foxtrot/data/*.db
cp ~/Light-Engine-Foxtrot/.env .env.backup 2>/dev/null || echo "No .env file"
pm2 save
cp ~/.pm2/dump.pm2 pm2-process-list.backup

# Network configs
sudo cp /etc/network/interfaces network-interfaces.backup 2>/dev/null
sudo cp /etc/wpa_supplicant/wpa_supplicant.conf wpa_supplicant.backup 2>/dev/null
sudo cp /etc/dnsmasq.conf dnsmasq.backup 2>/dev/null

# List of installed packages
dpkg --get-selections > dpkg-packages.list
npm list -g --depth=0 > npm-global-packages.list 2>&1

echo "Backup complete!"
ls -lah
```

### 2. Document Current Device Connections
```bash
# Check MQTT subscriptions
sudo mosquitto_sub -h localhost -t '#' -C 10 -v

# Check for connected sensors
sudo nmap -sn 192.168.2.0/24 | grep "Nmap scan report"

# List WiFi clients on AP
iw dev wlan0 station dump || echo "No WiFi clients"
```

### 3. Prepare Refresh Media (If Needed)
- [ ] Download latest Raspberry Pi OS Lite (64-bit)
- [ ] Verify SHA256 checksum
- [ ] Prepare SD card/eMMC writer
- [ ] Have backup power supply ready

---

## 🔄 REFRESH STRATEGY OPTIONS

### Option A: System Update Only (Recommended for Testing)
**When**: You want to keep existing OS but update packages  
**Time**: 30-60 minutes  
**Risk**: Low

```bash
# Update all packages
sudo apt update && sudo apt upgrade -y

# Update Node.js to latest LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# Update Python packages
pip3 install --upgrade pip
pip3 install --upgrade -r ~/Light-Engine-Foxtrot/requirements.txt

# Clean up disk space
sudo apt autoremove -y
sudo apt clean
docker system prune -a -f
pm2 flush
sudo journalctl --vacuum-time=7d
```

### Option B: Clean OS Install + Farm Setup
**When**: You want a pristine test environment  
**Time**: 2-4 hours  
**Risk**: Medium (requires reinstalling everything)

**Steps** (detailed in next section):
1. Flash new Raspberry Pi OS
2. Configure network (eth0, wlan0 AP, Tailscale)
3. Install base dependencies (Node.js, Python, Docker, PM2)
4. Install Light Engine from repository
5. Configure farm setup wizard
6. Test with prebuilt farm data

### Option C: Clone Current Setup to New SD Card
**When**: You want to preserve current setup as fallback  
**Time**: 1-2 hours  
**Risk**: Very Low

```bash
# From your Mac (not on Pi)
# Insert current SD card in USB reader
diskutil list  # Find disk (e.g., disk4)
sudo dd if=/dev/rdisk4 of=~/pi-backup-2026-02-28.img bs=4m

# Write to new SD card
# Insert new SD card
sudo dd if=~/pi-backup-2026-02-28.img of=/dev/rdisk5 bs=4m
```

---

## 🆕 CLEAN INSTALL PROCEDURE (Option B)

### Phase 1: OS Installation (30 min)

```bash
# Download Raspberry Pi OS Lite (64-bit)
# URL: https://www.raspberrypi.com/software/operating-systems/
# Use: "Raspberry Pi OS Lite (64-bit)" - Debian Bookworm

# Flash to SD card using Raspberry Pi Imager
# Enable SSH, set hostname: greach-pi
# Set username: greenreach
# Set WiFi credentials (optional)
# Enable SSH public key authentication
```

### Phase 2: Network Configuration (30 min)

```bash
# First boot - SSH via local network
ssh greenreach@greach-pi.local

# Update system
sudo apt update && sudo apt upgrade -y

# Install Tailscale for remote access
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=greach-pi

# Configure wlan0 as access point (for iPad/mobile devices)
sudo apt install -y dnsmasq hostapd

# Configure static IP for AP
sudo nano /etc/dhcpcd.conf
# Add:
# interface wlan0
#     static ip_address=10.42.0.1/24
#     nohook wpa_supplicant

# Configure dnsmasq
sudo mv /etc/dnsmasq.conf /etc/dnsmasq.conf.orig
sudo nano /etc/dnsmasq.conf
# Add:
# interface=wlan0
# dhcp-range=10.42.0.10,10.42.0.50,255.255.255.0,24h
# domain=local
# address=/greach-pi.local/10.42.0.1

# Configure hostapd
sudo nano /etc/hostapd/hostapd.conf
# Add:
# interface=wlan0
# driver=nl80211
# ssid=GreenReach-Farm
# hw_mode=g
# channel=7
# wmm_enabled=0
# macaddr_acl=0
# auth_algs=1
# ignore_broadcast_ssid=0
# wpa=2
# wpa_passphrase=greenreach2026
# wpa_key_mgmt=WPA-PSK
# wpa_pairwise=TKIP
# rsn_pairwise=CCMP

sudo nano /etc/default/hostapd
# Uncomment and set:
# DAEMON_CONF="/etc/hostapd/hostapd.conf"

sudo systemctl unmask hostapd
sudo systemctl enable hostapd
sudo systemctl start hostapd
sudo systemctl enable dnsmasq
sudo systemctl start dnsmasq
```

### Phase 3: Install Dependencies (20 min)

```bash
# Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Python 3 and dev tools
sudo apt install -y python3-pip python3-venv python3-dev

# Build tools
sudo apt install -y build-essential git curl

# PM2 process manager
sudo npm install -g pm2
pm2 startup
# Run the command it outputs
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u greenreach --hp /home/greenreach

# MQTT broker (for sensor communication)
sudo apt install -y mosquitto mosquitto-clients
sudo systemctl enable mosquitto

# VNC server (optional, for GUI access)
sudo apt install -y realvnc-vnc-server
sudo systemctl enable vncserver-x11-serviced
```

### Phase 4: Install Light Engine (20 min)

```bash
# Clone repository (or sync from local)
cd ~
git clone https://github.com/YOUR-ORG/Light-Engine-Foxtrot.git
# Or: scp -r from your development machine

cd ~/Light-Engine-Foxtrot

# Install Node.js dependencies
npm install

# Install Python dependencies
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate

# Create data directories
mkdir -p public/data
mkdir -p data

# Set environment variables
cat > .env << 'EOF'
PORT=8091
NODE_ENV=production
FARM_ID=test-farm-pi
MQTT_BROKER=mqtt://localhost:1883
NUTRIENT_MQTT_URL=mqtt://192.168.2.42:1883
DEFAULT_CONTROLLER=http://192.168.2.80:3000
EOF

# Start with PM2
pm2 start server-foxtrot.js --name lightengine-node --time
pm2 save
```

### Phase 5: Farm Configuration (30 min)

```bash
# Access Light Engine via browser
# Option 1: From local network
# http://192.168.2.235:8091

# Option 2: Via Tailscale (from anywhere)
# http://100.65.187.59:8091

# Option 3: Via VNC (GUI browser on Pi)
# Connect VNC to 100.65.187.59:5900
# Open Chromium browser
# Navigate to http://localhost:8091

# Complete setup wizard:
# 1. Farm Profile (name, timezone, certifications)
# 2. Room Configuration (define grow rooms)
# 3. Zone Mapping (environmental zones)
# 4. Device Connections (lights, sensors)
# 5. Recipe Selection (crop programs)
```

---

## 🧪 TESTING PLAN: Light Engine on Pi

### Prerequisites
- [ ] Pi refreshed and running updated OS
- [ ] Light Engine installed and accessible
- [ ] Browser access configured (VNC or network)
- [ ] Prebuilt farm data ready to load

### Test Scenarios

#### 1. First-Time Farm Setup Wizard
**URL**: `http://100.65.187.59:8091/views/setup-wizard.html`

**Test Steps**:
1. ✅ Wizard loads without errors
2. ✅ Farm name/location configuration saves
3. ✅ Room creation works (add multiple rooms)
4. ✅ Zone mapping UI functions
5. ✅ Device discovery finds MQTT sensors
6. ✅ Light controller connection (192.168.2.80)
7. ✅ Recipe library loads
8. ✅ Completion redirects to dashboard

**Expected Data**:
- Farm profile in `public/data/farm.json`
- Rooms in `public/data/rooms.json`
- Devices in `public/data/devices.json`

#### 2. Prebuilt Farm Load Test
**Goal**: Import existing farm configuration

```bash
# On Pi
cd ~/Light-Engine-Foxtrot/public/data

# Load sample farm data
curl -O https://raw.githubusercontent.com/YOUR-ORG/Light-Engine-Foxtrot/main/data/sample-farm.json
curl -O https://raw.githubusercontent.com/YOUR-ORG/Light-Engine-Foxtrot/main/data/sample-rooms.json
curl -O https://raw.githubusercontent.com/YOUR-ORG/Light-Engine-Foxtrot/main/data/sample-groups.json

# Restart server
pm2 restart lightengine-node
```

**Verify**:
- Dashboard shows imported farm
- Room cards display correctly
- Device connections show status
- Environmental data displays (if sensors connected)

#### 3. Network Access Test
**Test all access methods work**:

```bash
# From Mac (via Tailscale)
curl http://100.65.187.59:8091/api/status
# Expected: {"status":"ok","farm_id":"test-farm-pi"}

# From iPad on WiFi AP (10.42.0.x)
# Open Safari: http://10.42.0.1:8091
# Expected: Dashboard loads

# From local network device
curl http://192.168.2.235:8091/api/status
# Expected: {"status":"ok"}
```

#### 4. Sensor Integration Test
**Connect ESP32 environmental sensor**:

```bash
# Subscribe to MQTT sensor topics
mosquitto_sub -h localhost -t 'sensors/#' -v

# Expected: See temperature/humidity readings every 10-30 seconds
# Example: sensors/zone1/temperature 22.5
```

#### 5. Light Controller Test
**Control GROW3 Pro light at 192.168.2.80**:

```bash
# From Light Engine dashboard
# Navigate to Lighting Control
# Adjust dimming level 0-100%
# Verify light physically responds

# Check API endpoint
curl http://192.168.2.80:3000/status
# Expected: Light controller status JSON
```

#### 6. Performance Baseline
**Measure Pi performance with Light Engine**:

```bash
# CPU/Memory usage
pm2 monit

# Response time test
time curl http://localhost:8091/api/status

# Load test (optional)
ab -n 100 -c 10 http://localhost:8091/api/status
```

---

## 📊 SUCCESS CRITERIA

### Clean Install Success
- [ ] OS boots and network accessible (eth0, wlan0 AP, Tailscale)
- [ ] SSH access works via Tailscale
- [ ] VNC remote desktop accessible
- [ ] Light Engine server starts and stays running (PM2)
- [ ] Dashboard loads in browser (no console errors)
- [ ] Setup wizard completes without errors
- [ ] Farm data persists after server restart

### Farm Testing Success
- [ ] Can create new farm from scratch
- [ ] Can load prebuilt farm data
- [ ] Dashboard displays room/zone cards
- [ ] Environmental data shows (if sensors connected)
- [ ] Light controls respond (if controller connected)
- [ ] MQTT broker receives sensor messages
- [ ] Mobile devices (iPad) can access via WiFi AP
- [ ] System stable for 24+ hours uptime

### Performance Criteria
- [ ] Dashboard loads < 3 seconds
- [ ] API responses < 500ms
- [ ] CPU usage < 50% idle, < 80% active
- [ ] Memory usage < 2GB
- [ ] Disk usage < 70%
- [ ] No PM2 process restarts (except manual)

---

## 🚨 ROLLBACK PLAN

If refresh fails or Light Engine doesn't work:

### Option 1: Restore Backup
```bash
# From backup created in Phase 1
cd ~/backups/pre-refresh-2026-02-28
tar -xzf light-engine-data.tar.gz -C ~/Light-Engine-Foxtrot/public/
pm2 resurrect
pm2 restart all
```

### Option 2: Restore Cloned SD Card
```bash
# Power off Pi, swap SD cards back to original
# Boot and verify services: pm2 list
```

### Option 3: Emergency Access
```bash
# If Tailscale down, use local network
# Connect monitor/keyboard to Pi directly
# Or connect Mac to same network as Pi
ssh greenreach@192.168.2.235
```

---

## 📋 NEXT STEPS

### Ready to Proceed
**Choose your refresh strategy**:

1. **Quick Update** (Option A): Update packages, test with existing setup
   - Run: Phase 6 updates from Option A
   - Time: 30-60 min
   - Risk: Low

2. **Clean Install** (Option B): Fresh OS, pristine Light Engine test
   - Follow: All phases in Clean Install Procedure
   - Time: 2-4 hours
   - Risk: Medium (have backup ready)

3. **Clone & Test** (Option C): Preserve current, test on duplicate
   - Clone SD card first
   - Test on clone, keep original as rollback
   - Time: 1-2 hours for clone
   - Risk: Very Low

### Before Starting Any Option
```bash
# Take snapshot backup NOW
ssh -i ~/.ssh/id_ed25519 greenreach@100.65.187.59
mkdir -p ~/backups/pre-refresh-2026-02-28
cd ~/backups/pre-refresh-2026-02-28
# Run backup commands from checklist above
```

**Recommendation**: Start with **Option A (Quick Update)** to test Light Engine on current setup first. If that works well, consider Option B for a clean production deployment later.

---

## 📞 SUPPORT INFORMATION

### SSH Access
```bash
ssh -i ~/.ssh/id_ed25519 greenreach@100.65.187.59
```

### VNC Access
- **Address**: `100.65.187.59:5900`
- **Client**: RealVNC Viewer
- **Authentication**: VNC password (set on Pi)

### Log Locations
```bash
# PM2 logs
pm2 logs lightengine-node
pm2 logs --lines 100

# System logs
sudo journalctl -u lightengine-node -f
sudo journalctl -u mosquitto -f
sudo journalctl -u tailscaled -f

# Light Engine app logs
tail -f ~/Light-Engine-Foxtrot/logs/*.log
```

### Quick Health Check
```bash
ssh -i ~/.ssh/id_ed25519 greenreach@100.65.187.59 '
  echo "=== SYSTEM STATUS ===" &&
  uptime &&
  df -h / | tail -1 &&
  echo "=== PM2 PROCESSES ===" &&
  pm2 list &&
  echo "=== NETWORK ===" &&
  ip addr show | grep "inet " | grep -v 127.0.0.1 &&
  echo "=== LIGHT ENGINE ===" &&
  curl -s http://localhost:8091/api/status | head -3
'
```

---

**Document Status**: ✅ Complete and ready for execution  
**Last Updated**: February 28, 2026  
**Next Action**: Choose refresh strategy and execute
