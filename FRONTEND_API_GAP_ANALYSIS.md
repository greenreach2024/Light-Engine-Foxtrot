# Frontend → Central API Endpoint Gap Analysis

> Generated: 2026-02-08  
> Scope: Every `fetch()` call in `greenreach-central/public/` vs routes served by Central (`greenreach-central/server.js` + route files)

---

## Summary

| Category | Count |
|----------|-------|
| **COVERED** (Central handles) | ~95 unique endpoints |
| **MISSING** (Central does NOT handle — fall through to Foxtrot or 404) | ~72 unique endpoints |
| **Intentionally Edge-Only** (Foxtrot hardware/IoT) | ~20 of the 72 |
| **Frontend files audited** | 25+ JS/HTML files |
| **Central route files audited** | 34 route files + server.js inline |

---

## COVERED — Central Already Serves These

### Authentication (`/api/auth/*` → routes/auth.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| POST | `/api/auth/login` | login.html |
| GET | `/api/auth/validate-token` | (programmatic) |
| GET | `/api/auth/validate-device-token` | tray-inventory.html |
| POST | `/api/auth/logout` | (programmatic) |
| GET | `/api/auth/me` | (programmatic) |

### Farm Auth & Profile (`/api/farm/*` → server.js inline + routes/farms.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| POST | `/api/farm/auth/login` | farm-admin.js |
| GET | `/api/farm/profile` | farm-admin.js, farm-summary.html |
| GET | `/api/farms/:farmId` | farms.js |
| GET | `/api/farms/profile` | farms.js |
| POST | `/api/farms/register` | farms.js |
| POST | `/api/farms/:farmId/heartbeat` | farms.js |
| GET | `/api/farm/activity/:farmId` | farm-admin.js |
| GET | `/api/farms/:farmId/groups` | farms.js |

### Setup Wizard (`/api/setup-wizard/*`, `/api/setup/*` → routes/setup-wizard.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/setup-wizard/status` | farm-admin.js |
| GET | `/api/setup/status` | farm-admin.js |
| POST | `/api/setup/complete` | farm-admin.js, setup-wizard.html |
| POST | `/api/setup/farm-profile` | setup-wizard.js |
| POST | `/api/setup/change-password` | setup-wizard.js |
| GET | `/api/setup/rooms` | room-mapper.html |
| POST | `/api/setup/rooms` | setup-wizard.js |
| POST | `/api/setup/zones` | setup-wizard.js |

### Groups & Rooms (server.js inline)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/groups` | groups-v2.js |
| GET | `/api/rooms` | (server.js inline) |

### Environment & Sensors (server.js inline)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/env` | room-heatmap.html, farm-assistant.js, tray-inventory.html |
| GET | `/api/env` | farm-summary.html |

### Inventory (server.js inline)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/inventory/dashboard` | LE-farm-admin.html |
| GET | `/api/inventory/reorder-alerts` | LE-farm-admin.html |
| GET | `/api/inventory/seeds/list` | LE-farm-admin.html |
| POST | `/api/inventory/seeds` | LE-farm-admin.html |
| GET | `/api/inventory/seeds/:id` | LE-farm-admin.html |
| PUT | `/api/inventory/seeds/:id` | LE-farm-admin.html |
| GET | `/api/inventory/packaging/list` | LE-farm-admin.html |
| POST | `/api/inventory/packaging` | LE-farm-admin.html |
| GET | `/api/inventory/packaging/:id` | LE-farm-admin.html |
| POST | `/api/inventory/packaging/:id/restock` | LE-farm-admin.html |
| GET | `/api/inventory/nutrients/list` | LE-farm-admin.html |
| GET | `/api/inventory/nutrients/:id` | LE-farm-admin.html |
| GET | `/api/inventory/equipment/list` | LE-farm-admin.html |
| GET | `/api/inventory/equipment/:id` | LE-farm-admin.html |
| GET | `/api/inventory/supplies/list` | LE-farm-admin.html |
| GET | `/api/inventory/supplies/:id` | LE-farm-admin.html |
| GET | `/api/inventory/usage/weekly-summary` | LE-farm-admin.html |
| GET | `/api/inventory/current` | farm-admin.js, planting-scheduler.html, tray-inventory.html |
| GET | `/api/inventory/forecast` | tray-inventory.html |

