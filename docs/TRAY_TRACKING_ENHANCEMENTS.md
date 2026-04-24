# Tray Tracking System - Enhancement Documentation

> Update notice (2026-04-24): Tray scanning is no longer required for daily ops. The group is the primary unit of management; trays are derived implicitly from group configuration. The features in this doc remain supported for traceability, split harvest, and QA photos. See `docs/features/GROUP_LEVEL_MANAGEMENT_UPDATES.md`.

## Overview
Complete tray tracking system with QR code generation, thermal printing, and advanced analytics.

---

## 1. QR Code Bulk Generator

### Features
- Generate 100-1000 sequential QR codes in one batch
- Custom prefix (e.g., FARM-TRAY-0001)
- Automatic PDF generation (4x6 grid, 24 codes per page)
- Pre-register codes in database
- Check available code ranges
- Validate codes before generation

### Usage

**Web Interface:**
```
http://localhost:3000/qr-generator.html
```

**API Endpoints:**

```javascript
// Generate QR codes
POST /api/qr-generator/generate
{
  "farmId": "FARM-001",
  "prefix": "FARM-TRAY",
  "startNumber": 1,
  "count": 100,
  "format": "pdf" // or "json"
}
Response: PDF download or JSON array

// Check available range
GET /api/qr-generator/available-range?farmId=FARM-001&prefix=FARM-TRAY
Response: {
  "prefix": "FARM-TRAY",
  "lastNumber": 150,
  "suggestedStart": 151,
  "suggestedRange": "FARM-TRAY-0151 to FARM-TRAY-0250"
}

// Validate codes
POST /api/qr-generator/validate
{
  "codes": ["FARM-TRAY-0001", "FARM-TRAY-0002"]
}
Response: {
  "valid": true,
  "conflicts": [],
  "available": 2,
  "total": 2
}
```

**Database Schema:**
```sql
-- migrations/010_tray_qr_codes.sql
CREATE TABLE tray_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    farm_id VARCHAR(50) NOT NULL,
    registered BOOLEAN DEFAULT false,
    tray_id VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    registered_at TIMESTAMP
);
```

**Workflow:**
1. Navigate to `/qr-generator.html`
2. Enter Farm ID
3. Click "Check Available Range" to see next available numbers
4. Set quantity (1-1000)
5. Preview codes (optional)
6. Click "Generate PDF Sheet"
7. Print on waterproof labels
8. Apply to trays
9. First scan auto-registers tray

---

## 2. Thermal Printer API

### Supported Printers
- **Zebra**: ZPL commands (most Zebra models)
- **Brother**: QL-820NWB, QL-700, QL-1100 (ZPL/EPL)
- **DYMO**: LabelWriter series (EPL)

### Connection Types
- **USB**: Direct connection via lp/lpr commands
- **Network**: TCP/IP socket (default port 9100)

### Label Templates

**Tray Label (2" x 3")**
- QR code (200x200px)
- Tray code text
- Farm name
- Generation date

**Harvest Label (2" x 1")**
- QR code with lot data
- Crop name
- Lot code
- Weight
- Harvest date

**Packing Label (4" x 6")**
- Order ID
- Buyer name
- Item list
- Large QR code for traceability

### API Endpoints

```javascript
// Print tray label
POST /api/printer/print-tray
{
  "code": "FARM-TRAY-0001",
  "farmName": "Sunset Farms",
  "connection": "usb",        // or "network"
  "printerName": "Zebra_GX430", // USB only
  "host": "192.168.1.100",    // Network only
  "port": 9100,               // Network only
  "format": "zpl"             // or "epl"
}
Response: {
  "success": true,
  "jobId": "job-1234567890-abc",
  "queuePosition": 1
}

// Print harvest label
POST /api/printer/print-harvest
{
  "lotCode": "LOT-2025-12-25-1200",
  "cropName": "Lettuce - Green Oakleaf",
  "weight": 2.5,
  "unit": "kg",
  "connection": "network",
  "host": "192.168.1.100"
}

// Print packing label
POST /api/printer/print-packing
{
  "orderId": "ORD-12345",
  "buyer": "Whole Foods Market",
  "items": ["5 lbs Lettuce", "3 lbs Kale"],
  "qrData": "ORDER:ORD-12345|LOTS:LOT-001,LOT-002",
  "connection": "usb",
  "printerName": "Brother_QL-820NWB"
}

// Print raw ZPL/EPL
POST /api/printer/print-raw
{
  "data": "^XA^FO50,50^A0N,50,50^FDTEST^FS^XZ",
  "connection": "usb"
}

// View print queue
GET /api/printer/queue
Response: {
  "queue": [{
    "id": "job-123",
    "status": "completed",
    "metadata": { "code": "FARM-TRAY-0001" }
  }],
  "pending": 2,
  "processing": 1,
  "completed": 10
}

// Get job status
GET /api/printer/job/:jobId

// Cancel job
DELETE /api/printer/job/:jobId

// Clear completed jobs
POST /api/printer/clear

// Test printer
POST /api/printer/test
{
  "connection": "network",
  "host": "192.168.1.100"
}

// List USB printers (Linux/macOS)
GET /api/printer/list
```

