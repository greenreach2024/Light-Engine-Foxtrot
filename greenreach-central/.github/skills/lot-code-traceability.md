# Skill: Lot Code and Traceability System

## Purpose
Implement end-to-end lot code generation, assignment, and traceability for GreenReach farms -- from harvest through order fulfillment to customer receipt and recall capability.

## Context
- Platform: Node.js ESM / Express / PostgreSQL
- Existing lot_code references: optional JSONB field in `experiment_records.outcomes`, free-text in lab reports (`quality-reports.js`), synthetic traceability_id in wholesale-admin.js client-side export
- Traceability proxy endpoints exist in server.js (lines 2003-2055) forwarding to farm edge servers but Central stores zero traceability data itself
- Recall endpoint (`email-routes.js:88`) exists but calls `emailService.sendRecallNotification()` which does not exist -- will crash at runtime
- ESG scoring engine checks `experiment_records.outcomes->>'lot_code'` for traceability percentage

## Implementation Plan

### 1. Database Schema
Create migration `XXX_create_lot_codes.sql`:
```sql
CREATE TABLE lot_codes (
  id SERIAL PRIMARY KEY,
  lot_code VARCHAR(64) UNIQUE NOT NULL,
  farm_id VARCHAR(255) NOT NULL,
  crop VARCHAR(255),
  group_id VARCHAR(255),
  harvest_date DATE,
  quantity NUMERIC(10,2),
  unit VARCHAR(50) DEFAULT 'kg',
  status VARCHAR(30) DEFAULT 'active',  -- active, recalled, expired
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_lot_codes_farm ON lot_codes(farm_id);
CREATE INDEX idx_lot_codes_crop ON lot_codes(crop);
CREATE INDEX idx_lot_codes_status ON lot_codes(status);
```

Create `lot_code_order_links` table:
```sql
CREATE TABLE lot_code_order_links (
  id SERIAL PRIMARY KEY,
  lot_code VARCHAR(64) REFERENCES lot_codes(lot_code),
  order_id VARCHAR(64) NOT NULL,
  sku_id VARCHAR(255),
  quantity NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_lcol_lot ON lot_code_order_links(lot_code);
CREATE INDEX idx_lcol_order ON lot_code_order_links(order_id);
```

### 2. Lot Code Generation Function
File: `services/lotCodeService.js`
- Format: `{FARM_PREFIX}-{CROP_CODE}-{YYYYMMDD}-{SEQ}` (e.g., `GR01-BAS-20260315-001`)
- Auto-generate on harvest status change in `planting_assignments`
- Expose: `generateLotCode(farmId, crop, harvestDate)`, `assignLotToOrder(lotCode, orderId, skuId, qty)`
- Reverse lookup: `getOrdersByLotCode(lotCode)`, `getLotCodesByOrder(orderId)`

### 3. Route Endpoints
File: `routes/traceability.js`
- `POST /api/traceability/lot-codes` -- generate a new lot code
- `GET /api/traceability/lot-codes?farm_id=&crop=&status=` -- list lot codes
- `GET /api/traceability/lot-codes/:lotCode` -- lot code detail + linked orders
- `GET /api/traceability/lot-codes/:lotCode/orders` -- reverse lookup (which orders got this lot?)
- `POST /api/traceability/lot-codes/:lotCode/recall` -- initiate recall (set status, email affected buyers)
- `GET /api/traceability/export` -- CSV export with lot codes

### 4. Integration Points
- Wholesale checkout (`routes/wholesale.js`): attach lot_code to order line items, insert into `lot_code_order_links`
- POS checkout (`routes/farm-sales.js`): same lot code linkage for direct sales
- Wholesale exports (`routes/wholesale-exports.js`): add `lot_code` column to order CSV
- Client-side compliance export (`wholesale-admin.js`): replace synthetic traceability_id with real lot codes

### 5. Fix Recall Email
File: `services/email-service.js`
- Add `sendRecallNotification({ to, lotCode, productName, reason, customerName })` method
- Template: plain text with lot code, product, reason, and action instructions

## Validation Checklist
- [ ] Lot codes auto-generated at harvest
- [ ] Lot codes flow: farm -> product -> order line items -> customer receipt
- [ ] Reverse lookup works: lot code -> all affected orders/buyers
- [ ] Recall notification emails send successfully
- [ ] CSV exports include lot_code column
- [ ] ESG traceability scoring still works
- [ ] Existing tests pass (44/44)

## Rules
- Currency is always CAD
- No emojis in any output
- No fabricated fees
- Test with `npm test -- --runInBand` before deploying
- Deploy with `eb deploy --staged` (not just git push)