### Traceability (server.js inline)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/traceability/stats` | LE-farm-admin.html |
| GET | `/api/traceability/batches` | LE-farm-admin.html |
| GET | `/api/traceability/batches/:batchId` | LE-farm-admin.html, tray-inventory.html |
| POST | `/api/traceability/batches/create` | LE-farm-admin.html |
| GET | `/api/traceability/batches/:batchId/report` | LE-farm-admin.html |

### Sustainability (server.js inline)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/sustainability/esg-report` | LE-farm-admin.html |
| GET | `/api/sustainability/energy/usage` | LE-farm-admin.html |
| GET | `/api/sustainability/water/usage` | LE-farm-admin.html |
| GET | `/api/sustainability/carbon-footprint` | LE-farm-admin.html |
| GET | `/api/sustainability/waste/tracking` | LE-farm-admin.html |
| GET | `/api/sustainability/trends` | LE-farm-admin.html |

### Automation & ML (server.js inline)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/automation/rules` | farm-summary.html |
| GET | `/api/automation/history` | farm-summary.html |
| GET | `/api/schedule-executor/status` | farm-summary.html |
| GET | `/api/schedule-executor/ml-anomalies` | farm-summary.html, farm-assistant.js |
| GET | `/api/ml/anomalies/statistics` | farm-summary.html |
| GET | `/api/ml/energy-forecast` | farm-summary.html |
| GET | `/api/health/insights` | farm-summary.html |
| GET | `/api/health/vitality` | farm-vitality.js |
| GET | `/api/ai/status` | planting-scheduler.html |

### Tray Formats (server.js inline)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/tray-formats` | tray-setup.html, tray-inventory-old-backup.html |
| POST | `/api/tray-formats` | tray-setup.html |
| PUT | `/api/tray-formats/:id` | tray-setup.html |
| DELETE | `/api/tray-formats/:id` | tray-setup.html |
| GET | `/api/trays` | tray-setup.html, tray-inventory-old-backup.html |
| POST | `/api/trays/register` | tray-setup.html, tray-inventory-old-backup.html |

### Activity Hub (server.js inline — stub)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/activity-hub/orders/pending` | tray-inventory.html |
| GET | `/api/audit/recent` | tray-inventory.html |

### Wholesale — Buyer Facing (`/api/wholesale/*` → routes/wholesale.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/wholesale/catalog` | wholesale.html |
| GET | `/api/wholesale/catalog/filters` | wholesale.js |
| GET | `/api/wholesale/farms` | wholesale.js |
| POST | `/api/wholesale/buyers/register` | wholesale.html |
| POST | `/api/wholesale/buyers/login` | wholesale.html |
| POST | `/api/wholesale/buyers/change-password` | wholesale.html |
| GET | `/api/wholesale/buyers/me` | wholesale.html |
| PUT | `/api/wholesale/buyers/me` | wholesale.html |
| GET | `/api/wholesale/buyers/payments` | wholesale.html |
| GET | `/api/wholesale/orders` | wholesale.html |
| GET | `/api/wholesale/orders/:orderId` | wholesale.html, tray-inventory.html |
| GET | `/api/wholesale/orders/:orderId/invoice` | wholesale.html |
| POST | `/api/wholesale/orders/:orderId/cancel` | wholesale.html |
| POST | `/api/wholesale/checkout/preview` | wholesale.html |
| POST | `/api/wholesale/checkout/execute` | wholesale.html |
| POST | `/api/wholesale/order-status` | farm-admin.js |
| GET | `/api/wholesale/farm-performance/dashboard` | GR-farm-performance.html |
| GET | `/api/wholesale/network/farms` | wholesale.js |
| GET | `/api/wholesale/admin/orders` | wholesale.js |
| GET | `/api/wholesale/inventory/check-overselling` | wholesale.js |

