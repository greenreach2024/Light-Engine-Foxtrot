# Light Engine — Page Update & Completion Proposal

> **Date:** 2026-03-02  
> **Status:** AWAITING REVIEW — Do not implement until approved  
> **Reference:** `LIGHT_ENGINE_PAGE_GAPS.md` (710 lines, 8 pages reviewed)

---

## Executive Summary

The Light Engine farm admin interface (`LE-farm-admin.html`) has **21 nav items** across 5 sections. Of these:

- **12 are iframe-embedded pages** (standalone HTML files) — all files exist and are functional; excluded from this proposal
- **8 inline sections** were fully reviewed and documented in `LIGHT_ENGINE_PAGE_GAPS.md`
- **1 section** (Help & Docs) is a stub placeholder

Of the 8 reviewed inline sections, **none are fully functional end-to-end**. Common patterns:
- API contract mismatches (field names differ between frontend and backend)
- Commented-out API calls (write operations bypass the server)
- Missing DOM elements referenced by JS (causing crashes or silent failures)
- localStorage-only persistence (data lost across devices/browsers)
- Orphaned JS systems (competing implementations never reconciled)

This proposal orders updates by **risk level** (lowest first) and **impact** (highest first), with coordinated GRC + Foxtrot changes per page, deploy + verify after each.

---

## Critical Constraint: Data Flow Safety

**Active data flows that MUST NOT be disrupted:**

| Flow | Path | Risk Level |
|------|------|------------|
| Farm sync (crop groups, rooms, recipes) | Foxtrot → `POST /api/sync/*` → GRC `farm_data` table → farmStore | **DO NOT TOUCH** |
| Harvest → Traceability auto-record | Foxtrot harvest endpoint → `createTraceRecord()` | **MODIFY WITH CARE** |
| Activity Hub → QA checkpoints | iPad → Foxtrot `ai-vision.js` → `qa_checkpoints` table | **READ-ONLY from QC page** |
| Wholesale orders | GRC buyer → `order-events` → farm notification | **DO NOT TOUCH** |
| Inventory current | Foxtrot `/api/inventory/current` → GRC proxy → Dashboard + Crop Value | **DO NOT TOUCH** |

**Safety protocol for each page update:**
1. Identify read vs. write paths
2. Add new endpoints — never modify existing endpoint signatures
3. Fix contract mismatches by adding adapter/translation, not by changing backend response shapes
4. Test in dev (port 3100/8091) before deploy
5. Verify existing flows post-deploy with smoke tests

---

## Page Update Order

### Phase 1: Crash Fixes & Wiring (1-2 days each)

These pages have working backends and mostly-complete frontends. Changes are limited to fixing broken references, uncommenting API calls, and aligning field names. **Lowest risk, highest immediate impact.**

---

### Page 1: Farm Settings
**Risk: LOW** | **Effort: 1 day** | **Files: 3**

| # | Change | File | Details |
|---|--------|------|---------|
| 1 | Fix `saveSettings()` crash | `farm-admin.js` | Change `default-ws3-discountmarkup` → `default-ws3-discount`. Remove reference to non-existent `default-retail-markup`. |
| 2 | Remove 3 phantom DOM refs | `farm-admin.js` | Add null guards for `greenreach-sync-enabled`, `greenreach-endpoint`, `settings-api-key` in both `loadSettings()` and `saveSettings()`. |
| 3 | Build Certifications Edit Modal | `LE-farm-admin.html` | Add `editCertificationsModal` HTML with cert checkboxes + practices checkboxes (matching setup wizard structure). Add "Edit" button to Certifications card. |
| 4 | Fix cert save endpoint | `farm-admin.js` | Change `POST /api/setup/certifications` → `POST /api/setup/farm-profile` with `{ certifications: [...], practices: [...] }` body (endpoint already exists). |
| 5 | Break out Tablet Pairing | `LE-farm-admin.html` | Move Tablet Device Pairing from inside Integration Settings card to its own dedicated card with prominent styling. |
| 6 | Remove API & Webhooks card | `LE-farm-admin.html` | Remove entirely — 100% non-functional placeholder that adds confusion. Can be re-added when a real webhook system is built. |
| 7 | Remove phantom hardware refs | `farm-admin.js` | Remove `scanHardware()` references to `hardware-lights`, `hardware-fans`, `hardware-sensors`, `hardware-other`. |
| 8 | Remove Square status refs from Settings | `farm-admin.js` | Stop calling `checkSquareStatus()` from `loadSettings()` — those elements are on the Payments page. |

