# Seed-to-Harvest-to-Sale Workflow Audit

**Date:** 2026-02-21  
**Scope:** Complete lifecycle from seeding window → tray seeding → group placement → growing → harvest → wholesale sale  
**Commit:** `48b503f` (group labels + tray-to-group wiring)

---

## Executive Summary

The system has a **complete seed-to-sale data path** but relies on **two parallel inventory systems** that are not synchronized. The planting scheduler, inventory forecasting, and wholesale availability all read from `groups.json` (static configuration), while the Activity Hub writes to NeDB tray runs (dynamic operational data). This creates a **growing integrity gap** where harvested groups still show as available inventory, moved trays don't update group counts, and forecast accuracy degrades over time.

**14 errors/bugs found. 11 improvement opportunities identified.**

---

## 1. Workflow Step: Seeding Window & Planning

### How It Works Today
- **AI Recommendation Engine** (`POST /api/planting/recommendations`) scores crops across 6 factors: nutrient fit (30%), market demand (25%), inventory consistency (20%), harvest stagger (15%), light efficiency (7%), VPD fit (3%)
- **Real demand data** — queries completed wholesale orders from last 60 days for demand scoring
- **Planting Scheduler** (`calculateSeedingTasks()` in `planting-scheduler.html`) back-calculates seeding windows from expected harvest dates: `slotFreeDate - germinationDays`
- **Succession support** — `POST /api/planting/plan` supports weekly, biweekly, and monthly cadence with up to 4 batches

### Errors Found

| # | Error | Severity | Location |
|---|-------|----------|----------|
| E1 | **Germination days hardcoded to 7–10 for all crops** — should vary by crop type (basil=5-7d, lettuce=3-5d, microgreens=2-3d) | Medium | `planting-scheduler.html` L2456 |
| E2 | **No bridge from planting plan → actual seeding** — planting scheduler creates assignment records but the grower must manually re-enter all data at seeding time | Medium | Architectural gap |

### Improvement Opportunities

| # | Opportunity | Impact | AI Agent Potential |
|---|-------------|--------|-------------------|
| O1 | **Auto-populate seed form from active planting plan** — when scanning a tray for seeding, pre-fill recipe/crop/plant count from the most urgent pending plan assignment | High — eliminates re-entry | Yes: Agent matches tray scan to pending plan |
| O2 | **Per-crop germination data in crop-registry.json** — replace hardcoded 7-10d with crop-specific values | Medium — improves forecast | Yes: Agent seeds initial values from published data |
| O3 | **Push seeding reminders to Activity Hub** — "Seed 3 trays of Buttercrunch today (seeding window closes tomorrow)" | High — reduces missed windows | Yes: Agent generates daily task list from plan resolver |

---

## 2. Workflow Step: Tray Seeding

### How It Works Today
- **Tray Inventory Scanner** (Activity Hub) — user scans tray QR → fills form (recipe, seed source, variety, plant count, date) → calls `POST /api/trays/:trayId/seed`
- **Target weight assigned at seeding** — priority: crop benchmark (verified weigh-in data) > tray format > null
- **Tray run created** in NeDB with `status: 'GROWING'`, lot/trace data NOT created until harvest
- **No group assigned** — by design, group_id is set later via Quick Move

### Errors Found

| # | Error | Severity | Location |
|---|-------|----------|----------|
| E3 | **Tray registration endpoint is a stub** — `POST /api/trays/register` returns `{ success: true }` without persisting to traysDB in production mode | High | `server-foxtrot.js` L18383 |
| E4 | **Field name mismatch** — tray-setup.html sends `{ qrCodeValue, trayFormatId }` but endpoint expects `{ trayId, format }` | Medium | `tray-setup.html` vs `server-foxtrot.js` L18385 |
| E5 | **Seed inventory not decremented** — seeding a tray doesn't reduce seed stock; `seedsInventory[]` is a disconnected in-memory array | Low | `server-foxtrot.js` L16857 |

### Improvement Opportunities

| # | Opportunity | Impact | AI Agent Potential |
|---|-------------|--------|-------------------|
| O4 | **Wire tray registration to persist** — actually insert into traysDB so GET /api/trays shows all trays | High — enables full tray lifecycle | No: straightforward code fix |
| O5 | **Auto-detect crop from plan when scanning at seeding time** — if tray is being seeded in a slot assigned to "Basil" by the planting plan, pre-select that recipe | High — reduces input | Yes: Agent cross-references plan assignments |

---

## 3. Workflow Step: Move Tray to Group (Activity Hub)