### Planting (`/api/planting/*` → routes/planting.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/planting/recipes` | planting-scheduler.html |
| POST | `/api/planting/recommendations` | planting-scheduler.html |
| POST | `/api/planting/plan` | planting-scheduler.html |
| POST | `/api/planting/assignments` | planting-scheduler.html |
| GET | `/api/planting/assignments` | planting-scheduler.html |
| POST | `/api/planting/crop-info-batch` | planting-scheduler.html |
| POST | `/api/planting/feedback` | planting-scheduler.html |

### Planning (`/api/planning/*` → routes/planning.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/planning/capacity` | LE-farm-admin.html |
| GET | `/api/planning/demand-forecast` | LE-farm-admin.html |
| GET | `/api/planning/recommendations` | LE-farm-admin.html |
| GET | `/api/planning/plans/list` | LE-farm-admin.html |
| POST | `/api/planning/plans/create` | LE-farm-admin.html |
| GET | `/api/planning/crops` | LE-farm-admin.html |

### Admin (`/api/admin/*` → routes/admin.js + sub-mounts)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| POST | `/api/admin/auth/login` | central-admin.js (via admin-auth.js) |
| GET | `/api/admin/auth/verify` | central-admin.js (via admin-auth.js) |
| POST | `/api/admin/auth/logout` | central-admin.js (via admin-auth.js) |
| GET | `/api/admin/farms` | central-admin.js, GR-central-admin.html |
| GET | `/api/admin/farms/:farmId` | central-admin.js |
| DELETE | `/api/admin/farms/:farmId` | admin.js |
| GET | `/api/admin/farms/:farmId/rooms` | central-admin.js |
| GET | `/api/admin/farms/:farmId/zones` | admin.js |
| GET | `/api/admin/farms/:farmId/groups` | central-admin.js |
| GET | `/api/admin/farms/:farmId/config` | central-admin.js |
| PATCH | `/api/admin/farms/:farmId/config` | central-admin.js |
| PATCH | `/api/admin/farms/:farmId/notes` | central-admin.js |
| PATCH | `/api/admin/farms/:farmId/metadata` | central-admin.js |
| GET | `/api/admin/farms/:farmId/logs` | central-admin.js |
| GET | `/api/admin/farms/:farmId/devices` | central-admin.js |
| GET | `/api/admin/farms/:farmId/inventory` | central-admin.js |
| GET | `/api/admin/farms/:farmId/recipes` | central-admin.js |
| POST | `/api/admin/farms/sync-all-stats` | central-admin.js |
| GET | `/api/admin/users` | central-admin.js, GR-central-admin.html |
| POST | `/api/admin/users` | admin.js |
| PUT | `/api/admin/users/:userId` | admin.js |
| DELETE | `/api/admin/users/:userId` | admin.js |
| POST | `/api/admin/users/:userId/reset-password` | admin.js |
| GET | `/api/admin/analytics/aggregate` | central-admin.js |
| GET | `/api/admin/analytics/farms/:farmId/metrics` | central-admin.js |
| GET | `/api/admin/anomalies` | central-admin.js |
| GET | `/api/admin/alerts` | central-admin.js |
| GET | `/api/admin/rooms` | central-admin.js |
| GET | `/api/admin/zones` | central-admin.js |
| GET | `/api/admin/kpis` | admin.js |
| GET | `/api/admin/fleet/monitoring` | admin.js |
| GET | `/api/admin/energy/dashboard` | central-admin.js |
| GET | `/api/admin/harvest/forecast` | central-admin.js |
| GET | `/api/admin/ai-rules` | admin.js |
| POST | `/api/admin/ai-rules` | admin.js |
| GET | `/api/admin/grants/*` | admin.js |

