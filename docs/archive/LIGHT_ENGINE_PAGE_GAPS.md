# Light Engine — Page Gaps & Required Work

> Living document. Updated as each page is reviewed.
> Started: 2026-03-02

---

## 1. Advanced Inventory Management

**Location:** `greenreach-central/public/LE-farm-admin.html` — `section-inventory-mgmt` (lines 1440–1920)

### Frontend Bugs

| # | Severity | Description | File / Lines |
|---|----------|-------------|--------------|
| 1 | **HIGH** | Nutrients tab (`suppliesContent-nutrients`) contains Packaging Materials content instead of Nutrient Solutions. Clicking "Nutrients" shows packaging table + "Add Packaging" button. | `LE-farm-admin.html` L1521–1545 |
| 2 | **HIGH** | Actual Nutrient Solutions content is in orphaned div `invContent-nutrients` with class `inv-tab-content` (should be `supplies-tab-content`). `showSuppliesTab('nutrients')` never displays it. | `LE-farm-admin.html` L1546–1578 |
| 3 | **HIGH** | No `suppliesContent-packaging` div exists — Packaging tab shows nothing when clicked. | `LE-farm-admin.html` (missing) |

**Fix:** Rename `suppliesContent-nutrients` → `suppliesContent-packaging`; rename `invContent-nutrients` → `suppliesContent-nutrients` and change its class to `supplies-tab-content`.

### Backend — Missing API Endpoints

The frontend JS calls 19+ endpoints under `/api/inventory/` that do not exist in `greenreach-central/routes/inventory.js`. The backend only has `/current`, `/forecast/:days?`, `/:farmId/sync`, and `/:farmId`.

| Category | Missing Endpoints |
|----------|-------------------|
| Dashboard | `GET /dashboard`, `GET /reorder-alerts` |
| Seeds | `GET /seeds/list`, `GET /seeds/:id`, `POST /seeds`, `PUT /seeds/:id` |
| Nutrients | `GET /nutrients/list`, `GET /nutrients/:id`, `POST /nutrients/:id/usage`, `POST /nutrients/usage` |
| Packaging | `GET /packaging/list`, `GET /packaging/:id`, `POST /packaging`, `POST /packaging/:id/restock` |
| Equipment | `GET /equipment/list`, `GET /equipment/:id`, `POST /equipment/:id/maintenance`, `POST /equipment/maintenance` |
| Lab Supplies | `GET /supplies/list`, `GET /supplies/:id`, `POST /supplies/:id/usage`, `POST /supplies/usage` |
| Usage | `GET /usage/weekly-summary` |

### Database — Missing Tables

No tables exist for the five inventory categories. Required:

- `farm_seeds` — variety, quantity_grams, grow_media_kg, supplier, expiration_date, notes, added_date, farm_id
- `farm_nutrients` — type, name, volume_ml, volume_remaining_ml, concentration, expiration_date, farm_id
- `farm_packaging` — type, name, quantity, unit, reorder_point, cost_per_unit, supplier, farm_id
- `farm_equipment` — name, category, status, last_maintenance, next_maintenance, maintenance_interval_days, farm_id
- `farm_lab_supplies` — name, quantity, unit, reorder_threshold, last_used, farm_id
- `farm_inventory_usage_log` — item_type, item_id, quantity_used, date_used, applied_to/purpose, farm_id

### Frontend — Complete

- Dashboard stat cards (4) ✅
- Tab structure (5 tabs) ✅
- All modals (7): Add Seed, Edit Seed, Add Packaging, Restock Packaging, Record Nutrient Usage, Log Maintenance, Record Supply Usage ✅
- All JS functions: load, submit, open/close for every category ✅
- Alert badges, status badges, reorder alerts display ✅
- Weekly usage integration in Seeds & Nutrients tables ✅

---

## 2. Procurement Portal

**Location:** `greenreach-central/public/views/procurement-portal.html` (1258 lines, standalone page loaded via iframe from `LE-farm-admin.html`)

**Backend:** `greenreach-central/routes/procurement-admin.js` (419 lines), mounted at `/api/procurement` with `authMiddleware`

### Frontend — Complete (well-built)

- 4 tabs: Catalog, My Orders, Supply Inventory, Admin ✅
- Catalog with search, category filter pills, product cards, stock badges ✅
- Shopping cart sidebar with supplier grouping, qty controls, subtotals ✅
- Checkout modal with shipping address, payment method (Invoice/Square/Stripe), notes ✅
- Order listing table with status pills ✅
- Order detail view with supplier-grouped line items, shipping info, payment status, returns display ✅
- "Mark Received" workflow on orders ✅
- Supply Inventory tab (aggregated from received orders) ✅
- Admin tab with stats, supplier overview, commission report table ✅
- Cart persistence via localStorage ✅
- Toast notifications, responsive design, lazy-loaded tabs ✅

