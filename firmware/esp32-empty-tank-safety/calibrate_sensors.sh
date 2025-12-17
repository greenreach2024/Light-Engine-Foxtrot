#!/bin/bash
# Automated sensor calibration script for ESP32 Atlas EZO sensors
# Usage: ./calibrate_sensors.sh [serial_port]
# Default port: /dev/cu.usbserial-02898B21

SERIAL_PORT="${1:-/dev/cu.usbserial-02898B21}"
BAUD_RATE=115200

echo "🔧 ESP32 Sensor Calibration Script"
echo "=================================="
echo "Serial port: $SERIAL_PORT"
echo ""

# Function to send command and wait
send_command() {
    local cmd="$1"
    local wait_time="${2:-3}"
    echo "📤 Sending: $cmd"
    echo "$cmd" > "$SERIAL_PORT"
    sleep "$wait_time"
}

# Check if port exists
if [ ! -e "$SERIAL_PORT" ]; then
    echo "❌ Error: Serial port $SERIAL_PORT not found"
    exit 1
fi

# Configure serial port
stty -f "$SERIAL_PORT" "$BAUD_RATE"

echo "Step 1: Clearing pH calibration..."
send_command "PHCAL CLEAR" 2

echo ""
echo "Step 2: pH MID point calibration (6.90)..."
echo "   → Ensure probe is in pH 6.9 buffer"
send_command "PHCAL MID 6.90" 3

echo ""
echo "Step 3: pH LOW point calibration (4.00)..."
echo "   → Ensure probe is in pH 4.0 buffer"
send_command "PHCAL LOW 4.00" 3

echo ""
echo "Step 4: pH HIGH point calibration (9.28)..."
echo "   → Ensure probe is in pH 9.28 buffer"
send_command "PHCAL HIGH 9.28" 3

echo ""
echo "Step 5: Checking pH calibration state..."
send_command "PHCAL STATE" 2

echo ""
echo "Step 6: EC calibration (1413 µS/cm)..."
echo "   → Ensure EC probe is in 1413 solution"
send_command "ECCAL ONE 1413" 3

echo ""
echo "Step 7: Checking EC calibration state..."
send_command "ECCAL STATE" 2

echo ""
echo "Step 8: Reading all sensors..."
send_command "SENSORS" 2

echo ""
echo "✅ Calibration sequence complete!"
echo "Check the serial monitor output above for confirmation messages."