### Setup Instructions

**USB Printer (Linux/macOS):**
```bash
# Install CUPS
sudo apt-get install cups  # Ubuntu/Debian
brew install cups         # macOS

# Add printer
lpstat -p -d              # List printers
lp -d Zebra_GX430 -o raw file.zpl  # Test print
```

**Network Printer:**
```bash
# Find printer IP
# Check printer LCD display or print network config

# Test connection
telnet 192.168.1.100 9100
^XA^FO50,50^A0N,50,50^FDTEST^FS^XZ  # Send ZPL
^C                                   # Exit
```

**Brother QL Setup:**
1. Install Brother P-touch Editor (includes drivers)
2. Set printer to "Standalone" mode
3. Use USB or Network connection
4. Label size: 62mm continuous tape

---

## 3. Dashboard Enhancements

### Advanced Filters

**Filter Options:**
- Crop Type (all, lettuce, kale, basil, microgreens, etc.)
- Location (all, zone-a, zone-b, zone-c, etc.)
- Status (all, SEEDED, IN_GROW, READY, HARVESTED)
- Date Range (plant date from/to)

**Usage:**
1. Click "🔍 Filters" button in header
2. Set filter criteria
3. Results update automatically
4. See "Showing X of Y trays" at bottom
5. Click "Clear Filters" to reset

**Implementation:**
```javascript
// public/scripts/tray-enhancements.js
const filters = {
  cropType: 'all',
  location: 'all',
  status: 'all',
  dateFrom: null,
  dateTo: null
};

function applyFilters() {
  const filtered = allTrays.filter(tray => {
    // Apply each filter...
    return matchesAllCriteria;
  });
  renderTrays(filtered);
}
```

### Batch Harvest Recording

**Features:**
- Select multiple trays with tap
- Record harvest for all at once
- Equal weight distribution
- Single lot code generation
- Bulk label printing

**Usage:**
1. Click "📦 Batch Harvest" button
2. Tap trays to select (green border appears)
3. Selected count shows in header
4. Click "✓ Record Batch Harvest"
5. Enter total weight (auto-divides by tray count)
6. All trays marked as harvested
7. Individual lot codes generated

**Implementation:**
```javascript
let batchHarvestMode = false;
let batchSelectedTrays = [];

function toggleBatchHarvestMode() {
  batchHarvestMode = !batchHarvestMode;
  showBatchControls();
}

function toggleTraySelection(trayRunId) {
  if (!batchHarvestMode) return;
  // Toggle selection...
}

async function performBatchHarvest() {
  // Harvest all selected trays...
}
```

### Yield Analytics

**Metrics:**
- Total yield per crop
- Average yield per tray
- Min/max yield range
- Performance vs expected yield
- Tray count by crop
- Historical trends

**Views:**
1. **Chart View**: Horizontal bar chart
2. **Table View**: Detailed statistics
3. **Comparison View**: Crop performance comparison

**API Endpoint:**
```python
# backend/inventory_routes.py
@router.get("/analytics/yield-by-tray")
def get_yield_analytics(db: Session):
    results = db.query(
        TrayRun.recipe_id,
        func.count(...).label('tray_count'),
        func.sum(...).label('total_yield'),
        func.avg(...).label('avg_yield')
    ).filter(
        TrayRun.status == 'HARVESTED'
    ).group_by(TrayRun.recipe_id).all()
    
    return analytics
```

**Usage:**
1. Click "📊 Analytics" button
2. Switch between Chart/Table/Comparison tabs
3. Export to CSV for external analysis

### Photo History Timeline

**Features:**
- Chronological photo list per tray
- AI analysis results
- Growth progression visualization
- Notes and observations
- Days since planting

**Data Storage:**
```sql
CREATE TABLE quality_control_photos (
    id SERIAL PRIMARY KEY,
    tray_code VARCHAR(100),
    image_url TEXT,
    created_at TIMESTAMP,
    note TEXT,
    ai_analysis JSONB
);
```

**API Endpoint:**
```python
@router.get("/tray-runs/{tray_run_id}/photos")
def get_tray_photos(tray_run_id: str, db: Session):
    photos = db.query(QualityControlPhoto)
        .filter(...)
        .order_by(created_at.desc())
        .all()
    return photos
```

**Usage:**
1. Click on any tray card
2. Click "📸 Photo History"
3. Scroll through timeline
4. Click "Add New Photo" to upload

---

## Integration Guide

