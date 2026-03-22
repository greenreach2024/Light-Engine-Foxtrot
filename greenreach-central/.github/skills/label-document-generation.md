# Skill: Label and Document Generation

## Purpose
Server-side label, packing slip, and QR code generation for GreenReach -- product labels with lot traceability, packing slips for wholesale orders, and the QR tray label system.

## Current State (Implemented)
- **Lot-based labels and packing slips** are fully implemented in `routes/lot-system.js`
- PDFKit is in package.json (used by grant-wizard.js)
- QR generator frontend exists at `public/LE-qr-generator.html` (frontend-only, backend endpoints still missing)
- Packing slip in `farm-admin.js` uses raw `window.print()` -- the lot-system provides a server-rendered alternative

## Implemented Endpoints (routes/lot-system.js)

### POST /api/lots/label
Generates a printable label for a lot record.
- Body: `{ farmId, lotNumber, format }` (format: 'json' or 'html')
- JSON response includes: lot_number, product_name, farm_id, harvest_date, best_by_date, weight_oz, weight_lbs, quality_grade, seed_source, qr_data (JSON string for QR encoding)
- HTML response: 4-inch thermal-printer-friendly label with table layout, print media CSS
- Label content: product name, LOT number (bold), farm, harvest date, best-by, weight, grade, seed source

### POST /api/lots/packing-slip
Generates a packing slip with per-item lot traceability.
- Body: `{ farmId, orderId, items: [{ sku_name, qty, unit }], format }`
- For each item, looks up the most recent active lot via crop_id match
- Response includes per-item: product, quantity, unit, lot_number, harvest_date, best_by_date, quality_grade
- HTML format: print-ready table with order ID, farm ID, generation timestamp

## Not Yet Implemented

### QR Code Backend
`public/LE-qr-generator.html` calls these endpoints that do not exist:
- `GET /api/qr-generator/available-range?farmId=&prefix=`
- `POST /api/qr-generator/generate`
- `POST /api/qr-generator/generate-groups`

To implement: Install `qrcode` package, create `routes/qr-generator.js`, mount with auth.

### PDF Label Generation
Current labels are HTML. For thermal printer integration or PDF output:
- Use PDFKit (already in package.json) for PDF rendering
- Encode `qr_data` field from label endpoint into actual QR code image
- Support label sizes: 4x6 (shipping), 2x1 (small product), 4x3 (medium)

### Barcode Generation
No barcode library installed. For Code128/EAN-13 barcodes on physical labels:
- Install `bwip-js` for server-side barcode generation
- Encode lot_number as Code128 barcode on product labels

## Integration with Lot System

The label system reads from lot_records (created by `POST /api/lots/harvest`):
1. Harvest recorded -> lot_record created with lot_number, quality_score, best_by_date
2. `POST /api/lots/label` reads lot_record and renders label
3. `POST /api/lots/packing-slip` matches order items to active lots by crop_id
4. SFCR export (`GET /api/lots/:farmId/sfcr-export`) provides regulatory-grade traceability data

## Validation Checklist
- [x] Lot label JSON endpoint returns structured data
- [x] Lot label HTML endpoint renders print-ready label
- [x] Packing slip links order items to lots automatically
- [x] Quality grade displayed on all outputs
- [ ] QR generator backend endpoints (currently 404)
- [ ] PDF label generation via PDFKit
- [ ] Barcode generation on physical labels
- [ ] Thermal printer ZPL support

## Rules
- Currency is always CAD
- No emojis in any output
- No fabricated fees
- PDFKit is already available -- no need for new PDF libs
- Sanitize all text inputs before rendering (XSS prevention)
- Test with `npm test -- --runInBand`
- Deploy with `eb deploy --staged`
