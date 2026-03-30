# Thermal Printer & QR Label Setup Guide

## Overview

Complete guide for setting up thermal printers and generating QR code labels for production use. The software infrastructure is already built - this document covers hardware setup, configuration, and testing.

---

## 🎯 Quick Summary

**What You'll Need:**
- Thermal label printer (Zebra, Brother, or DYMO)
- Waterproof label rolls (2" x 1" or 2" x 3")
- USB cable or network connection
- 15 minutes for setup

**What You'll Get:**
- Automatic QR code label printing
- Tray tracking labels
- Harvest lot labels  
- Wholesale packing labels
- Print queue management

**Cost:**
- Printer: $100-400 (one-time)
- Labels: $15-30 per 500 labels
- Setup time: 15 minutes

---

## 📦 Hardware Options

### Option 1: Brother QL-820NWB (Recommended - $200)

**Pros:**
- Easy setup (plug & play)
- WiFi + Bluetooth + USB connectivity
- Continuous tape (flexible label sizes)
- Quiet operation
- No driver installation needed

**Cons:**
- Slightly more expensive labels ($30 per 300)
- Smaller print area (2.4" max width)

**Best For:** Farm offices, mobile setup, multiple workstations

**Where to Buy:**
- Amazon: $200
- Staples/Office Depot: $220
- Brother.com: $230

### Option 2: Zebra GX430t (Industrial - $300)

**Pros:**
- Extremely durable (built for 24/7 use)
- Fast printing (4 inches per second)
- Wide format support (up to 4")
- Industry standard (ZPL language)
- Cheap labels ($15 per 500)

**Cons:**
- Requires driver installation
- USB or Ethernet only (no WiFi)
- Louder operation
- More complex setup

**Best For:** High-volume operations, warehouse packing stations

**Where to Buy:**
- Amazon: $280-320
- Newegg: $300
- ZebraStore: $350

### Option 3: DYMO LabelWriter 4XL (Budget - $120)

**Pros:**
- Most affordable
- Simple USB setup
- 4" wide labels (good for packing labels)
- Compact footprint

**Cons:**
- USB only (no network)
- Proprietary DYMO labels (more expensive)
- Slower print speed
- Consumer-grade durability

**Best For:** Low-volume operations, starter setup

**Where to Buy:**
- Amazon: $120
- Best Buy: $130
- Staples: $140

---

## 🏷️ Label Options

### Waterproof Labels (Recommended)

**For Tray Tracking:**
- **Size:** 2" x 3"
- **Material:** Polypropylene or polyester
- **Adhesive:** Permanent waterproof
- **Cost:** $25-35 per 500 labels
- **Why:** Resistant to water, humidity, UV

**Recommended Products:**
- Brother DK-2205 (2.4" continuous): $30/300 labels
- Zebra 10010045 (2" x 3"): $20/500 labels
- DYMO 1744907 (4" x 6"): $40/220 labels

### Standard Paper Labels (Budget Option)

**For Indoor Use Only:**
- **Size:** 2" x 1" or 2" x 3"
- **Material:** Thermal paper
- **Cost:** $15-20 per 500 labels
- **Limitation:** Not waterproof, fades over time

**When to Use:**
- Office printing
- Short-term labels
- Indoor storage only

---

## 🔧 Hardware Setup

### USB Printer Setup (macOS/Linux)

#### 1. Connect Printer

```bash
# Connect USB cable
# Turn on printer

# Check printer detected
lpstat -p -d

# Expected output:
# printer Zebra_GX430 is idle
# printer Brother_QL_820NWB is idle
```

#### 2. Install Drivers (if needed)

**Zebra:**
```bash
# macOS
# Download drivers from zebra.com/drivers
# Install .pkg file
# Restart computer

# Linux (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install printer-driver-all cups
sudo systemctl restart cups
```

**Brother:**
```bash
# macOS
# Download Brother P-touch Editor from brother.com
# Install .dmg file
# Printer will auto-configure

# Linux
sudo apt-get install printer-driver-ptouch
```

#### 3. Configure Printer

```bash
# Set as default printer (optional)
lpoptions -d Zebra_GX430

# Set raw mode (important for ZPL)
lpadmin -p Zebra_GX430 -o raw

# Test print
echo "^XA^FO50,50^A0N,50,50^FDTEST^FS^XZ" | lp -d Zebra_GX430 -o raw
```

### Network Printer Setup (Recommended for Production)

#### 1. Configure Printer Network

**Zebra GX430t:**
1. Press Setup button (hold 2 seconds)
2. Select "Network Settings"
3. Configure:
   - DHCP: Enable (or set static IP)
   - IP Address: 192.168.1.100 (example)
   - Subnet: 255.255.255.0
   - Gateway: 192.168.1.1
4. Print network config label to verify

**Brother QL-820NWB:**
1. Press WiFi button
2. Select your network from display
3. Enter WiFi password
4. Note IP address on display (e.g., 192.168.1.105)
5. Test from browser: http://192.168.1.105

#### 2. Test Network Connection

```bash
# Test TCP connection
telnet 192.168.1.100 9100

# Send test ZPL (after connected)
^XA^FO50,50^A0N,50,50^FDNETWORK TEST^FS^XZ
^C

# Exit telnet
Ctrl+]
quit
```

#### 3. Configure in Application

Edit `.env` or set environment variables:

```bash
# For local development
PRINTER_CONNECTION=network
PRINTER_HOST=192.168.1.100
PRINTER_PORT=9100
PRINTER_TYPE=zebra

# For production (Elastic Beanstalk)
eb setenv \
  PRINTER_CONNECTION=network \
  PRINTER_HOST=192.168.1.100 \
  PRINTER_PORT=9100 \
  PRINTER_TYPE=zebra
```

---

## 🧪 Testing Printer Setup

### Test via API

#### 1. Start Server

```bash
npm start
# Server running on port 8091
```

#### 2. Test Printer Connection

**USB Printer:**
```bash
curl -X POST http://localhost:8091/api/printer/test \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "usb",
    "printerName": "Zebra_GX430"
  }'

# Expected response:
# {"success":true,"message":"Test label sent to USB printer"}
```

**Network Printer:**
```bash
curl -X POST http://localhost:8091/api/printer/test \
  -H "Content-Type: application/json" \
  -d '{
    "connection": "network",
    "host": "192.168.1.100",
    "port": 9100
  }'

# Expected response:
# {"success":true,"message":"Test label sent to 192.168.1.100:9100"}
```

#### 3. Print Sample Tray Label

```bash
curl -X POST http://localhost:8091/api/printer/print-tray \
  -H "Content-Type: application/json" \
  -d '{
    "code": "FARM-TRAY-0001",
    "farmName": "GreenReach Farms",
    "connection": "network",
    "host": "192.168.1.100",
    "format": "zpl"
  }'

# Expected response:
# {
#   "success": true,
#   "jobId": "job-1735689600000-abc123",
#   "message": "Print job queued",
#   "queuePosition": 1
# }
```

#### 4. Check Print Queue

```bash
curl http://localhost:8091/api/printer/queue

# Expected response:
# {
#   "queue": [{
#     "id": "job-1735689600000-abc123",
#     "status": "completed",
#     "metadata": {"code": "FARM-TRAY-0001"}
#   }],
#   "pending": 0,
#   "processing": 0,
#   "completed": 1
# }
```

### Test via Web Interface

1. Go to: http://localhost:8091/farm-sales.html
2. Click "Print Test Label" (if available)
3. Or use browser console:

```javascript
// Test printer
fetch('/api/printer/test', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    connection: 'network',
    host: '192.168.1.100'
  })
}).then(r => r.json()).then(console.log);

// Print tray label
fetch('/api/printer/print-tray', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    code: 'TRAY-TEST-001',
    farmName: 'Test Farm',
    connection: 'network',
    host: '192.168.1.100'
  })
}).then(r => r.json()).then(console.log);
```

---

## 📋 Label Types

### 1. Tray Labels (2" x 3")

**Purpose:** Track growing trays from seed to harvest

**Contains:**
- QR code (scannable)
- Tray code (FARM-TRAY-####)
- Farm name
- Print date

**When to Print:**
- When new trays are added to system
- When replacing damaged labels
- Batch printing: 500-1000 at once

**API Example:**
```bash
curl -X POST http://localhost:8091/api/printer/print-tray \
  -H "Content-Type: application/json" \
  -d '{
    "code": "FARM-TRAY-1005",
    "farmName": "GreenReach Farms",
    "connection": "network",
    "host": "192.168.1.100"
  }'
```

### 2. Harvest Labels (2" x 1")

**Purpose:** Track harvested lots for traceability

**Contains:**
- QR code (scannable)
- Lot code (LOT-2025-12-31-1200)
- Crop name
- Weight and unit
- Harvest date

**When to Print:**
- Immediately after harvest
- Before placing in cooler
- Before packing for wholesale

**API Example:**
```bash
curl -X POST http://localhost:8091/api/printer/print-harvest \
  -H "Content-Type: application/json" \
  -d '{
    "lotCode": "LOT-2025-12-31-1200",
    "cropName": "Lettuce - Green Oakleaf",
    "weight": 2.5,
    "unit": "kg",
    "connection": "network",
    "host": "192.168.1.100"
  }'
```

### 3. Packing Labels (4" x 6")

**Purpose:** Wholesale orders shipping labels

**Contains:**
- Order ID
- Buyer name
- Item list (multi-line)
- Large QR code for traceability
- "Scan for traceability" text

**When to Print:**
- During order fulfillment
- Before boxing shipment
- With invoice

**API Example:**
```bash
curl -X POST http://localhost:8091/api/printer/print-packing \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "ORD-12345",
    "buyer": "Whole Foods Market",
    "items": ["5 lbs Lettuce - Green Oakleaf", "3 lbs Kale - Tuscan"],
    "qrData": "ORDER:ORD-12345",
    "connection": "network",
    "host": "192.168.1.100"
  }'
```

---

## 🏭 Production Workflow

### Bulk Label Generation

For initial setup, print 500-1000 tray labels at once:

#### 1. Use QR Generator Tool

Go to: http://localhost:8091/qr-generator.html

1. **Start Number:** 1000 (or next available)
2. **Count:** 500
3. **Format:** Labels (PDF)
4. **Prefix:** FARM-TRAY-
5. Click **Generate**

This creates a PDF with 500 QR code labels.

#### 2. Batch Print via API

```bash
# Generate codes 1000-1499
for i in {1000..1499}; do
  curl -X POST http://localhost:8091/api/printer/print-tray \
    -H "Content-Type: application/json" \
    -d "{
      \"code\": \"FARM-TRAY-$(printf %04d $i)\",
      \"farmName\": \"GreenReach Farms\",
      \"connection\": \"network\",
      \"host\": \"192.168.1.100\"
    }"
  sleep 0.5  # 500ms between prints
done
```

**Time:** ~4-5 minutes for 500 labels

#### 3. Batch Print via Script

Create `scripts/batch-print-labels.js`:

```javascript
#!/usr/bin/env node
import fetch from 'node-fetch';

const PRINTER_HOST = '192.168.1.100';
const START = 1000;
const COUNT = 500;
const FARM_NAME = 'GreenReach Farms';

async function printLabel(code) {
  const response = await fetch('http://localhost:8091/api/printer/print-tray', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      code,
      farmName: FARM_NAME,
      connection: 'network',
      host: PRINTER_HOST
    })
  });
  
  const result = await response.json();
  console.log(`Printed: ${code} - Job ID: ${result.jobId}`);
}

async function main() {
  console.log(`Printing ${COUNT} labels starting from ${START}...`);
  
  for (let i = START; i < START + COUNT; i++) {
    const code = `FARM-TRAY-${String(i).padStart(4, '0')}`;
    await printLabel(code);
    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
  }
  
  console.log('Done!');
}

main();
```

Run:
```bash
chmod +x scripts/batch-print-labels.js
node scripts/batch-print-labels.js
```

### Daily Operations

**Morning Harvest:**
```bash
# Print harvest labels as you harvest
# Scan tray QR → Record harvest → Print lot label → Apply to container
```

**Wholesale Packing:**
```bash
# Fulfill order → Print packing label → Attach to box → Ship
```

**Tray Replacement:**
```bash
# Damaged label? → Print replacement on-demand
```

---

## 🐛 Troubleshooting

### Printer Not Detected (USB)

**Symptoms:** `lpstat -p` doesn't show printer

**Solutions:**
```bash
# 1. Check USB connection
system_profiler SPUSBDataType | grep -i zebra

# 2. Restart CUPS
sudo launchctl stop org.cups.cupsd
sudo launchctl start org.cups.cupsd

# 3. Add printer manually
lpadmin -p Zebra_GX430 -E -v usb://Zebra/GX430 -P /Library/Printers/PPDs/Contents/Resources/Generic-ZPL_Printer.ppd

# 4. Check permissions
sudo chmod 755 /usr/libexec/cups/backend/usb
```

### Network Printer Not Responding

**Symptoms:** Timeout or connection refused

**Solutions:**
```bash
# 1. Ping printer
ping 192.168.1.100

# 2. Check port open
telnet 192.168.1.100 9100

# 3. Check firewall
sudo iptables -L  # Linux
pfctl -s rules    # macOS

# 4. Restart printer
# Power cycle the printer

# 5. Check printer IP (may have changed via DHCP)
# Print network config label from printer menu
```

### Labels Printing Blank

**Symptoms:** Printer works but no content on label

**Solutions:**
```bash
# 1. Check label type in printer
# - Ensure using Direct Thermal labels (not Transfer)
# - Zebra: Menu → Media Settings → Print Method → Direct Thermal

# 2. Adjust darkness
# Zebra: Menu → Print Quality → Darkness → Increase to 20-25
# Brother: Settings → Density → Increase

# 3. Check label loaded correctly
# - Remove and reload label roll
# - Ensure label path clear

# 4. Calibrate media
# Zebra: Hold Feed button 2 seconds
# Brother: Press Feed 10 times to calibrate
```

### Print Queue Stuck

**Symptoms:** Jobs stay in "pending" state

**Solutions:**
```bash
# 1. Check queue via API
curl http://localhost:8091/api/printer/queue

# 2. Clear completed jobs
curl -X POST http://localhost:8091/api/printer/clear

# 3. Cancel stuck job
curl -X DELETE http://localhost:8091/api/printer/job/JOB_ID

# 4. Restart server
npm restart

# 5. Check printer connection
curl -X POST http://localhost:8091/api/printer/test \
  -H "Content-Type: application/json" \
  -d '{"connection":"network","host":"192.168.1.100"}'
```

### Labels Printing Too Small/Large

**Symptoms:** Content cut off or too small

**Solutions:**
```bash
# 1. Check label size configured in printer
# Zebra: Menu → Media Settings → Label Size → 2.0" x 3.0"

# 2. Adjust ZPL coordinates in code
# Edit routes/thermal-printer.js
# Increase/decrease ^FO coordinates

# 3. Test with different label template
# Try EPL format instead of ZPL:
curl -X POST http://localhost:8091/api/printer/print-tray \
  -H "Content-Type: application/json" \
  -d '{"code":"TEST","format":"epl","connection":"usb"}'
```

---

## 📊 Production Monitoring

### Daily Checks

```bash
# Check print queue health
curl http://localhost:8091/api/printer/queue

# Expected:
# - pending: 0
# - processing: 0-1
# - completed: < 100
```

### Weekly Maintenance

1. **Clean print head:** Use isopropyl alcohol and lint-free cloth
2. **Check label supply:** Order more if < 100 labels remaining
3. **Test print quality:** Print sample labels, check for fading
4. **Review error logs:** Check for recurring issues

### Monthly Tasks

1. **Replace print head:** If printing > 10,000 labels/month
2. **Update firmware:** Check manufacturer website for updates
3. **Calibrate printer:** Run calibration cycle
4. **Review costs:** Track label usage and costs

---

## 💰 Cost Calculator

### Initial Setup

| Item | Cost | Notes |
|------|------|-------|
| Brother QL-820NWB | $200 | Recommended |
| Waterproof labels (300) | $30 | 2.4" continuous |
| USB cable (included) | $0 | Included with printer |
| **Total** | **$230** | **One-time** |

### Ongoing Costs

| Item | Quantity | Cost | Cost per Label |
|------|----------|------|----------------|
| Brother DK-2205 | 300 labels | $30 | $0.10 |
| Zebra 10010045 | 500 labels | $20 | $0.04 |
| DYMO 1744907 | 220 labels | $40 | $0.18 |

**Estimated Annual Cost:**
- 5,000 trays/year: $250-500 (labels)
- 1,000 harvest lots/year: $50-100 (labels)
- 500 wholesale orders/year: $50-100 (labels)
- **Total: $350-700/year**

---

## ✅ Production Checklist

### Before Launch

- [ ] Purchase thermal printer (Brother/Zebra/DYMO)
- [ ] Order waterproof label rolls (500-1000)
- [ ] Connect printer via USB or network
- [ ] Test printer connection via API
- [ ] Print 10 test labels, verify quality
- [ ] Batch print 500-1000 tray labels
- [ ] Apply labels to trays
- [ ] Test scanning workflow with mobile app
- [ ] Document printer IP address
- [ ] Configure production environment variables

### Week 1 Post-Launch

- [ ] Monitor print queue daily
- [ ] Check label quality (fading, smudging)
- [ ] Verify all trays have readable labels
- [ ] Train staff on printer operation
- [ ] Create printer troubleshooting guide for staff
- [ ] Order backup label supply

---

## 📚 Related Documentation

- [Tray Tracking System](docs/TRAY_TRACKING_ENHANCEMENTS.md)
- [QR Generator Tool](docs/QR_GENERATOR.md)
- [Label Printing Review](REVIEW_LABELS_EXPORTS_QUICKBOOKS.md)
- [Mobile Scanning App](mobile-app/README.md)

---

## 🆘 Support

**Hardware Issues:**
- Brother Support: 1-877-BROTHER
- Zebra Support: zebra.com/support
- DYMO Support: dymo.com/support

**Software Issues:**
- Check `routes/thermal-printer.js` for API details
- Review print queue: `curl localhost:8091/api/printer/queue`
- Check server logs: `eb logs` (production) or `npm start` output (local)

**Label Supply:**
- Amazon: Search "thermal labels 2x3 waterproof"
- ULine.com: Industrial supplies
- Brother.com: Genuine Brother labels
- Zebra.com: Zebra label finder tool

---

**Setup Time: 15-30 minutes**  
**Cost: $230 initial + $50-70/year labels**  
**Difficulty: Easy (USB) to Medium (Network)** 🏷️
