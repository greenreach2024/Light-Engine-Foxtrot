# QR Label Generation & Printing Guide

## Quick Start (5 Minutes)

Generate and print 500-1000 tray labels for your farm in 5 simple steps.

---

## 🎯 Step 1: Access QR Generator (30 seconds)

### Option A: Web Interface (Easiest)

1. Open browser: http://localhost:8091/LE-qr-generator.html
2. Or from farm dashboard: Click **Tools** → **QR Label Generator**

### Option B: Direct API Call

```bash
curl -X POST http://localhost:8091/api/qr-generator/generate \
  -H "Content-Type: application/json" \
  -d '{
    "farmId": "FARM-001",
    "prefix": "FARM-TRAY",
    "startNumber": 1000,
    "count": 500,
    "format": "pdf"
  }' \
  --output tray-labels.pdf
```

---

## 📋 Step 2: Configure Generation (1 minute)

### Required Fields

**Farm ID:** `FARM-001` (your unique farm identifier)  
**Prefix:** `FARM-TRAY` (standard for tray codes)  
**Start Number:** `1000` (or check "Available Range")  
**Count:** `500` (number of labels needed)

### Tips

- **First time?** Start at 1000
- **Second batch?** Click "Check Available Range" to get next number
- **Max per batch:** 1,000 labels (takes ~5 minutes to generate)

---

## 🔍 Step 3: Preview (Optional - 30 seconds)

Click **"👁️ Generate Preview"** to see first 12 codes:

Example Preview:
```
FARM-TRAY-1000    FARM-TRAY-1001    FARM-TRAY-1002
FARM-TRAY-1003    FARM-TRAY-1004    FARM-TRAY-1005
...
```

Verify:
- ✓ Prefix is correct
- ✓ Numbers are sequential
- ✓ QR codes render properly

---

## 📥 Step 4: Generate PDF (2 minutes)

Click **"📥 Generate PDF Sheet"**

**What Happens:**
1. Generates 500 QR codes
2. Creates PDF with 4x6 grid (24 codes per page)
3. Pre-registers codes in database
4. Downloads PDF: `tray-qr-codes-FARM-001-[timestamp].pdf`

**File Size:** ~2-5 MB for 500 labels  
**Pages:** 21 pages (24 labels per page)

---

## 🖨️ Step 5: Print Labels (Varies)

### Option A: PDF to Waterproof Labels (Best for Production)

**Equipment:**
- Brother QL-820NWB or Zebra GX430t printer
- Waterproof label rolls (2" x 3")

**Steps:**
1. Load waterproof labels in printer
2. Open generated PDF
3. Print all pages
4. Peel and apply to trays

**Time:** ~10-15 minutes for 500 labels  
**Cost:** $20-30 for 500 labels

### Option B: Thermal Printer Direct (Fastest)

**Prerequisites:**
- Thermal printer configured (see [THERMAL_PRINTER_SETUP.md](THERMAL_PRINTER_SETUP.md))
- Printer connected via USB or network

**Use Batch Print Script:**
```bash
# Print 500 labels to network printer
node scripts/batch-print-labels.js \
  --start 1000 \
  --count 500 \
  --farm "GreenReach Farms" \
  --host 192.168.1.100

# Print 100 labels to USB printer
node scripts/batch-print-labels.js \
  --start 1000 \
  --count 100 \
  --connection usb
```

**Time:** ~4-5 minutes for 500 labels  
**Cost:** $20 for 500 labels

### Option C: Print to Regular Paper (Testing Only)

**NOT recommended for production** (not waterproof, fades)

**Steps:**
1. Open PDF
2. Print to regular printer
3. Cut out labels
4. Laminate or use clear tape

**Use for:** Testing, demos, indoor-only trays

---

## 📊 Label Layout

### PDF Grid Format

**Page Size:** 8.5" x 11" (US Letter)  
**Grid:** 4 columns × 6 rows = 24 labels per page  
**Label Size:** ~2" x 1.8" each

```
┌──────┬──────┬──────┬──────┐
│ QR   │ QR   │ QR   │ QR   │
│ 1000 │ 1001 │ 1002 │ 1003 │
├──────┼──────┼──────┼──────┤
│ QR   │ QR   │ QR   │ QR   │
│ 1004 │ 1005 │ 1006 │ 1007 │
├──────┼──────┼──────┼──────┤
│  ... │  ... │  ... │  ... │
│      │      │      │      │
└──────┴──────┴──────┴──────┘
```

### Individual Label Format

Each label contains:
- **QR Code:** 100×100px, error correction level H
- **Text:** FARM-TRAY-#### below QR
- **Margins:** 1mm around edges
- **Scannable from:** 6 inches away

---

## 🏭 Production Workflows

### Workflow 1: Initial Farm Setup

**Goal:** Print 1,000 labels for all farm trays

