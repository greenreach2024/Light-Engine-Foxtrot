# Custom Farm Product Entry -- Feature Overview

**Version**: 1.0.0
**Date**: March 28, 2026
**Status**: Implementation (Phases 1-6 complete, deploy pending)
**Scope**: Wholesale marketplace + Farm POS terminal

---

## 1. Purpose

Farms need the ability to add custom products that do not exist in the GreenReach managed catalog (tray-sync pipeline). Examples: value-added goods (jams, sauces), specialty bundles, seasonal items, or crops grown outside the sensor-tracked system. Custom products must receive identical treatment to auto-synced products across all sales channels.

---

## 2. Requirements

| # | Requirement | Detail |
|---|-------------|--------|
| R1 | Custom product creation | Farm admin can create products with name, SKU, category, pricing, quantity, unit |
| R2 | Description field | Short text description displayed on wholesale catalog and POS |
| R3 | Thumbnail image upload | Single image per product, displayed on catalog cards and POS grid |
| R4 | Per-product tax status | Taxable vs tax-exempt flag per product |
| R5 | Wholesale availability | Custom products appear in wholesale catalog alongside auto-synced products |
| R6 | POS availability | Custom products appear in POS terminal product grid |
| R7 | Commission parity | 12% broker fee (WHOLESALE_COMMISSION_RATE) applies identically |
| R8 | Checkout parity | Buyer checkout, invoicing, and fulfillment treat custom products the same |
| R9 | Order allocation | Custom products are allocatable by the order allocator |
| R10 | Edit and delete | Farm admin can update or remove custom products |

---

## 3. Current State Analysis

### 3.1 Product Data Pipeline (Today)

```
Sensor Sync (SwitchBot)                Manual Entry (F.A.Y.E.)
       |                                        |
  auto_quantity_lbs                     manual_quantity_lbs
       |                                        |
       +------ farm_inventory TABLE ------+
       |                                        |
  inventory_source = 'auto'         inventory_source = 'manual'
       |                                        |
       +------------ quantity_available = auto + manual - sold
                              |
              +---------------+---------------+
              |                               |
     Wholesale Catalog API              POS Inventory API
     GET /api/wholesale/catalog         GET /api/farm-sales/inventory
     (WHERE available_for_wholesale)    (STUB -- returns empty [])
              |                               |
     GR-wholesale.html                farm-sales-pos.html
     (Buyer marketplace)              (Farm terminal)
```

### 3.2 What Exists

| Component | Status | Location |
|-----------|--------|----------|
| `farm_inventory` table | ACTIVE | greenreach-central/config/database.js line 459 |
| Wholesale catalog query | ACTIVE | routes/wholesale/catalog.js line 70 |
| Order allocator | ACTIVE | lib/wholesale/order-allocator.js |
| Admin UI "Add Product" button | STUB | central-admin.js line 10113 (browser prompt + alert) |
| Admin UI "Edit Product" button | STUB | central-admin.js line 10129 (alert only) |
| POS inventory endpoint | STUB | greenreach-central/routes/farm-sales.js line 263 (returns []) |
| POS product grid | ACTIVE | farm-sales-pos.html (renders from API response) |
| POS tax calculation | ACTIVE | farm-sales-pos.html (reads `is_taxable` per item, 8% rate) |
| F.A.Y.E. manual inventory tool | ACTIVE | assistant-chat.js line 650 (updates manual_quantity_lbs) |

### 3.3 What Is Missing

| Component | Gap |
|-----------|-----|
| `description` column | Not on farm_inventory |
| `thumbnail_url` column | Not on farm_inventory |
| `is_taxable` column | Not on farm_inventory (POS HTML expects it but DB lacks it) |
| `is_custom` flag | No way to distinguish custom vs auto-synced products |
| Custom product API | No POST/PUT/DELETE endpoints for product CRUD |
| Custom SKU generation | No logic to mint unique SKUs for custom products |
| Image upload endpoint | No multer/multipart handling for product images |
| Image storage | No dedicated directory or S3 bucket for product thumbnails |
| Admin product modal | Stub uses browser prompt(), needs real modal form |
| POS inventory query | Stub returns empty array, needs farm_inventory SELECT |
| Wholesale catalog: description | Catalog API does not return or display description |
| Wholesale catalog: thumbnail | Catalog API does not return or display images |
| Wholesale catalog: tax flag | Catalog API does not return is_taxable |

---

## 4. Architecture Plan

### 4.1 Schema Changes (farm_inventory)

New columns via ALTER TABLE:

```sql
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500);
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN DEFAULT TRUE;
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT FALSE;
```

- `description`: Free text, displayed on catalog cards and POS
- `thumbnail_url`: Relative path to uploaded image (e.g., `/product-images/FARM-XXX/SKU-001.webp`)
- `is_taxable`: Default TRUE (most products taxable). POS already reads this field
- `is_custom`: Distinguishes custom products from auto-synced. Prevents auto-sync from overwriting custom entries

### 4.2 Custom Product API

