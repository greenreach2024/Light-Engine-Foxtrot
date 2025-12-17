# Raspberry Pi Deployment Scripts

This directory contains automation scripts for deploying and managing Light Engine Charlie on Raspberry Pi devices.

## Scripts Overview

### 🚀 `deploy-pi.sh` - Initial Deployment
Fully automated setup script for fresh or existing Raspberry Pi installations.

**What it does:**
- Detects Raspberry Pi hardware
- Updates system packages
- Installs Node.js 18+ and Python 3.8+
- Installs all project dependencies
- Creates `.env` configuration file
- Sets up systemd services for auto-start
- Configures network and firewall

**Usage:**
```bash
# On your Raspberry Pi
cd ~/Light-Engine-Charlie
./scripts/deploy-pi.sh
```

**First-time deployment:** ~10-15 minutes  
**Re-deployment:** ~3-5 minutes

---

### 🔄 `update-pi.sh` - Quick Updates
Fast update script for pulling latest code and restarting services.

**What it does:**
- Stashes local changes (if any)
- Pulls latest code from GitHub
- Updates Node.js and Python dependencies
- Restarts running services
- Restores stashed changes
- Shows service status

**Usage:**
```bash
# On your Raspberry Pi
cd ~/Light-Engine-Charlie
./scripts/update-pi.sh
```

**Update time:** ~2-3 minutes

---

### 📊 `status-pi.sh` - Health Check
Comprehensive status and health monitoring script.

**What it shows:**
- System information (model, hostname, IP, uptime)
- CPU, memory, disk usage, temperature
- Service status (Node.js and Python)
- Port availability (8091, 8000)
- Network connectivity
- Recent errors from logs
- Quick action commands

**Usage:**
```bash
# On your Raspberry Pi
cd ~/Light-Engine-Charlie
./scripts/status-pi.sh
```

**Check time:** Instant

---

## Common Workflows

### First-Time Setup

```bash
# 1. SSH into your Pi
ssh pi@raspberrypi.local

# 2. Clone the repository
git clone https://github.com/greenreach2024/Light-Engine-Charlie.git
cd Light-Engine-Charlie

# 3. Run deployment script
./scripts/deploy-pi.sh

# 4. Edit .env with your credentials
nano .env

# 5. Restart services
sudo systemctl restart light-engine-charlie.service
sudo systemctl restart light-engine-python.service

# 6. Check status
./scripts/status-pi.sh
```

---

### Regular Updates

```bash
# Quick update and restart
cd ~/Light-Engine-Charlie
./scripts/update-pi.sh
```

---

### Health Monitoring

```bash
# Check system health
./scripts/status-pi.sh

# If issues found, view logs
journalctl -u light-engine-charlie.service -n 100
journalctl -u light-engine-python.service -n 100
```

---

### Troubleshooting

**Services won't start:**
```bash
# Check service status
sudo systemctl status light-engine-charlie.service

# View recent logs
journalctl -u light-engine-charlie.service -n 50

# Restart services
sudo systemctl restart light-engine-charlie.service
sudo systemctl restart light-engine-python.service
```

**Port conflicts:**
```bash
# Find what's using port 8091
sudo lsof -i :8091

# Kill the process
sudo kill -9 <PID>

# Restart service
sudo systemctl restart light-engine-charlie.service
```

**Missing dependencies:**
```bash
# Reinstall Node.js dependencies
npm install

# Reinstall Python dependencies
pip3 install -r requirements.txt

# Restart services
sudo systemctl restart light-engine-charlie.service light-engine-python.service
```

---

## Service Management

### Start Services
```bash
sudo systemctl start light-engine-charlie.service
sudo systemctl start light-engine-python.service
```

### Stop Services
```bash
sudo systemctl stop light-engine-charlie.service
sudo systemctl stop light-engine-python.service
```

### Restart Services
```bash
sudo systemctl restart light-engine-charlie.service
sudo systemctl restart light-engine-python.service
```

### Enable Auto-Start (on boot)
```bash
sudo systemctl enable light-engine-charlie.service
sudo systemctl enable light-engine-python.service
```

