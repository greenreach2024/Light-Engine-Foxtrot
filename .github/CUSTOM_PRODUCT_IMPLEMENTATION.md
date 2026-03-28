# Custom Farm Product Entry -- Implementation Plan

**Reference**: `.github/CUSTOM_PRODUCT_FEATURE.md`
**Date**: March 28, 2026 (Deployed)
**Status**: All 8 phases complete and deployed.

---

## Phase 1: Database Schema -- COMPLETE

### Task 1.1 -- Add columns to farm_inventory
**File**: `greenreach-central/config/database.js`
**Action**: Add 4 ALTER TABLE statements in the migration block

```sql
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500);
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN DEFAULT TRUE;
ALTER TABLE farm_inventory ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT FALSE;
```

**Verify**: Deploy Central, check columns exist via F.A.Y.E. or direct DB query.

---

## Phase 2: Custom Product API -- COMPLETE

### Task 2.1 -- Create custom-products.js route file
**File**: `greenreach-central/routes/custom-products.js` (NEW)
**Endpoints**:
- `GET /` -- List custom products for farm (WHERE farm_id = req.farmId AND is_custom = TRUE)
- `POST /` -- Create custom product (validate fields, generate SKU, INSERT into farm_inventory)
- `PUT /:productId` -- Update custom product (only if is_custom = TRUE)
- `DELETE /:productId` -- Soft-delete (SET status = 'inactive')
- `POST /:productId/image` -- Upload thumbnail (multer, 2MB limit, image/* MIME)

**SKU format**: `CUSTOM-{FARM_SHORT}-{TIMESTAMP_HEX}`
**inventory_source**: `'custom'`
**is_custom**: `TRUE`

**Dependencies**: multer (npm install), fs/path for image storage

### Task 2.2 -- Mount router in Central server.js
**File**: `greenreach-central/server.js`
**Action**: Import and mount at `/api/farm/products`
**Auth**: Must require farm auth (same as other /api/farm/* routes)

### Task 2.3 -- Create product-images directory
**Path**: `greenreach-central/public/product-images/`
**Action**: Create directory, add .gitkeep
**Note**: Farm-specific subdirectories created on first upload (e.g., `product-images/FARM-MLTP9LVH-B0B85039/`)

---

## Phase 3: Auto-Sync Protection -- COMPLETE

### Task 3.1 -- Guard custom products from auto-sync overwrite
**File**: `greenreach-central/routes/inventory.js`
**Function**: `recalculateAutoInventoryFromGroups()`
**Action**: Add WHERE clause `AND (is_custom IS NULL OR is_custom = FALSE)` to the UPDATE query
**Verify**: Create a custom product, run auto-sync, confirm custom product unchanged

---

## Phase 4: Wholesale Catalog Integration -- COMPLETE

### Task 4.1 -- Extend catalog query to include new fields
**File**: `routes/wholesale/catalog.js`
**Action**: Add `description`, `thumbnail_url`, `is_taxable` to the SELECT clause in the catalog query
**Impact**: All catalog consumers automatically receive new fields

### Task 4.2 -- Update wholesale catalog UI
**File**: `greenreach-central/public/GR-wholesale.html` + `greenreach-central/public/js/wholesale.js`
**Action**:
- Render thumbnail image on product cards (with fallback placeholder)
- Display description text below product name
- Pass is_taxable through to cart for checkout tax calculation

---

## Phase 5: POS Integration -- COMPLETE

### Task 5.1 -- Wire POS inventory endpoint to database
**File**: `greenreach-central/routes/farm-sales.js`
**Current**: Stub at line 263 returning empty array
**Action**: Replace stub with actual farm_inventory query:
```sql
SELECT sku AS sku_id, product_name AS name, retail_price, 
       COALESCE(quantity_available, 0) AS available, unit, category,
       COALESCE(is_taxable, true) AS is_taxable, lot_code,
       description, thumbnail_url
FROM farm_inventory
WHERE farm_id = $1 AND status != 'inactive'
  AND COALESCE(quantity_available, 0) > 0
ORDER BY category, product_name
```

### Task 5.2 -- Update POS product cards with thumbnail + description
**File**: `greenreach-central/public/farm-sales-pos.html`
**Action**:
- Add thumbnail image to product card (with CSS fallback for no-image)
- Add description tooltip or subtitle
- Ensure is_taxable flows through addToCart() to tax calculation (already partially implemented)

---

## Phase 6: Admin UI -- COMPLETE

### Task 6.1 -- Replace showAddProductModal() stub
**File**: `greenreach-central/public/central-admin.js`
**Current**: Line 10113 -- browser prompt() + alert("coming soon")
**Action**: Build real modal form with fields:
- Product name (text, required)
- Category (select: Vegetables, Greens, Herbs, Fruits, Microgreens, Value-Added, Bundle)
- Description (textarea)
- Wholesale price (number)
- Retail price (number)
- Quantity available (number)
- Unit (select: lb, head, pint, bunch, jar, unit, bag)
- Taxable (checkbox, default checked)
- Available for wholesale (checkbox, default checked)
- Thumbnail image (file input)
**Submit**: POST /api/farm/products, then POST image if file selected

### Task 6.2 -- Replace editProduct() stub
**File**: `greenreach-central/public/central-admin.js`
**Current**: Line 10129 -- alert() only
**Action**: Open same modal pre-filled with existing product data (GET product, populate form)
**Submit**: PUT /api/farm/products/:productId

### Task 6.3 -- Add delete product action
**File**: `greenreach-central/public/central-admin.js`
**Action**: Confirmation dialog, then DELETE /api/farm/products/:productId
**UI**: Add delete button to product row/card in renderProductCatalog()

---

## Phase 7: Sync to Root Public (LE Deploy) -- COMPLETE

### Task 7.1 -- Copy modified files to root public/
**Files to sync** (if they exist in root public/):
- farm-sales-pos.html (if served from LE context)
**Note**: POS is primarily served from Central. Verify if LE serves it via embedded iframe or direct access.

---

## Phase 8: Testing and Deployment -- COMPLETE

### Task 8.1 -- Local verification
- Create custom product via API
- Verify it appears in wholesale catalog
- Verify it appears in POS terminal
- Verify image upload and display
- Verify tax calculation uses is_taxable flag
- Verify auto-sync does not overwrite custom product
- Verify edit and soft-delete work

### Task 8.2 -- Deploy Central
```bash
cd greenreach-central && /Users/petergilbert/Library/Python/3.9/bin/eb deploy greenreach-central-prod-v4 --staged
```

### Task 8.3 -- Deploy LE (if root public/ files changed)
```bash
cd /Volumes/CodeVault/Projects/Light-Engine-Foxtrot && /Users/petergilbert/Library/Python/3.9/bin/eb deploy light-engine-foxtrot-prod-v3 --staged
```

### Task 8.4 -- Production verification
- Log into farm admin, create a test custom product
- Check wholesale catalog at greenreachgreens.com
- Check POS terminal
- Verify commission applies on mock checkout

---


---

## Deployment Results

**Commit**: `ae184bbe` -- "feat: Custom farm product entry - full CRUD, wholesale, POS, admin UI"
**Files Changed**: 18 files, 1728 insertions, 303 deletions

| Environment | Status | Timestamp (UTC) |
|-------------|--------|-----------------|
| Central (`greenreach-central-prod-v4`) | Deployed successfully, Health: Green | 2026-03-28 14:45:34 |
| LE (`light-engine-foxtrot-prod-v3`) | Deployed successfully, instance recovered | 2026-03-28 14:51:16 |

**DB Migration**: Migration 026 runs on Central startup (ALTER TABLE IF NOT EXISTS -- idempotent).

## Dependency Graph

```
Phase 1 (Schema)
    |
    +---> Phase 2 (API) ---> Phase 3 (Sync Guard)
    |         |
    |         +---> Phase 4 (Wholesale UI)
    |         |
    |         +---> Phase 5 (POS)
    |         |
    |         +---> Phase 6 (Admin UI)
    |
    +---> Phase 7 (LE Sync) ---> Phase 8 (Deploy + Test)
```

Phases 4, 5, and 6 can be worked in parallel after Phase 2 is complete.

---

## npm Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| multer | ^1.4.5-lts.1 | Multipart form-data handling for image uploads |

**Install in**: `greenreach-central/` (not root)
```bash
cd greenreach-central && npm install multer
```