New route file: `greenreach-central/routes/custom-products.js`
Mounted at: `/api/farm/products` in Central server.js

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/farm/products | List custom products for authenticated farm |
| POST | /api/farm/products | Create custom product |
| PUT | /api/farm/products/:productId | Update custom product |
| DELETE | /api/farm/products/:productId | Soft-delete (set status='inactive') |
| POST | /api/farm/products/:productId/image | Upload thumbnail image |

**POST /api/farm/products** request body:
```json
{
  "product_name": "Strawberry Jam",
  "category": "Value-Added",
  "description": "Homemade jam from farm-fresh strawberries",
  "wholesale_price": 8.50,
  "retail_price": 12.00,
  "quantity_available": 24,
  "unit": "jar",
  "is_taxable": true,
  "available_for_wholesale": true
}
```

**SKU Generation**: `CUSTOM-{FARM_SHORT}-{TIMESTAMP_HEX}`
- Example: `CUSTOM-MLTP-6A3F1B2C`
- Guarantees uniqueness via farm prefix + time-based hex

### 4.3 Image Upload

- Middleware: multer (memory storage, 2MB limit, image/* MIME filter)
- Storage: `greenreach-central/public/product-images/{farm_id}/`
- Format: Accept JPEG/PNG/WebP, store original format
- Naming: `{sku}.{ext}` (overwrite on re-upload)
- Served via: Central static file serving (already serves greenreach-central/public/)
- URL stored: `/product-images/{farm_id}/{sku}.webp`

### 4.4 Auto-Sync Protection

The recalculateAutoInventoryFromGroups() function in inventory.js must skip rows where `is_custom = TRUE`. This prevents the tray-sync pipeline from zeroing out or overwriting custom products that have no sensor-tracked trays.

### 4.5 Data Flow After Implementation

```
                    +-- Custom Product API --+
                    |  POST /api/farm/products |
                    |  (manual creation)       |
                    +-----------+--------------+
                                |
                    is_custom=true, inventory_source='custom'
                                |
Sensor Sync ----+               |               +---- F.A.Y.E. Manual
(auto_qty_lbs)  |               |               |    (manual_qty_lbs)
                |               v               |
                +---- farm_inventory TABLE -----+
                |                               |
         is_custom=false                 is_custom=true
         (synced products)               (custom products)
                |                               |
                +---------- MERGED -----------+
                              |
              +---------------+---------------+
              |                               |
     Wholesale Catalog API              POS Inventory API
     (returns description,              (returns description,
      thumbnail_url, is_taxable)         thumbnail_url, is_taxable)
              |                               |
     GR-wholesale.html                farm-sales-pos.html
     (shows image + desc)             (shows image + desc)
```

---

## 5. Affected Files

### Must Modify

| File | Change |
|------|--------|
| greenreach-central/config/database.js | Add 4 columns to farm_inventory |
| greenreach-central/server.js | Mount custom-products router |
| greenreach-central/routes/farm-sales.js | Wire POS inventory endpoint to DB |
| greenreach-central/public/central-admin.js | Replace stubs with real product modal + API calls |
| greenreach-central/public/farm-sales-pos.html | Add thumbnail + description to product cards |
| greenreach-central/public/GR-wholesale.html | Add thumbnail + description to catalog cards |
| greenreach-central/public/js/wholesale.js | Handle new fields in catalog rendering |
| routes/wholesale/catalog.js | Include description, thumbnail_url, is_taxable in query |
| greenreach-central/routes/inventory.js | Skip is_custom rows in auto-sync |
| lib/wholesale/order-allocator.js | No changes needed (already uses sku_id match) |

### Must Create

| File | Purpose |
|------|---------|
| greenreach-central/routes/custom-products.js | Custom product CRUD API |
| greenreach-central/public/product-images/ | Image storage directory |

### Deploy Requirement

Both environments must be deployed:
- **Central** (greenreach-central-prod-v4): New routes, schema, static images
- **LE** (light-engine-foxtrot-prod-v3): Proxy routing for new API paths (if admin UI calls from LE context)

---

## 6. Risk Assessment

| Risk | Mitigation |
|------|------------|
| Auto-sync overwrites custom products | `is_custom` flag checked before any auto-sync UPDATE |
| Orphaned images on product delete | Soft-delete only (status='inactive'), images persist |
| Large image uploads slow requests | 2MB limit, multer memory storage, no resize pipeline needed at this scale |
| Existing catalog queries break | New columns have defaults (description=NULL, is_taxable=TRUE, is_custom=FALSE) |
| Order allocator skips custom products | Allocator already matches by sku_id -- custom SKUs will match if buyer adds them to cart |
| POS tax mismatch | POS already handles is_taxable per-item; DB column makes it real instead of assumed |

---

## 7. Out of Scope

- Multi-image gallery per product (single thumbnail only)
- Image resize/optimization pipeline (manual WebP conversion if desired)
- Barcode/UPC scanning for custom products
- Batch CSV import of custom products
- Custom product templates or duplication
- Tax rate configuration (remains 8% hardcoded in POS; wholesale tax handled by payment processor)
