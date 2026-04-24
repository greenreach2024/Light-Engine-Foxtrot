# Quick Start: Tray Tracking Enhancements

> Update notice (2026-04-24): Optional after group-first ops rollout. Use this guide only for farms that need per-tray lot codes, split harvest, or QA photo history. Daily group operations do not require any of the steps below. See `docs/features/GROUP_LEVEL_MANAGEMENT_UPDATES.md`.

## Installation (5 minutes)

### 1. Install Dependencies
```bash
cd /Users/petergilbert/Light-Engine-Foxtrot
npm install qrcode pdf-lib
```
✅ COMPLETE

### 2. Run Database Migration
```bash
# PostgreSQL
psql $DATABASE_URL -f migrations/010_tray_qr_codes.sql

# Or manually:
psql $DATABASE_URL << EOF
CREATE TABLE IF NOT EXISTS tray_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    farm_id VARCHAR(50) NOT NULL,
    registered BOOLEAN DEFAULT false,
    tray_id VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    registered_at TIMESTAMP
);
EOF
```

### 3. Restart Server
```bash
# If using PM2:
pm2 restart server-foxtrot

# Or directly:
npm start
```

---

## Usage

### QR Code Generator
1. Navigate to: `http://localhost:3000/qr-generator.html`
2. Enter Farm ID (e.g., "FARM-001")
3. Click "Check Available Range"
4. Set quantity (default: 100)
5. Click "Generate PDF Sheet"
6. Print on waterproof labels
7. Apply to trays

**Result**: 4x6 grid PDF with 24 QR codes per page

### Thermal Printer
```bash
# Test USB printer
curl -X POST http://localhost:3000/api/printer/test \
  -H "Content-Type: application/json" \
  -d '{"connection": "usb", "printerName": "Zebra_GX430"}'

# Test network printer
curl -X POST http://localhost:3000/api/printer/test \
  -H "Content-Type: application/json" \
  -d '{"connection": "network", "host": "192.168.1.100", "port": 9100}'

# Print tray label
curl -X POST http://localhost:3000/api/printer/print-tray \
  -H "Content-Type: application/json" \
  -d '{
    "code": "FARM-TRAY-0001",
    "farmName": "My Farm",
    "connection": "network",
    "host": "192.168.1.100"
  }'
```

### Dashboard Enhancements

**Enable Filters:**
1. Open `http://localhost:3000/views/tray-inventory.html`
2. Click "🔍 Filters" button
3. Set crop type, location, date range
4. View filtered results

**Batch Harvest:**
1. Click "📦 Batch Harvest" button
2. Tap trays to select (green border appears)
3. Click "✓ Record Batch Harvest"
4. Enter total weight
5. All selected trays harvested

**View Analytics:**
1. Click "📊 Analytics" button
2. See yield statistics by crop
3. Switch between Chart/Table/Comparison views
4. Export to CSV

---

## API Quick Reference

### QR Generator
```
POST /api/qr-generator/generate         - Generate QR codes (PDF/JSON)
GET  /api/qr-generator/available-range  - Get next available numbers
POST /api/qr-generator/validate         - Check if codes exist
```

### Thermal Printer
```
POST   /api/printer/print-tray     - Print tray label
POST   /api/printer/print-harvest  - Print harvest label
POST   /api/printer/print-packing  - Print packing label
POST   /api/printer/print-raw      - Print raw ZPL/EPL
GET    /api/printer/queue          - View print queue
GET    /api/printer/job/:id        - Get job status
DELETE /api/printer/job/:id        - Cancel job
POST   /api/printer/clear          - Clear completed jobs
POST   /api/printer/test           - Test printer
GET    /api/printer/list           - List USB printers
```

### Analytics
```
GET /api/analytics/yield-by-tray        - Yield statistics by crop
GET /api/tray-runs/:id/photos          - Photo history timeline
```

---

## Printer Setup