### Admin Recipes (`/api/admin/recipes/*` → routes/admin-recipes.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/admin/recipes` | central-admin.js |
| GET | `/api/admin/recipes/:recipeId` | central-admin.js |
| PUT | `/api/admin/recipes/:recipeId` | central-admin.js |
| POST | `/api/admin/recipes` | central-admin.js |

### Procurement (`/api/procurement/*` → routes/procurement-admin.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/procurement/catalog` | central-admin.js |
| PUT | `/api/procurement/catalog/product` | central-admin.js |
| DELETE | `/api/procurement/catalog/product/:sku` | central-admin.js |
| GET | `/api/procurement/suppliers` | central-admin.js |
| PUT | `/api/procurement/suppliers/:supplierId` | central-admin.js |
| POST | `/api/procurement/suppliers` | central-admin.js |
| GET | `/api/procurement/revenue` | central-admin.js |

### Crop Pricing (`/api/crop-pricing/*` → routes/crop-pricing.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/crop-pricing` | crop-pricing.js |
| PUT | `/api/crop-pricing` | crop-pricing.js |
| GET | `/api/crop-pricing/:cropName` | crop-pricing.js |

### Sync (`/api/sync/*` → routes/sync.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/sync/:farmId/devices` | central-admin.js |
| GET | `/api/sync/:farmId/telemetry` | central-admin.js |
| GET | `/api/sync/:farmId/inventory` | central-admin.js |

### AI Insights (`/api/ai-insights/*` → routes/ai-insights.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/ai-insights/:farmId` | central-admin.js |

### Billing (`/api/billing/*` → routes/billing.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/billing/usage/:farmId` | farm-admin.js |

### Recipes (`/api/recipes/*` → routes/recipes.js)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/api/recipes` | tray-inventory-old-backup.html |
| GET | `/api/recipes/categories` | recipes.js |
| GET | `/api/recipes/:id` | recipes.js |

### Static Data (server.js — served via express.static or inline)
| Method | Endpoint | Source File(s) |
|--------|----------|---------------|
| GET | `/data/groups.json` | groups-v2.js, farm-admin.js, planting-scheduler.html |
| GET | `/data/rooms.json` | room-mapper.html, room-heatmap.html |
| GET | `/data/farm.json` | farm-admin.js, farm-vitality.js, various HTMLs |
| GET | `/data/lighting-recipes.json` | central-admin.js, planting-scheduler.html |
| GET | `/data/crop-registry.json` | groups-v2.js, farm-inventory.html |
| GET | `/data/iot-devices.json` | room-heatmap.html, room-mapper.html |
| GET | `/data/room-map*.json` | room-heatmap.html, room-mapper.html |
| GET | `/data/equipment-metadata.json` | room-heatmap.html, room-mapper.html |
| GET | `/data/farm-summary.json` | farm-admin.js |
| GET | `/data/spd-library.json` | test-LE-matrix-solver.html |
| GET | `/data/field-mappings.json` | field-mapping.html |
| GET | `/plans` | planting-scheduler.html |
| GET | `/configuration` | (server.js inline) |
| GET | `/devices` | (server.js inline) |

---

## MISSING — Frontend Calls These But Central Does NOT Handle

### Priority 1: Farm Admin Features (farm-admin.js)

