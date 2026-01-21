#!/bin/bash
# ESP32 Firmware Upload Script for Light Engine Foxtrot

set -e

FIRMWARE_DIR="/Users/petergilbert/Light-Engine-Foxtrot/esp32-firmware/dual-sensor"
SERIAL_PORT="/dev/cu.usbserial-0001"

cd "$FIRMWARE_DIR"

echo "======================================"
echo " ESP32 Dual Sensor Firmware Upload"
echo "======================================"
echo ""

# Check if PlatformIO is installed
if ! command -v pio &> /dev/null; then
    echo "⚠️  PlatformIO not found. Installing..."
    pip3 install -U platformio
    echo "✓ PlatformIO installed"
    echo ""
fi

# Check ESP32 connection
if [ ! -e "$SERIAL_PORT" ]; then
    echo "❌ ERROR: ESP32 not found at $SERIAL_PORT"
    echo ""
    echo "Available ports:"
    ls -la /dev/cu.* 2>/dev/null | grep -v Bluetooth || echo "  (none)"
    echo ""
    exit 1
fi

echo "✓ ESP32 detected at $SERIAL_PORT"
echo ""

# Build and upload
echo "Building firmware..."
pio run

echo ""
echo "Uploading to ESP32..."
pio run --target upload --upload-port "$SERIAL_PORT"

echo ""
echo "======================================"
echo "✓ Upload Complete!"
echo "======================================"
echo ""
echo "To monitor serial output:"
echo "  screen $SERIAL_PORT 115200"
echo ""
echo "Or use the Python reader:"
echo "  python3 scripts/esp32-sensor-reader.py"
echo ""