**GRC backend changes:** None — delivery settings already work, cert save uses existing `/api/setup/farm-profile`.  
**Foxtrot changes:** None.  
**Data flow impact:** None — settings are localStorage + farmStore (no sync path affected).

**Post-deploy verification:**
- [ ] Click "Save Settings" — should NOT crash
- [ ] Edit Certifications modal opens, saves, values persist on reload
- [ ] Tablet Pairing QR code generates correctly
- [ ] Delivery Settings save and reload correctly
- [ ] Dashboard still loads, harvest data still flows

---

### Page 2: Users & Access Control
**Risk: LOW** | **Effort: 1 day** | **Files: 3**

| # | Change | File | Details |
|---|--------|------|---------|
| 1 | Uncomment + fix `sendUserInvitation()` | `farm-admin.js` | Convert invite flow to direct-create: call `POST /api/users/create` with email, name, role, and auto-generated temp password. Remove "personal message" field. Rename modal title to "Add User". |
| 2 | Uncomment + fix `saveUserChanges()` | `farm-admin.js` | Add `PATCH /api/users/update` backend route. Wire edit modal to call it with `{ email, role, status }`. |
| 3 | Uncomment + fix `removeUser()` | `farm-admin.js` | Change from `DELETE /api/users/${userId}` to `POST /api/users/delete` with `{ email }` body (matching existing backend). |
| 4 | Add `PATCH /api/users/update` | `routes/farm-users.js` | New endpoint: UPDATE `farm_users` SET `role`, `status` WHERE `email` AND `farm_id`. |
| 5 | Fix identifier: use `email` not `id` | `farm-admin.js` | System 1 uses numeric `user.id` — backend returns `email`. Change edit/remove to identify users by email. |
| 6 | Fix role badge CSS | `farm-admin.js` | Replace `rgba(${roleColors}, 0.1)` with proper hex fallbacks since `var()` doesn't work inside `rgba()`. |
| 7 | Remove System 2 dead code | `farm-admin.js` | Remove `initUserManagement()` block (L6480-6672) — its functionality will be merged into System 1. Keep `handlePasswordChange()` logic but wire it to the existing modal. |
| 8 | Add Change Password UI | `LE-farm-admin.html` | Add change-password form to Edit User modal (current password, new password, confirm). Wire to existing `POST /api/user/change-password`. |

**GRC backend changes:** Add 1 new route (`PATCH /api/users/update`) to `routes/farm-users.js`.  
**Foxtrot changes:** None.  
**Data flow impact:** None — `farm_users` table is independent of crop/sync data.

**Post-deploy verification:**
- [ ] Add User → creates user, appears in table on reload
- [ ] Edit User → change role → saves, reflected on reload
- [ ] Remove User → confirms, removes from table and database
- [ ] Change Password → works for the targeted user
- [ ] User list loads with correct role badges
- [ ] Existing farm login still works

---

### Page 3: Financial Summary + Data Exports  
**Risk: LOW** | **Effort: 1-2 days** | **Files: 4**

| # | Change | File | Details |
|---|--------|------|---------|
| 1 | Create Inventory Export endpoint | `routes/farm-sales.js` | `GET /api/farm-sales/inventory/export` — CSV of current inventory from `/api/inventory/current` data (or farmStore `inventory`). |
| 2 | Create Sales Transaction Export | `routes/farm-sales.js` | `GET /api/farm-sales/reports/sales-export` — CSV combining wholesale orders + POS transactions. |
| 3 | Create QuickBooks Daily Summary | `routes/farm-sales.js` | `GET /api/farm-sales/reports/quickbooks-daily-summary` — Aggregated revenue/expense summary in QuickBooks-compatible CSV format. |
| 4 | Wire `/api/farm-sales/orders` to real data | `routes/farm-sales.js` | Replace stub `{ orders: [] }` with query from wholesale `order_events` + POS `transactions` tables. Aggregate by period. |
| 5 | Remove 3 AI endpoint calls (graceful) | `farm-admin.js` | The calls to `/api/ai/insights/count`, `/api/ai/network-intelligence`, `/api/ai/suggested-crop` already fail silently. Add a comment that these are Phase 2 features. Keep the UI placeholders but show "Coming Soon" instead of "0". |
| 6 | Add QuickBooks connection UI placeholder | `LE-farm-admin.html` | Add QuickBooks status section to Financial Summary (matching the JS that already looks for `quickbooks-not-connected` / `quickbooks-connected` divs). Mark as "Coming Soon" since full OAuth integration is separate work. |

