# Phase 2 Task Audit Report (T13–T24)

**Generated:** 2026-02-22  
**Scope:** Research-only codebase audit — no code changes  
**Workspace:** `/Volumes/CodeVault/Projects/Light-Engine-Foxtrot`

---

## Summary Table

| Task | Description | Status | Effort Est. |
|------|-------------|--------|-------------|
| T13 | Auto-derive plant count from tray format | ✅ **IMPLEMENTED** | Done |
| T14 | AI pre-fill crop at seeding + demand signals | ✅ **IMPLEMENTED** | Done |
| T15 | Combine seed + group assignment in one step | ✅ **IMPLEMENTED** | Done |
| T16 | Auto-trigger label print on harvest | ⚠️ **PARTIAL** — server ready, client not wired | ~2h |
| T17 | Auto-derive photoperiod from recipe DLI/PPFD | ✅ **IMPLEMENTED** | Done |
| T18 | Remove duplicate seed-date entry (sync to group) | ✅ **IMPLEMENTED** | Done |
| T19 | Auto-discover lights from controller | ⚠️ **PARTIAL** — discovery works, auto-assign gap | ~4h |
| T20 | Demand signal aggregation + push to farms | ✅ **IMPLEMENTED** | Done |
| T21 | New-farm onboarding with benchmarks | ⚠️ **PARTIAL** — benchmarks push exists, onboarding wizard exists, but no "seed with benchmarks" flow | ~4h |
| T22 | Environmental benchmark push to farms | ✅ **IMPLEMENTED** | Done |
| T23 | Network trends endpoint | ✅ **IMPLEMENTED** (Central) / ⚠️ Stub (Foxtrot) | ~1h to reconcile |
| T24 | Buyer behavior & churn analytics | ✅ **IMPLEMENTED** | Done |

**Overall:** 8 of 12 tasks fully implemented. 4 have partial gaps.

---

## T13 — Auto-derive plant count from tray format

**Status: ✅ IMPLEMENTED**

