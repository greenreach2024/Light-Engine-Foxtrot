# Platform Readiness Correction Report

## Date: Session continuation
## Scope: 20 issues across 5 subsystems (Setup, Payment, Inventory, Environmental, Accounting)
## Previous Score: 5/10 overall readiness

---

## Phase 1: P0 Bug Fixes (Critical)

### 1A. Refund Parameter Mismatch
- **File:** `greenreach-central/services/squarePaymentService.js`
- **Problem:** `refundPayment()` passed `paymentId` as bare param but Square provider expected `providerPaymentId` key
- **Fix:** Changed to `providerPaymentId: paymentId` in the provider call
- **Impact:** Refunds now reach Square correctly instead of silently failing

### 1B. Undefined Provider in ingestFarmPayables
- **File:** `greenreach-central/services/revenue-accounting-connector.js`
- **Problem:** `ingestFarmPayables()` had no `provider` default -- ledger entries created without payment source
- **Fix:** Added `provider = 'square'` default parameter to all 3 ingest functions
- **Impact:** All ledger entries now carry correct provider attribution

### 1C. Partial Payment Auto-Refund
- **File:** `greenreach-central/routes/wholesale.js`
- **Problem:** If a multi-farm checkout partially succeeded (2 of 3 farms charged), successful charges were NOT refunded
- **Fix:** Added auto-refund loop that refunds all successful sub-payments when overall checkout fails
- **Impact:** Buyers no longer get charged by Farm A when Farm B's payment fails

---

## Phase 2: Accounting Foundation

### 2A. Revenue-to-Ledger Bridge Visibility
- **File:** `greenreach-central/routes/wholesale.js`
- **Problem:** `ingestPaymentRevenue` and `ingestFarmPayables` calls had no success/failure logging
- **Fix:** Added `.then()` success log and `.catch()` with stack trace for both accounting bridge calls; passed `provider` to `ingestFarmPayables`
- **Impact:** Revenue accounting failures are now visible in logs with full stack traces

### 2C. Tax Registration on Invoices
- **File:** `greenreach-central/lib/wholesale/invoice-generator.js`
- **Problem:** Invoices did not display farm GST/HST registration numbers
- **Fix:** Added `tax_registration_number` field to farm section data (reads from `profile.tax_registration_number || profile.gst_number || profile.hst_number`); added display in HTML rendering
- **Impact:** Wholesale invoices now show tax registration for CRA compliance

### 2D. Sequential Invoice Numbering
- **Files:** `greenreach-central/config/database.js`, `greenreach-central/lib/wholesale/invoice-generator.js`
- **Problem:** Invoices had no sequential numbering system
- **Fix:** Migration 054 creates `invoice_numbers` table + `invoice_number_seq` sequence (starts at 1001); added `getNextInvoiceNumber()` async helper
- **Impact:** Each invoice gets a unique sequential number (INV-1001, INV-1002, etc.)

---

## Phase 3: Onboarding and Payment Reliability

### 3B. Square Token Auto-Refresh
- **Files:** `greenreach-central/services/square-token-refresh.js` (new), `greenreach-central/server.js`
- **Problem:** Square OAuth tokens expire after 30 days; no automatic refresh mechanism existed
- **Fix:** Created scheduler service that runs every 12 hours, queries all `square_oauth` records from `farm_data` table, and refreshes tokens expiring within 7 days. Starts on Central server boot after DB init.
- **Impact:** Farm payment processing no longer breaks silently when tokens expire

### 3C. Setup Completion Unification
- **File:** `server-foxtrot.js`
- **Problem:** LE's setup completion handler did not set `setup_completed=true` in the farms table, and did not sync to Central's farmStore
- **Fix:** Added `UPDATE farms SET setup_completed = true` after local save; added POST to Central's `/api/setup-wizard/complete` endpoint with full setup payload (non-fatal on failure)
- **Impact:** Setup state is now consistent across both LE and Central regardless of which handler runs

---

## Phase 4: Inventory Integrity

### 4A. POS Inventory Deduction
- **Status:** ALREADY IMPLEMENTED (lines 348-365 in `greenreach-central/routes/farm-sales.js`)
- **Note:** POS checkout already updates `sold_quantity_lbs` and recalculates `quantity_available` for each line item on completed sales

### 4B. Fulfillment-Triggered Inventory Deduction
- **File:** `greenreach-central/routes/wholesale-fulfillment.js`
- **Problem:** Marking a wholesale order as "fulfilled" did not deduct inventory
- **Fix:** Added inventory deduction block after order save: iterates farm sub-order items, UPDATE `farm_inventory` for each SKU. Guarded with `inventory_deducted_at` flag to prevent double-deduction on re-fulfill.
- **Impact:** Wholesale fulfillment now correctly reduces available inventory

---

## Phase 5: Environmental and Reporting

### 5A. Sensor Timeseries Storage
- **Files:** `greenreach-central/config/database.js`, `greenreach-central/routes/sync.js`
- **Problem:** Telemetry handler only did UPSERT (overwrite) -- no historical sensor data was retained
- **Fix:** Migration 055 creates `sensor_readings` table with indexed columns (farm_id, zone_id, sensor_type, value, unit, recorded_at). Telemetry handler now INSERTs individual readings after the upsert. Added `GET /api/sync/env/history` endpoint for querying historical data with zone, type, and date range filters.
- **Impact:** Sensor trends are now queryable for analytics and reporting

