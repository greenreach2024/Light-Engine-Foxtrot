# Edge Device Deployment Guide

Complete guide for deploying Light Engine on edge devices (Raspberry Pi, local servers, embedded systems).

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Installation Methods](#installation-methods)
4. [Configuration](#configuration)
5. [Hardware Setup](#hardware-setup)
6. [Activation](#activation)
7. [Networking](#networking)
8. [Security](#security)
9. [Maintenance](#maintenance)
10. [Troubleshooting](#troubleshooting)

## Overview

Edge deployment runs Light Engine directly on local hardware in your greenhouse/farm. Benefits:

- **Low Latency**: Direct hardware control without internet delays
- **Offline Operation**: Continues working during internet outages
- **Data Privacy**: All data stays on-premises
- **Cost Effective**: No recurring cloud hosting fees
- **Local Discovery**: Auto-discovery via mDNS (light-engine.local)

**Supported Platforms:**
- Raspberry Pi 3/4/5 (Recommended: 4GB+ RAM)
- Ubuntu/Debian Linux (x64, ARM)
- macOS (Intel/Apple Silicon)
- Windows 10/11

## Prerequisites

### Hardware Requirements

**Minimum:**
- CPU: Dual-core 1.2GHz
- RAM: 2GB
- Storage: 8GB free space
- Network: Ethernet or WiFi

**Recommended:**
- CPU: Quad-core 1.5GHz+
- RAM: 4GB+
- Storage: 32GB+ (for logs and backups)
- Network: Gigabit Ethernet

### Software Requirements

- Node.js 18+ (automatically installed by installer)
- PostgreSQL 14+ (optional, uses SQLite by default)
- Avahi/Bonjour (for mDNS discovery)

## Installation Methods

### Method 1: One-Line Installer (Recommended)

```bash
# Download and run installer
curl -fsSL https://install.greenreach.io/install.sh | bash
```

The installer will:
1. Detect your operating system and architecture
2. Download the appropriate binary
3. Install to `/opt/light-engine` or `C:\Program Files\Light Engine`
4. Set up systemd service (Linux) or Windows Service
5. Launch setup wizard for activation

### Method 2: Binary Package

**Download from https://install.greenreach.io/downloads/**

**Linux:**
```bash
# Download
wget https://install.greenreach.io/downloads/light-engine-linux-x64

# Make executable
chmod +x light-engine-linux-x64

# Run
./light-engine-linux-x64
```

**Raspberry Pi:**
```bash
# Download ARM version
wget https://install.greenreach.io/downloads/light-engine-linux-arm64

chmod +x light-engine-linux-arm64
./light-engine-linux-arm64
```

**macOS:**
```bash
# Download
curl -O https://install.greenreach.io/downloads/light-engine-macos

chmod +x light-engine-macos
./light-engine-macos
```

**Windows:**
Download `light-engine-win-x64.exe` and run as Administrator.

### Method 3: From Source

```bash
# Clone repository
git clone https://github.com/greenreach/light-engine-foxtrot.git
cd light-engine-foxtrot

# Install dependencies
npm install

# Build
npm run build:edge

# Run
npm start
```

## Configuration

### Environment Variables

Create `.env` file in installation directory:

```bash
# Server Configuration
PORT=3000
NODE_ENV=production

# Deployment Mode
DEPLOYMENT_MODE=edge

# Database (optional - defaults to SQLite)
DATABASE_URL=postgresql://user:pass@localhost:5432/lightengine

# License
LICENSE_PATH=/opt/light-engine/license.json

# mDNS Discovery
MDNS_ENABLED=true
MDNS_HOSTNAME=light-engine

# Hardware Integration
KASA_ENABLED=true
GOVEE_ENABLED=true
SWITCHBOT_ENABLED=true

# Logging
LOG_LEVEL=info
LOG_PATH=/var/log/light-engine

# Auto-Updates
AUTO_UPDATE_ENABLED=true
UPDATE_CHECK_INTERVAL=21600000  # 6 hours
UPDATE_CHANNEL=stable  # stable, beta, or dev
```

### Hardware Configuration

Edit `config/iot-devices.json`:

```json
{
  "devices": [
    {
      "id": "light-zone-1",
      "name": "Germination Lights",
      "type": "kasa",
      "model": "HS300",
      "ip": "192.168.1.100",
      "zone": "germination",
      "capabilities": ["power", "energy_monitoring"]
    },
    {
      "id": "fan-zone-1",
      "name": "Exhaust Fan",
      "type": "switchbot",
      "mac": "AA:BB:CC:DD:EE:FF",
      "zone": "germination",
      "capabilities": ["power"]
    }
  ]
}
```

### Room/Zone Configuration

Edit `config/room-map.json`:

```json
{
  "zones": [
    {
      "id": "germination",
      "name": "Germination Room",
      "area_sqft": 200,
      "target_temp": 75,
      "target_humidity": 70,
      "light_schedule": "18/6"
    },
    {
      "id": "vegetative",
      "name": "Vegetative Growth",
      "area_sqft": 400,
      "target_temp": 72,
      "target_humidity": 65,
      "light_schedule": "18/6"
    }
  ]
}
```

## Hardware Setup

### Raspberry Pi Preparation

1. **Install Raspberry Pi OS**:
   - Use Raspberry Pi Imager
   - Choose "Raspberry Pi OS Lite (64-bit)"
   - Configure WiFi and SSH in imager settings

2. **Update system**:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

3. **Install dependencies**:
   ```bash
   sudo apt install -y avahi-daemon curl git
   ```

4. **Increase swap (for 2GB models)**:
   ```bash
   sudo dphys-swapfile swapoff
   sudo nano /etc/dphys-swapfile  # Set CONF_SWAPSIZE=2048
   sudo dphys-swapfile setup
   sudo dphys-swapfile swapon
   ```

### Network Setup

**Static IP (Recommended):**

Edit `/etc/dhcpcd.conf`:
```bash
interface eth0
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=192.168.1.1 8.8.8.8
```

Restart networking:
```bash
sudo systemctl restart dhcpcd
```

### Auto-Start Service

**Linux (systemd):**

Create `/etc/systemd/system/light-engine.service`:
```ini
[Unit]
Description=Light Engine Edge Service
After=network.target

[Service]
Type=simple
User=lightengine
WorkingDirectory=/opt/light-engine
ExecStart=/opt/light-engine/light-engine-linux-arm64
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable light-engine
sudo systemctl start light-engine
sudo systemctl status light-engine
```

**View logs:**
```bash
sudo journalctl -u light-engine -f
```

## Activation

### 1. Obtain Activation Code

Contact your administrator or visit GreenReach Central to generate an activation code.

### 2. Run Setup Wizard

**Option A: Web UI**

1. Navigate to `http://light-engine.local:3000` (or device IP)
2. Setup wizard will launch automatically on first run
3. Enter activation code
4. Choose farm name
5. Select deployment mode: Edge
6. Complete hardware detection

**Option B: Command Line**

```bash
# Using activation code
curl -X POST http://localhost:3000/api/setup/activate \
  -H "Content-Type: application/json" \
  -d '{
    "activationCode": "XXXX-XXXX-XXXX-XXXX",
    "farmName": "My Greenhouse",
    "deploymentMode": "edge"
  }'
```

### 3. Verify License

```bash
# Check license status
curl http://localhost:3000/api/license/status
```

Expected response:
```json
{
  "valid": true,
  "farmId": "my-greenhouse",
  "tier": "full",
  "features": ["automation", "wholesale", "analytics"],
  "expires": "2026-12-24T00:00:00.000Z",
  "daysRemaining": 365
}
```

## Networking

### Local Access

- **mDNS**: http://light-engine.local:3000
- **IP Address**: http://192.168.1.100:3000
- **Localhost**: http://localhost:3000 (from device itself)

### Remote Access (Optional)

**Method 1: Port Forwarding**

1. Configure router to forward port 3000 to edge device IP
2. Access via public IP: http://YOUR_PUBLIC_IP:3000
3. **Security**: Enable HTTPS and authentication

**Method 2: Cloudflare Tunnel**

```bash
# Install cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
chmod +x cloudflared-linux-arm64
sudo mv cloudflared-linux-arm64 /usr/local/bin/cloudflared

# Login
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create light-engine

# Configure tunnel
cat > ~/.cloudflared/config.yml << EOF
tunnel: YOUR_TUNNEL_ID
credentials-file: /home/pi/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: farm.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
EOF

# Run tunnel
cloudflared tunnel run light-engine
```

### Firewall Configuration

**Allow local network access:**

```bash
# UFW (Ubuntu)
sudo ufw allow from 192.168.1.0/24 to any port 3000
sudo ufw enable

# iptables
sudo iptables -A INPUT -s 192.168.1.0/24 -p tcp --dport 3000 -j ACCEPT
```

## Security

### Best Practices

1. **Change default passwords**
2. **Enable HTTPS** (use Let's Encrypt or self-signed cert)
3. **Keep software updated** (enable auto-updates)
4. **Use firewall** (allow only local network)
5. **Regular backups** (data and configuration)
6. **Monitor logs** for unauthorized access attempts

### HTTPS Setup

**Generate self-signed certificate:**

```bash
# Create certificate directory
sudo mkdir -p /opt/light-engine/certs
cd /opt/light-engine/certs

# Generate certificate
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout privkey.pem -out fullchain.pem \
  -subj "/C=US/ST=State/L=City/O=Farm/CN=light-engine.local"

# Set permissions
sudo chown lightengine:lightengine *.pem
sudo chmod 600 privkey.pem
```

**Update environment:**

```bash
# .env
HTTPS_ENABLED=true
HTTPS_KEY_PATH=/opt/light-engine/certs/privkey.pem
HTTPS_CERT_PATH=/opt/light-engine/certs/fullchain.pem
```

Access via: https://light-engine.local:3000

### User Authentication

Default admin credentials are generated on first run. Check logs:

```bash
sudo journalctl -u light-engine | grep "Admin credentials"
```

**Change admin password:**

```bash
curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "oldPassword": "temp_password",
    "newPassword": "secure_password_123"
  }'
```

## Maintenance

### Software Updates

**Automatic (Recommended):**

Enable in `.env`:
```bash
AUTO_UPDATE_ENABLED=true
UPDATE_CHANNEL=stable
```

Updates check every 6 hours and install at 3 AM.

**Manual:**

```bash
# Check for updates
curl http://localhost:3000/api/updates/check

# Download update
curl -X POST http://localhost:3000/api/updates/download

# Install update (installs at 3 AM unless immediate flag set)
curl -X POST http://localhost:3000/api/updates/install
```

**Rollback:**

```bash
# Automatic rollback on failure
# Manual rollback:
curl -X POST http://localhost:3000/api/updates/rollback
```

### Backups

**Automatic backups** run daily at 2 AM to `/opt/light-engine/backups/`

**Manual backup:**

```bash
# Backup database and config
curl -X POST http://localhost:3000/api/admin/backup

# Backup is saved to /opt/light-engine/backups/backup-YYYYMMDD-HHMMSS.tar.gz
```

**Restore from backup:**

```bash
# Stop service
sudo systemctl stop light-engine

# Extract backup
cd /opt/light-engine
sudo tar -xzf backups/backup-20251224-020000.tar.gz

# Start service
sudo systemctl start light-engine
```

### Log Management

**View logs:**

```bash
# Live logs
sudo journalctl -u light-engine -f

# Last 100 lines
sudo journalctl -u light-engine -n 100

# Today's logs
sudo journalctl -u light-engine --since today

# Error logs only
sudo journalctl -u light-engine -p err
```

**Rotate logs:**

Create `/etc/logrotate.d/light-engine`:
```
/var/log/light-engine/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 lightengine lightengine
    sharedscripts
    postrotate
        systemctl reload light-engine > /dev/null 2>&1 || true
    endscript
}
```

### Health Monitoring

**Check system health:**

```bash
# API health check
curl http://localhost:3000/api/health

# Detailed system info
curl http://localhost:3000/api/admin/system-info

# Hardware status
curl http://localhost:3000/api/hardware/status
```

**Expected response:**
```json
{
  "status": "healthy",
  "uptime": 86400,
  "memory": {
    "used": "1.2 GB",
    "total": "4 GB",
    "percentage": 30
  },
  "cpu": {
    "usage": 15,
    "cores": 4
  },
  "disk": {
    "used": "5.2 GB",
    "total": "32 GB",
    "percentage": 16
  },
  "database": "connected",
  "devices": {
    "total": 12,
    "online": 11,
    "offline": 1
  }
}
```

## Troubleshooting

### Service Won't Start

**Check logs:**
```bash
sudo journalctl -u light-engine -n 50
```

**Common issues:**

1. **Port already in use:**
   ```bash
   sudo lsof -i :3000
   # Kill conflicting process or change PORT in .env
   ```

2. **Permission denied:**
   ```bash
   sudo chown -R lightengine:lightengine /opt/light-engine
   ```

3. **Missing dependencies:**
   ```bash
   cd /opt/light-engine
   npm install --production
   ```

### Can't Access Web Interface

1. **Check service is running:**
   ```bash
   sudo systemctl status light-engine
   ```

2. **Check firewall:**
   ```bash
   sudo ufw status
   # Allow port if blocked
   sudo ufw allow 3000
   ```

3. **Check network connectivity:**
   ```bash
   ping light-engine.local
   # If fails, use IP address instead
   ```

4. **Check mDNS:**
   ```bash
   # Linux
   systemctl status avahi-daemon
   
   # Test mDNS resolution
   avahi-browse -a
   ```

### Devices Not Detected

1. **Check device is online:**
   ```bash
   ping DEVICE_IP
   ```

2. **Check device configuration:**
   ```bash
   cat /opt/light-engine/config/iot-devices.json
   ```

3. **Test device connection:**
   ```bash
   curl http://localhost:3000/api/devices/test/DEVICE_ID
   ```

4. **Check network:**
   - Ensure edge device and smart devices on same network/VLAN
   - Check router allows multicast (for discovery)

### High Memory Usage

1. **Check process memory:**
   ```bash
   ps aux | grep light-engine
   ```

2. **Restart service:**
   ```bash
   sudo systemctl restart light-engine
   ```

3. **Increase swap (Raspberry Pi):**
   ```bash
   sudo dphys-swapfile swapoff
   sudo nano /etc/dphys-swapfile  # Increase CONF_SWAPSIZE
   sudo dphys-swapfile setup
   sudo dphys-swapfile swapon
   ```

### License Issues

**Invalid license:**
```bash
# Check license file exists
ls -la /opt/light-engine/license.json

# Validate license
curl http://localhost:3000/api/license/validate

# Reactivate with new code
curl -X POST http://localhost:3000/api/setup/activate \
  -H "Content-Type: application/json" \
  -d '{"activationCode": "NEW-CODE-HERE"}'
```

### Update Failures

**Rollback to previous version:**
```bash
curl -X POST http://localhost:3000/api/updates/rollback
```

**Manual update:**
```bash
# Stop service
sudo systemctl stop light-engine

# Download new binary
cd /opt/light-engine
sudo wget https://install.greenreach.io/downloads/light-engine-linux-arm64 -O light-engine.new

# Backup current
sudo mv light-engine light-engine.backup

# Install new
sudo mv light-engine.new light-engine
sudo chmod +x light-engine

# Start service
sudo systemctl start light-engine

# Check logs
sudo journalctl -u light-engine -f
```

## Support

- **Documentation**: https://docs.greenreach.io
- **Community Forum**: https://community.greenreach.io
- **Email Support**: support@greenreach.io
- **Emergency Hotline**: 1-800-GREENREACH

## Next Steps

- [Multi-Tenant Cloud Setup](CLOUD_DEPLOYMENT_GUIDE.md)
- [Desktop App Installation](DESKTOP_APP_GUIDE.md)
- [Wholesale Integration](WHOLESALE_INTEGRATION_GUIDE.md)
- [Security Hardening](SECURITY_HARDENING_GUIDE.md)