| Method | Endpoint | Source File | Notes |
|--------|----------|------------|-------|
| POST | `/api/auth/generate-device-token` | farm-admin.js:4173 | **No route** — auth.js only has login/validate-token/logout/me |
| POST | `/api/user/change-password` | farm-admin.js:6125 | **No route** — distinct from setup-wizard change-password |
| POST | `/api/users/create` | farm-admin.js:6169 | **No route** — ≠ `/api/admin/users` (admin-only) |
| GET | `/api/users/list` | farm-admin.js:6216 | **No route** — farm-scoped user list |
| POST | `/api/users/delete` | farm-admin.js:6270 | **No route** — farm-scoped user delete |
| GET | `/api/quality/tests/:farmId` | farm-admin.js:5755 | **No route anywhere** |
| GET | `/api/ai/insights/count` | farm-admin.js:3170 | **No route** — `/api/ai/status` exists but not `/insights/count` |
| GET | `/api/billing/receipts` | farm-admin.js:3626 | **No route** — billing.js only has `/usage/:farmId` |
| GET | `/api/farm/square/status` | farm-admin.js:3503, 3844 | **No route** — farms.js has NO square endpoints |
| POST | `/api/farm/square/authorize` | farm-admin.js:3565 | **No route** |
| POST | `/api/hardware/scan` | farm-admin.js:3880 | **No route** — Foxtrot edge only? |
| POST | `/api/setup/certifications` | farm-admin.js:4057 | **No route** — setup-wizard.js doesn't handle this |
| POST | `/api/setup/activate` | farm-admin.js:4825 | **No route** — setup-wizard.js doesn't handle this |
| GET | `/api/inventory/tray-formats` | farm-admin.js:5152 | **No route** — `/api/tray-formats` exists (no `/api/inventory/` prefix) — **path mismatch** |
| GET | `/crop-pricing` | farm-admin.js:1318 | **No route** — `/api/crop-pricing` exists but NOT `/crop-pricing` (missing `/api/` prefix) — **path mismatch** |

### Priority 2: Farm Sales & POS (Entire subsystem missing)

| Method | Endpoint | Source File | Notes |
|--------|----------|------------|-------|
| GET | `/api/config/app` | farm-sales-landing.html:779, farm-sales-pos.html:819+, farm-sales-store.html:748+, farm-sales-shop.html:877 | **No route** — used across 4 pages |
| GET | `/api/farm-auth/demo-tokens` | farm-sales-pos.html:828+, farm-sales-store.html:757+, farm-sales-shop.html:910+ | **No route** — used across 3 pages (5+ calls) |
| GET | `/api/farm-sales/orders` | farm-admin.js:3034, farm-sales-shop.html:1207 | **No route** |
| GET | `/api/farm-sales/inventory` | farm-summary.html:2270, farm-sales-shop.html:914 | **No route** |
| GET | `/api/farm-sales/subscriptions/plans` | farm-sales-shop.html:989 | **No route** |
| GET | `/api/farm-sales/quickbooks/status` | farm-admin.js:3307 | **No route** — 6 QuickBooks endpoints |
| POST | `/api/farm-sales/quickbooks/auth` | farm-admin.js:3335 | **No route** |
| POST | `/api/farm-sales/quickbooks/disconnect` | farm-admin.js:3376 | **No route** |
| POST | `/api/farm-sales/quickbooks/sync-invoices` | farm-admin.js:3404 | **No route** |
| POST | `/api/farm-sales/quickbooks/sync-payments` | farm-admin.js:3436 | **No route** |
| POST | `/api/farm-sales/quickbooks/sync/customer` | farm-admin.js:3468 | **No route** |
| GET | `/api/farm-sales/ai-agent/status` | ai-agent-test.html:368 | **No route** |
| POST | `/api/farm-sales/ai-agent/chat` | ai-agent-test.html:415 | **No route** |

### Priority 3: Wholesale Farm-Side Operations (farm-admin.js)

