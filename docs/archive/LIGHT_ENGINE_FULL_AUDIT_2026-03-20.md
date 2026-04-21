# Light Engine Foxtrot — Complete System Audit

**Date:** March 20, 2026
**Scope:** Full data flow, AI/ML, cashflow, every page, every button, every task

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Application Inventory](#3-application-inventory)
4. [Every Page & UI Surface](#4-every-page--ui-surface)
5. [Every API Endpoint](#5-every-api-endpoint)
6. [AI & ML Capabilities](#6-ai--ml-capabilities)
7. [Cashflow & Financial System](#7-cashflow--financial-system)
8. [Data Architecture & Flow](#8-data-architecture--flow)
9. [IoT & Hardware Layer](#9-iot--hardware-layer)
10. [Critical Findings & Risk Register](#10-critical-findings--risk-register)

---

## 1. Executive Summary

Light Engine Foxtrot is a **full-stack indoor farming platform** comprising:

| Metric | Count |
|--------|-------|
| Total Lines of Code (server-foxtrot.js alone) | ~30,500 |
| GreenReach Central server.js | ~4,700 |
| Route files (Central) | 55 |
| Unique API endpoints (est.) | **~450+** (Central) + **~415** (Foxtrot) |
| HTML pages | 60+ |
| Frontend JS modules | 22+ |
| Backend services | 30 (Central) + 20 (root) |
| PostgreSQL tables | **~65** |
| AI/ML components | **17** (7 LLM-powered, 10 statistical/rule-based) |
| Payment integrations | Square (live), Stripe (built but disconnected) |
| Python ML models | 2 SARIMAX + 1 Vision API |
| IoT firmware projects | 2 (ESP32 nutrient controller + dual sensor) |
| Deployment targets | AWS EB (cloud), Edge (local farm), Desktop (Electron), Mobile (React Native) |

### Platform Components

| Component | Framework | Status | LOC Est. |
|-----------|-----------|--------|----------|
| **server-foxtrot.js** | Express.js (monolith) | PRODUCTION | 30,500 |
| **greenreach-central/** | Express.js (multi-tenant SaaS) | PRODUCTION | ~15,000 |
| **backend/** | FastAPI (Python) | ACTIVE | ~8,000 |
| **automation/** | Node.js rules engine | ACTIVE | ~3,000 |
| **mobile-app/** | React Native / Expo | DEVELOPED | ~2,000 |
| **desktop-app/** | Electron | DEVELOPED | ~500 |
| **frontend/** | React / TypeScript | ACTIVE (narrow) | ~1,500 |
| **analytics/** | Node.js energy forecaster | DEVELOPED | ~2,000 |
| **aws-lambda/** | SAM / Node.js | DEVELOPED | ~300 |
| **esp32-firmware/** | PlatformIO / Arduino | DEVELOPED | ~500 |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLOUD (AWS EB)                           │
│                                                                 │
│   server-foxtrot.js (30K LOC)                                   │
│   ├── Express routes (415+)                                     │
│   ├── WebSocket (real-time sync)                                │
│   ├── mounts: greenreach-central/routes/* (55 files, 450+ APIs) │
│   ├── Python FastAPI backend (port 8000, proxied at /py)        │
│   └── automation/ rules engine                                  │
│                                                                 │
│   PostgreSQL (RDS) ──── 65 tables                               │
│   Redis (caching, rate-limiting)                                │
├─────────────────────────────────────────────────────────────────┤
│                      EDGE (On-Farm)                             │
│                                                                 │
│   server-foxtrot.js (EDGE_MODE)                                 │
│   ├── SQLite (offline persistence)                              │
│   ├── MQTT listener (nutrient sensors)                          │
│   ├── Device drivers (SwitchBot, Kasa, Shelly)                  │
│   └── Sync service → pushes to Cloud every 5 min               │
│                                                                 │
│   ESP32 sensors ── serial/WiFi ── readings every 2s             │
│   SwitchBot devices ── API polling every 60s                    │
│   Smart plugs (Kasa/Shelly) ── local network control            │
├─────────────────────────────────────────────────────────────────┤
│                      CLIENTS                                    │
│                                                                 │
│   Browser (60+ HTML pages, vanilla JS + injected React)         │
│   Mobile (React Native / Expo)                                  │
│   Desktop (Electron wrapper)                                    │
│   POS Terminal (farm-sales-pos.html)                            │
│   Activity Hub (QR-driven staff workflows)                      │
└─────────────────────────────────────────────────────────────────┘
```

### Authentication Domains (4 separate)

| Domain | Table | Token Type |
|--------|-------|------------|
| Farm operators | `farm_users` | JWT (farm_id scoped) |
| Central admins | `admin_users` | JWT (admin role) |
| Wholesale buyers | `wholesale_buyers` | JWT (buyer_id scoped) |
| Grant users | `grant_users` | JWT (separate) |

---

## 3. Application Inventory

### Production Deployments

| App | Target | URL Pattern |
|-----|--------|-------------|
| Cloud server | AWS EB `light-engine-foxtrot-prod-v3` | `*.greenreachgreens.com` |
| Central SaaS | Same EB instance (mounted routes) | `/api/*`, admin pages |
| Python backend | Same instance (port 8000) | Proxied at `/py/*` |
| Edge server | On-premises Raspberry Pi / PC | `http://localhost:8091` |

### Developed / Not Deployed

| App | Status | Notes |
|-----|--------|-------|
| Desktop (Electron) | Built, not distributed | Windows NSIS + macOS DMG |
| Mobile (React Native) | Built, not in app stores | 10 screens, QR scanning |
| Lambda sensor aggregator | SAM template ready | SwitchBot polling |
| CloudFormation stack | Reference / aspirational | Full VPC/ECS definition |

### Abandoned / Skeleton

| App | Status |
|-----|--------|
| `edge-app/` | Only tsconfig.json, no source |
| `hq-app/` | Only tsconfig.json, no source |

---

## 4. Every Page & UI Surface

### 4A. Landing / Marketing Pages (13)

| Page | URL | Buttons / Actions |
|------|-----|-------------------|
| `landing-main.html` | `/` | CTA: "Get Started", "Learn More" |
| `landing-home.html` | `/home` | Feature cards, plan selection |
| `landing-cloud.html` | `/cloud` | Cloud plan details, "Subscribe" |
| `landing-edge.html` | `/edge` | Edge plan details, "Subscribe" |
| `landing-downloads.html` | `/downloads` | Download buttons (Desktop, Mobile) |
| `landing-purchase.html` | `/purchase` | Plan selector, "Purchase" → Square |
| `landing-purchase-success.html` | `/purchase-success` | Auto-login, setup wizard redirect |
| `about.html` | `/about` | Company info |
| `greenreach-org.html` | `/greenreach` | Organization overview |
| `grow-and-sell.html` | `/grow-and-sell` | Producer onboarding |
| `growing-made-easy.html` | `/growing-made-easy` | Consumer-facing |
| `id-buy-local.html` | `/buy-local` | Consumer marketplace |

### 4B. Farm Admin Pages (16)

| Page | Purpose | Key Buttons / Actions |
|------|---------|----------------------|
| `farm-admin-login.html` | Farm operator login | Email/password form, "Login" |
| `farm-admin.html` | Farm administration portal | User management (create/edit/delete), password reset, role assignment |
| `LE-dashboard.html` | **Main farm dashboard** | Room cards (click → drill-down), environment gauges, alert banners, recipe status, device counts, AI insights panel, notification bell |
| `LE-dashboard-consolidated.html` | Consolidated dashboard view | Same as above, single-page layout |
| `LE-farm-admin.html` | Farm admin panel | Edit farm profile, certifications, practices, delivery settings |
| `LE-qr-generator.html` | QR code generator | Generate QR for rooms/trays/products, print button |
| `LE-wholesale-orders.html` | Farm-side wholesale orders | Order list, accept/reject, fulfillment status, tracking |
| `farm-vitality.html` | Farm health dashboard | Multi-view tabs (Summary, Environment, Growth, Financials), chart toggles |
| `farm-sales-pos.html` | Point-of-Sale terminal | Product grid, cart, checkout (cash/card), receipt print |
| `farm-sales-store.html` | Online farm store | Product catalog, add-to-cart, checkout |
| `farm-sales-landing.html` | Farm store landing | Featured products, shop CTA |
| `farm-sales-shop.html` | Farm shop page | Browsing, filtering, cart |
| `setup-wizard.html` | First-time setup wizard | Step-by-step: password, profile, rooms, zones, devices, completion |
| `schedule.html` | Lighting schedule management | Dayparts editor, recipe selection, apply to group |
| `delivery.html` | Delivery management | Zone config, driver assignment, route planning |
| `activity-hub-qr.html` | Activity Hub QR scanning | Camera, scan tray QR → task menu |

### 4C. Central Admin Pages (8)

| Page | Purpose | Key Buttons / Actions |
|------|---------|----------------------|
| `GR-central-admin-login.html` | Admin login | Email/password, MFA |
| `GR-central-admin.html` | **Central admin dashboard** | Farm fleet overview, KPIs, anomaly alerts, farm drill-down |
| `GR-admin.html` | Admin management | User CRUD, permissions, AI rules config |
| `GR-wholesale.html` | Wholesale admin | Buyer management, order review, refunds, pricing offers |
| `GR-wholesale-integrations.html` | Wholesale integrations | Square OAuth per farm, Stripe setup |
| `GR-wholesale-order-review.html` | Order review panel | Approve/reject orders, split view |
| `GR-wholesale-farm-performance.html` | Farm performance analytics | Fulfillment rates, response times, quality scores |
| `GR-wholesale-legacy.html` | Legacy wholesale view | Backwards-compatible order view |

### 4D. Wholesale Buyer Pages (5)

| Page | Purpose | Key Buttons / Actions |
|------|---------|----------------------|
| `wholesale-landing.html` | Buyer landing page | "Register", "Login", marketplace info |
| `wholesale-about.html` | About wholesale | Program details |
| `wholesale-learn-more.html` | Learn more | FAQ, pricing, onboarding |
| `wholesale.html` (root) | **Buyer portal** | Catalog browse, filter by farm/category, add-to-cart, checkout, order history, payment history, profile |
| `wholesale-admin.html` (root) | Admin wholesale panel | Legacy admin view |

### 4E. Specialized View Pages (15)

| Page | Purpose | Key Buttons / Actions |
|------|---------|----------------------|
| `views/farm-summary.html` | Farm overview summary | Aggregate stats, room cards, recent harvests |
| `views/farm-inventory.html` | Inventory management | List/grid view, add/edit/delete items, reorder alerts, CSV export |
| `views/iot-manager.html` | IoT device management | Device cards, assign to room, power toggle, status LED |
| `views/room-mapper.html` | Room layout editor | Drag-and-drop device placement, zone assignment |
| `views/room-heatmap.html` | Environmental heatmap | Temperature/humidity/VPD overlays, color gradient |
| `views/planting-scheduler.html` | Planting schedule planner | Calendar view, drag assignments, crop picker |
| `views/nutrient-management.html` | Nutrient tracking | pH/EC readings, dosing history, target ranges |
| `views/network-dashboard.html` | Multi-farm network view | Comparative charts, supply/demand, harvest conflicts |
| `views/procurement-portal.html` | Procurement purchasing | Supplier catalog, order creation, receiving |
| `views/tray-inventory.html` | Tray tracking | QR-linked tray lifecycle, location tracking |
| `views/tray-setup.html` | Tray format configuration | Tray dimensions, cell counts, custom formats |
| `views/crop-weight-analytics.html` | Crop weight tracking | Weight trends, yield per tray, species comparison |
| `views/fan-rotation-monitor.html` | Fan rotation monitor | Active fan display, rotation schedule, override |
| `views/field-mapping.html` | Field/room spatial mapping | Canvas-based layout editor |
| `views/farm-maintenance-checklist.html` | Maintenance checklists | Task lists, completion tracking |

### 4F. Other Pages (5)

| Page | Purpose |
|------|---------|
| `grant-wizard.html` | Grant application wizard (multi-step) |
| `driver-enrollment.html` | Delivery driver sign-up form |
| `GR-farm-performance.html` | Farm performance analytics |
| `login.html` | General login page |
| `blog.html` / `blog-post.html` | Blog content |

### 4G. Persistent UI Widgets (always-on)

| Widget | File | Present On | Functions |
|--------|------|------------|-----------|
| **Farm Assistant "Cheo"** | `farm-assistant.js` | All farm pages | Chat input, voice output (TTS), settings panel (10 voices, TTS toggle), feedback thumbs, rich response cards, function calling (23 tools) |
| **Onboarding Checklist** | `onboarding-checklist.js` | Dashboard pages | Collapsible checklist, step completion tracking |
| **Header Nav** | `header-dropdown-nav.js` | All pages | Dropdown menus, farm switcher |
| **Help System** | `light-engine-help.js` | All pages | Context-sensitive help, AI insights panel |
| **PWA Installer** | `pwa-installer.js` | All pages | Install prompt, offline detection |

---

## 5. Every API Endpoint

### 5A. GreenReach Central Routes (55 files, ~450+ endpoints)

#### Authentication & Users

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | None | Farm user login |
| POST | `/api/auth/validate-token` | Bearer | Validate JWT |
| POST | `/api/auth/validate-device-token` | Device token | Validate device auth |
| POST | `/api/auth/logout` | Bearer | Invalidate session |
| POST | `/api/auth/change-password` | Bearer | Change password |
| GET | `/api/auth/me` | Bearer | Current user profile |
| POST | `/api/admin/auth/login` | None | Admin login |
| GET | `/api/admin/auth/verify` | Admin JWT | Verify admin session |
| POST | `/api/admin/auth/logout` | Admin JWT | Admin logout |
| POST | `/api/users/create` | Bearer | Create farm user |
| GET | `/api/users/list` | Bearer | List farm users |
| PATCH | `/api/users/update` | Bearer | Update farm user |
| POST | `/api/users/delete` | Bearer | Delete farm user |
| POST | `/api/users/reset-password` | Bearer | Reset user password |
| POST | `/api/auth/generate-device-token` | Bearer | Generate device auth token |

#### Farm Management

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/farms` | Admin | List all farms |
| GET | `/api/farms/:farmId` | Admin | Farm detail |
| POST | `/api/farms/register` | None | Register new farm |
| POST | `/api/farms/:id/heartbeat` | API key | Farm heartbeat |
| GET | `/api/farm/profile` | Bearer | Farm profile |
| GET | `/api/farms/:id/groups` | Bearer | Farm groups |
| GET | `/api/farms/:id/activity` | Admin | Farm activity log |

#### Setup Wizard

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/setup-wizard/status` | Bearer | Setup completion status |
| POST | `/api/setup-wizard/change-password` | Bearer | Initial password change |
| POST | `/api/setup-wizard/farm-profile` | Bearer | Save farm profile |
| POST | `/api/setup-wizard/rooms` | Bearer | Create rooms |
| GET | `/api/setup-wizard/rooms` | Bearer | Get rooms |
| POST | `/api/setup-wizard/zones` | Bearer | Create zones |
| GET | `/api/setup/profile` | Bearer | Get setup profile |
| PATCH | `/api/setup/profile` | Bearer | Update setup profile |
| POST | `/api/setup/certifications` | Bearer | Set certifications |
| POST | `/api/setup-wizard/complete` | Bearer | Mark setup complete |
| PATCH | `/api/setup-wizard/mark-complete` | Bearer | Force mark complete |
| GET | `/api/setup-wizard/onboarding-status` | Bearer | Onboarding progress |

#### AI & Assistant

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/assistant/chat` | Bearer | GPT-4o-mini chat (23 function tools) |
| GET | `/api/assistant/status` | Bearer | Assistant availability |
| GET | `/api/assistant/morning-briefing` | Bearer | Daily briefing (cached 4hr) |
| GET | `/api/assistant/nudges` | Bearer | Proactive nudge recommendations |
| POST | `/api/assistant/feedback` | Bearer | Submit chat feedback (👍/👎) |
| GET | `/api/ai-insights/:farmId` | Bearer | GPT-4 farm analysis |
| POST | `/api/tts` | Bearer | OpenAI text-to-speech |
| GET | `/api/ml/insights/forecast/:zone` | Bearer | ML forecast proxy |

#### Farm Operations Agent

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/farm-ops/daily-todo` | Bearer | Scored daily task list |
| POST | `/api/farm-ops/tool-gateway` | Bearer | Execute farm tool |
| GET | `/api/farm-ops/tool-catalog` | Bearer | List all 23 tools |
| POST | `/api/farm-ops/parse-command` | Bearer | NLU intent extraction |
| GET | `/api/farm-ops/audit-log` | Bearer | Tool execution log |
| POST | `/api/farm-ops/undo` | Bearer | Undo last write |
| GET | `/api/farm-ops/undo-history` | Bearer | Undo stack |

#### Admin Dashboard

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/farms` | Admin | All farms with metadata |
| GET | `/api/admin/farms/:id` | Admin | Deep farm detail |
| GET | `/api/admin/farms/:id/rooms` | Admin | Farm rooms |
| GET | `/api/admin/farms/:id/zones` | Admin | Farm zones |
| GET | `/api/admin/farms/:id/groups` | Admin | Farm groups |
| GET/PATCH | `/api/admin/farms/:id/config` | Admin | Farm configuration |
| PATCH | `/api/admin/farms/:id/notes` | Admin | Admin notes |
| PATCH | `/api/admin/farms/:id/metadata` | Admin | Farm metadata |
| GET | `/api/admin/farms/:id/logs` | Admin | Farm logs |
| DELETE | `/api/admin/farms/:id` | Admin | Delete farm |
| POST | `/api/admin/farms/:id/reset-credentials` | Admin | Reset farm credentials |
| POST | `/api/admin/farms/sync-all-stats` | Admin | Sync all farm stats |
| GET | `/api/admin/kpis` | Admin | Platform KPIs |
| GET | `/api/admin/analytics/aggregate` | Admin | Aggregate analytics |
| GET | `/api/admin/analytics/farms/:id/metrics` | Admin | Farm metrics |
| GET | `/api/admin/anomalies` | Admin | System anomalies |
| GET | `/api/admin/fleet/monitoring` | Admin | Fleet monitoring |
| GET | `/api/admin/alerts` | Admin | All alerts |
| GET | `/api/admin/rooms` | Admin | All rooms |
| GET | `/api/admin/zones` | Admin | All zones |
| GET/POST | `/api/admin/users` | Admin | Admin user CRUD |
| PUT/DELETE | `/api/admin/users/:id` | Admin | Admin user update/delete |
| POST | `/api/admin/users/:id/reset-password` | Admin | Admin password reset |
| GET/POST | `/api/admin/ai-rules` | Admin | AI guardrails config |
| GET/POST/DELETE | `/api/admin/ai-reference-sites` | Admin | AI reference data |

#### Admin AI Monitoring

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/ai/monitoring` | Admin | AI usage stats + costs |
| GET | `/api/admin/ai/activity` | Admin | AI activity log |

#### Wholesale Marketplace (~60 endpoints)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/wholesale/catalog` | None | Public product catalog |
| GET | `/api/wholesale/catalog/filters` | None | Filter options |
| GET | `/api/wholesale/farms` | None | Farm listings |
| POST | `/api/wholesale/buyers/register` | None | Buyer registration |
| POST | `/api/wholesale/buyers/login` | None | Buyer login |
| POST | `/api/wholesale/buyers/change-password` | Buyer JWT | Change password |
| POST | `/api/wholesale/buyers/forgot-password` | None | Password reset email |
| POST | `/api/wholesale/buyers/reset-password` | None | Reset with token |
| GET/PUT | `/api/wholesale/buyers/me` | Buyer JWT | Buyer profile |
| POST | `/api/wholesale/auth/logout` | Buyer JWT | Buyer logout |
| POST | `/api/wholesale/checkout/preview` | Buyer JWT | Cart preview + allocation |
| POST | `/api/wholesale/checkout/execute` | Buyer JWT | Place order (Square payment) |
| GET | `/api/wholesale/orders` | Buyer JWT | Buyer order list |
| GET | `/api/wholesale/orders/:id` | Buyer JWT | Order detail |
| GET | `/api/wholesale/orders/:id/invoice` | Buyer JWT | Invoice data |
| POST | `/api/wholesale/orders/:id/cancel` | Buyer JWT | Cancel order |
| GET | `/api/wholesale/buyers/payments` | Buyer JWT | Payment history |
| POST | `/api/wholesale/delivery/quote` | Buyer JWT | Delivery fee quote |
| GET | `/api/wholesale/exports/orders` | **NO AUTH** | Orders CSV |
| GET | `/api/wholesale/exports/payments` | **NO AUTH** | Payments CSV |
| GET | `/api/wholesale/exports/tax-summary` | **NO AUTH** | Tax summary CSV |
| GET | `/api/wholesale/exports/delivery-fees` | **NO AUTH** | Delivery fees CSV |

#### Wholesale Fulfillment

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/wholesale/orders/pending` | Bearer | Pending orders |
| GET | `/api/wholesale/orders/pending-verification/:farmId` | Bearer | Pending verification |
| POST | `/api/wholesale/orders/:id/fulfill` | Bearer | Mark fulfilled |
| POST | `/api/wholesale/orders/:id/verify` | Bearer | Verify order |
| POST | `/api/wholesale/orders/:id/cancel-by-farm` | Bearer | Farm-side cancel |
| POST | `/api/wholesale/order-statuses` | Bearer | Batch status update |
| POST | `/api/wholesale/tracking-numbers` | Bearer | Add tracking |
| GET | `/api/wholesale/order-events` | Bearer | Event timeline |
| GET | `/api/wholesale/farm-performance/alerts` | Bearer | Performance alerts |

#### Wholesale Network

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/wholesale/network/bootstrap` | Admin | Seed network data |
| GET/POST/DELETE | `/api/wholesale/network/farms` | Admin | Manage network farms |
| GET | `/api/wholesale/network/snapshots` | Admin | Network snapshots |
| GET | `/api/wholesale/network/aggregate` | Admin | Aggregate stats |
| GET | `/api/wholesale/network/trends` | Admin | Network trends |
| GET/POST | `/api/wholesale/network/market-events` | Admin | Market events |
| GET | `/api/wholesale/network/recommendations` | Admin | AI recommendations |

#### Admin Wholesale

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/wholesale/buyers` | Admin | All buyers |
| GET | `/api/admin/wholesale/orders` | Admin | All orders |
| GET | `/api/admin/wholesale/dashboard` | Admin | Revenue dashboard |
| POST | `/api/admin/wholesale/refunds` | Admin | Process refund (record only) |
| GET/PATCH | `/api/admin/wholesale/orders/:id` | Admin | Order management |
| GET | `/api/admin/wholesale/audit-log` | Admin | Audit trail |
| POST | `/api/admin/wholesale/buyers/reset-password` | Admin | Reset buyer password |
| GET/POST | `/api/admin/wholesale/buyers/:id` | Admin | Buyer management |

#### Admin Pricing

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET/POST | `/api/admin/pricing/cost-surveys` | Admin | Farm cost data |
| POST | `/api/admin/pricing/set-wholesale` | Admin | Set wholesale price |
| GET/PUT | `/api/admin/pricing/offers` | Admin | Pricing offers |
| GET | `/api/admin/pricing/offers/:id/responses` | Admin | Farm responses |
| GET | `/api/admin/pricing/offers/:id/counter-offers` | Admin | Counter-offer analysis |
| PUT | `/api/admin/pricing/offers/:id/cancel` | Admin | Cancel offer |
| GET | `/api/admin/pricing/history` | Admin | Price history |
| GET | `/api/admin/pricing/analytics/acceptance-trends` | Admin | Acceptance analytics |
| POST | `/api/admin/pricing/batch-update` | Admin | Batch price update |
| GET | `/api/admin/pricing/current-prices` | Admin | Current prices |

#### Admin Delivery

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/admin/delivery/readiness` | Admin | Delivery system readiness |
| GET/PUT | `/api/admin/delivery/config` | Admin | Delivery config |
| GET/POST/PUT/DELETE | `/api/admin/delivery/zones` | Admin | Delivery zones |
| GET/POST/PUT | `/api/admin/delivery/drivers` | Admin | Driver management |
| GET | `/api/admin/delivery/fees` | Admin | Fee schedule |
| GET/PATCH | `/api/admin/delivery/driver-payouts` | Admin | Driver payouts |
| GET | `/api/admin/delivery/reconciliation` | Admin | Financial reconciliation |
| GET/PATCH | `/api/admin/delivery/applications` | Admin | Driver applications |

#### Admin Marketing

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/admin/marketing/generate` | Admin | AI content generation |
| GET/PATCH/DELETE | `/api/admin/marketing/queue` | Admin | Content queue |
| POST | `/api/admin/marketing/publish` | Admin | Publish post |
| POST | `/api/admin/marketing/cron` | Admin | Trigger scheduled posts |
| GET/PATCH | `/api/admin/marketing/metrics` | Admin | Post metrics |
| GET/PATCH | `/api/admin/marketing/rules` | Admin | Content rules |
| GET/PATCH | `/api/admin/marketing/skills` | Admin | Agent skills |
| GET/PUT | `/api/admin/marketing/settings` | Admin | Marketing settings |
| POST | `/api/admin/marketing/settings/test` | Admin | Test config |
| GET | `/api/admin/marketing/history/:postId` | Admin | Post history |

#### Market Intelligence

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/market-intelligence/price-alerts` | Bearer | Price alerts |
| GET | `/api/market-intelligence/market-overview` | Bearer | Market summary |
| GET | `/api/market-intelligence/product/:name` | Bearer | Product detail |
| GET | `/api/market-intelligence/pricing-recommendations` | Bearer | AI pricing recs |
| GET | `/api/market-intelligence/price-history/:product` | Bearer | Price history |
| GET | `/api/market-intelligence/retailer-comparison/:product` | Bearer | Retailer comparison |
| GET | `/api/market-intelligence/anomalies` | Bearer | Price anomalies |
| POST | `/api/market-intelligence/observations` | Bearer | Submit observation |
| POST | `/api/market-intelligence/refresh-trends` | Bearer | Recompute trends |
| POST | `/api/market-intelligence/seed` | Bearer | Seed USDA data |

#### Crop Pricing & Planting

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/crop-pricing` | Bearer | Farm crop prices |
| PUT | `/api/crop-pricing` | Bearer | Update prices |
| GET | `/api/crop-pricing/:crop` | Bearer | Single crop price |
| GET | `/api/crop-pricing/export` | Bearer | CSV export |
| POST | `/api/crop-pricing/decisions` | Bearer | Record pricing decision |
| GET | `/api/planting/recipes` | Bearer | Planting recipes |
| POST | `/api/planting/recommendations` | Bearer | AI planting recs |
| POST | `/api/planting/plan` | Bearer | Create planting plan |
| GET | `/api/planting/schedules` | Bearer | Planting schedules |
| GET | `/api/planting/activity-hub-tasks` | Bearer | Activity Hub tasks |
| POST | `/api/planting/assignments` | Bearer | Create assignment |
| GET | `/api/planting/assignments` | Bearer | List assignments |
| POST | `/api/planting/crop-info-batch` | Bearer | Batch crop info |
| GET | `/api/planning/capacity` | Bearer | Farm capacity |
| GET | `/api/planning/demand-forecast` | Bearer | Demand forecast |
| GET | `/api/planning/recommendations` | Bearer | Planning recs |

#### Inventory Management

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/inventory/current` | Bearer | Current inventory |
| GET | `/api/inventory/forecast/:days?` | Bearer | Inventory forecast |
| GET | `/api/inventory/dashboard` | Bearer | Dashboard summary |
| GET | `/api/inventory/reorder-alerts` | Bearer | Low-stock alerts |
| GET | `/api/inventory/usage/weekly-summary` | Bearer | Weekly usage |
| GET/POST/PUT/DELETE | `/api/inventory/seeds/*` | Bearer | Seed inventory CRUD |
| GET/POST/PUT/DELETE | `/api/inventory/nutrients/*` | Bearer | Nutrient inventory |
| GET/POST/PUT/DELETE | `/api/inventory/packaging/*` | Bearer | Packaging inventory |
| GET/POST/PUT/DELETE | `/api/inventory/equipment/*` | Bearer | Equipment inventory |
| GET/POST/PUT/DELETE | `/api/inventory/supplies/*` | Bearer | Supplies inventory |
| POST | `/api/inventory/:cat/:id/restock` | Bearer | Restock item |
| POST | `/api/inventory/:cat/:id/usage` | Bearer | Record usage |
| POST | `/api/inventory/:cat/:id/maintenance` | Bearer | Log maintenance |

#### Accounting & Finance

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/accounting/health` | Admin | Schema health check |
| GET | `/api/accounting/accounts` | Admin | Chart of accounts |
| POST | `/api/accounting/transactions/ingest` | Admin | Ingest transactions |
| GET | `/api/accounting/transactions` | Admin | Query transactions |
| POST | `/api/accounting/classifications/:id` | Admin | Classify transaction |
| POST | `/api/accounting/classifications/apply-rules` | Admin | Batch auto-classify |
| GET | `/api/accounting/classifications/queue` | Admin | Review queue |
| GET | `/api/accounting/classifications/metrics` | Admin | Classification metrics |
| GET | `/api/accounting/classifications/trends` | Admin | Classification trends |
| PATCH | `/api/accounting/classifications/:id/review` | Admin | Approve/reject |
| PATCH | `/api/accounting/classifications/review/bulk` | Admin | Bulk review |
| POST | `/api/accounting/periods/:key/lock` | Admin | Lock accounting period |
| POST/GET | `/api/accounting/valuations` | Admin | Business valuations |
| POST | `/api/accounting/export/quickbooks` | Admin | QB journal export |
| POST | `/api/accounting/connectors/aws-cost-explorer/sync` | Admin | Sync AWS costs |
| POST | `/api/accounting/connectors/github-billing/sync` | Admin | Sync GitHub costs |
| GET | `/api/billing/receipts` | Bearer | Payment receipts |
| GET | `/api/billing/usage/:farmId` | Bearer | Usage metering |

#### Reports

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/reports` | Bearer | Reports index |
| GET | `/api/reports/revenue-summary` | Bearer | Revenue summary |
| GET | `/api/reports/order-volume` | Bearer | Order volume |
| GET | `/api/reports/harvest-performance` | Bearer | Harvest performance |
| GET | `/api/reports/buyer-analytics` | Bearer | Buyer analytics |

#### Quality & Sustainability

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/quality/reports` | Bearer | QC reports |
| GET | `/api/quality/stats` | Bearer | QC statistics |
| GET | `/api/quality/checkpoints` | Bearer | QC checkpoints |
| GET | `/api/quality/dashboard` | Bearer | QC dashboard |
| POST | `/api/quality/reports` | Bearer | Submit QC report |
| DELETE | `/api/quality/reports/:id` | Bearer | Delete QC report |
| GET/POST/DELETE | `/api/sustainability/utility-bills` | Bearer | Utility bill tracking |
| GET | `/api/sustainability/metrics` | Bearer | Sustainability metrics |
| GET | `/api/sustainability/food-miles` | Bearer | Food miles calc |
| GET | `/api/sustainability/esg-report` | Bearer | ESG report |
| GET | `/api/sustainability/esg-history` | Bearer | ESG history |
| GET | `/api/sustainability/energy/usage` | Bearer | Energy usage |
| GET | `/api/sustainability/water/usage` | Bearer | Water usage |
| GET | `/api/sustainability/carbon-footprint` | Bearer | Carbon footprint |
| GET | `/api/sustainability/waste/tracking` | Bearer | Waste tracking |
| GET | `/api/sustainability/trends` | Bearer | Sustainability trends |

#### Monitoring & Sync

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/monitoring` | Bearer | System overview |
| GET | `/api/monitoring/rooms` | Bearer | Room status |
| GET | `/api/monitoring/devices` | Bearer | Device status |
| GET | `/api/monitoring/heartbeats` | Bearer | Farm heartbeats |
| POST | `/api/sync/rooms` | API key | Sync rooms |
| POST | `/api/sync/groups` | API key | Sync groups |
| POST | `/api/sync/schedules` | API key | Sync schedules |
| POST | `/api/sync/config` | API key | Sync config |
| POST | `/api/sync/inventory` | API key | Sync inventory |
| POST | `/api/sync/heartbeat` | API key | Heartbeat |
| POST | `/api/sync/health` | API key | Health data |
| POST | `/api/sync/telemetry` | API key | Telemetry data |
| POST | `/api/sync/restore` | API key | Restore backup |
| GET | `/api/sync/status` | Bearer | Sync status |

#### Farm Settings

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/farm-settings/:id/certifications` | Bearer | Set certifications |
| GET | `/api/farm-settings/:id/pending` | Bearer | Pending acknowledgements |
| POST | `/api/farm-settings/:id/ack` | Bearer | Acknowledge setting |
| GET | `/api/farm-settings/:id/history` | Bearer | Settings history |
| POST | `/api/farm-settings/:id/notify-preferences` | Bearer | Notification prefs |
| POST | `/api/farm-settings/:id/display-preferences` | Bearer | Display prefs |

#### Grant Wizard (~30 endpoints)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/grant-wizard/register` | None | Grant user registration |
| POST | `/api/grant-wizard/login` | None | Grant user login |
| GET/PUT/DELETE | `/api/grant-wizard/profile` | Grant JWT | Profile CRUD |
| GET | `/api/grant-wizard/programs` | Grant JWT | List programs |
| GET | `/api/grant-wizard/programs/:id` | Grant JWT | Program detail |
| POST | `/api/grant-wizard/programs/:id/check-eligibility` | Grant JWT | Check eligibility |
| POST/GET | `/api/grant-wizard/applications` | Grant JWT | Application CRUD |
| GET/PUT | `/api/grant-wizard/applications/:id` | Grant JWT | Application detail |
| POST | `/api/grant-wizard/applications/:id/match-programs` | Grant JWT | AI program matching |
| POST | `/api/grant-wizard/applications/:id/ai-recommend` | Grant JWT | AI recommendations |
| POST | `/api/grant-wizard/applications/:id/export` | Grant JWT | Export application |
| GET | `/api/grant-wizard/applications/:id/export/pdf` | Grant JWT | PDF export |
| POST | `/api/grant-wizard/applications/:id/outcome` | Grant JWT | Record outcome |
| POST | `/api/grant-wizard/competitor-search` | Grant JWT | Competitor research |
| POST | `/api/grant-wizard/competitor-analyze` | Grant JWT | AI competitor analysis |
| POST | `/api/grant-wizard/scrape-website` | Grant JWT | Website scraping |
| POST | `/api/grant-wizard/wizard-events` | Grant JWT | UX analytics |

#### Campaign

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/campaign/signup` | None | Field of Dreams signup |
| GET | `/api/campaign/stats` | Admin | Campaign stats |
| GET | `/api/campaign/heatmap` | Admin | Geographic heatmap |
| GET | `/api/campaign/export` | Admin | Export signups |

#### Network & Multi-Farm

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/network/dashboard` | Admin | Network overview |
| GET | `/api/network/farms/list` | Admin | All network farms |
| GET | `/api/network/farms/:id` | Admin | Farm detail |
| GET | `/api/network/comparative-analytics` | Admin | Cross-farm comparison |
| GET | `/api/network/trends` | Admin | Network trends |
| GET | `/api/network/buyer-behavior` | Admin | Buyer analytics |
| GET | `/api/network/alerts` | Admin | Network alerts |
| GET | `/api/network/anomaly-correlation` | Admin | Anomaly correlation |
| GET | `/api/network/energy-benchmarks` | Admin | Energy benchmarks |

#### Procurement

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/procurement/catalog` | Bearer | Procurement catalog |
| GET | `/api/procurement/suppliers` | Bearer | Supplier list |
| POST | `/api/procurement/suppliers` | Bearer | Add supplier |
| PUT | `/api/procurement/suppliers/:id` | Bearer | Update supplier |
| GET | `/api/procurement/orders` | Bearer | PO list |
| POST | `/api/procurement/orders` | Bearer | Create PO |
| GET | `/api/procurement/orders/:id` | Bearer | PO detail |
| POST | `/api/procurement/orders/:id/receive` | Bearer | Mark received |
| GET | `/api/procurement/inventory` | Bearer | Procurement inventory |
| GET | `/api/procurement/commission-report` | Bearer | Commission report |
| GET | `/api/procurement/revenue` | Bearer | Procurement revenue |

#### Other

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/alerts` | Bearer | Active alerts |
| POST | `/api/alerts/:id/resolve` | Bearer | Resolve alert |
| GET | `/api/orders` | Bearer | Order list |
| GET | `/api/orders/:id` | Bearer | Order detail |
| GET | `/api/recipes` | None | Recipe catalog |
| GET | `/api/recipes/categories` | None | Recipe categories |
| GET | `/api/recipes/:id` | None | Recipe detail |
| POST | `/api/delivery/driver-applications` | None | Submit driver application |
| GET | `/api/delivery/driver-applications/:id` | None | Application status |
| GET | `/api/remote/farms` | Admin | Remote farm list |
| GET | `/api/remote/:farmId/*` | Admin | Remote farm diagnostics |
| POST | `/api/remote/:farmId/restart` | Admin | Remote restart |
| POST | `/api/remote/:farmId/sync-now` | Admin | Force sync |

### 5B. Server.js Inline Endpoints (~100+ additional)

Includes: health checks, farm config, device management (SwitchBot, Kasa, Shelly), IoT device CRUD, tray management, automation rules, KPIs, harvest predictions, loss prediction, ML anomalies, weather, network coordination, wholesale inline helpers, experiment management, governance reports, data file serving, and more. See Section 3 architecture for complete list.

---

## 6. AI & ML Capabilities

### 6A. LLM-Powered (7 components)

| Component | Model | Cost/Call | Schedule | Status |
|-----------|-------|-----------|----------|--------|
| **Chat Assistant "Cheo"** | GPT-4o-mini | ~$0.001 | On-demand | **REAL** |
| **AI Insights** | GPT-4 | ~$0.03-0.06 | On-demand | **REAL** (rule-based fallback) |
| **TTS Voice** | OpenAI tts-1-hd | ~$0.06/2K chars | On-demand | **REAL** |
| **Market Analysis Agent** | GPT-4o-mini | ~$0.001 | Daily | **REAL** |
| **AI Recommendations Pusher** | **GPT-4** | ~$0.03/farm | Every 30 min | **REAL** ⚠️ EXPENSIVE |
| **Marketing AI Agent** | Claude Sonnet 4 / GPT-4o-mini | ~$0.01 | On-demand | **REAL** (dual-provider) |
| **Grant Wizard AI** (3 features) | GPT-4 | ~$0.03-0.10 | On-demand | **REAL** |

### 6B. Statistical / Custom ML (8 components)

| Component | Method | Data Source | Status |
|-----------|--------|-------------|--------|
| **Harvest Prediction** | Mean/StdDev + t-distribution CI | `experiment_records` | **REAL** |
| **Yield Regression** | OLS linear regression (JS) | `experiment_records` | **REAL** |
| **SARIMAX Temp Forecast** | statsmodels SARIMAX (Python) | Environmental telemetry | **REAL** (synthetic data) |
| **SARIMAX Energy Forecast** | statsmodels SARIMAX (Python) | Energy + weather | **REAL** (synthetic data) |
| **AI Vision** | OpenAI Vision API (Python) | Plant photos | **REAL** |
| **SpectraSync** | Algorithmic light optimization | Recipes + sensors | **REAL** |
| **Supply/Demand Balancer** | SQL aggregation | Orders + inventory | **REAL** |
| **Experiment Orchestrator** | A/B statistical comparison | `experiment_records` | **REAL** |

### 6C. Deterministic/Rule-Based (5 components)

| Component | Method | Status |
|-----------|--------|--------|
| **Farm Ops Agent Tasks** | Weighted scoring formula | **REAL** |
| **Farm Ops Agent NLU** | Regex pattern matching (~12 intents) | **REAL** |
| **ESG Scoring Engine** | Weighted composite scoring | **REAL** |
| **Marketing Rules Engine** | 6-rule auto-approve chain | **REAL** |
| **Production Planner** | Demand-driven rule planning | **REAL** |

### 6D. Chat Assistant Tool Inventory (23 tools)

**Read Tools (15):**
1. `get_daily_todo` — Scored task list
2. `get_room_status` — Environment readings
3. `get_orders` — Wholesale orders
4. `get_harvest_log` — Harvest records
5. `get_alerts` — Active alerts
6. `get_market_intelligence` — Prices + AI outlook
7. `get_pricing_info` — Retail/wholesale pricing
8. `get_planting_recommendations` — AI planting suggestions
9. `get_demand_forecast` — Demand prediction
10. `get_pricing_decisions` — Pricing history
11. `get_capacity` — Farm utilization
12. `get_inventory_summary` — Crop inventory
13. `get_crop_info` — Crop registry data
14. `get_farm_insights` — Environmental insights
15. `get_ai_recommendations` — Network AI recs

**Write Tools (8, require confirmation):**
16. `dismiss_alert` — Acknowledge alert
17. `auto_assign_devices` — Assign IoT devices
18. `seed_benchmarks` — Import benchmarks
19. `update_crop_price` — Change price
20. `create_planting_assignment` — Schedule planting
21. `mark_harvest_complete` — Record harvest
22. `update_order_status` — Change order status
23. `add_inventory_item` — Add stock

### 6E. AI Cost Model

| Component | Frequency | Est. Monthly Cost (10 farms) |
|-----------|-----------|------------------------------|
| Chat (GPT-4o-mini) | ~50 msgs/day/farm | ~$7.50 |
| AI Insights (GPT-4) | ~5 calls/day/farm | ~$45.00 |
| **AI Pusher (GPT-4)** | **48/day/farm** | **~$432.00** |
| TTS (tts-1-hd) | ~20 calls/day/farm | ~$36.00 |
| Market Agent (GPT-4o-mini) | 1/day | ~$0.03 |
| Marketing (Claude Sonnet) | ~5/week | ~$0.20 |
| Grant Wizard (GPT-4) | ~10/week | ~$3.00 |
| **Total estimated** | | **~$524/mo for 10 farms** |

⚠️ **The AI Recommendations Pusher is 82% of projected AI costs** because it uses GPT-4 (not GPT-4o-mini) and runs every 30 minutes per farm.

---

## 7. Cashflow & Financial System

### 7A. Revenue Streams

| Stream | Mechanism | Processing | Status |
|--------|-----------|------------|--------|
| Farm subscriptions | $29 CAD/month | Square Payment Links | **ONE-TIME ONLY** — no recurring billing |
| Wholesale orders | Per-order payment | Square per-farm split | **LIVE** |
| Broker commission | 12% of wholesale | Square `appFeeMoney` | **LIVE** |
| POS sales | Cash / card | Square per-farm | **LIVE** |

### 7B. Expense Tracking

| Source | Integration | Auto-Sync | Status |
|--------|-------------|-----------|--------|
| AWS infrastructure | Cost Explorer API | Periodic | **REAL** → accounting ledger |
| GitHub billing | REST API | Periodic | **REAL** → accounting ledger |
| Payment fees | Estimated (2.9% + $0.30) | Computed | **REAL** (estimate only) |

### 7C. Payment Provider Status

| Provider | Implementation | Routes Wired | Live |
|----------|---------------|-------------|------|
| **Square** | Full (payments, refunds, webhooks, OAuth) | Yes — purchase, wholesale, POS, farm OAuth | **YES** |
| **Stripe** | Full (Connect model, application fees, refunds, webhooks) | **NO** — factory registered but never instantiated | **NO** |

### 7D. Financial Reporting

| Report | Source | Format | Status |
|--------|--------|--------|--------|
| Revenue summary | In-memory wholesale orders | JSON API | **REAL** (volatile on restart) |
| Order volume | In-memory wholesale orders | JSON API | **REAL** |
| Buyer analytics | In-memory wholesale orders | JSON API | **REAL** |
| Harvest performance | `experiment_records` DB | JSON API | **REAL** |
| Orders CSV export | `wholesale_orders` DB | CSV | **REAL** |
| Payments CSV export | `payment_records` DB | CSV | **REAL** |
| Tax summary CSV | `wholesale_orders` DB | CSV (CRA-ready) | **REAL** |
| Delivery fees CSV | `delivery_orders` DB | CSV | **REAL** |
| Inventory CSV | Farm data store | CSV | **REAL** |
| Sales CSV | Farm data store | CSV | **REAL** |
| QuickBooks daily CSV | Computed from orders | IIF-style CSV | **REAL** |
| QuickBooks journal JSON | Accounting ledger | QB JournalEntry JSON | **REAL** (export only) |

### 7E. What's Missing

1. **No recurring subscription billing** — $29 initial payment only, no Stripe/Square subscriptions
2. **No actual refund processing** — refunds are record-only, money never returned
3. **Stripe fully built but disconnected** — zero routes invoke the Stripe provider
4. **Revenue not in accounting ledger** — AWS/GitHub expenses tracked but wholesale/POS revenue is NOT ingested
5. **No P&L report** — expenses and revenue tracked in separate systems, never combined
6. **QuickBooks OAuth is stubbed** — 6 endpoints return 501
7. **No Square webhook receiver** — payment status updates require polling
8. **Wholesale export endpoints have NO authentication**
9. **In-memory payment/refund data lost on restart** (buyers and orders DO hydrate from DB)

---

## 8. Data Architecture & Flow

### 8A. Database (PostgreSQL — ~65 tables)

**Core Infrastructure:** farms, farm_data, farm_users, farm_backups, farm_heartbeats, farm_inventory, products, planting_assignments

**Auth:** admin_users, admin_sessions, admin_audit_log, audit_log, token_blacklist, login_lockouts, site_settings

**Wholesale:** wholesale_buyers, wholesale_orders, payment_records, checkout_sessions, purchase_leads

**Pricing:** farm_cost_surveys, pricing_offers, pricing_responses, pricing_history, pricing_decisions, market_price_observations, market_price_trends, market_ai_analysis

**Delivery:** farm_delivery_settings, farm_delivery_windows, farm_delivery_zones, delivery_orders, delivery_routes, delivery_drivers, driver_payouts, driver_applications, tracking_events

**Accounting:** accounting_sources, accounting_accounts, accounting_transactions, accounting_entries, accounting_classifications, accounting_period_closes, valuation_snapshots

**Procurement:** procurement_catalog, procurement_suppliers, procurement_orders

**Grants:** grant_users, grant_programs, grant_applications, grant_export_packs, grant_program_snapshots, grant_outcome_analytics, grant_research_jobs, grant_wizard_events, grant_program_change_alerts, ai_reference_sites

**Marketing:** marketing_posts, marketing_post_history, marketing_rules, marketing_skills, campaign_supporters

**AI/ML:** device_integrations, experiment_records, crop_benchmarks, network_recipe_modifiers, ai_usage, api_usage_daily

**ESG:** esg_assessments

**Inventory:** 5 sub-tables for seeds, nutrients, packaging, equipment, supplies

### 8B. In-Memory Stores (VOLATILE)

| Store | Data | Hydrated from DB? | Risk |
|-------|------|--------------------|------|
| `inMemoryStore` (sync.js) | Farm rooms, groups, schedules, telemetry, devices, config | YES | LOW |
| `wholesaleMemoryStore` buyers | Buyer accounts | YES | LOW |
| `wholesaleMemoryStore` orders | Order records | YES | LOW |
| `wholesaleMemoryStore` **payments** | Payment records | **NO** | **HIGH** |
| `wholesaleMemoryStore` **refunds** | Refund records | **NO** | **HIGH** |
| `wholesaleMemoryStore` audit log | Order event trail | **NO** | MEDIUM |
| `alertState` (alert-manager) | Active alerts | NO (regenerated) | LOW |
| `networkFarms` | Farm registry cache | YES | LOW |
| Conversation memory (assistant) | Chat history | NO | LOW (ephemeral) |

### 8C. Data Flow Diagram

```
ESP32 Sensors ─── Serial/WiFi ──► Edge Server (server-foxtrot.js EDGE_MODE)
SwitchBot ─── Cloud API ──────────►  ├── SQLite (offline)
Kasa/Shelly ─── Local LAN ───────►  └── Sync Service
                                           │
                                           │ HTTP POST /api/sync/* (every 5 min)
                                           │ Auth: X-API-Key
                                           ▼
                                    GreenReach Central (server.js)
                                           │
                        ┌──────────────────┼──────────────────────┐
                        ▼                  ▼                      ▼
                   PostgreSQL         In-Memory Maps         Flat JSON Files
                   (65 tables)        (farm-scoped)          (fallback only)
                        │                  │
                        │                  │
          ┌─────────────┼──────────────────┼─────────────────┐
          ▼             ▼                  ▼                 ▼
     AI Pipeline    Reports/CSV       REST APIs         WebSocket
     ├─ GPT Chat    ├─ Revenue       (450+ endpoints)   (real-time)
     ├─ Insights    ├─ Orders CSV         │
     ├─ Market AI   ├─ Tax CSV            ▼
     ├─ Recs Push   └─ QB Export     Browser UI (60+ pages)
     └─ Grant AI                     Mobile App (10 screens)
                                     Desktop App (Electron)
```

### 8D. Multi-Tenant Isolation

- All DB queries scoped by `farm_id` (resolved from JWT → header → query → env)
- `farm_data` table: `UNIQUE(farm_id, data_type)` constraint
- Memory stores: `Map<farmId, data>` keyed by farm
- File fallback only activates when no farm context (single-tenant dev mode)
- 4 separate auth domains (farm users, admins, buyers, grant users)

---

## 9. IoT & Hardware Layer

### 9A. Supported Devices

| Device Type | Protocol | Integration | Status |
|-------------|----------|-------------|--------|
| SwitchBot Hub/sensors | Cloud API (signed) | Polling every 60s | **ACTIVE** |
| TP-Link Kasa plugs | Local LAN (python-kasa) | Direct control | **ACTIVE** |
| Shelly smart plugs | Local LAN (HTTP) | Direct control | **ACTIVE** |
| MQTT devices | MQTT broker | Subscribe/publish | **ACTIVE** |
| ESP32 nutrient controller | WiFi + MQTT | pH/EC/dosing | **DEVELOPED** |
| ESP32 dual sensor | USB serial | Temp/humidity/pressure | **DEVELOPED** |
| Grow3 LED controller | RS485 / 0-10V | Spectrum + intensity | **ACTIVE** |
| DMX512 lighting | USB-DMX adapter | Channel control | **AVAILABLE** |
| Thermal printer | USB/network | Label/receipt printing | **ACTIVE** |

### 9B. Automation Engine

Environment control via rules engine (`automation/`):
- **VPD Controller** — Humidity + temperature → VPD target
- **Ventilation Controller** — Fan speed + exhaust based on temp/CO2
- **Irrigation Controller** — Watering schedules + moisture triggers
- **Fan Rotation** — 15-min alternating cycles for airflow
- **Plug Manager** — On/off control for smart plugs by room/zone
- **Growth Stage Manager** — Automatic recipe transitions

---

## 10. Critical Findings & Risk Register

### 🔴 HIGH SEVERITY

| # | Finding | Impact | Recommendation |
|---|---------|--------|----------------|
| 1 | **In-memory payment/refund data not persisted** | Payment records and refund records in `wholesaleMemoryStore` are **lost on server restart**. Orders and buyers persist, but financial trail does not. | Add DB hydration for `paymentsById` and `refundsById` from `payment_records` table. |
| 2 | **Refunds are record-only** | Admin refund endpoint creates in-memory record but **never calls Square/Stripe refund API**. Money is not returned to buyers. | Wire `SquarePaymentProvider.refundPayment()` into the admin refund flow. |
| 3 | **No recurring subscription billing** | Farm subscriptions collect $29 once via Square Payment Link. **No mechanism for monthly charges.** Revenue after initial purchase = $0 from subscriptions. | Implement Square Subscriptions API or Stripe Billing. |
| 4 | **AI Pusher uses GPT-4 instead of GPT-4o-mini** | `ai-recommendations-pusher.js` hardcodes `gpt-4` despite config being `gpt-4o-mini`. At 48 calls/day/farm, this is **~$432/mo for 10 farms** — 82% of total AI costs. | Change model to `gpt-4o-mini` or `gpt-4o`. Savings: ~$420/mo. |
| 5 | **Wholesale export endpoints have no authentication** | `GET /api/wholesale/exports/orders|payments|tax-summary|delivery-fees` — **anyone can download all financial data** including tax records, payment amounts, buyer info. | Add `adminAuthMiddleware` to all export routes. |

### 🟡 MEDIUM SEVERITY

| # | Finding | Impact | Recommendation |
|---|---------|--------|----------------|
| 6 | **Stripe provider built but disconnected** | Complete Stripe Connect implementation exists in `lib/payment-providers/stripe.js` but **no route ever instantiates it**. Wasted capability. | Wire into checkout flow as alternative provider, or remove dead code. |
| 7 | **Revenue not in accounting ledger** | AWS/GitHub expenses auto-sync to ledger, but wholesale/POS revenue does NOT. **No P&L report possible.** | Build accounting connector for `payment_records` → `accounting_transactions`. |
| 8 | **QuickBooks integration is fully stubbed** | 6 QB OAuth/sync endpoints return 501. Export-only CSV exists. **No live QB sync.** | Implement using `node-quickbooks` (already in root dependencies). |
| 9 | **No Square/Stripe webhook handlers** | `verifyWebhook()` and `parseWebhookEvent()` implemented but **no route receives webhooks**. Payment status changes not detected. | Add webhook receiver routes with signature verification. |
| 10 | **30,500-line monolith (server-foxtrot.js)** | Maintainability risk. Single file contains 415+ route handlers, inline business logic, startup config, and middleware. | Progressively extract into route modules (greenreach-central pattern). |
| 11 | **Demo mode bypasses payment** | When Square is not configured, purchase flow provisions farms without payment. In production this path is unreachable, but no explicit guard. | Add `NODE_ENV=production` check to prevent demo fallback. |
| 12 | **SARIMAX models use synthetic data** | Python energy/temperature forecasts generate fake sensor data when real data unavailable. Predictions are plausible but not grounded. | Connect to real `farm_data` telemetry from PostgreSQL. |

### 🟢 LOW SEVERITY

| # | Finding | Impact | Recommendation |
|---|---------|--------|----------------|
| 13 | Alert state is in-memory only | Active alerts disappear on restart, but regenerate on next telemetry cycle (~5 min). | Acceptable — but consider DB persistence for alert history. |
| 14 | Chat conversation memory in-memory only | Chat history lost on restart. 30-min TTL anyway. | Acceptable for current use. Consider DB for analytics. |
| 15 | Mobile app not deployed to stores | React Native app with 10 screens is built but not distributed. | Deploy via Expo or app store when ready for farm staff. |
| 16 | Desktop app not distributed | Electron wrapper built for Win/Mac but not in use. | Distribute via downloads page when farm deployments need it. |
| 17 | `edge-app/` and `hq-app/` are empty skeletons | Just tsconfig.json each. | Remove or mark as deprecated. |
| 18 | Commission rate defined in multiple places | 12% commission is read from env var independently in `wholesale.js` and `farm-sales.js`. | Centralize to single config. |

---

## Appendix: Dependency Summary

### Production NPM (Root)
express, square, stripe, twilio, firebase-admin, openai, mqtt, pg, sqlite3, canvas, pdf-lib, qrcode, jsbarcode, nodemailer, node-quickbooks, express-ws, helmet, bcryptjs, jsonwebtoken, axios, cors, express-rate-limit, ws, nedb-promises, http-proxy-middleware, react, react-dom

### Production NPM (Central)
express, openai, @anthropic-ai/sdk, @aws-sdk/client-cost-explorer, @aws-sdk/client-ses, pg, square, bcryptjs, jsonwebtoken, helmet, cors, express-rate-limit, nodemailer, pdfkit, cheerio, validator, winston, ws, uuid, dotenv

### Python (Backend)
fastapi, uvicorn, pydantic, numpy, pandas, statsmodels, openai, paho-mqtt, python-kasa, bleak, zeroconf, slowapi

### IoT (ESP32)
Adafruit HDC302x, Adafruit BME680, ArduinoJson, Atlas Scientific (pH/EC/RTD), PlatformIO

---

*Audit conducted March 20, 2026. Covers 30,500+ LOC server-foxtrot.js, 15,000+ LOC greenreach-central, 8,000+ LOC Python backend, 60+ HTML pages, 55 route files, ~865 API endpoints, 65 PostgreSQL tables, 17 AI/ML components, and all peripheral apps.*