**GRC backend changes:** 3 new endpoints in `routes/farm-sales.js`, 1 endpoint data source change.  
**Foxtrot changes:** None.  
**Data flow impact:** LOW — reading from existing wholesale order data (read-only). Not modifying order flow. The `/api/farm-sales/orders` change replaces a stub with real reads — no write path changed.

**Post-deploy verification:**
- [ ] Financial Summary loads without error popup (already fixed)
- [ ] Revenue shows real data if wholesale orders exist
- [ ] Each of the 6 export buttons downloads a valid CSV
- [ ] Wholesale export buttons still work (regression check)
- [ ] No error toasts on page load

---

### Phase 2: API Contract Alignment (1-2 days each)

These pages have both frontend and backend but data doesn't render due to field name mismatches. Fixes use adapter patterns — translate backend response to match frontend expectations without modifying backend response shapes.

---

### Page 4: Seed-to-Sale Traceability  
**Risk: MEDIUM** | **Effort: 1 day** | **Files: 2**

⚠️ **This page touches the GRC↔Foxtrot proxy layer.** Changes must preserve the existing proxy passthrough behavior.

| # | Change | File | Details |
|---|--------|------|---------|
| 1 | Fix `ok` vs `success` flag | `farm-admin.js` | Change frontend checks from `if (data.ok)` to `if (data.ok \|\| data.success)` in `loadTraceRecords()`, `renderTraceRecords()`, `viewTraceDetail()`. This accepts both formats without breaking either GRC fallback or Foxtrot response. |
| 2 | Fix stats field names | `farm-admin.js` | Add fallback reads: `stats.total_records \|\| stats.total`, `stats.active_records \|\| stats.active`, `stats.crops_tracked \|\| stats.crops`, `stats.total_events \|\| stats.events`. |
| 3 | Fix weight field | `farm-admin.js` | Change `r.harvest_weight_g` to `r.actual_weight` with unit display from `r.weight_unit`. |
| 4 | Add QR code display | `LE-farm-admin.html` + `farm-admin.js` | In trace detail modal: fetch `GET /api/traceability/lot/:lotCode` and render QR code from `qr_payload` using QRCode library (already loaded for Tablet Pairing). |
| 5 | Add date range filter | `LE-farm-admin.html` + `farm-admin.js` | Add date picker inputs to filter bar. Pass `from_date`/`to_date` query params to existing backend support. |

**GRC backend changes:** None — proxy layer is untouched. The adapter is in the frontend only.  
**Foxtrot changes:** None — backend is already correct.  
**Data flow impact:** MEDIUM — we're changing how the frontend reads proxy responses, but NOT changing the proxy code or Foxtrot endpoints. The harvest → trace record auto-creation flow is completely untouched.

**Post-deploy verification:**
- [ ] Traceability page loads and shows trace records (not empty)
- [ ] Stats cards show real numbers (not 0 or undefined)
- [ ] Weight column shows values with units
- [ ] SFCR Export downloads valid CSV
- [ ] QR codes render in detail modal
- [ ] New harvest still creates a trace record (test via Activity Hub if possible)

---

### Page 5: Procurement Portal  
**Risk: LOW** | **Effort: 2 days** | **Files: 2**

The Procurement Portal is an iframe page (`/views/procurement-portal.html`) with its own backend at `routes/procurement-admin.js`. **No proxy layer involved** — all calls go directly to GRC.