| Method | Endpoint | Source File | Notes |
|--------|----------|------------|-------|
| POST | `/api/wholesale/order-statuses` | farm-admin.js:2841, 2862 | **No route** — only `order-status` (singular) exists |
| POST | `/api/wholesale/tracking-numbers` | farm-admin.js:2881, 2902 | **No route** |
| POST | `/api/wholesale/order-tracking` | farm-admin.js:2938 | **No route** |
| GET | `/api/wholesale/order-events` | farm-admin.js:2487 | **No route in Central** — Foxtrot edge only |
| GET | `/api/wholesale/farm-performance/alerts` | GR-farm-performance.html:532, GR-wholesale-farm-performance.html:532 | **No route** — only `/dashboard` exists |
| GET | `/api/wholesale/orders/pending-verification/:farmId` | LE-wholesale-orders.html:511 | **No route** |
| POST | `/api/wholesale/orders/farm-verify` | LE-wholesale-orders.html:645, 714, 764 | **No route** |
| POST | `/api/wholesale/orders/:orderId/verify` | tray-inventory.html:3039 | **No route** |

### Priority 4: Procurement Portal (procurement-portal.html)

| Method | Endpoint | Source File | Notes |
|--------|----------|------------|-------|
| POST | `/api/procurement/orders` | procurement-portal.html:916 | **No route** — procurement-admin.js has catalog/suppliers/revenue only |
| GET | `/api/procurement/orders` | procurement-portal.html:953, 1154 | **No route** |
| GET | `/api/procurement/orders/:id` | procurement-portal.html:999 | **No route** |
| POST | `/api/procurement/orders/:id/receive` | procurement-portal.html:1081 | **No route** |
| GET | `/api/procurement/inventory` | procurement-portal.html:1100 | **No route** |
| GET | `/api/procurement/commission-report` | procurement-portal.html:1155 | **No route** |

### Priority 5: GR-central-admin.html — Network & Grower Management

| Method | Endpoint | Source File | Notes |
|--------|----------|------------|-------|
| GET | `/api/network/dashboard` | GR-central-admin.html:3970 | **No route** — entirely separate from `/api/wholesale/network/*` |
| GET | `/api/network/farms/list` | GR-central-admin.html:4012 | **No route** |
| GET | `/api/network/comparative-analytics` | GR-central-admin.html:4088 | **No route** |
| GET | `/api/network/trends` | GR-central-admin.html:4139 | **No route** |
| GET | `/api/network/alerts` | GR-central-admin.html:4208 | **No route** |
| GET | `/api/network/farms/:farmId` | GR-central-admin.html:4238, 4672 | **No route** |
| GET | `/api/growers/dashboard` | GR-central-admin.html:4332 | **No route** |
| GET | `/api/growers/list` | GR-central-admin.html:4349 | **No route** |
| GET | `/api/farms/list` | GR-central-admin.html:4399 | **No route** — `/api/farms` (no `/list`) exists |
| GET | `/api/contracts/list` | GR-central-admin.html:4431 | **No route** |
| GET | `/api/leaderboard` | GR-central-admin.html:4464 | **No route** |
| GET | `/api/performance/:growerId` | GR-central-admin.html:4500 | **No route** |
| GET | `/api/invitations/list` | GR-central-admin.html:4547 | **No route** |
| POST | `/api/admin/farms/:farmId/reset-credentials` | GR-central-admin.html:4973 | **No route** in admin.js |
| POST | `/api/admin/farms/reset-user-password` | GR-central-admin.html:5001 | **No route** — admin.js has `/users/:userId/reset-password` instead |
| POST | `/api/admin/farms/:farmId/status` | GR-central-admin.html:5036 | **No route** |
| PUT | `/api/admin/users/:userId/status` | GR-central-admin.html:5068 | **No route** — admin.js has `PUT /users/:userId` (general update) |
| PUT | `/api/admin/users/:userId/role` | GR-central-admin.html:5105 | **No route** — same general update route |
| POST | `/api/admin/impersonate/:farmId` | GR-central-admin.html:5134 | **No route** |
| POST | `/api/admin/auth/change-password` | central-admin.js:332 | **No route** — admin-auth.js has login/verify/logout only |