### Brother QL-820NWB (Recommended)
1. **Connection**: USB or Network (WiFi/Ethernet)
2. **Labels**: 62mm continuous tape ($30 per 300 labels)
3. **Setup**:
   - Install Brother P-touch Editor
   - Set to "Standalone" mode
   - Note IP address from LCD display
4. **Test**: Send test print via `/api/printer/test`

### Zebra GX430t (Industrial)
1. **Connection**: USB or Ethernet
2. **Labels**: 2" x 3" direct thermal ($15 per 500)
3. **Setup**:
   - Install Zebra drivers
   - Configure via ZebraDesigner
   - Set to ZPL language mode
4. **Test**: `lp -d Zebra_GX430 -o raw test.zpl`

### Network Printer (Any Brand)
1. **Find IP**: Check printer LCD or print config
2. **Test Connection**: `telnet 192.168.1.100 9100`
3. **Send Test Print**:
   ```bash
   echo "^XA^FO50,50^A0N,50,50^FDTEST^FS^XZ" | nc 192.168.1.100 9100
   ```

---

## Files Created

```
routes/qr-generator.js                    ✅ 244 lines
routes/thermal-printer.js                 ✅ 548 lines
migrations/010_tray_qr_codes.sql          ✅ 20 lines
public/qr-generator.html                  ✅ 387 lines
public/scripts/tray-enhancements.js       ✅ 287 lines
public/components/tray-enhancements-ui.html ✅ 600+ lines
backend/inventory_routes.py (enhanced)    ✅ +100 lines
docs/TRAY_TRACKING_ENHANCEMENTS.md        ✅ Complete guide
```

**Total**: ~2,186 new lines of code

---

## What's Next?

1. **Generate Test QR Codes**
   - Visit `/qr-generator.html`
   - Generate 10 test codes
   - Print PDF

2. **Print Test Label**
   - Configure printer connection
   - Test print via API
   - Verify label quality

3. **Try Batch Harvest**
   - Seed 5 test trays
   - Mark as ready to harvest
   - Use batch mode to harvest all

4. **View Analytics**
   - Harvest 10+ trays with weights
   - Open Analytics modal
   - Export yield report

---

## Troubleshooting

**Server won't start:**
```bash
# Check for syntax errors
npm start

# Check logs
pm2 logs server-foxtrot

# Restart
pm2 restart server-foxtrot
```

**Database migration fails:**
```bash
# Check connection
psql $DATABASE_URL -c "SELECT 1;"

# Run migration
psql $DATABASE_URL -f migrations/010_tray_qr_codes.sql
```

**QR generator doesn't work:**
```bash
# Check dependencies
npm list qrcode pdf-lib

# Reinstall if needed
npm install qrcode pdf-lib
```

**Printer not responding:**
```bash
# USB: List printers
lpstat -p -d

# Network: Test connection
ping 192.168.1.100
telnet 192.168.1.100 9100
```

---

## Support Checklist

- ✅ Dependencies installed (qrcode, pdf-lib)
- ✅ Database migration complete (tray_codes table)
- ✅ Server routes registered (qr-generator, printer)
- ✅ Frontend files created (UI components, scripts)
- ✅ API endpoints tested
- ✅ Printer configured (if applicable)

---

## Cost Summary

**Essential Setup:**
- Software: $0 (all open source)
- Labels: $30-40 per 300-500 labels
- **Total**: ~$40 to start

**With Thermal Printer:**
- Brother QL-820NWB: $250
- Labels: $30 per 300
- **Total**: ~$280 complete system

**ROI**: Save 10+ hours/month on manual tray tracking = $500+ value

---

## Next Steps

1. ✅ Run `npm install qrcode pdf-lib`
2. ✅ Run database migration
3. ✅ Restart server
4. → Generate first QR codes
5. → Print test labels
6. → Scan and register trays
7. → Use batch harvest mode
8. → View analytics dashboard

---

**System Ready!** 🚀

All three enhancement features are now available:
- 🏷️ QR Code Bulk Generator
- 🖨️ Thermal Printer API
- 📊 Dashboard Enhancements (Filters, Batch Harvest, Analytics, Photos)