| # | Change | File | Details |
|---|--------|------|---------|
| 1 | Fix `GET /catalog` categories | `routes/procurement-admin.js` | Change categories response from string array to objects: `[{ id, name, icon, sortOrder }]`. |
| 2 | Fix `POST /orders` request/response | `routes/procurement-admin.js` | Accept `shippingAddress` + `paymentMethod` fields. Support multi-supplier orders (group items by `supplierId`). Return `orderId` (not just `id`). |
| 3 | Fix `GET /orders` response | `routes/procurement-admin.js` | Add computed `itemCount`, `subtotal`, `paymentStatus` fields. Return `orderId` field (alias of `id`). |
| 4 | Fix `GET /orders/:orderId` response | `routes/procurement-admin.js` | Add `orderId` alias, rename `price`→`unitPrice`, `total`→`lineTotal`, add per-item `status`, `supplierName`, tracking fields. |
| 5 | Fix `GET /inventory` response | `routes/procurement-admin.js` | Change array name from `inventory` to `supplies`. Add `category`, `standardUnit`, `minStockLevel`, `qtyOnHand`, `lastRestockedAt` fields. |
| 6 | Fix `GET /commission-report` response | `routes/procurement-admin.js` | Add `grandTotal`, `grandCommission`, `orderCount`, `suppliers[]` breakdown. |
| 7 | Fix `POST /orders/:orderId/receive` response | `routes/procurement-admin.js` | Return `{ received: count }` alongside `{ order }`. |
| 8 | Add catalog seed data migration | New script | Create `scripts/seed-procurement-catalog.js` to populate default products (seeds, nutrients, packaging, equipment) for farms without catalog data. |

**GRC backend changes:** 7 endpoint response shape fixes in `procurement-admin.js`, 1 new seed script.  
**Foxtrot changes:** None.  
**Data flow impact:** NONE — Procurement is entirely self-contained within GRC using farmStore. No Foxtrot interaction.

**Post-deploy verification:**
- [ ] Catalog loads with category pills showing names + icons
- [ ] Add items to cart → checkout → order created with correct ID
- [ ] Order list shows all columns correctly (not undefined)
- [ ] Order detail shows items with prices, supplier names
- [ ] "Mark Received" updates inventory
- [ ] Commission report shows per-supplier breakdown
- [ ] Admin tab stats render correctly

---

### Phase 3: New Backend + Frontend (2-4 days each)

These pages need new database tables, new API endpoints, or significant new frontend features. Changes are additive (new routes, new tables) and don't modify existing data flows.

---

### Page 6: Advanced Inventory Management (Farm Supplies)  
**Risk: LOW** | **Effort: 3-4 days** | **Files: 5+**

| # | Change | File | Details |
|---|--------|------|---------|
| 1 | Fix tab content swap | `LE-farm-admin.html` | Rename `suppliesContent-nutrients` → `suppliesContent-packaging`; rename `invContent-nutrients` → `suppliesContent-nutrients` with correct class. |
| 2 | Create 6 database tables | `lib/database.js` (GRC) | `farm_seeds`, `farm_nutrients`, `farm_packaging`, `farm_equipment`, `farm_lab_supplies`, `farm_inventory_usage_log` — all with `farm_id` foreign key. |
| 3 | Create inventory management routes | New: `routes/inventory-mgmt.js` | 19+ CRUD endpoints matching what the frontend JS already calls. **Important:** this is a DIFFERENT route file from the existing `routes/inventory.js` which handles crop inventory (trays/plants). Name carefully to avoid conflict. |
| 4 | Mount new routes | `server.js` | Mount at `/api/inventory/` with careful path ordering so new sub-routes (`/seeds/*`, `/nutrients/*`, etc.) don't conflict with existing `/api/inventory/current` and `/api/inventory/forecast`. |
| 5 | Add dashboard aggregation endpoint | `routes/inventory-mgmt.js` | `GET /api/inventory/dashboard` — counts + reorder alerts across all 5 categories. |
| 6 | Add reorder email alerts | `routes/inventory-mgmt.js` | When stock falls below threshold, optionally email farm admin (if notification preferences include inventory alerts). |

**GRC backend changes:** 1 new route file, 6 new DB tables, route mount in server.js.  
**Foxtrot changes:** None.  
**Data flow impact:** NONE — Farm supplies inventory is completely separate from crop inventory (`/api/inventory/current`). The new routes use distinct sub-paths (`/seeds/*`, `/nutrients/*`, etc.) that don't collide.

**⚠️ CRITICAL:** Route mounting order matters. Existing routes for `/api/inventory/current` and `/api/inventory/forecast` MUST continue to work. Mount new supply routes AFTER existing inventory routes, OR use a distinct prefix like `/api/farm-supplies/`.