### How It Works Today
- **Quick Move** (Activity Hub) — 2-step scan: tray QR → group/position QR
- **Group detection** — `GRP:` prefix on QR or raw group ID lookup in `groups.json`
- **Placement record** created with `group_id`, prior placements closed with `MOVED` reason
- **Tray run** updated with `group_id`

### Errors Found

| # | Error | Severity | Location |
|---|-------|----------|----------|
| E6 | **`groups.json` NOT updated after move** — moving a tray to a group sets `group_id` on the tray run/placement, but the group's `trays` count in `groups.json` is never incremented | **Critical** | `server-foxtrot.js` L18718-18800 |
| E7 | **Non-Quick "Move Tray" button is broken** — redirects to `?move=<trayId>` with no handler for that URL parameter; only Quick Move actually works | Medium | `tray-inventory.html` L4685 |
| E8 | **No move event notification** — other connected Activity Hub tablets and the central dashboard are not notified of tray moves (no WebSocket/event) | Low | `server-foxtrot.js` L18795 |

### Improvement Opportunities

| # | Opportunity | Impact | AI Agent Potential |
|---|-------------|--------|-------------------|
| O6 | **Sync tray count back to groups.json on move** — when a tray is moved to a group, increment the group's tray count; on move-away, decrement | **Critical** — fixes inventory cascade | No: deterministic sync logic |
| O7 | **Auto-assign group at seeding** — if the planting plan assigns a crop to a specific group, auto-set `group_id` at seed time instead of requiring a separate Quick Move step | High — eliminates 1 scan step | Yes: Agent resolves plan → group mapping |

---

## 4. Workflow Step: Growing Phase & Countdown to Harvest

### How It Works Today
- **Two parallel countdown systems:**
  - **System A** (`GET /api/trays`): Calculates `daysSinceSeeding` from NeDB tray run's `seeded_at`
  - **System B** (`GET /api/inventory/current`): Calculates `daysOld` from `groups.json` → `planConfig.anchor.seedDate`
- **Daily plan resolver** applies light recipes per group based on day number since seed date
- **Growth stages** resolved from `lighting-recipes.json` → `Seedling → Vegetative → Flowering → Fruiting`
- **Forecast endpoint** (`GET /api/inventory/forecast`) produces 7/14/30/30+ day harvest buckets

### Errors Found

| # | Error | Severity | Location |
|---|-------|----------|----------|
| E9 | **Inventory/forecast reads ONLY from groups.json** — completely ignores tray run data; trays seeded via Activity Hub don't appear in forecast unless group is manually configured with matching seed date | **Critical** | `server-foxtrot.js` L16633-16730 |
| E10 | **Harvest day default is 45d when no recipe found** — some crops need 7-14 days; 45d creates wildly wrong forecasts for microgreens/lettuce | Medium | `server-foxtrot.js` L16552-16586 |

### Improvement Opportunities

| # | Opportunity | Impact | AI Agent Potential |
|---|-------------|--------|-------------------|
| O8 | **Unify inventory systems** — `GET /api/inventory/current` should merge groups.json (planned capacity) with trayRunsDB (actual in-progress trays) for accurate real-time inventory | **Critical** | Partially: Agent could build the merge query |
| O9 | **AI harvest date refinement** — use crop weight reconciliation data + environmental sensor data to predict actual harvest date more accurately than the static recipe day count | High — improves forecast | Yes: Agent trains on historical harvest-day vs recipe-day deltas |

---

## 5. Workflow Step: Harvest & Reconciliation

### How It Works Today
- **Activity Hub harvest** — scan tray QR → `POST /api/tray-runs/:id/harvest`
- **Auto-generated:** lot code (`A1-CROP-YYMMDD-RAND`), batch ID, SFCR trace record
- **Weight determination:**
  - If crop is unverified → 80% chance of weigh-in prompt (build benchmark data fast)
  - If crop is verified → 20% chance (maintenance sampling)
  - Otherwise uses `target_weight_oz × plantCount` from seeding
- **Reconciliation system** (`POST /api/crop-weights/record`) updates rolling benchmarks per crop
- **Tray run status** set to `HARVESTED` in NeDB

### Errors Found

| # | Error | Severity | Location |
|---|-------|----------|----------|
| E11 | **`printHarvestLabel()` calls Python backend `/api/labels/harvest`** — returns 404 on Node.js-only deployments (which is the current production setup) | **Critical** | `tray-inventory.html` L5189-5193 |
| E12 | **Harvest does NOT update groups.json or wholesale inventory** — harvested trays still show as available growing inventory and saleable wholesale stock | **Critical** | `server-foxtrot.js` L18283-18294 |
| E13 | **Crop "verified" after just 1 weigh-in** — `hasCropBenchmark()` returns true if `sample_count >= 1`, immediately dropping weigh-in rate from 80% → 20%; should require 5+ samples for statistical validity | Medium | `crop-weight-reconciliation.js` L485-488 |

