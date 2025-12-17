#!/bin/bash

# Light Engine Charlie - Raspberry Pi WiFi Setup Helper
# Configures WiFi credentials on Raspberry Pi

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Light Engine Charlie - WiFi Setup Helper              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ This script must be run with sudo${NC}"
    echo "Usage: sudo ./wifi-setup-pi.sh"
    exit 1
fi

# Check if NetworkManager is available (preferred method)
if command -v nmcli >/dev/null 2>&1; then
    USE_NMCLI=true
    echo -e "${GREEN}✅ NetworkManager detected${NC}"
else
    USE_NMCLI=false
    echo -e "${YELLOW}⚠️  NetworkManager not found, will use wpa_supplicant${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Scanning for WiFi Networks...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Scan for networks
if [ "$USE_NMCLI" = true ]; then
    echo ""
    nmcli device wifi list
    echo ""
else
    echo ""
    iwlist wlan0 scan | grep -E "ESSID|Quality|Encryption" | head -30
    echo ""
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Configure WiFi Connection${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Get SSID
echo ""
read -p "Enter WiFi SSID (network name): " SSID

if [ -z "$SSID" ]; then
    echo -e "${RED}❌ SSID cannot be empty${NC}"
    exit 1
fi

# Get password
echo ""
read -s -p "Enter WiFi password: " PASSWORD
echo ""

if [ -z "$PASSWORD" ]; then
    echo -e "${RED}❌ Password cannot be empty${NC}"
    exit 1
fi

# Confirm
echo ""
echo -e "${YELLOW}WiFi Configuration:${NC}"
echo -e "  SSID: ${BLUE}$SSID${NC}"
echo -e "  Password: ${BLUE}********${NC}"
echo ""
read -p "Connect to this network? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⚠️  WiFi setup cancelled${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Connecting to WiFi...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

if [ "$USE_NMCLI" = true ]; then
    # Use NetworkManager
    echo -e "${BLUE}📡 Connecting via NetworkManager...${NC}"
    
    # Delete existing connection with same SSID if it exists
    nmcli connection delete "$SSID" 2>/dev/null || true
    
    # Connect to WiFi
    if nmcli device wifi connect "$SSID" password "$PASSWORD"; then
        echo -e "${GREEN}✅ Successfully connected to $SSID${NC}"
    else
        echo -e "${RED}❌ Failed to connect to $SSID${NC}"
        exit 1
    fi
else
    # Use wpa_supplicant (fallback)
    echo -e "${BLUE}📡 Configuring via wpa_supplicant...${NC}"
    
    # Generate wpa_supplicant configuration
    WPA_CONFIG="/etc/wpa_supplicant/wpa_supplicant.conf"
    
    # Check if config exists
    if [ ! -f "$WPA_CONFIG" ]; then
        echo -e "${YELLOW}⚠️  Creating wpa_supplicant.conf...${NC}"
        cat > "$WPA_CONFIG" << EOF
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=US

EOF
    fi
    
    # Add network configuration
    echo -e "${BLUE}📝 Adding network to wpa_supplicant.conf...${NC}"
    
    wpa_passphrase "$SSID" "$PASSWORD" >> "$WPA_CONFIG"
    
    # Restart wpa_supplicant
    echo -e "${BLUE}🔄 Restarting networking...${NC}"
    wpa_cli -i wlan0 reconfigure
    
    # Wait for connection
    sleep 5
    
    # Check if connected
    if iwgetid -r 2>/dev/null | grep -q "$SSID"; then
        echo -e "${GREEN}✅ Successfully connected to $SSID${NC}"
    else
        echo -e "${YELLOW}⚠️  Connection status unclear, please check manually${NC}"
        echo -e "${YELLOW}    Run: iwconfig wlan0${NC}"
    fi
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Network Status${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Show connection status
sleep 2

if [ "$USE_NMCLI" = true ]; then
    echo ""
    nmcli device status
    echo ""
    echo -e "${BLUE}Active connections:${NC}"
    nmcli connection show --active
else
    echo ""
    iwconfig wlan0 2>/dev/null || echo "wlan0 not found"
fi

# Show IP address
echo ""
IP_ADDR=$(ip -4 addr show wlan0 2>/dev/null | grep inet | awk '{print $2}' | cut -d'/' -f1)

if [ -n "$IP_ADDR" ]; then
    echo -e "${GREEN}✅ IP Address: $IP_ADDR${NC}"
    echo ""
    echo -e "${GREEN}Access Light Engine Charlie at:${NC}"
    echo -e "  ${BLUE}http://$(hostname).local:8091${NC}"
    echo -e "  ${BLUE}http://$IP_ADDR:8091${NC}"
else
    echo -e "${YELLOW}⚠️  No IP address assigned yet${NC}"
    echo -e "${YELLOW}    Wait a moment and check with: ip addr show wlan0${NC}"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ WiFi Setup Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}To verify connection:${NC}"
echo "  ${YELLOW}ping -c 3 8.8.8.8${NC}"
echo ""
echo -e "${BLUE}To view saved networks:${NC}"
if [ "$USE_NMCLI" = true ]; then
    echo "  ${YELLOW}nmcli connection show${NC}"
else
    echo "  ${YELLOW}cat /etc/wpa_supplicant/wpa_supplicant.conf${NC}"
fi
echo ""