```bash
# Step 1: Generate PDF
curl -X POST http://localhost:8091/api/qr-generator/generate \
  -H "Content-Type: application/json" \
  -d '{"farmId":"FARM-001","prefix":"FARM-TRAY","startNumber":1000,"count":1000,"format":"pdf"}' \
  --output initial-1000-labels.pdf

# Step 2: Print via thermal printer
node scripts/batch-print-labels.js --start 1000 --count 1000 --host 192.168.1.100

# Step 3: Apply to trays
# - Peel and stick on dry tray edge
# - Ensure no bubbles
# - Press firmly for 5 seconds
```

**Time:** 15-20 minutes total  
**Cost:** $40-60 for labels

### Workflow 2: Expansion Batch

**Goal:** Add 250 more trays

```bash
# Step 1: Check available range
curl http://localhost:8091/api/qr-generator/available-range?farmId=FARM-001&prefix=FARM-TRAY

# Response: {"suggestedStart": 2000, "suggestedRange": "FARM-TRAY-2000 to FARM-TRAY-2249"}

# Step 2: Generate next batch
curl -X POST http://localhost:8091/api/qr-generator/generate \
  -H "Content-Type: application/json" \
  -d '{"farmId":"FARM-001","prefix":"FARM-TRAY","startNumber":2000,"count":250,"format":"pdf"}' \
  --output expansion-250-labels.pdf

# Step 3: Print
node scripts/batch-print-labels.js --start 2000 --count 250 --host 192.168.1.100
```

### Workflow 3: Replacement Labels

**Goal:** Replace 10 damaged labels

```bash
# Known damaged codes: 1005, 1023, 1045, 1067, 1089, 1123, 1156, 1178, 1234, 1256

# Option A: Print individually via API
curl -X POST http://localhost:8091/api/printer/print-tray \
  -H "Content-Type: application/json" \
  -d '{"code":"FARM-TRAY-1005","connection":"network","host":"192.168.1.100"}'

# Option B: Generate small PDF with specific codes
# (requires manual selection - use web interface)
```

---

## 🔍 Validation & Testing

### Test Generated Codes

```bash
# Validate codes exist in database
curl -X POST http://localhost:8091/api/qr-generator/validate \
  -H "Content-Type: application/json" \
  -d '{
    "codes": ["FARM-TRAY-1000", "FARM-TRAY-1001", "FARM-TRAY-1002"]
  }'

# Response:
# {
#   "valid": true,
#   "conflicts": [],
#   "available": 3,
#   "total": 3
# }
```

### Test Label Scanning

1. **Print 1 test label**
2. **Scan with mobile app**
3. **Verify:**
   - QR code readable from 6 inches
   - Code displays correctly in app
   - Tray registration works

### Quality Check

**Good Label:**
- ✓ QR code scans instantly
- ✓ Text is legible
- ✓ No smudging or fading
- ✓ Waterproof (if required)

**Bad Label:**
- ✗ Requires multiple scan attempts
- ✗ Text blurry or cut off
- ✗ Ink smudges when wet
- ✗ Label curling at edges

**Fix:** Adjust printer darkness, check label type, recalibrate printer

---

## 📈 Tracking & Analytics

### Monitor Generated Codes

**Database Query:**
```sql
-- Check total codes generated
SELECT COUNT(*) FROM tray_codes WHERE farm_id = 'FARM-001';

-- Check registered vs unused
SELECT 
  registered,
  COUNT(*) as count
FROM tray_codes 
WHERE farm_id = 'FARM-001'
GROUP BY registered;

-- Find next available number
SELECT MAX(
  CAST(SUBSTRING(code FROM '\d+$') AS INTEGER)
) + 1 as next_number
FROM tray_codes
WHERE farm_id = 'FARM-001' AND code LIKE 'FARM-TRAY-%';
```

### Usage Statistics

Track via API:
```bash
# Get available range (shows how many used)
curl http://localhost:8091/api/qr-generator/available-range?farmId=FARM-001&prefix=FARM-TRAY
```

---

## 🐛 Troubleshooting

### PDF Not Generating

**Symptom:** Generation hangs or fails

**Solutions:**
```bash
# 1. Check server running
curl http://localhost:8091/health

# 2. Test with small batch first
curl -X POST http://localhost:8091/api/qr-generator/generate \
  -H "Content-Type: application/json" \
  -d '{"farmId":"TEST","prefix":"TEST","startNumber":1,"count":10,"format":"json"}'

# 3. Check server logs
tail -f logs/server.log | grep "QR generation"

# 4. Verify dependencies installed
npm list qrcode pdf-lib
```

### QR Codes Not Scanning

**Symptom:** Mobile app can't read QR codes

**Solutions:**
1. **Increase error correction:** Already set to 'H' (highest)
2. **Increase QR size:** Edit `routes/qr-generator.js`, change `width: 200` to `width: 300`
3. **Print darker:** Increase printer darkness setting
4. **Clean camera lens:** Ensure mobile camera is clean
5. **Better lighting:** Scan in well-lit area

### Codes Already Exist Error

**Symptom:** "Conflicts found" when generating