### Priority 6: Edge/Foxtrot Hardware Endpoints (Intentionally Edge-Only)

These are called from Central-hosted frontend files but are designed to hit the **Foxtrot edge server** directly. They will 404 on Central — this is by design when `currentAPI` points to the edge.

| Method | Endpoint | Source File | Notes |
|--------|----------|------------|-------|
| GET | `/api/devicedatas` | groups-v2.js:1173 | Device controller data |
| GET/POST | `/api/devicedatas/device/:controllerId` | groups-v2.js:1190+ | Multiple control commands |
| GET | `/api/kasa/info` | groups-v2.js:1310 | Kasa smart plug info |
| POST | `/api/kasa/device/:ip/power` | groups-v2.js:1322+ | Kasa power control |
| POST | `/api/kasa/control` | groups-v2.js:1609 | Kasa general control |
| GET | `/api/switchbot/status/:deviceId` | groups-v2.js:1379 | SwitchBot status |
| POST | `/api/switchbot/devices/:deviceId/commands` | groups-v2.js:1391+ | SwitchBot commands |
| POST | `/api/switchbot/command` | groups-v2.js:1619 | SwitchBot general |
| GET | `/iot/devices` | iot-manager.js:68 | IoT device list |
| POST | `/iot/devices/scan` | iot-manager.js:86 | IoT scan |
| PUT | `/iot/devices/:deviceId` | iot-manager.js:231 | IoT update |
| DELETE | `/iot/devices/:deviceId` | iot-manager.js:257 | IoT delete |
| PUT | `/switchbot/devices/:deviceId/room` | switchbot-helpers.js:5 | Room assignment |
| PUT | `/switchbot/devices/:deviceId/zone` | switchbot-helpers.js:21 | Zone assignment |
| POST | `/switchbot/devices/:deviceId/command` | switchbot-helpers.js:37 | Direct command |

### Priority 7: Tray Inventory Operations (Edge-Primary)

These are called from `tray-inventory.html` and `tray-inventory-old-backup.html` with `${currentAPI}` which points to **Foxtrot edge** when connected:

| Method | Endpoint | Source File | Notes |
|--------|----------|------------|-------|
| POST | `/api/tray-runs/:id/harvest` | tray-inventory.html:2231, 4241, 4701 | Harvest workflow |
| POST | `/api/tray-runs/:id/move` | tray-inventory.html:2468 | Tray movement |
| POST | `/api/qa/checkpoint` | tray-inventory.html:2238 | QA checkpoint |
| GET | `/api/quality/standards/:type` | tray-inventory.html:3405 | Quality standards |
| POST | `/api/quality/checkpoints/record` | tray-inventory.html:3532 | Quality recording |
| GET | `/api/activity-hub/orders/:orderId` | tray-inventory.html:2520 | Order detail |
| POST | `/api/activity-hub/orders/:id/accept` | tray-inventory.html:2706 | Accept order |
| POST | `/api/activity-hub/orders/:id/modify` | tray-inventory.html:2788 | Modify order |
| POST | `/api/activity-hub/orders/:id/decline` | tray-inventory.html:2846 | Decline order |
| POST | `/api/activity-hub/orders/:id/pick` | tray-inventory.html:2891 | Pick order |
| POST | `/api/activity-hub/orders/:id/pack` | tray-inventory.html:2952 | Pack order |
| POST | `/api/printer/print-packing` | tray-inventory.html:2978 | Print packing slip |
| GET | `/api/wholesale/orders/pending` | tray-inventory.html:3966 | Pending orders |
| POST | `/api/trays/:id/seed` | tray-inventory-old-backup.html:1014 | Seed tray |
| PUT | `/api/trays/:id` | tray-inventory-old-backup.html:860 | Update tray |
| POST | `/api/tray-formats/:id/update-target` | tray-inventory-old-backup.html:1188 | Update target |
| POST | `/api/farm-sales/lots/generate` | tray-inventory-old-backup.html:1222, 1243 | Generate lots |

