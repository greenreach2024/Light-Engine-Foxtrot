#!/bin/bash
# Deploy ESP32 Sensor Integration to Edge Device

set -e

EDGE_HOST="admin@100.65.187.59"
EDGE_PATH="/home/admin/light-engine"

echo "======================================"
echo " ESP32 Sensor Deployment"
echo "======================================"
echo ""
echo "Target: $EDGE_HOST"
echo "Path: $EDGE_PATH"
echo ""

# Check SSH connection
echo "Checking connection..."
if ! ssh -o ConnectTimeout=5 "$EDGE_HOST" "echo 'Connected'" > /dev/null 2>&1; then
    echo "✗ Cannot connect to edge device"
    exit 1
fi
echo "✓ Connected"
echo ""

# Copy sensor reader script
echo "Copying sensor integration script..."
scp scripts/esp32-to-env.py "$EDGE_HOST:$EDGE_PATH/scripts/"
ssh "$EDGE_HOST" "chmod +x $EDGE_PATH/scripts/esp32-to-env.py"
echo "✓ Script deployed"
echo ""

# Copy systemd service
echo "Installing systemd service..."
scp edge-deployment/esp32-sensor.service "$EDGE_HOST:/tmp/"
ssh "$EDGE_HOST" "sudo mv /tmp/esp32-sensor.service /etc/systemd/system/ && \
                 sudo systemctl daemon-reload"
echo "✓ Service installed"
echo ""

# Add user to dialout group (for USB serial access)
echo "Configuring USB serial permissions..."
ssh "$EDGE_HOST" "sudo usermod -a -G dialout admin || true"
echo "✓ User added to dialout group"
echo ""

# Check if ESP32 is connected
echo "Checking for ESP32..."
ESP32_PORT=$(ssh "$EDGE_HOST" "ls /dev/ttyUSB* 2>/dev/null | head -1" || echo "")
if [ -z "$ESP32_PORT" ]; then
    echo "⚠ ESP32 not detected yet"
    echo ""
    echo "Please plug in ESP32 to USB port, then run:"
    echo "  ssh $EDGE_HOST"
    echo "  sudo systemctl start esp32-sensor"
    echo "  sudo systemctl status esp32-sensor"
else
    echo "✓ ESP32 detected at $ESP32_PORT"
    echo ""
    
    # Start service
    echo "Starting sensor service..."
    ssh "$EDGE_HOST" "sudo systemctl enable esp32-sensor && \
                     sudo systemctl restart esp32-sensor"
    echo "✓ Service started"
    echo ""
    
    # Show status
    echo "Service status:"
    ssh "$EDGE_HOST" "sudo systemctl status esp32-sensor --no-pager -l" || true
fi

echo ""
echo "======================================"
echo " Deployment Complete"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Plug ESP32 into edge device USB port"
echo "2. Check status: ssh $EDGE_HOST 'sudo systemctl status esp32-sensor'"
echo "3. View logs: ssh $EDGE_HOST 'sudo journalctl -u esp32-sensor -f'"
echo "4. Check env.json: ssh $EDGE_HOST 'cat $EDGE_PATH/public/data/env.json'"
echo ""
echo "After 72 hours of data collection:"
echo "  ssh $EDGE_HOST 'cd $EDGE_PATH && source venv/bin/activate && python3 backend/predictive_forecast.py --zone main --hours 4'"
echo ""