**Check Conflicts:**
```bash
curl -X POST http://localhost:8091/api/qr-generator/validate \
  -H "Content-Type: application/json" \
  -d '{"codes":["FARM-TRAY-1000","FARM-TRAY-1001"]}'
```

**Solution:**
- Use higher start number
- Or intentionally skip conflicting numbers
- Or delete unused codes from database (if confirmed unused)

### Database Pre-registration Failed

**Symptom:** PDF generates but codes not in database

**Impact:** Low - codes will register when first scanned

**Fix (Optional):**
```sql
-- Manually insert codes
INSERT INTO tray_codes (code, farm_id, registered, created_at)
VALUES ('FARM-TRAY-1000', 'FARM-001', false, NOW())
ON CONFLICT (code) DO NOTHING;
```

---

## 💰 Cost Breakdown

### Initial Setup (One-Time)

| Item | Cost | Notes |
|------|------|-------|
| Thermal Printer | $200 | Brother QL-820NWB (recommended) |
| **Total** | **$200** | |

### Per-Batch Costs

| Batch Size | Label Cost | Time | Cost per Label |
|------------|-----------|------|----------------|
| 100 labels | $6 | 2 min | $0.06 |
| 500 labels | $25 | 10 min | $0.05 |
| 1,000 labels | $40 | 20 min | $0.04 |

### Annual Estimate

**Assumptions:**
- 1,000 trays initially
- 500 new trays per year
- 10% replacement rate (100 labels/year)

**Total:** ~$70/year for labels

---

## ✅ Production Checklist

### Before First Generation

- [ ] Server running (check http://localhost:8091/health)
- [ ] Database connected (check health endpoint)
- [ ] Chosen Farm ID (e.g., FARM-001)
- [ ] Decided on prefix (e.g., FARM-TRAY)
- [ ] Calculated how many labels needed
- [ ] Ordered waterproof label stock
- [ ] Thermal printer setup complete (if using)

### During Generation

- [ ] Generated PDF successfully
- [ ] Verified first page of PDF looks correct
- [ ] Checked QR codes render properly
- [ ] Confirmed code range is correct (1000-1499 etc)
- [ ] Saved PDF to safe location

### After Printing

- [ ] Printed test label and scanned successfully
- [ ] Quality check passed (readable, waterproof)
- [ ] Labels applied to 10 test trays
- [ ] Test trays scanned and registered in system
- [ ] Documented label batch in log
- [ ] Updated inventory tracking

### Week 1 Post-Launch

- [ ] Monitor scanning success rate (should be >95%)
- [ ] Check for label durability issues
- [ ] Verify database sync working
- [ ] Train all staff on scanning workflow
- [ ] Order more labels if needed

---

## 📚 Related Documentation

- [Thermal Printer Setup](THERMAL_PRINTER_SETUP.md) - Complete printer configuration
- [Tray Tracking Enhancements](docs/TRAY_TRACKING_ENHANCEMENTS.md) - Full feature documentation
- [Mobile Scanning App](mobile-app/README.md) - Using QR codes with mobile app
- [Batch Print Script](scripts/batch-print-labels.js) - Automated label printing

---

## 🎓 Training Guide

### Staff Training (15 minutes)

**What to Cover:**
1. How to use QR generator web interface
2. How to print PDF labels
3. How to apply labels to trays (clean, dry, firm press)
4. How to scan labels with mobile app
5. What to do if label damaged (print replacement)

**Hands-On:**
1. Generate 10 test labels together
2. Print on scrap paper
3. Apply to test tray
4. Scan with mobile app
5. Register tray in system

### Quick Reference Card

Print and laminate this for staff:

```
🏷️ QUICK REFERENCE: QR Label Generation

1. Open: localhost:8091/LE-qr-generator.html
2. Farm ID: FARM-001
3. Prefix: FARM-TRAY
4. Click "Check Available Range"
5. Set Count (100-500)
6. Click "Generate PDF"
7. Print on waterproof labels
8. Apply to dry tray edge

Need help? See THERMAL_PRINTER_SETUP.md
```

---

**Setup Time: 5 minutes**  
**Cost: $40-70 per 1000 labels**  
**Difficulty: Easy** 🏷️

---

## 🆘 Support

**Code Generation Issues:**
- Check [routes/qr-generator.js](routes/qr-generator.js)
- Verify dependencies: `npm list qrcode pdf-lib`
- Test API: `curl localhost:8091/api/qr-generator/available-range?farmId=FARM-001`

**Printing Issues:**
- See [THERMAL_PRINTER_SETUP.md](THERMAL_PRINTER_SETUP.md)
- Check printer queue: `curl localhost:8091/api/printer/queue`
- Test printer: `curl -X POST localhost:8091/api/printer/test -d '{"connection":"network","host":"192.168.1.100"}'`

**Scanning Issues:**
- Ensure good lighting
- Clean camera lens
- Hold phone 4-6 inches from label
- Check mobile app permissions (camera access)