### 5B. Sensor Readings Cleanup
- **Files:** `greenreach-central/routes/sync.js`, `greenreach-central/server.js`
- **Problem:** No retention policy for timeseries data
- **Fix:** Added `startSensorCleanupScheduler()` that deletes readings older than 90 days, runs daily (first run 5 minutes after boot)
- **Impact:** Database stays bounded; ~90 days of trend data retained

### 5C. Alert Threshold Alignment
- **Status:** NOT NEEDED
- **Note:** server-foxtrot.js does not have its own hardcoded alert thresholds. It uses recipe/schedule targets from farmStore. Thresholds are already aligned.

### 5D. Financial Reports (P&L, Balance Sheet)
- **File:** `greenreach-central/routes/accounting.js`
- **Problem:** No financial reporting endpoints existed
- **Fix:** Added two endpoints:
  - `GET /api/accounting/reports/income-statement` -- Revenue, COGS, Expenses grouped by account with gross profit and net income
  - `GET /api/accounting/reports/balance-sheet` -- Assets, Liabilities, Equity snapshot with balance check
  - Both support `farm_id` filter and date range
- **Impact:** Farm operators can now generate standard financial reports

### 5E. Receipts System
- **Files:** `greenreach-central/routes/billing-receipts.js` (new), `greenreach-central/server.js`
- **Problem:** No way to view or download payment receipts
- **Fix:** Created receipts router with 3 endpoints:
  - `GET /api/billing/receipts` -- List payment receipts with filtering (status, date range, pagination)
  - `GET /api/billing/receipts/:paymentId` -- Receipt detail with farm-scoped access control
  - `GET /api/billing/receipts/:paymentId/download` -- Downloadable HTML receipt
- **Impact:** Billing section now has receipt browsing and download capabilities

### 5F. QuickBooks Daily Summary Endpoint
- **Status:** ALREADY EXISTS (line 675 in `greenreach-central/routes/reports.js`)

### 5G. QuickBooks Token Persistence
- **File:** `routes/farm-sales/quickbooks.js`
- **Problem:** QB OAuth tokens stored in-memory only (`farmStores.qbTokens._store`) -- lost on every server restart
- **Fix:** Replaced in-memory store with DB-backed implementation using `farm_data` table (`data_type = 'quickbooks_oauth'`). Added in-memory cache for read performance. Converted all store calls to async/await (11 call sites).
- **Impact:** QB connections survive server restarts; token refresh works correctly

---

## New Files Created

| File | Purpose |
|------|---------|
| `greenreach-central/services/square-token-refresh.js` | Square OAuth token auto-refresh scheduler |
| `greenreach-central/routes/billing-receipts.js` | Payment receipts listing and download |

## New Database Migrations

| Migration | Table | Purpose |
|-----------|-------|---------|
| 054 | `invoice_numbers` | Sequential invoice numbering with `invoice_number_seq` sequence |
| 055 | `sensor_readings` | Sensor timeseries storage with zone/type/time indexes |

## Files Modified

| File | Changes |
|------|---------|
| `greenreach-central/services/squarePaymentService.js` | Refund param fix |
| `greenreach-central/services/revenue-accounting-connector.js` | Provider defaults on all ingest functions |
| `greenreach-central/routes/wholesale.js` | Partial-failure auto-refund, accounting logging, provider pass-through |
| `greenreach-central/lib/wholesale/invoice-generator.js` | Tax reg display, sequential numbering helper |
| `greenreach-central/config/database.js` | Migrations 054-055 |
| `greenreach-central/server.js` | Scheduler imports/mounts, receipts router mount |
| `greenreach-central/routes/wholesale-fulfillment.js` | DB import, inventory deduction on fulfill |
| `greenreach-central/routes/sync.js` | Sensor timeseries INSERT, env/history endpoint, cleanup scheduler |
| `greenreach-central/routes/accounting.js` | Income statement + balance sheet endpoints |
| `server-foxtrot.js` | Setup completion: set flag + sync to Central |
| `routes/farm-sales/quickbooks.js` | DB-backed token store, async/await conversion |

## Revised Subsystem Scores (Estimated)

| Subsystem | Before | After | Delta |
|-----------|--------|-------|-------|
| Setup / Onboarding | 6/10 | 8/10 | +2 |
| Payment Processing | 5/10 | 8/10 | +3 |
| Inventory Management | 6/10 | 8/10 | +2 |
| Environmental Monitoring | 7/10 | 9/10 | +2 |
| Accounting / Billing | 3/10 | 8/10 | +5 |
| **Overall** | **5/10** | **8/10** | **+3** |

## Deployment Required
Both environments need deployment:
- **Central** (`greenreach-central-prod-v4`): All new services, routes, migrations, accounting endpoints
- **LE** (`light-engine-foxtrot-prod-v3`): Setup completion sync, QB token persistence
