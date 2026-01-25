# reTerminal WiFi Access Point Setup

## Overview

Configure the reTerminal (Raspberry Pi CM4) to create its own WiFi network for direct communication with CODE3 controllers and other farm devices. This eliminates dependency on facility WiFi and creates an isolated, farm-controlled network.

## Architecture

**Before (Current):**
```
[CODE3] --WiFi--> [Facility Router] <--WiFi-- [reTerminal]
```

**After (Isolated Farm Network):**
```
[CODE3] --WiFi--> [reTerminal WiFi AP] --Ethernet--> [Internet]
                        ^
                        |-- [ESP32 Sensors]
                        |-- [Other Farm Devices]
```

## Benefits

✅ **No Facility WiFi Dependency** - Farm network operates independently  
✅ **Lower Latency** - Direct communication, no router hops  
✅ **Better Security** - Isolated network, controlled access  
✅ **Easier Deployment** - No need to configure facility network  
✅ **Predictable IPs** - Static DHCP leases for devices  
✅ **Mobile Operation** - Works in greenhouses without existing WiFi

## Hardware Requirements

- **reTerminal** with built-in WiFi (CM4 Wireless variant)
- **Ethernet connection** for internet access (optional but recommended)
- **CODE3 Controller** or other WiFi-capable devices

## Installation

### Step 1: Deploy Setup Script

```bash
# Copy script to reTerminal
scp edge-deployment/setup-wifi-ap.sh greenreach@EDGE_IP:~/

# Run setup (requires root)
ssh greenreach@EDGE_IP
sudo bash setup-wifi-ap.sh
```

### Step 2: Verify WiFi AP is Running

```bash
# Check hostapd status
sudo systemctl status hostapd

# View connected devices
sudo cat /var/lib/misc/dnsmasq.leases

# Check WiFi interface
ip addr show wlan0
```

### Step 3: Connect CODE3 Controller

1. **Access CODE3 web interface** (currently on facility WiFi)
2. **WiFi Settings** → Change network
3. **Connect to:** `GreenReach-Farm-XXXX`
4. **Password:** `FarmSecure2026!` (or custom password)
5. **Wait 30 seconds** for DHCP lease
6. **Find new IP:** Check dnsmasq leases or scan 10.42.0.0/24

### Step 4: Update Light Engine Configuration

If CODE3 controller IP changed, update the configuration:

```bash
# Check current Grow3 proxy target
grep -A 5 'grow3Target' ~/Light-Engine-Foxtrot/server-foxtrot.js

# Test new CODE3 IP
curl http://10.42.0.20/api/status  # Replace with actual IP

# If IP changed, update in code or use dynamic discovery
```

## Network Configuration

| Setting | Value |
|---------|-------|
| **SSID** | GreenReach-Farm-XXXX |
| **Password** | FarmSecure2026! |
| **reTerminal IP** | 10.42.0.1 |
| **DHCP Range** | 10.42.0.10 - 10.42.0.50 |
| **Subnet** | 10.42.0.0/24 |
| **Channel** | 6 (2.4GHz) |

## Static IP Assignment (Optional)

For predictable device IPs, assign static DHCP leases:

```bash
# Get CODE3 MAC address
sudo cat /var/lib/misc/dnsmasq.leases

# Edit dnsmasq config
sudo nano /etc/dnsmasq.conf

# Add static lease (replace MAC with actual)
dhcp-host=AA:BB:CC:DD:EE:FF,10.42.0.20,code3-controller,infinite

# Restart dnsmasq
sudo systemctl restart dnsmasq
```

## Security Enhancements

### 1. MAC Address Filtering

Restrict network to known devices only:

```bash
# Edit hostapd config
sudo nano /etc/hostapd/hostapd.conf

# Enable MAC filtering
macaddr_acl=1
accept_mac_file=/etc/hostapd/accept_mac

# Create whitelist
sudo nano /etc/hostapd/accept_mac
# Add CODE3 MAC: AA:BB:CC:DD:EE:FF

sudo systemctl restart hostapd
```

### 2. Change Default Password

```bash
sudo nano /etc/hostapd/hostapd.conf
# Change wpa_passphrase to farm-specific password
sudo systemctl restart hostapd
```

### 3. Disable Internet Access (Air-Gapped Mode)

If farm network should be completely isolated:

```bash
# Disable NAT forwarding
sudo iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
sudo netfilter-persistent save
```

## Troubleshooting

### WiFi AP Not Starting

```bash
# Check hostapd logs
sudo journalctl -u hostapd -f

# Test config
sudo hostapd -d /etc/hostapd/hostapd.conf

# Check WiFi interface
sudo rfkill list
sudo rfkill unblock wifi
```

### Devices Can't Connect

```bash
# Verify dnsmasq is running
sudo systemctl status dnsmasq

# Check DHCP logs
sudo tail -f /var/log/syslog | grep dnsmasq

# Test DHCP manually
sudo dnsmasq --test
```

### CODE3 Controller Not Reachable

```bash
# Scan farm network
sudo nmap -sn 10.42.0.0/24

# Check connected devices
sudo cat /var/lib/misc/dnsmasq.leases

# Ping test
ping 10.42.0.20  # Replace with controller IP
```

## Performance Considerations

- **2.4GHz vs 5GHz**: CODE3 uses 2.4GHz (better range, walls)
- **Channel Selection**: Use channel 1, 6, or 11 to avoid overlap
- **WiFi Scanner**: Check for interference from nearby networks
- **Range**: ~30-50m indoors, 100m+ outdoors
- **Throughput**: 50-100 Mbps typical (sufficient for DMX512 control)

## Advanced: Dual WiFi Setup

If reTerminal has both built-in WiFi (wlan0) and USB WiFi adapter (wlan1):

- **wlan0**: Farm AP (devices connect here)
- **wlan1**: Connect to facility WiFi (internet access)

This provides internet without Ethernet cable.

## Integration with Light Engine

The Light Engine automatically detects devices on the farm network. No code changes needed if using mDNS/Bonjour discovery.

For manual configuration:

```javascript
// In server-foxtrot.js or .env
CODE3_CONTROLLER_IP=10.42.0.20
```

## Maintenance

```bash
# View WiFi AP status
sudo systemctl status hostapd

# Restart WiFi AP
sudo systemctl restart hostapd

# View connected devices in real-time
watch -n 1 'sudo cat /var/lib/misc/dnsmasq.leases'

# Check WiFi signal strength (from connected device)
iw dev wlan0 link
```

## Reverting to Facility WiFi

If you need to switch back:

```bash
# Stop AP services
sudo systemctl stop hostapd
sudo systemctl stop dnsmasq
sudo systemctl disable hostapd
sudo systemctl disable dnsmasq

# Restore DHCP on wlan0
sudo rm /etc/network/interfaces.d/wlan0
sudo systemctl restart networking

# Reconnect to facility WiFi
sudo nmcli device wifi connect "FacilitySSID" password "password"
```

## Future: Cellular Backup

For farms without reliable internet, add USB cellular modem:

```bash
# PPP connection via USB modem
# Routes through ppp0 instead of eth0
# Automatic failover if Ethernet drops
```

## Support

For deployment assistance or custom network configurations, contact the GreenReach engineering team.