### API Contract Mismatches (Backend routes exist but response shapes don't match frontend)

| # | Severity | Endpoint | Problem |
|---|----------|----------|---------|
| 1 | **HIGH** | `GET /catalog` | Backend returns `categories` as string array `["seeds","nutrients"]`. Frontend expects objects `[{id, name, icon, sortOrder}]` — calls `c.id`, `c.icon`, `c.name`, `c.sortOrder`. Category pills will show `undefined`. |
| 2 | **HIGH** | `POST /orders` | Frontend sends `{items, shippingAddress, paymentMethod, notes}`. Backend expects `{items, supplierId, notes, farmId}` — doesn't accept/store `shippingAddress` or `paymentMethod`. Frontend doesn't send `supplierId` (multi-supplier cart). |
| 3 | **HIGH** | `POST /orders` response | Frontend reads `data.order.orderId`. Backend returns `data.order.id`. Order ID won't display. |
| 4 | **HIGH** | `GET /orders` | Frontend reads `o.orderId`, `o.itemCount`, `o.subtotal`, `o.paymentStatus`. Backend returns `o.id` (not `orderId`), no `itemCount`, no `paymentStatus` field. Orders table will show `undefined` in multiple columns. |
| 5 | **HIGH** | `GET /orders/:orderId` | Frontend reads `o.orderId`, per-item `unitPrice`, `saleUnit`, `lineTotal`, `status`, `supplierName`, `trackingNumber`, `carrier`. Backend returns `o.id`, items with `price`/`total` (not `unitPrice`/`lineTotal`), no per-item `status`, no `supplierName`, no tracking fields. |
| 6 | **HIGH** | `GET /inventory` | Frontend reads `data.supplies[]` with fields `name, category, qtyOnHand, standardUnit, minStockLevel, lastRestockedAt`. Backend returns `data.inventory[]` with fields `sku, name, quantity, lastReceived`. Different array name and different field names — table will be empty or error. |
| 7 | **HIGH** | `GET /commission-report` | Frontend reads `data.grandTotal`, `data.grandCommission`, `data.orderCount`, `data.suppliers[]` with `supplierName, orderCount, totalSales, totalCommission`. Backend returns `data.totalRevenue`, `data.totalCommission`, `data.totalOrders` — no `suppliers` array, no per-supplier breakdown, different field names. |
| 8 | **MED** | `POST /orders/:orderId/receive` | Frontend reads `data.received` (item count). Backend returns `data.order` object. Toast will show `undefined item(s) received`. |

### Missing Catalog Seed Data

The catalog reads from farmStore key `procurement_catalog`. Unless this has been populated via `PUT /catalog/product`, the catalog will be empty on first load. There is no migration or seed script to populate default products for a farm.

### Missing Features (functional gaps)

| # | Feature | Detail |
|---|---------|--------|
| 1 | Order status updates | No endpoint to change order status to `confirmed`, `shipped`, `cancelled`. Only `receive` exists. Supplier-side status management doesn't exist. |
| 2 | Per-item tracking numbers | Frontend displays `trackingNumber` and `carrier` per item, but backend never stores these. |
| 3 | Returns / RMA | Frontend renders `order.returns[]` with RMA IDs, items, reasons, refund amounts. No backend endpoint to create or manage returns. |
| 4 | Payment status tracking | Frontend shows `paymentStatus` column. Backend doesn't track payment status at all. |
| 5 | Supply Inventory min-stock alerts | Frontend shows red color for items at/below `minStockLevel`. Backend doesn't store or return `minStockLevel`, `category`, `standardUnit`. |
| 6 | Reorder from inventory | No way to reorder low-stock items directly from the Supply Inventory tab. |

### Summary

The Procurement Portal has a **polished, complete frontend** but the backend API contracts are misaligned on nearly every endpoint. None of the data will render correctly in the current state because field names and response structures differ between what the frontend reads and what the backend returns.

---

## 3. _(next page review)_

---

## Summary

| Page | Frontend | Backend | Database | Status |
|------|----------|---------|----------|--------|
| Advanced Inventory Management | 85% (tab swap bug) | 0% (19 endpoints missing) | 0% (6 tables needed) | **Incomplete** |
| Procurement Portal | 95% (complete) | 60% (routes exist, 8 contract mismatches) | N/A (uses farmStore) | **Broken — API mismatch** |
