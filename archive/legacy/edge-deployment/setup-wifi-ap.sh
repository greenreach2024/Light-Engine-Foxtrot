#!/bin/bash
# Setup reTerminal as WiFi Access Point for CODE3 Controller
# This creates an isolated farm network for direct device communication

set -e

echo "======================================"
echo " reTerminal WiFi AP Setup"
echo " Creates: GreenReach-Farm-XXXX Network"
echo "======================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "❌ Please run as root: sudo bash $0"
  exit 1
fi

# Configuration
SSID_PREFIX="GreenReach-Farm"
FARM_ID=$(hostname | cut -d'-' -f1)
SSID="${SSID_PREFIX}-${FARM_ID}"
PASSPHRASE="FarmSecure2026!"  # Change this to farm-specific password
CHANNEL=6
AP_IP="10.42.0.1"
DHCP_RANGE_START="10.42.0.10"
DHCP_RANGE_END="10.42.0.50"
INTERFACE="wlan0"

echo "Network Configuration:"
echo "  SSID: $SSID"
echo "  IP Range: 10.42.0.0/24"
echo "  Interface: $INTERFACE"
echo ""

# Install required packages
echo "📦 Installing hostapd and dnsmasq..."
apt-get update -qq
apt-get install -y hostapd dnsmasq iptables-persistent

# Stop services for configuration
systemctl stop hostapd || true
systemctl stop dnsmasq || true

# Configure static IP for WiFi interface
echo "🔧 Configuring static IP..."
cat > /etc/network/interfaces.d/wlan0 << EOF
auto wlan0
iface wlan0 inet static
    address $AP_IP
    netmask 255.255.255.0
EOF

# Configure hostapd (WiFi AP daemon)
echo "📡 Configuring WiFi Access Point..."
cat > /etc/hostapd/hostapd.conf << EOF
# reTerminal WiFi AP Configuration
interface=$INTERFACE
driver=nl80211
ssid=$SSID
hw_mode=g
channel=$CHANNEL
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=$PASSPHRASE
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP

# Optional: Restrict to specific MAC addresses (CODE3 controller)
# macaddr_acl=1
# accept_mac_file=/etc/hostapd/accept_mac
EOF

# Point hostapd to config file
sed -i 's|#DAEMON_CONF=""|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd

# Configure dnsmasq (DHCP server)
echo "🌐 Configuring DHCP server..."
mv /etc/dnsmasq.conf /etc/dnsmasq.conf.backup 2>/dev/null || true
cat > /etc/dnsmasq.conf << EOF
# reTerminal DHCP Configuration
interface=$INTERFACE
dhcp-range=$DHCP_RANGE_START,$DHCP_RANGE_END,255.255.255.0,24h
dhcp-option=3,$AP_IP  # Gateway
dhcp-option=6,$AP_IP  # DNS Server

# Static lease for CODE3 controller (optional - add MAC address)
# dhcp-host=AA:BB:CC:DD:EE:FF,10.42.0.20,code3-controller

# Log DHCP requests
log-dhcp
EOF

# Enable IP forwarding (if internet sharing needed via eth0)
echo "🔀 Enabling IP forwarding..."
sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf
sysctl -w net.ipv4.ip_forward=1

# Configure NAT (if internet access needed for devices on farm network)
# This allows CODE3 controller to get firmware updates while on farm network
echo "🔒 Configuring NAT..."
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
iptables -A FORWARD -i eth0 -o wlan0 -m state --state RELATED,ESTABLISHED -j ACCEPT
iptables -A FORWARD -i wlan0 -o eth0 -j ACCEPT
netfilter-persistent save

# Enable and start services
echo "🚀 Starting services..."
systemctl unmask hostapd
systemctl enable hostapd
systemctl enable dnsmasq

# Restart networking
echo "♻️  Restarting network services..."
systemctl daemon-reload
ifdown wlan0 2>/dev/null || true
sleep 2
ifup wlan0
sleep 2
systemctl restart hostapd
systemctl restart dnsmasq

echo ""
echo "✅ WiFi AP Setup Complete!"
echo ""
echo "======================================"
echo " Farm Network Details"
echo "======================================"
echo "SSID: $SSID"
echo "Password: $PASSPHRASE"
echo "reTerminal IP: $AP_IP"
echo "Device Range: $DHCP_RANGE_START - $DHCP_RANGE_END"
echo ""
echo "CODE3 Controller Setup:"
echo "1. Connect CODE3 controller to WiFi: $SSID"
echo "2. Controller will receive IP via DHCP"
echo "3. Test connectivity: ping 10.42.0.X"
echo "4. Update Light Engine config if needed"
echo ""
echo "View connected devices: sudo cat /var/lib/misc/dnsmasq.leases"
echo "Check AP status: sudo systemctl status hostapd"
echo "View DHCP logs: sudo tail -f /var/log/syslog | grep dnsmasq"
echo ""