### Improvement Opportunities

| # | Opportunity | Impact | AI Agent Potential |
|---|-------------|--------|-------------------|
| O10 | **Fix harvest label to use Node.js endpoint** — change `printHarvestLabel()` to call `/api/printer/label-harvest` (browser HTML) or `/api/printer/print-harvest` (thermal) | **Critical** fix | No: straightforward URL swap |
| O11 | **Auto-create wholesale lot on harvest** — when harvest completes, auto-create a wholesale inventory lot with the lot code, actual weight, and available quantity; this bridges the harvest → sale gap | **Critical** | No: deterministic endpoint wiring |

---

## 6. Workflow Step: Sale via Wholesale Portal

### How It Works Today
- **Wholesale inventory** (`GET /api/wholesale/inventory`) calculates SKUs from `groups.json`:
  - `SKU-{CROP}-5LB` per crop
  - `qty = ceil(trayCount × plants × 0.125 lbs/plant / 5lbs/case) - reserved - deducted`
- **Buyer registration** — JWT auth, PostgreSQL storage, bcrypt passwords
- **Two checkout systems exist** (Central checkout.js + wholesale-orders.js SkipTheDishes-style)
- **Reservation system** — file-based with 24h TTL auto-expiry
- **Fulfillment** — status transitions (pending → picked → packed → shipped → delivered)
- **Order events** forwarded to farm via webhooks

### Errors Found

| # | Error | Severity | Location |
|---|-------|----------|----------|
| E14 | **Fulfillment records are in-memory only** — all fulfillment data (Map) is lost on server restart; no database persistence | **Critical** | `wholesale-fulfillment.js` — `fulfillmentRecords` Map |

### Improvement Opportunities

| # | Opportunity | Impact | AI Agent Potential |
|---|-------------|--------|-------------------|
| — | Covered by O11 above: harvest → wholesale lot bridge | Critical | — |

---

## 7. Labels Across the Lifecycle

### Current Label Coverage

| Stage | Label Type | Trigger | Endpoint | Status |
|-------|-----------|---------|----------|--------|
| Tray Registration | Tray Label (QR + code) | Manual | `POST /api/printer/print-tray` | ✅ Working |
| Group Setup | Group Label (QR + name) | Manual button | `POST /api/qr-generator/generate-groups` | ✅ Working (just deployed) |
| Seeding | — | — | — | ⚠️ **No seeding label** |
| Growing | — | — | — | N/A (no label needed) |
| Harvest | Harvest Label (lot + weight + SFCR) | Manual button | `GET /api/labels/harvest` | ❌ **404 on Node.js** |
| Packing/Shipping | Packing Label (order + items + SFCR) | Manual | `POST /api/printer/print-packing` | ✅ Working |

### Key Issue
The harvest label button in the Activity Hub calls the **Python backend** (`/api/labels/harvest`) instead of the **Node.js thermal printer** (`/api/printer/print-harvest` or a new browser-printable `/api/printer/label-harvest` endpoint). This is a **broken link** in the production workflow.

---

## 8. Data Flow Diagram: What Updates What

```
SEEDING                          GROWING                      HARVEST                    SALE
─────────                        ───────                      ───────                    ────
                                                              
POST /trays/:id/seed             Daily Plan Resolver          POST /tray-runs/:id        POST checkout/execute
       │                               │                      /harvest                         │
       ▼                               ▼                           │                           ▼
  trayRunsDB ──────────────────> (reads groups.json)               ▼                     reservations.json
  [status:GROWING]                light schedules            trayRunsDB                  deductions.json
       │                               │                    [status:HARVESTED]                 │
       │   POST /tray-runs/:id/move    │                         │                           │
       │──────────────▶ trayRunsDB     │                   traceRecordsDB                    │
       │               [group_id]      │                   [SFCR trace]                      │
       │                               │                         │                           │
       │              ┌────────────────┘                         │                           │
       │              ▼                                          │                           │
       │    GET /api/inventory/current ◀──── groups.json ────────┼────────▶ GET /wholesale  ◀┘
       │    GET /api/inventory/forecast       (STATIC!)          │            /inventory
       │              │                                          │               │
       │              ▼                                     ┌────┘               │
       │    Activity Hub Dashboard                          │                    ▼
       │    - Active Trays count                            │            Buyer Portal
       │    - Harvest countdown                             │            - Browse SKUs
       │    - Ready Soon list                               │            - Place orders
       │                                                    │
       │                              ╔═══════════════╗     │
       └─────────────────────────────▶║  DISCONNECT   ║◀────┘
                                      ║               ║
                                      ║ trayRunsDB    ║
                                      ║ never syncs   ║
                                      ║ back to       ║
                                      ║ groups.json   ║
                                      ╚═══════════════╝
```

