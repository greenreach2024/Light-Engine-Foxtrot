#!/bin/bash

# Light Engine Charlie - Simple WiFi Setup for Raspberry Pi
# Works with standard Raspberry Pi OS (dhcpcd + wpa_supplicant)

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Light Engine Charlie - WiFi Setup (Pi OS)             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ This script must be run with sudo${NC}"
    echo "Usage: sudo ./wifi-setup-simple.sh"
    exit 1
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Scanning for WiFi Networks...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Scan for networks using iwlist
echo -e "${BLUE}📡 Scanning...${NC}"
echo ""

# Bring up wlan0 if down
ip link set wlan0 up 2>/dev/null || true
sleep 2

# Scan with iwlist
if command -v iwlist >/dev/null 2>&1; then
    iwlist wlan0 scan 2>/dev/null | grep -E "ESSID|Quality|Encryption|IEEE" | head -40
else
    echo -e "${YELLOW}⚠️  iwlist not available${NC}"
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
read -s -p "Enter WiFi password (leave blank for open network): " PASSWORD
echo ""

# Confirm
echo ""
echo -e "${YELLOW}WiFi Configuration:${NC}"
echo -e "  SSID: ${BLUE}$SSID${NC}"
if [ -n "$PASSWORD" ]; then
    echo -e "  Password: ${BLUE}********${NC}"
else
    echo -e "  Password: ${YELLOW}(open network)${NC}"
fi
echo ""
read -p "Save this configuration? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⚠️  WiFi setup cancelled${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Configuring WiFi...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

WPA_CONFIG="/etc/wpa_supplicant/wpa_supplicant.conf"

# Backup existing config
if [ -f "$WPA_CONFIG" ]; then
    echo -e "${BLUE}💾 Backing up existing configuration...${NC}"
    cp "$WPA_CONFIG" "${WPA_CONFIG}.backup.$(date +%Y%m%d-%H%M%S)"
fi

# Create or update wpa_supplicant.conf
echo -e "${BLUE}📝 Writing configuration...${NC}"

# Check if config has ctrl_interface header
if ! grep -q "ctrl_interface=" "$WPA_CONFIG" 2>/dev/null; then
    echo -e "${BLUE}Creating new wpa_supplicant.conf...${NC}"
    cat > "$WPA_CONFIG" << 'EOF'
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=US

EOF
fi

# Remove existing network with same SSID
sed -i "/network={/,/}/{ /ssid=\"$SSID\"/,/}/d }" "$WPA_CONFIG" 2>/dev/null || true

# Add new network configuration
echo "" >> "$WPA_CONFIG"

if [ -n "$PASSWORD" ]; then
    # Encrypted network
    echo -e "${BLUE}Generating encrypted PSK...${NC}"
    wpa_passphrase "$SSID" "$PASSWORD" >> "$WPA_CONFIG"
else
    # Open network
    cat >> "$WPA_CONFIG" << EOF
network={
    ssid="$SSID"
    key_mgmt=NONE
}
EOF
fi

echo -e "${GREEN}✅ Configuration saved${NC}"

# Restart networking
echo ""
echo -e "${BLUE}🔄 Restarting WiFi...${NC}"

# Kill existing wpa_supplicant processes
killall wpa_supplicant 2>/dev/null || true
sleep 1

# Bring down and up wlan0
ip link set wlan0 down
sleep 1
ip link set wlan0 up
sleep 2

# Start wpa_supplicant
wpa_supplicant -B -i wlan0 -c "$WPA_CONFIG" -D nl80211,wext

# Wait for connection
echo -e "${BLUE}⏳ Waiting for connection...${NC}"
sleep 5

# Request DHCP lease
dhclient -r wlan0 2>/dev/null || true
dhclient wlan0 2>/dev/null || true

# Or use dhcpcd if dhclient not available
if ! command -v dhclient >/dev/null 2>&1; then
    dhcpcd wlan0 2>/dev/null || true
fi

sleep 3

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Connection Status${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Check if connected
CONNECTED_SSID=$(iwgetid -r 2>/dev/null || echo "")

if [ "$CONNECTED_SSID" = "$SSID" ]; then
    echo -e "${GREEN}✅ Connected to: $SSID${NC}"
else
    echo -e "${YELLOW}⚠️  Connected to: ${CONNECTED_SSID:-none}${NC}"
    if [ "$CONNECTED_SSID" != "$SSID" ]; then
        echo -e "${YELLOW}⚠️  Expected: $SSID${NC}"
    fi
fi

# Show WiFi interface details
echo ""
echo -e "${BLUE}WiFi Interface Status:${NC}"
iwconfig wlan0 2>/dev/null | grep -E "ESSID|Quality|Bit Rate"

# Get IP address
echo ""
IP_ADDR=$(ip -4 addr show wlan0 2>/dev/null | grep inet | awk '{print $2}' | cut -d'/' -f1)

if [ -n "$IP_ADDR" ]; then
    echo -e "${GREEN}✅ IP Address: $IP_ADDR${NC}"
    
    # Test internet connectivity
    echo ""
    echo -e "${BLUE}Testing internet connectivity...${NC}"
    if ping -c 2 8.8.8.8 >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Internet connection working${NC}"
    else
        echo -e "${YELLOW}⚠️  No internet connectivity${NC}"
    fi
    
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     ✅ WiFi Setup Complete!                                 ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}Access Light Engine Charlie at:${NC}"
    echo -e "  ${BLUE}http://$(hostname).local:8091${NC}"
    echo -e "  ${BLUE}http://$IP_ADDR:8091${NC}"
else
    echo -e "${YELLOW}⚠️  No IP address assigned${NC}"
    echo ""
    echo -e "${YELLOW}Troubleshooting:${NC}"
    echo "1. Check WiFi password is correct"
    echo "2. Ensure router is in range"
    echo "3. Try rebooting: ${BLUE}sudo reboot${NC}"
    echo "4. Check logs: ${BLUE}sudo journalctl -u wpa_supplicant -n 50${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Additional Commands${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "View saved networks:"
echo "  ${YELLOW}sudo cat /etc/wpa_supplicant/wpa_supplicant.conf${NC}"
echo ""
echo "Check WiFi status:"
echo "  ${YELLOW}iwconfig wlan0${NC}"
echo ""
echo "Check IP address:"
echo "  ${YELLOW}ip addr show wlan0${NC}"
echo ""
echo "Reconnect WiFi:"
echo "  ${YELLOW}sudo wpa_cli -i wlan0 reconfigure${NC}"
echo ""
