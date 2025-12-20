# GreenReach Edge Device Installation Guide

## Overview

This guide walks through installing and configuring a GreenReach Edge Device for your farm. The edge device manages greenhouse automation, inventory tracking, and wholesale integration.

**Estimated Time:** 2-4 hours  
**Skill Level:** Intermediate (basic Linux knowledge helpful)  
**Support:** support@greenreach.com | 1-800-473-3673

---

## Table of Contents

1. [Hardware Requirements](#hardware-requirements)
2. [Pre-Installation Checklist](#pre-installation-checklist)
3. [Operating System Installation](#operating-system-installation)
4. [GreenReach Software Installation](#greenreach-software-installation)
5. [First-Run Setup Wizard](#first-run-setup-wizard)
6. [Network Configuration](#network-configuration)
7. [Hardware Connection](#hardware-connection)
8. [Verification & Testing](#verification-testing)
9. [Troubleshooting](#troubleshooting)
10. [Maintenance](#maintenance)

---

## Hardware Requirements

### Recommended Device: Symcod W101M N97 TermiCom W

**Specifications:**
- **Processor**: Intel Alder Lake N97, 3.6 GHz (quad-core)
- **RAM**: 8 GB DDR4 (minimum)
- **Storage**: 240 GB NVMe SSD (minimum)
- **Display**: 10.1" touchscreen, 1280x800 resolution
- **Network**: 2.5 GbE + 1 GbE Ethernet ports
- **USB**: 4 ports (2x USB 3.2, 2x USB 2.0)
- **Power**: 24 VDC industrial power supply
- **Casing**: Industrial aluminum, VESA 100 mounting

**Purchase:** Available from Symcod or GreenReach partners  
**Price:** ~$800-1000 USD

### Alternative Hardware

GreenReach also supports:

**Raspberry Pi 4/5:**
- 8 GB RAM model
- 64 GB+ microSD or USB SSD
- Official 7" touchscreen (optional)
- Case with cooling
- ~$150-250 USD

**Generic x86 PC:**
- Intel i3/i5 or AMD Ryzen 3/5
- 8 GB+ RAM
- 120 GB+ SSD
- Ubuntu 22.04 LTS compatible
- ~$300-500 USD

### Required Accessories

- **Network**: Ethernet cable (Cat 5e or better)
- **Power**: Device-appropriate power supply
- **USB Hub**: If connecting multiple devices (optional)
- **Keyboard/Mouse**: For initial setup (temporary)

---

## Pre-Installation Checklist

Before beginning installation:

### Farm Information

□ Farm name and location  
□ GreenReach account credentials  
□ Farm ID (from GreenReach portal)  
□ API Key and Secret (from GreenReach portal)

**Get credentials:**
1. Log in to https://portal.greenreach.com
2. Navigate to "Settings" → "API Credentials"
3. Click "Generate Edge Device Credentials"
4. Save Farm ID, API Key, and API Secret securely

### Network Information

□ Static IP address (or DHCP available)  
□ Subnet mask  
□ Gateway IP  
□ DNS servers  
□ WiFi credentials (if using wireless)

### Hardware Ready

□ Edge device unboxed and inspected  
□ Power supply connected  
□ Ethernet cable connected  
□ Touchscreen responsive (if applicable)  
□ All sensors/controllers ready to connect

---

## Operating System Installation

### Option 1: Symcod W101M (Pre-installed Windows)

The Symcod device typically ships with Windows. We'll install Ubuntu alongside or replace it.

**Steps:**

1. **Download Ubuntu 22.04 LTS Server:**
   ```
   https://ubuntu.com/download/server
   ```

2. **Create bootable USB:**
   - Download Rufus (Windows) or Etcher (Mac/Linux)
   - Insert 8GB+ USB drive
   - Select Ubuntu ISO
   - Write to USB

3. **Boot from USB:**
   - Connect USB to device
   - Power on and press F12 (or DEL) for boot menu
   - Select USB drive

4. **Install Ubuntu:**
   - Select "Install Ubuntu Server"
   - Choose language: English
   - Network: Configure Ethernet (DHCP or static)
   - Storage: Use entire disk (or manual partitioning)
   - Profile:
     * Name: greenreach
     * Server name: greenreach-edge
     * Username: greenreach
     * Password: (choose strong password)
   - SSH: Enable OpenSSH server
   - Snaps: Skip for now
   - Complete installation and reboot

### Option 2: Raspberry Pi

1. **Download Raspberry Pi OS Lite (64-bit):**
   ```
   https://www.raspberrypi.com/software/
   ```

2. **Flash to microSD:**
   - Use Raspberry Pi Imager
   - Select "Raspberry Pi OS Lite (64-bit)"
   - Choose your microSD card
   - Configure settings:
     * Hostname: greenreach-edge
     * Enable SSH
     * Set username/password
     * Configure WiFi (optional)
   - Write

3. **Boot Raspberry Pi:**
   - Insert microSD card
   - Connect Ethernet, power, display
   - Wait for boot (~2 minutes)
   - Login via SSH or console

### Option 3: Generic x86 PC

Follow Option 1 (Ubuntu installation) for x86-based PCs.

---

## GreenReach Software Installation

### Step 1: System Update

```bash
# Update package lists
sudo apt update

# Upgrade installed packages
sudo apt upgrade -y

# Reboot
sudo reboot
```

### Step 2: Install Dependencies

```bash
# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install build tools
sudo apt install -y build-essential git

# Install OpenSSL (for certificates)
sudo apt install -y openssl

# Install PM2 (process manager)
sudo npm install -g pm2

# Verify installations
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

### Step 3: Clone GreenReach Repository

```bash
# Create application directory
sudo mkdir -p /opt/greenreach
sudo chown $USER:$USER /opt/greenreach

# Clone repository
cd /opt/greenreach
git clone https://github.com/greenreach2024/Light-Engine-Foxtrot.git
cd Light-Engine-Foxtrot

# Checkout stable branch
git checkout main
```

### Step 4: Install Application Dependencies

```bash
# Install Node.js dependencies
npm install --production

# Create necessary directories
sudo mkdir -p /etc/greenreach/{certs,credentials}
sudo mkdir -p /var/log/greenreach
sudo mkdir -p /var/lib/greenreach/data

# Set permissions
sudo chown -R $USER:$USER /etc/greenreach
sudo chown -R $USER:$USER /var/log/greenreach
sudo chown -R $USER:$USER /var/lib/greenreach
```

### Step 5: Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit environment file
nano .env
```

**Required environment variables:**

```bash
# Farm Identification
FARM_ID=GR-17350001001
FARM_NAME="My Farm"

# GreenReach Central API
GREENREACH_CENTRAL_URL=https://api.greenreach.com
GREENREACH_API_KEY=your-api-key-here
GREENREACH_API_SECRET=your-api-secret-here

# Server Configuration
NODE_ENV=production
PORT=3000

# Database
DATABASE_PATH=/var/lib/greenreach/data/greenreach.db

# Logging
LOG_LEVEL=info
LOG_DIR=/var/log/greenreach

# Certificates
CERT_DIR=/etc/greenreach/certs
CRED_DIR=/etc/greenreach/credentials

# Optional: Hardware-specific
TOUCHSCREEN_ENABLED=true
CONTROLLER_IP=192.168.1.100
```

**Save and exit:** Press Ctrl+X, then Y, then Enter

### Step 6: Start Application

```bash
# Start with PM2
pm2 start ecosystem.config.cjs

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
# Follow the command output instructions
```

### Step 7: Verify Installation

```bash
# Check application status
pm2 status

# View logs
pm2 logs server-foxtrot

# Test health endpoint
curl http://localhost:3000/healthz
```

Expected output:
```json
{
  "ok": true,
  "status": "healthy",
  "controller": { ... },
  "services": { ... }
}
```

---

## First-Run Setup Wizard

### Accessing the Wizard

**On touchscreen device:**
1. Open web browser on the device
2. Navigate to `http://localhost:3000/setup/wizard`

**From another computer:**
1. Find device IP: `hostname -I`
2. On another computer, open browser
3. Navigate to `http://<device-ip>:3000/setup/wizard`

### Wizard Steps

#### Step 1: Welcome
- Review system requirements
- Ensure network connectivity
- Click "Start Setup"

#### Step 2: Network Configuration

**Ethernet (Recommended):**
- Select "Ethernet"
- Choose "DHCP" (automatic) or "Static"
- If Static, enter:
  * IP Address: e.g., 192.168.1.50
  * Subnet Mask: e.g., 255.255.255.0
  * Gateway: e.g., 192.168.1.1
  * DNS: 8.8.8.8, 8.8.4.4

**WiFi:**
- Select "WiFi"
- Choose network from list
- Enter password
- Test connection

#### Step 3: Farm Registration

- Enter Farm ID (from GreenReach portal)
- Enter API Key
- Enter API Secret
- Click "Verify Credentials"
- Wait for confirmation

#### Step 4: Hardware Detection

- Click "Scan Hardware"
- Review detected devices:
  * USB devices
  * Serial ports
  * Network cameras
  * Controllers
- Assign device roles:
  * Environmental controllers
  * Light controllers
  * Cameras
  * Sensors
- Click "Confirm Hardware"

#### Step 5: Complete

- Review configuration summary
- Click "Finish Setup"
- System will:
  * Provision TLS certificate
  * Initialize synchronization
  * Connect to GreenReach Central
- Click "Go to Dashboard"

---

## Network Configuration

### Ethernet Configuration (Static IP)

**Edit netplan:**
```bash
sudo nano /etc/netplan/01-netcfg.yaml
```

**Configuration:**
```yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: no
      addresses:
        - 192.168.1.50/24
      gateway4: 192.168.1.1
      nameservers:
        addresses:
          - 8.8.8.8
          - 8.8.4.4
```

**Apply:**
```bash
sudo netplan apply
```

### WiFi Configuration

**Edit netplan:**
```bash
sudo nano /etc/netplan/01-netcfg.yaml
```

**Configuration:**
```yaml
network:
  version: 2
  wifis:
    wlan0:
      dhcp4: true
      access-points:
        "YourNetworkName":
          password: "YourPassword"
```

**Apply:**
```bash
sudo netplan apply
```

### Firewall Configuration

```bash
# Install UFW
sudo apt install -y ufw

# Allow SSH
sudo ufw allow 22/tcp

# Allow GreenReach web interface
sudo ufw allow 3000/tcp

# Allow HTTPS (if using)
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## Hardware Connection

### Environmental Controllers

**Supported:**
- Symcod ControlC Series
- Argus Controls
- Link4 Corporation
- Grolab

**Connection:**
1. Connect controller to Ethernet (preferred) or USB
2. Access setup wizard: Hardware Detection
3. Assign as "Environmental Controller"
4. Test connection in dashboard

### Light Controllers

**Supported:**
- GreenReach Lighting System (built-in)
- Heliospectra
- Fluence by OSRAM
- California LightWorks

**Connection:**
1. Connect via USB or network
2. Detect in hardware scan
3. Configure in Lighting section

### Cameras

**Supported:**
- Any USB webcam
- IP cameras (ONVIF compatible)
- Raspberry Pi Camera Module

**Connection:**
1. **USB Cameras:**
   - Plug into USB port
   - Detected automatically

2. **IP Cameras:**
   - Connect to same network
   - Note IP address
   - Add in dashboard: Settings → Cameras

### Sensors

**Environmental Sensors:**
- Temperature/Humidity (DHT22, SHT31)
- CO2 (MH-Z19, SCD30)
- Light (VEML7700, BH1750)
- Soil moisture (Capacitive sensors)

**Connection:**
- Most sensors use USB-to-Serial adapters
- Connect to USB port
- Auto-detected in hardware scan

---

## Verification & Testing

### System Health Check

```bash
# Check application status
pm2 status

# View system resources
htop

# Check disk space
df -h

# Check network
ip addr show
ping -c 4 api.greenreach.com
```

### Certificate Verification

```bash
# Check certificate status
curl http://localhost:3000/api/certs/status

# Expected: "provisioned": true, "valid": true
```

### Synchronization Test

```bash
# Trigger manual sync
curl -X POST http://localhost:3000/api/sync/trigger \
  -H "Content-Type: application/json" \
  -d '{"type": "all"}'

# Check sync status
curl http://localhost:3000/api/sync/status
```

### Wholesale Integration Test

```bash
# Check wholesale status
curl http://localhost:3000/api/wholesale/status

# Expected: "enabled": true
```

### Dashboard Access

Open browser and navigate to:
```
http://<device-ip>:3000
```

**Expected:**
- Dashboard loads
- Farm data visible
- No error messages
- Sync status: Connected

---

## Troubleshooting

### Application Won't Start

**Symptom:** PM2 shows "errored" or "stopped"

**Solution:**
```bash
# Check logs
pm2 logs server-foxtrot --lines 100

# Common issues:
# 1. Port already in use
sudo netstat -tulpn | grep 3000
# Kill conflicting process

# 2. Database permissions
ls -la /var/lib/greenreach/data
sudo chown -R $USER:$USER /var/lib/greenreach

# 3. Missing environment variables
cat .env
# Ensure all required variables are set

# Restart application
pm2 restart server-foxtrot
```

### Cannot Connect to Dashboard

**Symptom:** Browser shows "Connection refused"

**Solution:**
```bash
# Check if application is running
pm2 status

# Check firewall
sudo ufw status
sudo ufw allow 3000/tcp

# Check application is listening
sudo netstat -tulpn | grep 3000

# Try from local device
curl http://localhost:3000/healthz
```

### Certificate Provisioning Failed

**Symptom:** Certificate status shows "provisioned": false

**Solution:**
```bash
# Check network connectivity
ping api.greenreach.com

# Verify API credentials
curl http://localhost:3000/api/wholesale/status

# Check certificate directory permissions
ls -la /etc/greenreach/certs
sudo chown -R $USER:$USER /etc/greenreach/certs

# Trigger manual provisioning
curl -X POST http://localhost:3000/api/certs/provision \
  -H "Authorization: Bearer $GREENREACH_API_KEY"
```

### Synchronization Not Working

**Symptom:** lastSync values are null or old

**Solution:**
```bash
# Check sync status
curl http://localhost:3000/api/sync/status

# Check logs
pm2 logs server-foxtrot | grep sync

# Verify network connectivity
ping api.greenreach.com

# Check API credentials
echo $GREENREACH_API_KEY
echo $GREENREACH_API_SECRET

# Trigger manual sync
curl -X POST http://localhost:3000/api/sync/trigger \
  -d '{"type": "all"}'
```

### Hardware Not Detected

**Symptom:** Hardware scan shows no devices

**Solution:**
```bash
# Check USB devices
lsusb

# Check serial ports
ls -la /dev/tty*

# Check permissions
sudo usermod -a -G dialout $USER
# Logout and login again

# Check network devices
nmap -sP 192.168.1.0/24

# Retry scan
curl http://localhost:3000/api/hardware/scan
```

---

## Maintenance

### Daily Tasks

**Automated** (no action needed):
- Certificate expiry checking
- Inventory synchronization
- Health monitoring
- Log rotation

**Manual:**
- Review dashboard for alerts
- Check pending wholesale orders
- Verify environmental readings

### Weekly Tasks

```bash
# Review system logs
pm2 logs --lines 1000

# Check disk space
df -h

# Backup database
cp /var/lib/greenreach/data/greenreach.db \
   /var/lib/greenreach/backups/greenreach-$(date +%Y%m%d).db
```

### Monthly Tasks

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update GreenReach application
cd /opt/greenreach/Light-Engine-Foxtrot
git pull origin main
npm install --production
pm2 restart server-foxtrot

# Review and rotate logs
pm2 flush

# Check certificate expiry
curl http://localhost:3000/api/certs/status
```

### Backup Procedures

**Manual Backup:**
```bash
# Create backup directory
sudo mkdir -p /var/backups/greenreach

# Backup database
sudo cp /var/lib/greenreach/data/greenreach.db \
        /var/backups/greenreach/greenreach-$(date +%Y%m%d).db

# Backup configuration
sudo tar -czf /var/backups/greenreach/config-$(date +%Y%m%d).tar.gz \
        /etc/greenreach

# Backup logs
sudo tar -czf /var/backups/greenreach/logs-$(date +%Y%m%d).tar.gz \
        /var/log/greenreach
```

**Automated Backup:**
```bash
# Create backup script
sudo nano /usr/local/bin/greenreach-backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/greenreach"
DATE=$(date +%Y%m%d)

mkdir -p $BACKUP_DIR

# Database backup
cp /var/lib/greenreach/data/greenreach.db \
   $BACKUP_DIR/greenreach-$DATE.db

# Configuration backup
tar -czf $BACKUP_DIR/config-$DATE.tar.gz /etc/greenreach

# Keep last 30 days
find $BACKUP_DIR -type f -mtime +30 -delete

echo "Backup completed: $DATE"
```

```bash
# Make executable
sudo chmod +x /usr/local/bin/greenreach-backup.sh

# Add to crontab (daily at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/greenreach-backup.sh") | crontab -
```

### System Monitoring

**Install monitoring tools:**
```bash
sudo apt install -y htop iotop nethogs
```

**Monitor resources:**
```bash
# CPU and RAM
htop

# Disk I/O
sudo iotop

# Network usage
sudo nethogs

# Application logs
pm2 monit
```

---

## Support & Resources

### Documentation

- **Main Documentation:** https://docs.greenreach.com
- **API Reference:** https://api.greenreach.com/docs
- **Video Tutorials:** https://greenreach.com/tutorials
- **Community Forum:** https://community.greenreach.com

### Contact Support

**Email:** support@greenreach.com  
**Phone:** 1-800-473-3673  
**Hours:** 8am-8pm EST, 7 days/week  
**Emergency:** 24/7 for production issues

**When contacting support, include:**
- Farm ID
- Edge device IP address
- System logs: `pm2 logs --lines 200`
- Error messages
- Steps to reproduce issue

### Updates & Releases

**Stable releases:** https://github.com/greenreach2024/Light-Engine-Foxtrot/releases  
**Changelog:** https://github.com/greenreach2024/Light-Engine-Foxtrot/blob/main/CHANGELOG.md  
**Release notes:** Emailed to registered farms

---

**Installation Guide Version:** 1.0.0  
**Last Updated:** December 19, 2024  
**Maintained By:** GreenReach Support Team  
**License:** Proprietary - GreenReach Systems, Inc.