### Disable Auto-Start
```bash
sudo systemctl disable light-engine-charlie.service
sudo systemctl disable light-engine-python.service
```

### View Logs
```bash
# Real-time logs
journalctl -u light-engine-charlie.service -f

# Last 100 lines
journalctl -u light-engine-charlie.service -n 100

# Since last boot
journalctl -u light-engine-charlie.service -b

# Errors only
journalctl -u light-engine-charlie.service -p err
```

---

## Environment Configuration

After deployment, edit `.env` to configure your system:

```bash
nano ~/Light-Engine-Charlie/.env
```

**Required settings:**
```bash
SWITCHBOT_TOKEN=your_token_here
SWITCHBOT_SECRET=your_secret_here
```

**Optional settings:**
```bash
ENV_SOURCE=azure  # Use Azure for data logging
AZURE_LATEST_URL=https://your-function.azurewebsites.net/api/telemetry/latest

MQTT_HOST=192.168.2.38
MQTT_USERNAME=your_username
MQTT_PASSWORD=your_password
```

**After editing `.env`, restart services:**
```bash
sudo systemctl restart light-engine-charlie.service
sudo systemctl restart light-engine-python.service
```

---

## Network Access

Once deployed, access the dashboard from any device on your network:

- **By hostname:** `http://raspberrypi.local:8091`
- **By IP:** `http://192.168.X.X:8091` (find IP with `hostname -I`)

**API Documentation:**
- Python Backend: `http://raspberrypi.local:8000/docs`

---

## Automated Backups

Create a cron job to backup your configuration:

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * cd ~/Light-Engine-Charlie && tar -czf ~/backups/light-engine-$(date +\%Y\%m\%d).tar.gz .env public/data data
```

---

## Hardware-Specific Configuration

### Raspberry Pi reTerminal (with built-in display)

**Enable auto-start browser in kiosk mode:**
```bash
sudo nano /etc/xdg/lxsession/LXDE-pi/autostart
```

Add:
```bash
@xset s off
@xset -dpms
@xset s noblank
@chromium-browser --kiosk --disable-restore-session-state http://localhost:8091
```

**Install screen rotation utility:**
```bash
sudo apt install arandr
```

---

## Security Recommendations

1. **Change default password:**
   ```bash
   passwd
   ```

2. **Enable firewall:**
   ```bash
   sudo apt install ufw
   sudo ufw enable
   sudo ufw allow ssh
   sudo ufw allow 8091/tcp
   sudo ufw allow 8000/tcp
   ```

3. **Secure .env file:**
   ```bash
   chmod 600 ~/Light-Engine-Charlie/.env
   ```

4. **Use SSH keys:**
   ```bash
   # On your computer
   ssh-copy-id pi@raspberrypi.local
   ```

5. **Keep system updated:**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

---

## Performance Tuning

### For Raspberry Pi 3B/3B+

Enable swap for better performance:
```bash
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile
# Set CONF_SWAPSIZE=1024
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### For Raspberry Pi 4 (4GB+)

Reduce GPU memory (more for Node.js/Python):
```bash
sudo nano /boot/config.txt
# Add: gpu_mem=16
sudo reboot
```

---

## Documentation

For detailed deployment information, see:
- [PI_DEPLOYMENT_GUIDE.md](../docs/PI_DEPLOYMENT_GUIDE.md) - Complete deployment guide
- [README.md](../README.md) - Project overview
- [SETUP_WIZARD_SYSTEM.md](../SETUP_WIZARD_SYSTEM.md) - Setup wizard documentation

---

## Support

**Check logs first:**
```bash
./scripts/status-pi.sh
journalctl -u light-engine-charlie.service -n 100
```

**Common issues:**
- Service won't start → Check logs and .env file
- Can't access dashboard → Check firewall and network
- High CPU/memory → Check for infinite loops in logs
- Disk full → Clean logs: `journalctl --vacuum-time=7d`

**Contact:** info@greenreachfarms.com