### Priority 8: Other Miscellaneous Gaps

| Method | Endpoint | Source File | Notes |
|--------|----------|------------|-------|
| POST | `/api/farms/create-checkout-session` | landing-purchase.html:1130 | **No route** — Stripe/Square checkout |
| GET | `/api/farms/verify-session/:sessionId` | purchase-success.html:278, landing-purchase-success.html:266 | **No route** — payment verification |
| GET | `/api/demo/intro-cards` | intro-card.js:29 | **No route** |
| GET | `/api/health/ai-character` | farm-vitality.js:971 | **No route** — `/api/health/vitality` exists but not `ai-character` |
| POST | `/api/room-mapper/save` | room-mapper.html:862 | **No route** |
| GET | `/api/automation/fan-rotation/analytics` | fan-rotation-monitor.html:321 | **No route** — automation rules/history exist but not fan-rotation |
| POST | `/api/ai/record-decision` | planting-scheduler.html:4070 | **No route** — `ai/status` exists but not `record-decision` |
| POST | `/api/harvest` | farm-summary.html:6707, 6771 | **No route** — harvest recording |
| GET | `/api/farm/dedicated-crops` | farm-summary.html:7048 | **No route** |
| GET | `/api/wholesale/inventory` | tray-inventory.html:1865 | **No route on Central** — Foxtrot edge wholesale inventory |
| GET | `/api/farm-sales/inventory` | farm-summary.html:2270 | **No route** |
| GET | `/api/admin/farms/:farmId/users` | farm-admin.js:5334 | **No route** — admin.js has `/admin/users` but not per-farm users |

---

## Path Mismatch Issues (Quick Wins)

These endpoints exist on Central but the frontend uses wrong paths:

| Frontend Calls | Central Has | Fix Location |
|---------------|-------------|-------------|
| `GET /crop-pricing` | `GET /api/crop-pricing` | farm-admin.js:1318 — add `/api/` prefix |
| `GET /api/inventory/tray-formats` | `GET /api/tray-formats` | farm-admin.js:5152 — remove `/inventory/` |
| `GET /api/farms/list` | `GET /api/farms` (or `/api/admin/farms`) | GR-central-admin.html:4399 — drop `/list` |

---

## Recommendations

### Immediate (blocking user flows):
1. **Farm Sales subsystem** — `/api/config/app`, `/api/farm-auth/demo-tokens`, `/api/farm-sales/*` — 12 missing endpoints used by 4+ frontend pages
2. **Procurement orders** — `/api/procurement/orders` CRUD — 6 endpoints the procurement-portal.html depends on, procurement-admin.js only has catalog/suppliers
3. **Checkout flow** — `/api/farms/create-checkout-session` + `verify-session` — landing page purchase flow broken

### Short-term (farm admin UX):
4. **User management** — `/api/users/create|list|delete` and `/api/user/change-password` — farm-admin.js team management section
5. **Wholesale farm operations** — `order-statuses`, `tracking-numbers`, `order-tracking`, `order-events` — farm-side order fulfillment
6. **Square integration** — `/api/farm/square/status|authorize` — payment integration section

### Medium-term (admin & network):
7. **GR-central-admin network** — entire `/api/network/*` and `/api/growers/*` subsystem (13 endpoints)
8. **Admin extended ops** — `impersonate`, `reset-credentials`, `change-password`, status/role updates
9. **Quality & AI** — `quality/tests`, `ai/insights/count`, `health/ai-character`, `ai/record-decision`

### Accepted as Edge-Only:
10. Device control (`/api/devicedatas/*`, `/api/kasa/*`, `/api/switchbot/*`, `/iot/*`) — these intentionally route to Foxtrot
11. Tray inventory operations (`/api/tray-runs/*`, `/api/activity-hub/orders/*`, `/api/qa/*`) — edge workflow operations