### Existing Code
| File | Line(s) | What |
|------|---------|------|
| [server-foxtrot.js](server-foxtrot.js#L19315) | 19315–19337 | Phase 2 Task 2.1 — full implementation |
| [server-foxtrot.js](server-foxtrot.js#L19302) | 19302 | `POST /api/tray-runs/:id/seed` accepts `plantCount` param |
| [server-foxtrot.js](server-foxtrot.js#L18565-L18922) | 18565–18922 | Tray format CRUD (`GET/POST/PUT/DELETE /api/tray-formats`) |
| [greenreach-central/server.js](greenreach-central/server.js#L1792) | 1792–1868 | Central tray format CRUD mirror |

### How It Works
1. `POST /api/tray-runs/:id/seed` receives optional `plantCount`
2. If not provided, looks up tray → `format_id` → `trayFormatsDB.findOne()`
3. Reads `trayFormat.plantSiteCount` or `plant_site_count`
4. Sets `plant_count_source: 'tray_format'` (vs `'manual'`)
5. Response includes `planted_site_count` and `plant_count_source`

### Data
- Tray formats stored in NeDB (`trayFormatsDB`)
- Fields: `name`, `cellCount`, `plantSiteCount`, `gridRows`, `gridCols`, `depth_mm`, `material`

### Gaps
- None — fully operational.

---

## T14 — AI pre-fill crop recommendation at seeding + Central demand signals

**Status: ✅ IMPLEMENTED**

### Existing Code
| File | Line(s) | What |
|------|---------|------|
| [server-foxtrot.js](server-foxtrot.js#L10618) | 10618–10625 | Phase 2 Task 2.2 comment + endpoint doc |
| [server-foxtrot.js](server-foxtrot.js#L10626) | 10626–10710 | `GET /api/ai/suggested-crop` — full implementation |
| [server-foxtrot.js](server-foxtrot.js#L18314) | 18314–18350 | Phase 2 Task 2.2: merge network demand signals from Central |
| [server-foxtrot.js](server-foxtrot.js#L10680) | 10680 | Reads `aiRecs?.network_intelligence?.demand_signals` |
| [greenreach-central/server.js](greenreach-central/server.js#L2283) | 2283 | `demand_signals: Object.fromEntries(sorted)` |

### How It Works
1. Activity Hub calls `GET /api/ai/suggested-crop?groupId=X`
2. Reads group conditions (EC, pH, VPD, DLI capacity)
3. Loads available crops from `lighting-recipes.json`
4. Loads demand data from `ai-recommendations.json` (pushed by Central)
5. Calls `generateCropRecommendations()` → returns top crop + confidence
6. Network demand signals blended at 30% weight on top of local data
7. Response: `{ suggestion: { cropId, cropName, confidence, reason } }`

### Data
- `public/data/ai-recommendations.json` — persisted on push from Central
- `public/data/lighting-recipes.json` — available crop list
- `public/data/groups.json` — current inventory snapshot

### Gaps
- None — endpoint and demand blending fully operational.

---

## T15 — Combine seed + group assignment in one step

**Status: ✅ IMPLEMENTED**

### Existing Code
| File | Line(s) | What |
|------|---------|------|
| [server-foxtrot.js](server-foxtrot.js#L19371) | 19371–19393 | Phase 2 Task 2.3 comment + implementation |
| [server-foxtrot.js](server-foxtrot.js#L19302) | 19302 | `POST /api/tray-runs/:id/seed` accepts `groupId` param |
| [server-foxtrot.js](server-foxtrot.js#L19386) | 19386 | Creates placement with `group_id` in `trayPlacementsDB` |

### How It Works
1. `POST /api/tray-runs/:id/seed` body includes optional `groupId`
2. If `groupId` supplied, placement record is created immediately (no separate "Quick Move")
3. Placement record includes `group_id`, `location_qr`, `placed_at`
4. Response message: `"Seeding recorded + assigned to group {groupId}"`

### Gaps
- None — single-step seed + group assignment works end-to-end.

---

## T16 — Auto-trigger label print on harvest

**Status: ⚠️ PARTIAL**

### Existing Code
| File | Line(s) | What |
|------|---------|------|
| [server-foxtrot.js](server-foxtrot.js#L19235) | 19235–19260 | Phase 2 Task 2.4 — builds `labelPrintData` with `auto_print: true` |
| [routes/thermal-printer.js](routes/thermal-printer.js#L295) | 295–320 | `POST /api/printer/print-harvest` — functional ZPL/EPL printer endpoint |
| [routes/thermal-printer.js](routes/thermal-printer.js#L47) | 47–48 | Harvest label ZPL template |

### How It Works (Server Side)
1. `POST /api/tray-runs/:id/harvest` response includes `label_print` object
2. `label_print.auto_print = true` signals client to auto-submit
3. `label_print.endpoint = '/api/printer/print-harvest'`
4. Includes `lotCode`, `cropName`, `weight`, `unit`

### Gaps
- **Client-side auto-trigger NOT wired** — the Activity Hub receives `label_print` in the harvest response but does not auto-call `/api/printer/print-harvest`
- **Known bug:** `printHarvestLabel()` in `tray-inventory.html` calls Python `/api/labels/harvest` (404); should use `/api/printer/print-harvest`
- **Estimated fix:** ~2 hours — add client JS to detect `label_print.auto_print` in harvest response and POST to the print endpoint

---

## T17 — Auto-derive photoperiod from recipe DLI/PPFD

**Status: ✅ IMPLEMENTED**

### Existing Code
| File | Line(s) | What |
|------|---------|------|
| [server-foxtrot.js](server-foxtrot.js#L1483) | 1483–1490 | Phase 2 Task 2.5 — full formula implementation |
| [server-foxtrot.js](server-foxtrot.js#L1290) | 1290 | `readPhotoperiodHours(value)` helper function |
| [server-foxtrot.js](server-foxtrot.js#L1478) | 1478–1480 | Cascading resolution: plan → firstDay → defaults |

### How It Works
```
if (photoperiodHours == null && dliProvided != null && ppfd > 0):
    hours = DLI * 1e6 / (PPFD * 3600)
    clamped [4, 24]
    photoperiodSource = 'auto_dli'
```
1. If recipe has explicit photoperiod → use that (`source: 'recipe'`)
2. If recipe has DLI + PPFD but no photoperiod → auto-derive (`source: 'auto_dli'`)
3. Result used by schedule executor and energy forecaster

### Data
- Source: `lighting-recipes.json` day config (`dli`, `ppfd`, `photoperiod`)

### Gaps
- None — fully operational.

---

## T18 — Remove duplicate seed-date entry (sync to group)

**Status: ✅ IMPLEMENTED**

### Existing Code
| File | Line(s) | What |
|------|---------|------|
| [server-foxtrot.js](server-foxtrot.js#L19389) | 19389–19408 | Phase 2 Task 2.6 — sync seed date to group |

### How It Works
1. When `POST /api/tray-runs/:id/seed` is called with `groupId`:
2. Reads `groups.json`, finds target group
3. Sets `targetGroup.planConfig.anchor.seedDate = seedDateStr`
4. Also sets `targetGroup.crop = recipe` if not already set
5. Writes back to `groups.json`
6. Error is non-fatal (logged, doesn't fail seeding)

### Gaps
- None — seed date is now set once at seeding time, no need to duplicate in group config manually.

---

## T19 — Auto-discover lights from controller

**Status: ⚠️ PARTIAL — infrastructure exists, auto-assign gap**

### Existing Code
| File | Line(s) | What |
|------|---------|------|
| [lib/device-discovery.js](lib/device-discovery.js) | full file | Device discovery service (mDNS, SSDP, BLE, Kasa UDP, SwitchBot Cloud) |
| [lib/device-wizard.js](lib/device-wizard.js) | full file | Device wizard with group assignment |
| [lib/mdns-advertiser.js](lib/mdns-advertiser.js) | full file | mDNS service advertisement |
| [server-foxtrot.js](server-foxtrot.js#L23068) | 23068–23494 | Multiple discovery-related endpoints |

### Endpoints
- `GET /api/mdns/discover` — start discovery
- `GET /api/mdns/services` — list discovered
- `POST /api/mdns/refresh` — restart discovery
- `GET /api/mdns/status` — discovery system status
- Device Manager UI modal with "Run discovery" button

### Gaps
- **Auto-assign discovered lights to groups** not implemented — discovery finds devices but user must manually assign via the Groups V2 panel
- Missing: controller topology → zone/group mapping logic
- Bus Mapping Wizard (6-step wizard in HTML) exists but is manual

---

## T20 — Demand signal aggregation + push to farms

**Status: ✅ IMPLEMENTED**

### Existing Code
| File | Line(s) | What |
|------|---------|------|
| [greenreach-central/services/ai-recommendations-pusher.js](greenreach-central/services/ai-recommendations-pusher.js#L1) | full file | AI Pusher — `analyzeAndPushToAllFarms()` |
| [greenreach-central/services/wholesaleMemoryStore.js](greenreach-central/services/wholesaleMemoryStore.js#L762) | 762–830 | `analyzeDemandPatterns()` — crop demand from wholesale orders |
| [greenreach-central/routes/experiment-records.js](greenreach-central/routes/experiment-records.js#L270) | 270–300 | `getCropBenchmarksForPush()` — benchmark payload |
| [greenreach-central/services/ai-recommendations-pusher.js](greenreach-central/services/ai-recommendations-pusher.js#L200) | 200–225 | Phase 2 Task 2.8: loads real demand signals |

### How It Works
1. `startAIPusher()` runs every 30 minutes
2. Calls `analyzeDemandPatterns()` — analyzes wholesale orders by crop over 60 days
3. Computes trend (comparing recent 30d vs prior 30d, ratio thresholds ±25%)
4. Calls `getCropBenchmarksForPush()` — yields, loss rates, optimal env per crop
5. Builds `networkIntelligence: { crop_benchmarks, demand_signals, risk_alerts }`
6. POSTs to each farm's `/api/health/ai-recommendations`
7. Farm persists to `ai-recommendations.json` for local consumption

### Data Flow
```
wholesale_orders → analyzeDemandPatterns() → demand_signals
experiment_records → getCropBenchmarksForPush() → crop_benchmarks
                        ↓
     ai-recommendations-pusher.js → pushToFarm()
                        ↓
     Farm: /api/health/ai-recommendations → ai-recommendations.json
                        ↓
     Farm: /api/ai/suggested-crop (T14) reads demand signals
     Farm: /api/planting/recommendations reads demand signals
```

### Gaps
- None — full pipeline operational.

---

## T21 — New-farm onboarding with benchmarks

**Status: ⚠️ PARTIAL**

### Existing Code
| File | Line(s) | What |
|------|---------|------|
| `routes/farm-stripe-setup.js` | 5 | Farm Stripe onboarding route |
| `routes/wholesale/square-oauth.js` | full file | Square OAuth onboarding for farms |
| `FARM_ONBOARDING_GUIDE.md` | full file | Documented onboarding process |
| Farm Setup Wizard | HTML modal | Multi-step wizard (connection → location → contact → rooms → review) |
| [server-foxtrot.js](server-foxtrot.js#L10793) | 10793 | Farm Purchase & Onboarding Routes |
| `db/migrations/001_wholesale_schema.sql` | 27 | `status IN ('active', 'inactive', 'onboarding', 'suspended')` |

### What Exists
- Farm setup wizard: Wi-Fi → location → contact → rooms → review → save
- Purchase flow: Square checkout → account creation → activation
- QR code + PIN-based device pairing via `/api/setup/activate`
- Grower landing page: `landing-growers.html`
- Benchmark push already works via AI Pusher (T20/T22)

### Gaps
- **"Seed new farm with benchmarks"** flow doesn't exist — when a new farm joins, it receives benchmarks on the next 30-min AI push cycle, but there's no immediate onboarding step that pre-populates with network benchmarks
- Workaround: farm receives benchmarks within 30 minutes of registration and first telemetry sync
- Fix estimate: ~4h — add an immediate benchmark push on farm registration webhook

---

## T22 — Environmental benchmark push to farms

**Status: ✅ IMPLEMENTED**

### Existing Code
| File | Line(s) | What |
|------|---------|------|
| [greenreach-central/routes/experiment-records.js](greenreach-central/routes/experiment-records.js#L270) | 270–300 | `getCropBenchmarksForPush()` |
| [greenreach-central/services/ai-recommendations-pusher.js](greenreach-central/services/ai-recommendations-pusher.js#L200) | 200–225 | Benchmark push in network intelligence |
| [greenreach-central/routes/experiment-records.js](greenreach-central/routes/experiment-records.js#L202) | 202 | `computeCropBenchmarks()` — nightly aggregation |
| [greenreach-central/routes/farms.js](greenreach-central/routes/farms.js#L296) | 296–297 | Benchmark data in farm routes |

### Benchmark Schema Pushed to Farms
```json
{
  "crop_benchmarks": {
    "Genovese Basil": {
      "network_avg_weight": 2.1,
      "network_min_weight": 0.8,
      "network_max_weight": 4.2,
      "network_avg_grow_days": 28,
      "network_avg_loss_rate": 0.05,
      "network_optimal_temp_c": 24.5,
      "network_optimal_humidity_pct": 65,
      "network_optimal_ppfd": 450,
      "contributing_farms": 3,
      "harvest_count": 27,
      "computed_at": "2026-02-21T02:00:00Z"
    }
  }
}
```

### Gaps
- None — benchmarks computed nightly at 2 AM, pushed every 30 min via AI Pusher.

---

## T23 — Network trends endpoint

**Status: ✅ IMPLEMENTED (Central) / ⚠️ STUB (Foxtrot)**

### Existing Code — Central (PRODUCTION)
| File | Line(s) | What |
|------|---------|------|
| [greenreach-central/routes/network-growers.js](greenreach-central/routes/network-growers.js#L220) | 220–304 | `GET /api/network/trends` — full PostgreSQL-backed implementation |

Returns:
- `networkGrowth[]` — new farms per week
- `productionTrend[]` — harvests + avg yield per week
- `demandTrend[]` — wholesale orders + units per week
- `yieldTrend[]` — average yield per week

Supports `?period=90d` query parameter.

### Existing Code — Foxtrot (STUB)
| File | Line(s) | What |
|------|---------|------|
| [routes/network.js](routes/network.js#L236) | 236–254 | `GET /api/network/trends` — returns empty `{ trends: [] }` mock |

### UI
- Central admin HTML has `#network-production-trend` KPI display
- `central-admin.js` calls `/api/network/trends`
- `wholesaleMemoryStore.js` tracks trends at lines 811–817

### Gaps
- **Foxtrot stub** at `routes/network.js:236` returns mock data. Since trends are a Central concern (cross-farm analysis), this is architecturally correct — the Foxtrot endpoint is just a passthrough placeholder.
- ~1h to connect Foxtrot stub to proxy Central's endpoint if needed.

---

## T24 — Buyer behavior & churn analytics

**Status: ✅ IMPLEMENTED**

### Existing Code
| File | Line(s) | What |
|------|---------|------|
| [greenreach-central/routes/network-growers.js](greenreach-central/routes/network-growers.js#L305) | 305–400 | `GET /api/network/buyer-behavior` — Phase 2 Task 2.12 |

### How It Works
1. Queries `wholesale_orders` + `wholesale_buyers` tables
2. Computes per-buyer: `first_order_at`, `last_order_at`, `total_orders`, `period_orders`, `lifetime_units`
3. Classifies each buyer:
   - **active** — last order within 30 days
   - **at_risk** — last order 30–60 days ago
   - **churned** — last order > 60 days ago
4. Summary: `active_buyers`, `at_risk_buyers`, `churned_buyers`, `repeat_rate`
5. Supports `?period=90d` query parameter

### Response Schema
```json
{
  "success": true,
  "behavior": {
    "period": "90d",
    "summary": {
      "active_buyers": 12,
      "at_risk_buyers": 3,
      "churned_buyers": 5,
      "repeat_rate": 68.5
    },
    "buyers": [
      {
        "buyer": "buyer@example.com",
        "first_order_at": "2026-01-15T...",
        "last_order_at": "2026-02-20T...",
        "total_orders": 8,
        "period_orders": 4,
        "lifetime_units": 120,
        "churn_status": "active"
      }
    ]
  }
}
```

### UI
- Central admin `GR-central-admin.html` has buyer analytics sections at lines 2448–2520
- `central-admin.js:601` references buyer behavior display

### Gaps
- None — fully operational with PostgreSQL-backed analytics.

---

## Architecture Notes

### Data Flow Summary
```
Farm (Foxtrot, port 8091)
  ├── Tray runs + formats (NeDB) → T13, T15, T18
  ├── Lighting recipes (JSON)    → T17
  ├── AI recommendations (JSON)  → T14, T20
  ├── Device discovery (mDNS)    → T19
  └── Printer endpoints           → T16

Central (GreenReach, port 3100)
  ├── PostgreSQL
  │   ├── experiment_records     → T22 benchmarks
  │   ├── wholesale_orders       → T20 demand, T24 churn
  │   ├── wholesale_buyers       → T24 analytics
  │   ├── farms                  → T21 onboarding, T23 growth
  │   └── crop_benchmarks        → T22 pushed data
  ├── AI Pusher (30-min cycle)   → T20, T22
  └── Network routes             → T23, T24
```

### Remaining Work (Priority Order)
1. **T16** (~2h) — Wire client-side auto-print trigger in Activity Hub harvest response handler
2. **T23** (~1h) — Decide: proxy Central trends on Foxtrot, or leave as Central-only (recommendation: Central-only is correct)
3. **T19** (~4h) — Add controller-topology-to-group auto-assignment after discovery
4. **T21** (~4h) — Add immediate benchmark push on new farm registration
