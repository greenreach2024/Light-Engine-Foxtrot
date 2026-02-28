#!/bin/bash
# Pi Complete Wipe Script
# Preserves: OS, network (Tailscale, SSH, WiFi), VNC, MQTT broker
# Removes: Light Engine, user data, PM2, Docker containers, caches

set -e

echo "=== Pi Complete Wipe Started: $(date) ===" | tee -a /tmp/pi-wipe.log

# Step 1: Create final backup
echo "[1/10] Creating final backup..." | tee -a /tmp/pi-wipe.log
mkdir -p ~/backups/final-pre-wipe-$(date +%Y%m%d-%H%M)
cd ~/backups/final-pre-wipe-*
ls -la ~/Light-Engine-Foxtrot/ > light-engine-file-list.txt 2>&1 || echo "No Light Engine dir"
pm2 list > pm2-list.txt 2>&1 || echo "No PM2"

# Step 2: Stop and remove PM2
echo "[2/10] Removing PM2 processes..." | tee -a /tmp/pi-wipe.log
pm2 kill 2>&1 || echo "PM2 already stopped"
rm -rf ~/.pm2 2>&1 || echo "PM2 dir already removed"

# Step 3: Remove Light Engine installation
echo "[3/10] Removing Light Engine..." | tee -a /tmp/pi-wipe.log
rm -rf ~/Light-Engine-Foxtrot 2>&1 || echo "Already removed"
rm -rf ~/light-engine 2>&1 || echo "Already removed"

# Step 4: Remove Python virtual environments
echo "[4/10] Removing Python venvs..." | tee -a /tmp/pi-wipe.log
rm -rf ~/venv 2>&1 || echo "No venv"
rm -rf ~/.local/lib/python* 2>&1 || echo "No python libs"

# Step 5: Clean Docker (keep Docker engine installed)
echo "[5/10] Cleaning Docker..." | tee -a /tmp/pi-wipe.log
docker stop $(docker ps -aq) 2>&1 || echo "No running containers"
docker rm $(docker ps -aq) 2>&1 || echo "No containers to remove"
docker rmi $(docker images -q) 2>&1 || echo "No images to remove"
docker system prune -a -f 2>&1 || echo "Docker already clean"

# Step 6: Remove user application data
echo "[6/10] Removing user data..." | tee -a /tmp/pi-wipe.log
rm -rf ~/data 2>&1 || echo "No data dir"
rm -rf ~/logs 2>&1 || echo "No logs dir"
rm -rf ~/.cache 2>&1 || echo "No cache"
rm -rf ~/.npm 2>&1 || echo "No npm cache"
rm -rf ~/.node-gyp 2>&1 || echo "No node-gyp"

# Step 7: Clean home directory of config files
echo "[7/10] Removing config files..." | tee -a /tmp/pi-wipe.log
rm -f ~/.env 2>&1 || echo "No .env"
rm -f ~/ecosystem.config.js 2>&1 || echo "No ecosystem"
rm -rf ~/.config/chromium 2>&1 || echo "No chromium config"

# Step 8: System cleanup
echo "[8/10] System cleanup..." | tee -a /tmp/pi-wipe.log
sudo apt autoremove -y 2>&1 | tail -3 || echo "Autoremove done"
sudo apt clean 2>&1 || echo "Clean done"
sudo journalctl --vacuum-time=1d 2>&1 | tail -1 || echo "Journal vacuum done"

# Step 9: Remove old backups (keep only latest)
echo "[9/10] Cleaning old backups..." | tee -a /tmp/pi-wipe.log
cd ~/backups
ls -dt */ | tail -n +2 | xargs rm -rf 2>&1 || echo "Old backups removed"

# Step 10: Verify critical services still running
echo "[10/10] Verifying critical services..." | tee -a /tmp/pi-wipe.log
systemctl is-active tailscaled && echo "✓ Tailscale running" || echo "✗ Tailscale DOWN"
systemctl is-active ssh && echo "✓ SSH running" || echo "✗ SSH DOWN"  
systemctl is-active vncserver-x11-serviced && echo "✓ VNC running" || echo "✗ VNC DOWN"
systemctl is-active mosquitto && echo "✓ MQTT running" || echo "✗ MQTT DOWN"
ping -c 1 8.8.8.8 > /dev/null && echo "✓ Internet connected" || echo "✗ Internet DOWN"

# Final status
echo "" | tee -a /tmp/pi-wipe.log
echo "=== Wipe Complete: $(date) ===" | tee -a /tmp/pi-wipe.log
echo "" | tee -a /tmp/pi-wipe.log
echo "Disk usage:" | tee -a /tmp/pi-wipe.log
df -h / | tee -a /tmp/pi-wipe.log
echo "" | tee -a /tmp/pi-wipe.log
echo "Home directory:" | tee -a /tmp/pi-wipe.log
du -sh ~/* 2>/dev/null | sort -h | tail -10 | tee -a /tmp/pi-wipe.log
echo "" | tee -a /tmp/pi-wipe.log
echo "Network interfaces:" | tee -a /tmp/pi-wipe.log
ip addr show | grep "inet " | grep -v 127.0.0.1 | tee -a /tmp/pi-wipe.log
echo "" | tee -a /tmp/pi-wipe.log
echo "✅ Pi is now clean and ready for fresh Light Engine installation" | tee -a /tmp/pi-wipe.log
echo "Complete log: /tmp/pi-wipe.log"