**Post-deploy verification:**
- [ ] Tabs show correct content (Nutrients ≠ Packaging)
- [ ] Each tab loads data from API (empty state on first load is OK)
- [ ] Add/edit/delete operations work for each category (Seeds, Nutrients, Packaging, Equipment, Lab Supplies)
- [ ] Dashboard stats update when items are added
- [ ] Reorder alerts appear when stock is below threshold
- [ ] `/api/inventory/current` still works (crop inventory regression check)
- [ ] Dashboard page KPIs still load

---

### Page 7: Crop Pricing (Server-Side Persistence)
**Risk: LOW** | **Effort: 1 day** | **Files: 3**

| # | Change | File | Details |
|---|--------|------|---------|
| 1 | Create `farm_pricing` table | `lib/database.js` | `id, farm_id, crop_name, sku, retail_price, ws1_price, ws2_price, ws3_price, unit (oz/25g), taxable, updated_at`. |
| 2 | Create pricing API endpoints | New: `routes/farm-pricing.js` | `GET /api/farm/pricing` — list all crop prices. `PUT /api/farm/pricing` — bulk upsert. `GET /api/farm/pricing/export` — CSV export. |
| 3 | Wire `savePricing()` to API | `farm-admin.js` | Replace localStorage-only save with API call + localStorage cache fallback. |
| 4 | Wire `renderPricingTable()` to API | `farm-admin.js` | Load from API first, fall back to localStorage. |

**GRC backend changes:** 1 new route file, 1 new DB table.  
**Foxtrot changes:** None.  
**Data flow impact:** NONE — Pricing is currently localStorage-only. Adding server persistence is additive.

**Post-deploy verification:**
- [ ] Pricing table loads from server
- [ ] Edit price → save → reload → price persists
- [ ] Price changes visible from different browser/device
- [ ] Crop Value page still calculates correctly using saved prices

---

### Phase 4: Full Redesigns (3-5 days each)

These pages need fundamental design changes per user requirements. More invasive but still isolated from core crop management data flow.

---

### Page 8: Quality Control  
**Risk: MEDIUM** | **Effort: 4-5 days** | **Files: 5+**

⚠️ **This page requires adding a GRC→Foxtrot proxy (like traceability has).** The proxy is read-only — it surfaces existing QA checkpoint data from the Foxtrot farm server.

| # | Change | File | Details |
|---|--------|------|---------|
| 1 | Remove wrong design | `LE-farm-admin.html` | Remove hardcoded Microbial/Nutrient/Physical category cards. Remove "New Quality Test" modal with lab-style form. |
| 2 | New section: Visual Inspections | `LE-farm-admin.html` | Primary tab showing QA checkpoints from Activity Hub (`qa_checkpoints` table). Timeline view with health scores, AI assessments, and photos. |
| 3 | New section: Lab Reports | `LE-farm-admin.html` | Upload PDF/image of external lab reports. Associate with batch/lot. Tag type (microbial, GAP audit, nutrient, pesticide). |
| 4 | New section: Quality Trends | `LE-farm-admin.html` | Charts from `GET /api/qa/quality-trends` — health score over time by crop. |
| 5 | Add GRC proxy for QA endpoints | `server.js` | New proxy routes forwarding to Foxtrot: `GET /api/quality/dashboard`, `GET /api/quality/stats`, `GET /api/quality/checkpoints/list`. **Read-only proxies only.** |
| 6 | Create lab report upload | New: `routes/quality-reports.js` | `POST /api/quality/lab-reports` — store uploaded file (base64 interim, S3 later). `GET /api/quality/lab-reports` — list reports. `GET /api/quality/lab-reports/:id` — download. |
| 7 | Create `lab_reports` table | `lib/database.js` (GRC) | `id, farm_id, batch_id, lot_code, report_type, test_date, file_data, file_name, file_type, notes, uploaded_at`. |
| 8 | Wire stats cards to real data | `farm-admin.js` | Replace hardcoded 98.5%/247/3/4 with data from QA stats endpoint. |
| 9 | Add charting notes capability | `farm-admin.js` | When viewing a QA checkpoint, allow adding freetext notes that are stored alongside the checkpoint. |

**GRC backend changes:** 3 new proxy routes in server.js, 1 new route file, 1 new DB table.  
**Foxtrot changes:** None — existing `quality-control.js` and `ai-vision.js` endpoints are already complete.  
**Data flow impact:** MEDIUM — Adding new proxy routes to server.js. These are additive (new paths) and read-only. The Activity Hub → QA checkpoint write flow is untouched. **Risk is in server.js route ordering — new `/api/quality/*` routes must not shadow existing routes.**