---

## 9. Priority Action Items

### Tier 1: Critical Fixes (Data Integrity)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| **F1** | **Fix harvest label URL** — change `printHarvestLabel()` to use `/api/printer/print-harvest` or add browser endpoint `/api/printer/label-harvest` | 1 hour | Unblocks on-farm harvest labeling |
| **F2** | **Create harvest → wholesale lot bridge** — when harvest completes, auto-create a wholesale lot entry (lot code, actual weight, crop, qty) that `GET /api/wholesale/inventory` can read | 4 hours | Accurate post-harvest availability |
| **F3** | **Persist fulfillment records** — move from in-memory Map to NeDB or file-backed JSON | 2 hours | Data survives restart |
| **F4** | **Fix tray registration stub** — actually persist to traysDB so `GET /api/trays` works | 1 hour | Enables tray lifecycle tracking |

### Tier 2: Inventory Accuracy

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| **F5** | **Sync tray moves to groups.json** — on Quick Move to a group, increment group tray count; on harvest, decrement | 3 hours | Accurate group capacity |
| **F6** | **Merge inventory sources** — `GET /api/inventory/current` should read BOTH groups.json (planned) and trayRunsDB (actual) | 4 hours | Real inventory visibility |
| **F7** | **Raise verified benchmark threshold** — require 5+ weigh-in samples before marking a crop as verified | 30 min | Better weight data quality |

### Tier 3: AI Agent Automation

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| **A1** | **Smart Seed Form** — when scanning tray for seeding, AI agent cross-references pending planting plan assignments and auto-fills recipe, plant count, and variety. User confirms or overrides. Eliminates 4+ manual fields. | 3 hours | Cuts seeding input by 80% |
| **A2** | **Daily Task Agent** — at startup, AI generates "Today's Tasks" from plan resolver + forecast: "Seed 3 trays of Basil (window closes tomorrow)", "Harvest Group 7 (day 28 of 28)", "Move 2 germinated trays to Main Grow Room". Pushed to Activity Hub Today's Priorities. | 4 hours | Proactive vs reactive farming |
| **A3** | **Harvest Date Predictor** — trains on historical `seeded_at` → `harvested_at` deltas per crop, adjusting for environmental conditions (DLI, temperature), to predict more accurate harvest dates than static recipe day counts | 6 hours | ±2 day accuracy vs ±7 day |
| **A4** | **Auto-Group Assignment** — when planting plan assigns a crop to a group, and a tray is seeded with that crop, auto-set `group_id` on the tray run — eliminating the Quick Move step entirely for planned trays | 2 hours | 1 fewer scan per tray |

---

## 10. Summary Scorecard

| Workflow Stage | Data Integrity | User Experience | Label Support | AI Potential |
|---------------|---------------|-----------------|---------------|-------------|
| **Seeding Window** | ⚠️ Hardcoded germination | ⚠️ Manual re-entry from plan | ✅ Tray labels work | 🟢 High (O1, O2, O3) |
| **Tray Seeding** | ⚠️ Registration stub | ⚠️ 5+ field manual entry | ✅ Tray labels work | 🟢 High (A1) |
| **Move to Group** | ❌ groups.json not updated | ✅ Quick Move works well | ✅ Group labels work | 🟡 Medium (A4) |
| **Growing/Forecast** | ❌ Dual systems, no sync | ⚠️ Inaccurate countdown | N/A | 🟢 High (A3) |
| **Harvest** | ❌ No inventory cascade | ⚠️ Label button 404 | ❌ Harvest label broken | 🟡 Medium |
| **Wholesale Sale** | ❌ Stale availability data | ✅ Buyer portal works | ✅ Packing labels work | 🟡 Medium (A2) |
| **Fulfillment** | ❌ In-memory only | ⚠️ No persistence | ✅ Packing labels work | Low |

**Overall:** The workflow path exists end-to-end but the **groups.json ↔ trayRunsDB disconnect** creates compounding data integrity issues from move → harvest → sale. The most impactful single fix is **F2 (harvest → wholesale lot bridge)**, and the most impactful AI automation is **A1 (smart seed form auto-fill)**.
