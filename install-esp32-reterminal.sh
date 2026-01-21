#!/bin/bash
# ESP32 Sensor Quick Install for reTerminal
# Run this on the reTerminal: bash install-esp32.sh

set -e

echo "=== ESP32 Sensor Installation ==="
echo ""

# Create directories
mkdir -p /home/greenreach/light-engine/scripts
mkdir -p /home/greenreach/light-engine/public/data
echo "✓ Directories created"

# Download sensor script from Mac (you'll need to transfer this file first)
# For now, we'll check if it exists
if [ -f "/home/greenreach/esp32-to-env.py" ]; then
    cp /home/greenreach/esp32-to-env.py /home/greenreach/light-engine/scripts/
    chmod +x /home/greenreach/light-engine/scripts/esp32-to-env.py
    echo "✓ Sensor script installed"
else
    echo "✗ esp32-to-env.py not found in /home/greenreach/"
    echo "Please copy it first using scp"
    exit 1
fi

# Create systemd service
sudo tee /etc/systemd/system/esp32-sensor.service > /dev/null << 'SERVICE_EOF'
[Unit]
Description=ESP32 Environmental Sensor Reader
After=network.target
Wants=network.target

[Service]
Type=simple
User=greenreach
Group=greenreach
WorkingDirectory=/home/greenreach/light-engine
ExecStart=/usr/bin/python3 /home/greenreach/light-engine/scripts/esp32-to-env.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE_EOF

echo "✓ Service file created"

# Add user to dialout group
sudo usermod -a -G dialout greenreach
echo "✓ User added to dialout group"

# Reload and start service
sudo systemctl daemon-reload
sudo systemctl enable esp32-sensor
sudo systemctl start esp32-sensor
echo "✓ Service started"

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Check status: sudo systemctl status esp32-sensor"
echo "View logs: sudo journalctl -u esp32-sensor -f"
echo "Check data: cat /home/greenreach/light-engine/public/data/env.json"