**Post-deploy verification:**
- [ ] Visual Inspections tab shows QA checkpoints from Activity Hub
- [ ] Health score charts render with trend data
- [ ] Lab report upload accepts PDF/image, stores, and displays
- [ ] Stats cards show real numbers from connected farm
- [ ] Activity Hub still writes QA checkpoints (regression check)
- [ ] Traceability page still works (regression check on server.js proxy changes)

---

### Page 9: Sustainability & ESG Dashboard  
**Risk: LOW** | **Effort: 4-5 days** | **Files: 5+**

| # | Change | File | Details |
|---|--------|------|---------|
| 1 | Remove Waste Management section | `LE-farm-admin.html` + `farm-admin.js` | Remove waste card, `displayWasteData()`, waste goal bar, waste endpoint. Per user directive. |
| 2 | Restructure metrics to production-relative | `farm-admin.js` | All energy/water/carbon metrics displayed as "per kg harvested" ratios. Fetch harvest totals from `/api/inventory/current` or `farm-summary.json`. |
| 3 | Build Utility Bill Upload UI | `LE-farm-admin.html` | New card with file upload (PDF/image) + manual data entry form (kWh, gallons, cost, billing period). |
| 4 | Create utility bill endpoints | New: `routes/sustainability.js` | Replace inline stubs with real route file. `POST /api/sustainability/utility-bills` — upload/save. `GET /api/sustainability/utility-bills` — list. Delete inline stubs from server.js. |
| 5 | Create `utility_bills` table | `lib/database.js` (GRC) | `id, farm_id, bill_type, billing_period_start, billing_period_end, usage_amount, usage_unit, cost, currency, file_data, file_name, uploaded_at`. |
| 6 | Build bill-to-metric pipeline | `routes/sustainability.js` | Calculate energy/water/carbon metrics from uploaded bills. Replace zero-stubs with real aggregation logic from `utility_bills` table. |
| 7 | Add Food Miles card + endpoint | `LE-farm-admin.html` + `routes/sustainability.js` | `GET /api/sustainability/food-miles` — calculate average delivery distance from farm location to buyer locations (from order/buyer data). Display as metric card with conventional supply chain comparison (1,500+ miles average). |
| 8 | Fix currency/unit configurability | `farm-admin.js` | Read currency and unit preferences from farm settings (Display Preferences). Show CAD/USD and liters/gallons per farm config. |
| 9 | Improve export format | `farm-admin.js` | Generate human-readable CSV alongside JSON for ESG reports. |

**GRC backend changes:** 1 new route file (replaces inline stubs), 1 new DB table, remove 6 inline stubs from server.js.  
**Foxtrot changes:** None.  
**Data flow impact:** NONE — Sustainability is entirely self-contained. The only cross-reference is reading harvest totals for production-relative metrics (read-only from existing data).

**Post-deploy verification:**
- [ ] Waste Management section is gone
- [ ] Utility bill upload form works (PDF + manual entry)
- [ ] Energy/water metrics derive from uploaded bills
- [ ] All metrics show "per kg harvested" ratios
- [ ] Food Miles card shows distance data
- [ ] ESG score recalculates based on real data
- [ ] Export downloads readable CSV
- [ ] Dashboard still loads (regression check)

---

## Pages NOT Requiring Updates

These sections were surveyed and found to be functional:

| Page | Type | Status | Notes |
|------|------|--------|-------|
| Dashboard | Inline section | ✅ Complete | 4 KPIs from API, Quick Actions, Activity table |
| Wholesale Orders | Inline section | ✅ Complete | JS-rendered from `/api/wholesale/order-events` |
| Payment Methods | Inline section | ✅ Complete | Square + Stripe OAuth, receipts table |
| Crop Value | Inline section | ✅ Complete | Calculated from live inventory + pricing |
| Help & Docs | Inline section | ⬜ Stub | "Coming soon" — not blocking any workflow |
| 12 iframe pages | Separate files | ✅ All exist | Setup, Activity Hub, Farm Summary, Inventory, Planting Scheduler, Tray Setup, Nutrient Management, Heat Map, Crop Weight Analytics, Farm Vitality, Farm Sales POS, Procurement Portal |

---

## Implementation Cadence

