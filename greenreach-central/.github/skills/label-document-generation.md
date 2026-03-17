# Skill: Label and Document Generation

## Purpose
Build server-side label, packing slip, and QR code generation for GreenReach -- product labels, shipping labels, packing slips, and the existing QR tray label generator.

## Context
- PDFKit is already in package.json (used only for grant-wizard.js currently)
- QR generator frontend exists at `public/LE-qr-generator.html` calling:
  - `GET /api/qr-generator/available-range?farmId=&prefix=` (MISSING)
  - `POST /api/qr-generator/generate` (MISSING)
  - `POST /api/qr-generator/generate-groups` (MISSING from groups-v2.js)
- Linked from 5+ farm UI pages (LE-farm-admin.html, farm-summary.html, tray-inventory.html, planting-scheduler.html)
- Packing slip is currently a raw innerHTML dump via `window.print()` in farm-admin.js:2946
- No barcode library in package.json (need bwip-js or similar)
- No thermal/ZPL printer support

## Implementation Plan

### 1. Install Dependencies
```bash
npm install qrcode bwip-js
```
- `qrcode` -- QR code PNG/SVG generation (small, no native deps)
- `bwip-js` -- barcode generation (Code128, EAN-13, etc.)

### 2. QR Generator Backend
File: `routes/qr-generator.js`

Endpoints:
- `GET /api/qr-generator/available-range?farmId=&prefix=` -- check existing QR codes and return next available sequence range
- `POST /api/qr-generator/generate` -- generate PDF sheet of sequential QR codes
  - Body: `{ farmId, prefix, startNumber, count, labelSize }`
  - Response: PDF stream (Content-Type: application/pdf)
  - Use PDFKit to render grid of QR codes with labels beneath each
- `POST /api/qr-generator/generate-groups` -- generate QR codes for group/room IDs

Mount in server.js: `app.use('/api/qr-generator', authMiddleware, qrGeneratorRouter);`

### 3. Product Label Generator
File: `routes/labels.js`

Endpoints:
- `POST /api/labels/product` -- generate product label PDF
  - Body: `{ farmId, products: [{ name, sku, lot_code, weight, unit, harvest_date }], labelSize }`
  - Include: farm name, product name, lot code barcode, harvest date, weight, "Product of Canada"
- `POST /api/labels/shipping` -- generate shipping label PDF
  - Body: `{ orderId }` -- pulls order data for address, farm return address
- `GET /api/labels/packing-slip/:orderId` -- structured packing slip PDF
  - Line items with quantities, weights, lot codes
  - Order total, delivery date, special instructions
  - Farm name and address header

Label sizes to support:
- `4x6` -- standard shipping label
- `2x1` -- small product label
- `4x3` -- medium product label (default)
- `letter` -- full page packing slip

### 4. PDFKit Template Helpers
File: `services/labelTemplateService.js`
- `renderProductLabel(doc, product, options)` -- reusable label rendering
- `renderQRCode(doc, data, x, y, size)` -- QR code placement helper
- `renderBarcode(doc, data, x, y, options)` -- barcode placement helper
- `renderPackingSlip(doc, order)` -- full packing slip layout

### 5. Integration
- Replace `printPackingSlip()` in farm-admin.js to call `/api/labels/packing-slip/:orderId` and open the PDF
- POS checkout receipt: add QR code linking to order lookup page
- Wholesale order detail: add "Print Packing Slip" and "Print Shipping Label" buttons

## Validation Checklist
- [ ] QR generator endpoints respond (fix dead 404s)
- [ ] Product labels include lot code, farm name, harvest date
- [ ] Packing slips include line items with lot codes
- [ ] Shipping labels include buyer delivery address
- [ ] PDF generation does not block event loop (use streams)
- [ ] Existing tests pass (44/44)
- [ ] No XSS in label content (sanitize all text inputs before PDF rendering)

## Rules
- Currency is always CAD
- No emojis in any output
- No fabricated fees
- PDFKit is already available -- no need for new PDF libs
- Test with `npm test -- --runInBand`
- Deploy with `eb deploy --staged`