### Step 1: Update Server
```javascript
// server-foxtrot.js
import { router as qrGeneratorRouter } from './routes/qr-generator.js';
import { router as printerRouter } from './routes/thermal-printer.js';

app.use('/api/qr-generator', qrGeneratorRouter);
app.use('/api/printer', printerRouter);
```

### Step 2: Run Database Migration
```bash
psql $DATABASE_URL < migrations/010_tray_qr_codes.sql
```

### Step 3: Add UI Components
```html
<!-- public/views/tray-inventory.html -->
<script src="/scripts/tray-enhancements.js"></script>
<!-- Insert components from public/components/tray-enhancements-ui.html -->
```

### Step 4: Test QR Generator
```bash
# Navigate to:
http://localhost:3000/qr-generator.html

# Generate 10 test codes
# Download PDF
# Verify codes in database
```

### Step 5: Configure Printer
```javascript
// Test network printer
POST /api/printer/test
{
  "connection": "network",
  "host": "192.168.1.100"
}

// Print test tray label
POST /api/printer/print-tray
{
  "code": "FARM-TRAY-TEST",
  "connection": "network",
  "host": "192.168.1.100"
}
```

---

## File Structure

```
Light-Engine-Foxtrot/
├── routes/
│   ├── qr-generator.js          (244 lines - QR generation API)
│   └── thermal-printer.js       (548 lines - Printer API)
├── migrations/
│   └── 010_tray_qr_codes.sql    (Database schema)
├── public/
│   ├── qr-generator.html        (387 lines - QR generator UI)
│   ├── scripts/
│   │   └── tray-enhancements.js (287 lines - Dashboard enhancements)
│   └── components/
│       └── tray-enhancements-ui.html (600+ lines - UI components)
├── backend/
│   └── inventory_routes.py      (Enhanced with analytics endpoints)
└── package.json                 (Added qrcode, pdf-lib dependencies)
```

---

## Cost Breakdown

### QR Code System
- **Brother QL-820NWB**: $250 (one-time)
- **Waterproof labels**: $30 per 300 labels ($0.10 each)
- **Total per 1000 trays**: ~$350 setup + $100 labels

### Thermal Printer Alternatives
- **Zebra GX430t**: $450 (industrial-grade)
- **DYMO LabelWriter 450**: $120 (budget option)
- **Generic thermal labels**: $15 per 500 ($0.03 each)

---

## Troubleshooting

### QR Generator Issues
**Problem**: PDF generation fails
**Solution**: Check pdf-lib dependency: `npm install pdf-lib`

**Problem**: Codes already exist
**Solution**: Use `/available-range` endpoint to find next available numbers

### Printer Issues
**Problem**: USB printer not found
**Solution**: 
```bash
lpstat -p -d  # List printers
lpadmin -p Zebra_GX430 -E  # Enable printer
```

**Problem**: Network printer timeout
**Solution**: 
- Check printer IP and port (usually 9100)
- Ping printer: `ping 192.168.1.100`
- Test telnet: `telnet 192.168.1.100 9100`

**Problem**: ZPL commands not working
**Solution**: Try EPL format or check printer language settings

### Dashboard Issues
**Problem**: Filters not working
**Solution**: Clear browser cache, check console for JS errors

**Problem**: Analytics showing no data
**Solution**: Ensure trays have been harvested with `actualWeight` recorded

**Problem**: Photos not loading
**Solution**: Check `quality_control_photos` table exists and has data

---

## Performance Tips

1. **QR Generation**: Limit to 1000 codes per batch for memory efficiency
2. **Printer Queue**: Clear completed jobs regularly to prevent queue buildup
3. **Analytics**: Cache results for 5 minutes to reduce database load
4. **Photo Timeline**: Lazy-load images as user scrolls
5. **Filters**: Debounce filter updates by 300ms for smoother UX

---

## Security Considerations

1. **QR Codes**: Pre-register in database to prevent unauthorized codes
2. **Printer Access**: Restrict API to authenticated users only
3. **Database**: Use parameterized queries to prevent SQL injection
4. **File Uploads**: Validate and sanitize image uploads for photos
5. **API Rate Limiting**: Limit QR generation to prevent abuse

---

## Future Enhancements

- [ ] Mobile app for QR scanning (React Native)
- [ ] Bluetooth printer support
- [ ] NFC tags as alternative to QR codes
- [ ] Real-time dashboard updates via WebSocket
- [ ] Machine learning for yield prediction
- [ ] Integration with scale hardware for auto-weight recording
- [ ] Barcode scanner hardware support (USB/Bluetooth)

---

## Support

For issues or questions:
- Check logs: `pm2 logs server-foxtrot`
- Database queries: `psql $DATABASE_URL`
- Test endpoints: Use Postman or curl
- Browser console: Check for JavaScript errors