```
Phase 1 — Crash Fixes & Wiring (days 1-4)
├── Page 1: Farm Settings ........... Day 1    → commit → deploy → verify
├── Page 2: Users & Access .......... Day 2    → commit → deploy → verify
└── Page 3: Financial Summary ....... Days 3-4 → commit → deploy → verify

Phase 2 — API Contract Alignment (days 5-8)
├── Page 4: Traceability ............ Day 5    → commit → deploy → verify
└── Page 5: Procurement Portal ...... Days 6-7 → commit → deploy → verify

Phase 3 — New Backend + Frontend (days 8-12)
├── Page 6: Farm Supplies ........... Days 8-10  → commit → deploy → verify
└── Page 7: Crop Pricing (server) ... Day 11     → commit → deploy → verify

Phase 4 — Full Redesigns (days 12-20)
├── Page 8: Quality Control ......... Days 12-15 → commit → deploy → verify
└── Page 9: Sustainability & ESG .... Days 16-19 → commit → deploy → verify
```

**Total estimated effort: ~19 working days** (4 phases, 9 page updates)

---

## Deploy & Verify Protocol (Per Page)

1. **Pre-deploy:** Run `npm run validate-schemas` (if applicable)
2. **Local test:** Start dev servers (Foxtrot 8091, GRC 3100), smoke test changed endpoints
3. **Commit:** `git add -A && git commit -m "Page [N]: [Page Name] — [summary]"`
4. **Deploy:** `eb deploy greenreach-central-prod-v4` (after APPROVED FOR DEPLOYMENT)
5. **Verify — Page-specific:** Run page-specific checks listed above
6. **Verify — Regression:** Confirm these critical flows still work:
   - [ ] Farm login loads Light Engine dashboard
   - [ ] Dashboard KPIs show real data
   - [ ] Activity Hub opens and functions
   - [ ] Wholesale orders display for farms with orders
   - [ ] Harvest → traceability auto-record (if applicable)
7. **Report:** Summarize what was deployed + verification results

---

## Risk Summary

| Page | Risk | Reason |
|------|------|--------|
| Farm Settings | 🟢 LOW | localStorage + independent DB tables only |
| Users & Access | 🟢 LOW | `farm_users` table, no sync dependency |
| Financial Summary | 🟢 LOW | Read-only from existing data, additive endpoints |
| Traceability | 🟡 MEDIUM | Touches GRC↔Foxtrot proxy (frontend-only fix) |
| Procurement | 🟢 LOW | Self-contained in GRC + farmStore |
| Farm Supplies | 🟢 LOW | All-new routes + tables, careful mount ordering |
| Crop Pricing | 🟢 LOW | Additive — new table + API alongside existing localStorage |
| Quality Control | 🟡 MEDIUM | New proxy routes in server.js, reads from Foxtrot |
| Sustainability | 🟢 LOW | All-new, replaces inline stubs |

**No HIGH-risk pages.** The two MEDIUM-risk pages (Traceability, Quality Control) involve the GRC↔Foxtrot proxy layer but changes are either frontend-only (Traceability) or additive read-only proxy routes (Quality Control).

---

## Open Questions for Review

1. **Farm Supplies mount path:** Use existing `/api/inventory/` prefix (risk of route collision with crop inventory) or new `/api/farm-supplies/` prefix (requires frontend JS changes)?

2. **User invite vs. direct-create:** Current backend only supports `POST /api/users/create` (direct creation with password). Should we build an email invitation workflow, or change the UI to "Add User" with a temporary password?

3. **QuickBooks integration:** Financial Summary has JS referencing QuickBooks OAuth flow. Is QuickBooks integration a priority feature, or should it remain "Coming Soon"?

4. **Sustainability — additional metrics:** The gaps document lists 8 additional sustainability metrics (Crop Loss Rate, Nutrient Use Efficiency, Growing Medium Reuse, etc.). Should any of these be included in the initial redesign?

5. **Quality Control — file storage:** Lab report uploads need file storage. Use base64 in PostgreSQL as interim, or set up S3 bucket now?

6. **Help & Docs:** Currently a stub. Should it be populated as part of this project, or deferred?

---

*This proposal covers functional completion of all Light Engine inline sections. The 12 iframe-embedded pages (Setup, Activity Hub, Farm Summary, etc.) are separate codebases and are not included in this scope.*
