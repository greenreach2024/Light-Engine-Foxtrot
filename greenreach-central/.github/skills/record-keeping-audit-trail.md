# Skill: Record Keeping and Audit Trail

## Purpose
Harden data persistence and auditability across GreenReach -- farm settings to DB, inventory change logging, fulfillment email notifications, and recall email fixes.

## Context
- Farm settings (business info, delivery preferences, tax rates) are currently stored in volatile JSONB `farmStore` Map objects that reset on server restart
- Inventory changes (add, decrement, adjust) have no audit trail
- Fulfillment status changes (pending -> processing -> fulfilled -> delivered) send no email notifications
- Recall email endpoint (`POST /api/lots/:lotCode/recall`) crashes because it references undefined `lot.contact_emails`
- PostgreSQL DB has 70+ tables but no `farm_settings` or `inventory_audit_log` tables
- Notification system is partially wired (order confirmation emails exist)

## Implementation Plan

### 1. Farm Settings Persistence
Table: `farm_settings`
```sql
CREATE TABLE IF NOT EXISTS farm_settings (
  id SERIAL PRIMARY KEY,
  farm_id TEXT NOT NULL UNIQUE,
  business_name TEXT,
  business_address JSONB,
  contact_email TEXT,
  contact_phone TEXT,
  tax_rate NUMERIC(5,4) DEFAULT 0,
  delivery_preferences JSONB DEFAULT '{}',
  payment_preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

File: `services/farmSettingsService.js`
- `getFarmSettings(farmId)` -- DB lookup with farmStore fallback
- `saveFarmSettings(farmId, settings)` -- upsert to DB + update farmStore
- On server startup, hydrate farmStore from DB

Integration points:
- `routes/farm-sales.js` `/settings` endpoints -- use service instead of raw farmStore
- POS checkout -- pull tax rate from DB-backed settings
- Label generation -- pull business name/address from DB

### 2. Inventory Change Audit Trail
Table: `inventory_audit_log`
```sql
CREATE TABLE IF NOT EXISTS inventory_audit_log (
  id SERIAL PRIMARY KEY,
  farm_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT,
  change_type TEXT NOT NULL CHECK (change_type IN ('add', 'decrement', 'adjust', 'pos_sale', 'wholesale_fulfill', 'import')),
  quantity_before NUMERIC,
  quantity_after NUMERIC,
  quantity_delta NUMERIC NOT NULL,
  reference_id TEXT,
  actor TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inventory_audit_farm ON inventory_audit_log(farm_id);
CREATE INDEX idx_inventory_audit_product ON inventory_audit_log(farm_id, product_id);
```

File: `services/inventoryAuditService.js`
- `logInventoryChange({ farmId, productId, productName, changeType, before, after, delta, referenceId, actor, notes })`
- `getInventoryHistory(farmId, productId, options)` -- paginated history for product

Integration points:
- POS checkout (farm-sales.js) -- log `pos_sale` on inventory decrement
- Wholesale fulfillment (wholesale-fulfillment.js) -- log `wholesale_fulfill`
- Manual inventory adjustment (farm-sales.js /inventory endpoints) -- log `adjust`
- CSV import (farm-sales.js) -- log `import`

### 3. Fulfillment Status Email Notifications
File: `services/fulfillmentNotificationService.js`

Trigger points (in `routes/wholesale-fulfillment.js` and `routes/admin-wholesale.js`):
- `fulfilled` -- email buyer: "Your order {orderId} has been fulfilled and is being prepared for delivery"
- `shipped` / `out_for_delivery` -- email buyer: "Your order is on the way" with tracking number if available
- `delivered` -- email buyer: "Your order has been delivered"
- `cancelled` -- email buyer: "Your order has been cancelled" with reason

Template pattern: match existing order confirmation email format and branding.

### 4. Recall Email Fix
Current bug: `POST /api/lots/:lotCode/recall` crashes with `Cannot read properties of undefined (reading 'contact_emails')`

Fix:
1. Look up lot code in `lot_codes` table (once it exists -- see lot-code-traceability.md skill)
2. Join `lot_code_order_links` to find affected orders
3. Pull buyer emails from orders, NOT from `lot.contact_emails` (which does not exist)
4. Until lot_codes table exists: return 501 with message "Lot code tracking not yet configured"

### 5. Migration Script
File: `migrations/005-record-keeping.sql`
- Create `farm_settings` table
- Create `inventory_audit_log` table
- Migrate any existing farmStore data (if server is running, export first)

## Validation Checklist
- [ ] Farm settings survive server restart
- [ ] Inventory changes logged with before/after quantities
- [ ] POS sale decrements appear in audit log
- [ ] Fulfillment status email sent on state transition
- [ ] Recall endpoint does not crash (returns 501 until lot codes exist)
- [ ] All 44 existing tests pass
- [ ] No inventory audit log gaps (every code path that changes quantity is covered)

## Rules
- Currency is always CAD
- No emojis in any output
- No fabricated fees or pricing
- Wholesale broker fee is 12% (collected via Square app_fee_money)
- Square credentials are production -- never downgrade to sandbox
- Test with `npm test -- --runInBand`
- Deploy with `eb deploy --staged`
