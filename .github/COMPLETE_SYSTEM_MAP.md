# GreenReach Platform -- Complete System Map

**Version**: 2.0.0
**Date**: April 8, 2026
**Last Updated**: April 8, 2026 -- v2.0.0: Full Cloud Run migration (replaced all AWS/EB references), added PAYMENT_WORKFLOW.md reference, added FAYE diagnostic tools (get_sync_status fix, search_codebase, get_page_route_map), updated data flows for Google Cloud. Previous: v1.9.0: Activity Hub order sync fix, EVIE chat integration, calendar/tasks system. v1.8.0: Research Integration Layer, GWEN fixes, agent-caused Central outage recovery. v1.7.0: E.V.I.E. LLM fallback (Anthropic), F.A.Y.E. auto-recovery, heartbeat false-alert fix.
**Authority**: This document is the canonical system map for the entire GreenReach platform. All agents MUST consult this before making changes to ensure full awareness of cross-system impacts.
**Purpose**: Prevent agent-caused regressions by providing complete visibility into every page, route, data field, button, data flow, and dependency across the platform.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [AWS Infrastructure](#2-aws-infrastructure)
3. [Server-Foxtrot (Light Engine)](#3-server-foxtrot-light-engine)
4. [GreenReach Central Server](#4-greenreach-central-server)
5. [Frontend Pages -- Complete Inventory](#5-frontend-pages----complete-inventory)
6. [Data Flows -- Entry to Exit](#6-data-flows----entry-to-exit)
7. [Sensor and Environmental Controller Pipeline](#7-sensor-and-environmental-controller-pipeline)
8. [Database Schema -- All Tables](#8-database-schema----all-tables)
9. [Authentication Architecture](#9-authentication-architecture)
10. [Data Files and Configuration](#10-data-files-and-configuration)
11. [External Service Integrations](#11-external-service-integrations)
12. [Cross-System Dependency Map](#12-cross-system-dependency-map)
13. [Error Log -- Known Issues for Correction](#13-error-log----known-issues-for-correction)
14. [Category Quick Reference](#14-category-quick-reference)
15. [Complete Inventory Workflow](#15-complete-inventory-workflow)

---

## 1. Architecture Overview

### System Diagram

```
                        INTERNET
                           |
              +------------+------------+
              |                         |
    greenreachgreens.com        Cloud Run URL
    (pending DNS migration)     (direct URLs)
              |                         |
              v                         v
+---------------------------+  +---------------------------+
| GreenReach Central        |  | Light Engine Foxtrot      |
| (Cloud Run)               |  | (Cloud Run)               |
| greenreach-central        |  | light-engine              |
|                           |  |                           |
| greenreach-central/       |  | server-foxtrot.js         |
|   server.js               |  |                           |
|                           |  | EnvStore (in-memory)      |
| AlloyDB (PostgreSQL)      |  | env-state.json (file)     |
| farmStore (in-memory)     |  | NeDB / SQLite             |
| 168+ database tables      |  |                           |
|                           |  | E.V.I.E. (farm AI)       |
| F.A.Y.E. (admin AI)      |  | Farm dashboard             |
| Admin dashboard           |  | Device control             |
| Wholesale marketplace     |  | Sensor polling             |
| Grant wizard              |  | Automation engine          |
| Accounting                |  |                           |
+------------+--------------+  +------------+--------------+
             ^                              |
             |   POST /api/sync/telemetry   |
             |   (every 30s via             |
             |    sync-service.js)          |
             +------------------------------+
                              ^
                              | SwitchBot Cloud API v1.1
                              | (HTTPS polling every 30s)
                              |
                   +----------+----------+
                   | SwitchBot Cloud     |
                   | api.switch-bot.com  |
                   |                     |
                   | 4x WoIOSensor       |
                   | 1x Hub Mini (WiFi)  |
                   +---------------------+
```

### Two Deployments, One Monorepo

| Property | Light Engine (LE) | GreenReach Central |
|----------|-------------------|-------------------|
| Server file | server-foxtrot.js | greenreach-central/server.js |
| Cloud Run service | light-engine | greenreach-central |
| URL | `https://light-engine-1029387937866.us-east1.run.app` | `https://greenreach-central-1029387937866.us-east1.run.app` |
| Custom domain | None | greenreachgreens.com (pending DNS) |
| Deploy from | Repo root | greenreach-central/ subdirectory |
| Port | 8091 | 3000 (HTTP) + 3001 (WS) |
| Region | us-east1 | us-east1 |
| Role | The Farm (sensors, devices, automation) | The Hub (data, admin, marketplace) |

### Critical Rules

- The farm is 100% cloud. No physical device, no Pi, no edge hardware.
- LE Cloud Run IS the farm. "Edge mode" in code is a legacy naming artifact.
- AWS Elastic Beanstalk is DEPRECATED (April 2026). All workloads on Google Cloud Run.
- Two public/ directories: root public/ (LE), greenreach-central/public/ (Central). NOT synced.
- E.V.I.E. files must exist in BOTH public directories.
- server-foxtrot.js NEVER imports from greenreach-central/routes/ (exception: 3 AI routes).
- Changing greenreach-central/ files requires deploying BOTH environments.

---

## 2. Google Cloud Infrastructure

### Cloud Run Services

#### Light Engine (Active)

| Property | Value |
|----------|-------|
| Service | light-engine |
| URL | `https://light-engine-1029387937866.us-east1.run.app` |
| Service Account | `light-engine-sa@project-5d00790f-13a9-4637-a40.iam.gserviceaccount.com` |
| Image | `us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest` |
| Entry Point | node server-foxtrot.js |
| CPU / Memory | 1 vCPU / 1Gi (CPU always-allocated) |
| Min / Max Instances | 1 / 2 |
| Execution Environment | Gen2 (Direct VPC egress) |

#### GreenReach Central (Active)

| Property | Value |
|----------|-------|
| Service | greenreach-central |
| URL | `https://greenreach-central-1029387937866.us-east1.run.app` |
| Custom Domain | greenreachgreens.com (pending DNS migration) |
| Service Account | `greenreach-central-sa@project-5d00790f-13a9-4637-a40.iam.gserviceaccount.com` |
| Image | `us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest` |
| Entry Point | node server.js |
| CPU / Memory | 1 vCPU / 768Mi |
| Min / Max Instances | 1 / 5 |
| Execution Environment | Gen2 (Direct VPC egress) |

### Google Cloud Services Used

| Service | Purpose |
|---------|---------|
| Cloud Run | Application hosting (2 services) |
| AlloyDB | PostgreSQL-compatible database (cluster: greenreach-db, IP: 10.87.0.2) |
| Artifact Registry | Docker image storage |
| Secret Manager | All secrets (JWT, DB password, Square tokens, SMTP, API keys) |
| Cloud Storage | Persistent file storage (bucket: greenreach-storage, mounted at /app/data) |
| Cloud Scheduler | Keep-alive and cron jobs (3 jobs) |
| VPC | Private networking (greenreach-vpc / greenreach-subnet) |

### DEPRECATED: AWS (DO NOT USE)

AWS Elastic Beanstalk environments are DEPRECATED (April 2026). Do not reference EB environments, use `eb` CLI commands, or deploy to AWS. See `.github/CLOUD_ARCHITECTURE.md`.

### Deployment Pipeline

```
Developer Machine
       |
       | docker buildx build --platform linux/amd64 --push
       v
Artifact Registry (us-east1)
       |
       | gcloud run services update
       v
Cloud Run (new revision, traffic shifted)
```

Deploy Commands:
```bash
# Central
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest \
  --push ./greenreach-central/
gcloud run services update greenreach-central --region=us-east1 \
  --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest

# LE
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest \
  --push .
gcloud run services update light-engine --region=us-east1 \
  --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest
```

---

## 3. Server-Foxtrot (Light Engine)

### File: server-foxtrot.js (~30,000+ lines)

### 3.1 Imported Modules

**Core Framework**: express, express-ws, helmet, http, https, path, fs, crypto, os, net
**Auth/Security**: jsonwebtoken, bcryptjs, validator, http-proxy-middleware
**Data/Storage**: nedb-promises, pg, sqlite3 (dynamic import)
**Networking**: mqtt, axios, child_process.exec, dotenv/config

**Custom Services**:
- services/sync-service.js (SyncServiceClass)
- lib/automation-engine.js (AutomationRulesEngine)
- lib/database.js (initDatabase, checkHealth, getDatabaseMode)
- lib/schedule-executor.js (ScheduleExecutor)
- lib/lights-database.js (lightsDB)
- lib/spectral-solver.js (solveSpectrum, toPWM)
- lib/edge-config.js (edgeConfig)
- services/certificate-manager.js (CertificateManager)
- services/credential-manager.js (CredentialManager)
- lib/wholesale/audit-logger.js
- lib/event-bus.js (eventBus)
- lib/recipe-modifier.js
- lib/alert-prioritizer.js
- lib/device-safety-envelope.js
- lib/anomaly-history.js
- lib/ml-automation-controller.js (mlAutomation)
- lib/cloudwatch-metrics.js

### 3.2 Middleware Stack (Execution Order)

| # | Middleware | Path | Purpose |
|---|-----------|------|---------|
| 1 | helmet | Global | CSP, HSTS, X-Frame-Options |
| 2 | trust proxy | Global | Required for EB/CloudFront |
| 3 | Metrics tracking | Global | Request counting, response times, CloudWatch 10% sampling |
| 4 | express.json | Global | JSON body parsing (1MB limit) |
| 5 | sanitizeRequestBody | Global | Input sanitization (injection prevention) |
| 6 | apiRateLimiter | /api/* | 500 req/15min (configurable) |
| 7 | autoEnforceFeatures | Global | License-based feature gates |
| 8 | securityAuditMiddleware | Global | Audit logging (if AUDIT_LOG_ENABLED) |
| 9 | buyerRouter | Global | Wholesale marketplace buyer routes |
| 10 | adminAuthMiddleware | /api/admin/* | Admin JWT validation |
| 11 | farmAuthMiddleware | /api/assistant | Farm auth for E.V.I.E. |
| 12 | proxyCorsMiddleware | Pre-proxy | CORS for proxied requests |
| 13 | API route validator | /api/* | Rejects invalid routes before proxy |
| 14 | createProxyMiddleware | /api/* (fallthrough) | Proxy to hardware controller (CTRL) |
| 15 | express.static | /light-engine/public, / | Static file serving |
| 16 | Error handler | Global | 500 error responses |
| 17 | 404 handler | Global | Not-found fallback |

### 3.3 Complete Route Map

#### Authentication Routes
| HTTP | Path | Description |
|------|------|-------------|
| POST | /api/auth | User authentication (via authRouter) |
| POST | /api/farm-auth | Farm-specific auth (via createAuthRoutes) |
| POST | /api/admin/auth | Admin authentication (via adminAuthRouter) |
| - | /api/admin/assistant | F.A.Y.E. admin AI (requires admin/editor role) |
| - | /api/admin/ops | Operations agent (requires admin role) |
| - | /api/assistant | E.V.I.E. farm AI (requires farm auth) |

#### Device and Appliance Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /devices | List all devices |
| GET | /devices/:id | Get single device |
| POST | /devices | Create device |
| PATCH | /devices/:id | Update device (requires edge control) |
| DELETE | /devices/:id | Delete device |
| GET | /lights | List all light fixtures |
| GET | /lights/manufacturers | List supported manufacturers |
| GET | /lights/stats | Lighting statistics |
| GET | /lights/:id | Get single light |
| POST | /lights | Create light fixture |
| POST | /lights/search | Search lights |
| PATCH | /lights/:id | Update light |
| DELETE | /lights/:id | Delete light |
| POST | /api/device/:deviceId/power | Device power control |
| POST | /api/device/:deviceId/spectrum | Spectrum adjustment |

#### Smart Plug Routes
| HTTP | Path | Description |
|------|------|-------------|
| POST | /plugs/search/kasa | Discover Kasa plugs |
| POST | /plugs/search/shelly | Discover Shelly plugs |
| POST | /api/kasa/device/:host/power | Kasa power control |
| GET | /plugs | List registered plugs |
| POST | /plugs/discover | Initiate discovery |
| POST | /plugs/register | Register plug |
| DELETE | /plugs/:plugId | Remove plug |
| POST | /plugs/:plugId/state | Set plug state (requires edge) |
| POST | /plugs/:plugId/rules | Define automation rules |

#### SwitchBot Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /switchbot/devices | Legacy device list |
| POST | /switchbot/discover | Discover devices |
| GET | /api/switchbot/devices | Device list (modern) |
| GET | /api/switchbot/status | System status |
| GET | /api/switchbot/devices/:deviceId/status | Single device status |
| POST | /api/switchbot/devices/:deviceId/commands | Send command (requires edge) |

#### Kasa IoT Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /api/kasa/devices | List Kasa devices |
| GET | /api/kasa/devices/:deviceId/status | Device status |
| POST | /api/kasa/devices/:deviceId/control | Device control |

#### Environment Data Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /env | Get environment sensor readings (CORS enabled) |
| POST | /env | Update environment data (PIN guarded) |
| POST | /env/readings | Batch upload readings (PIN guarded) |
| GET | /api/automation/sensors | All available sensors |
| PATCH | /env/rooms/:roomId | Update room config |
| POST | /env/rooms/:roomId/actions | Execute room action |

#### Automation and Rules Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /rules | List rules |
| GET | /rules/:ruleId | Get rule |
| POST | /rules | Create rule |
| PATCH | /rules/:ruleId | Update rule |
| DELETE | /rules/:ruleId | Delete rule |
| GET | /api/automation/rules | List rules (API) |
| POST | /api/automation/rules | Create rule (requires edge) |
| DELETE | /api/automation/rules/:ruleId | Delete rule |
| PATCH | /api/automation/rules/:ruleId | Update rule |
| POST | /automation/run | Execute automation (requires edge) |
| POST | /api/automation/test | Test rule |
| POST | /api/automation/trigger/:ruleId | Manually trigger rule |
| POST | /api/automation/sync-actuator | Sync actuator state |
| GET | /api/automation/history | Execution history |

#### VPD (Vapor Pressure Deficit) Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /api/automation/vpd/capabilities | VPD control capabilities |
| GET | /api/automation/vpd/capabilities/:zoneId | Zone capabilities |
| GET | /api/automation/vpd/zones | List VPD zones |
| POST | /api/automation/vpd/zones/:zoneId/devices | Add device to zone |
| DELETE | /api/automation/vpd/zones/:zoneId/devices/:deviceId | Remove device |
| GET | /api/automation/vpd/control-results | Control history |
| POST | /api/automation/vpd/control/enable | Enable VPD control |
| GET | /api/automation/vpd/status | VPD status |

#### Fan Rotation Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /api/automation/fan-rotation | Get rotation schedule |
| POST | /api/automation/fan-rotation/rotate | Manual rotate |
| GET | /api/automation/fan-rotation/analytics | Rotation analytics |

#### Schedule Executor Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /api/schedule-executor/status | Executor status |
| POST | /api/schedule-executor/start | Start executor |
| POST | /api/schedule-executor/stop | Stop executor |
| POST | /api/schedule-executor/tick | Trigger single cycle |
| GET | /api/schedule-executor/ml-anomalies | ML anomalies |
| POST | /api/schedule-executor/device-registry | Update registry |

#### Harvest and Experiment Routes
| HTTP | Path | Description |
|------|------|-------------|
| POST | /api/harvest | Record harvest |
| GET | /api/harvest | List harvests |
| POST | /api/harvest/experiment-record | Record experiment |
| GET | /api/harvest/experiment-records | List experiments |
| GET | /api/harvest/experiment-stats | Experiment statistics |
| GET | /api/harvest/predict/:groupId | Harvest prediction |
| GET | /api/harvest/predictions/all | All predictions |
| GET | /api/harvest/readiness | Harvest readiness |
| GET | /api/harvest/readiness/:groupId | Readiness for group |
| GET | /api/harvest/growth-analysis/:crop | Growth analysis |

#### Recipe Modifier Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /api/recipe-modifiers | Active modifiers |
| POST | /api/recipe-modifiers/compute | Compute modifiers |
| POST | /api/recipe-modifiers/network/:crop/accept | Accept network modifier |
| POST | /api/recipe-modifiers/network/:crop/dismiss | Dismiss modifier |
| GET | /api/recipe-modifiers/chef-challenger/:crop | A/B test status |
| GET | /api/recipe-modifiers/autonomous/status | Autonomous status |
| POST | /api/recipe-modifiers/autonomous/apply | Apply modifier |
| POST | /api/recipe-modifiers/autonomous/track-performance | Track performance |
| POST | /api/recipe-modifiers/autonomous/clear-revert/:crop | Revert changes |
| POST | /api/recipe-modifiers/network/auto-adopt | Auto-adopt network modifiers |
| GET | /api/recipe-modifiers/versions | Version history |

#### ML (Machine Learning) Routes
| HTTP | Path | Description |
|------|------|-------------|
| POST | /api/ml/retrain | Retrain models |
| GET | /api/ml/metrics | Model metrics |
| POST | /api/ml/retrain/:zone | Retrain zone |
| POST | /api/ml/retrain/all | Retrain all |
| GET | /api/ml/forecast | Demand/growth forecast |
| GET | /api/ml/insights/anomalies | Anomaly insights |
| GET | /api/ml/insights/forecast/:zone | Zone forecast |
| GET | /api/ml/insights/status | ML status |
| GET | /api/ml/models/history | Training history |
| GET | /api/ml/models/:zone/status | Zone model status |
| POST | /api/ml/models/:zone/rollback | Rollback model |
| POST | /api/ml/ab-test/:testId/evaluate | Evaluate A/B test |
| GET | /api/ml/metrics/health | ML health |
| GET | /api/ml/diagnostics | ML diagnostics |
| GET | /api/ml/automation/config | Automation config |
| PUT | /api/ml/automation/config | Update automation |
| GET | /api/ml/automation/status | Automation status |
| POST | /api/ml/automation/evaluate | Evaluate automation |
| GET | /api/ml/automation/actions | Recent actions |
| GET | /api/ml/energy-forecast | Energy forecast |

#### Anomaly and Alert Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /api/anomaly-recipe-correlation | Anomaly-recipe correlation |
| POST | /api/alerts/score | Score alert severity |
| POST | /api/alerts/response | Record response |
| GET | /api/alerts/stats | Alert statistics |
| GET | /api/ml/anomalies/history | Historical anomalies |
| GET | /api/ml/anomalies/statistics | Anomaly statistics |

#### AI Training and Knowledge Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /api/ai/training-data | Training data |
| GET | /api/ai/learning-correlations | Correlations |
| GET | /api/ai/network-intelligence | Network insights |
| GET | /api/ai/suggested-crop | ML crop recommendation |
| POST | /api/ai/recommendations/receive | Receive recommendations |

#### Developer and Proposal Routes
| HTTP | Path | Description |
|------|------|-------------|
| POST | /api/developer/evaluate | Evaluate algorithm |
| POST | /api/developer/propose | Propose feature |
| GET | /api/developer/proposals | Get proposals |
| POST | /api/developer/proposals/:id/approve | Approve |
| POST | /api/developer/proposals/:id/reject | Reject |

#### Wholesale Routes (via multiple routers)
| Prefix | Router | Description |
|--------|--------|-------------|
| /api/wholesale/catalog | wholesaleCatalogRouter | Product catalog |
| /api/wholesale/checkout | wholesaleCheckoutRouter | Payment processing |
| /api/wholesale | wholesaleReservationsRouter | Inventory reservations |
| /api/wholesale/fulfillment | wholesaleFulfillmentRouter | Order fulfillment |
| /api/wholesale/admin | wholesaleAdminRouter | Wholesale admin |
| /api/wholesale | wholesaleBuyersRouter | Buyer management |
| /api/wholesale/orders | wholesaleOrdersRouter | Order management |
| /api/wholesale/product-requests | wholesaleProductRequestsRouter | Product requests |
| /api/wholesale/webhooks | wholesaleWebhooksRouter | Payment webhooks |
| /api/wholesale/webhooks/fulfillment | fulfillmentWebhooksRouter | Fulfillment webhooks |
| /api/wholesale/refunds | wholesaleRefundsRouter | Refund processing |
| /api/wholesale/sla | wholesaleSLAPoliciesRouter | SLA policies |
| /api/wholesale/network | wholesaleNetworkRouter | Network connections |
| /api/wholesale/farm-performance | farmPerformanceRouter | Performance metrics |
| /api/wholesale/oauth/square | squareOAuthRouter | Square OAuth flow |

#### Farm Sales Routes (via multiple routers)
| Prefix | Router | Description |
|--------|--------|-------------|
| /api/farm-sales/customers | customersRouter | Customer data |
| /api/farm-sales/orders | ordersRouter | Order management |
| /api/farm-sales/inventory | inventoryRouter | Inventory management |
| /api/farm-sales/payments | paymentsRouter | Payment processing |
| /api/farm-sales/pos | posRouter | Point of sale |
| /api/farm-sales/delivery | deliveryRouter | Delivery tracking |
| /api/farm-sales/subscriptions | subscriptionsRouter | Subscriptions |
| /api/farm-sales/programs | programsRouter | Loyalty programs |
| /api/farm-sales/fulfillment | fulfillmentRouter | Fulfillment |
| /api/farm-sales/reports | reportsRouter | Sales reports |
| /api/farm-sales/quickbooks | quickbooksRouter | QuickBooks integration |
| /api/farm-sales/lots | lotTrackingRouter | Lot/batch tracking |
| /api/farm-sales/donations | donationsRouter | Donations |
| /api/farm-sales/ai-agent | aiAgentRouter | AI sales agent |


#### Wholesale Order Events (Inline Handlers)
| HTTP | Path | Description |
|------|------|-------------|
| POST | /api/wholesale/order-events | Receive order notifications from Central (saves sub-orders to NeDB) |
| GET | /api/wholesale/order-events | List farm sub-orders from NeDB orderStore |

#### Farm and Setup Routes
| Prefix | Router | Description |
|--------|--------|-------------|
| /api/farms | farmsRouter | Farm management |
| /api/farm/square | farmSquareSetupRouter | Square setup |
| /api/farm/stripe | farmStripeSetupRouter | Stripe setup |
| /api/farm/store | farmStoreSetupRouter | Store setup |
| /api/integrations | integrationsRouter | Third-party integrations |
| /api/setup | setupRouter | Setup endpoints |
| /api/setup-wizard | setupWizardRouter | Setup wizard |
| /api/edge | edgeRouter | Edge config |
| /api/migration | migrationRouter | Data migration |

#### Quality and Traceability Routes
| Prefix | Router | Description |
|--------|--------|-------------|
| /api/crop-weights | cropWeightReconciliationRouter | Weight verification |
| /api/traceability | traceabilityRouter | Farm-to-table tracing |
| /api/quality | qualityControlRouter | Quality assurance |
| /api/qa | aiVisionRouter | AI-powered QA |

#### Admin and Other Routes
| Prefix | Router | Description |
|--------|--------|-------------|
| /api/admin | adminFarmManagementRouter | Farm administration |
| /api/admin/pricing | adminPricingRouter | Pricing management |
| /api/admin/health | adminHealthRouter | Admin health check |
| /api/health | healthRouter | API health |
| /api | licenseRouter | License validation |
| /api/crop-pricing | cropPricingRouter | Crop pricing |
| /api/market-intelligence | marketIntelligenceRouter | Market data |
| /api/network | networkRouter | Network config |
| /api/activity-hub/orders | activityHubOrdersRouter | Activity tracking |
| /api/procurement | procurementRouter | Procurement |
| /api/kpis | kpisRouter | KPI dashboards |
| /api/auth | authRouter | Auth endpoints |
| /api/email | emailRouter | Email endpoints |
| /api/qr-generator | qrGeneratorRouter | QR code generation |
| /api/printer | printerRouter | Thermal printing |
| /api/mdns | mdnsDiscoveryRouter | mDNS discovery |
| /api/audit | createAuditRoutes() | Audit trail |

#### Utility Routes
| HTTP | Path | Description |
|------|------|-------------|
| GET | /healthz | Kubernetes health probe |
| GET | /health | Detailed health check |
| GET | /api/status | System status |
| GET | /api/version | App version |
| GET | /api/diagnostics | System diagnostics |
| GET | /api/logs | Server logs |
| GET | /metrics | Prometheus format metrics |
| GET | /recipes | Growing recipes |
| GET | /recipes/:crop | Crop-specific recipe |
| POST | /api/voice/parse-intent | Voice command parsing |

#### Proxy Routes
| Pattern | Target | Purpose |
|---------|--------|---------|
| /api/* (fallthrough) | CTRL env var (controller) | Hardware controller proxy |
| /controller/* | CTRL | Direct controller proxy |
| /grow3/*, /api/grow3/* | Grow3 controller | Cultivate3/Growblox |
| /py/* | PY_BACKEND_URL | Python ML backend |

### 3.4 Startup Sequence

1. Load .env, import all dependencies
2. Parse PORT (default 8091), detect environment
3. Load crop registry, resolve controller URL
4. Create Express app, enable WebSocket
5. Register middleware stack (helmet, JSON, sanitize, rate limit, features, audit)
6. Register all routers (85+ middleware registrations)
7. Register inline routes (200+ route handlers)
8. Register proxy middleware (controller, Grow3, Python)
9. Register static file serving (public/)
10. Register error + 404 handlers
11. **startServer()**: Validate license, initialize database (PostgreSQL), setup weather polling, initialize zone setpoints, start live sensor sync (SwitchBot), start Schedule Executor, start wholesale reservation cleanup (hourly), start ML periodic scheduling (15min), initialize edge mode services (sync-service, SQLite), start zone bindings refresh (30s)

---

## 4. GreenReach Central Server

### File: greenreach-central/server.js

### 4.1 Middleware Stack (Execution Order)

| # | Middleware | Purpose |
|---|-----------|---------|
| 1 | Helmet (CSP) | Security headers |
| 2 | JSON/URL Body Parser | req.body parsing (10mb limit) |
| 3 | Farm Data Write Middleware | PUT /data/*.json -> PostgreSQL |
| 4 | Farm Data Middleware | GET /data/*.json -> farm-scoped DB |
| 5 | req.farmStore Injector | Attaches in-memory store |
| 6 | Room Map Route Handler | Special /data/room-map.json handling |
| 7 | HTML Auto-Injection | Injects api-config.js + auth-guard.js into HTML |
| 8 | Static File Serving | greenreach-central/public/ then root public/ |
| 9 | CORS | Origin validation (greenreachgreens.com, urbanyeild.ca, localhost) |
| 10 | Request Logger | Timestamp-based logging |
| 11 | Database Injector | Attaches req.db (PG pool) |
| 12 | Farm Context Extractor | Extracts req.farmId from JWT/API key/subdomain/env |
| 13 | Rate Limiter | 500 req/15min (skips /api/debug/*, /api/sync/*) |
| 14 | Auth Middleware | JWT token or API key validation |
| 15 | Admin Auth Middleware | Admin JWT for /api/admin/* |
| 16 | HTTPS Redirect | HTTP -> HTTPS in cloud mode |

### 4.2 Complete Route Map

#### Core API Routes
| Prefix | File | Description |
|--------|------|-------------|
| /api/auth | routes/auth.js | Farm user login/register/verify/refresh |
| /api/farms | routes/farms.js | Farm CRUD and profiles |
| /api/setup-wizard | routes/setup-wizard.js | Initial farm setup |
| /api/monitoring | routes/monitoring.js | System health telemetry |
| /api/inventory | routes/inventory.js, inventory-mgmt.js | Seed/nutrient/equipment tracking |
| /api/orders | routes/orders.js | Order management |
| /api/alerts | routes/alerts.js | Alert configuration |
| /api/sync | routes/sync.js | Farm data sync, API key auth |
| /api/farm-settings | routes/farm-settings.js | Settings sync to edge (DB-backed via farm_data) |
| /api/recipes | routes/recipes.js | Public recipe API |
| /api/wholesale | routes/wholesale.js | Wholesale marketplace |
| /api/square-proxy | routes/square-oauth-proxy.js | Square OAuth flow |
| /api/admin | routes/admin.js | Admin dashboard |
| /api/admin/recipes | routes/admin-recipes.js | Admin recipe management |
| /api/admin/delivery | routes/admin-delivery.js | Delivery zones, drivers, fees |
| /api/admin/network-devices | routes/network-devices.js | Network device analytics |
| /api/reports | routes/reports.js | Financial exports |
| /api/ai-insights | routes/ai-insights.js | GPT-4 powered insights |
| /api/env | routes/env-proxy.js | Environmental data proxy |
| /api/ml/insights | routes/ml-forecast.js | ML temperature forecast |
| /api/billing | routes/billing.js | Usage billing |
| /api/accounting | routes/accounting.js | Accounting ledger |
| /api/procurement | routes/procurement-admin.js | Catalog and suppliers |
| /api/remote | routes/remote-support.js | Remote diagnostics proxy |
| /api/planting | routes/planting.js | Planting recommendations |
| /api/planning | routes/planning.js | Production planning |
| /api/market-intelligence | routes/market-intelligence.js | North American market data |
| /api/crop-pricing | routes/crop-pricing.js | Farm pricing |
| /api/users | routes/farm-users.js | Farm user CRUD |
| /api/farm/products | routes/custom-products.js | Custom farm product CRUD + image upload |
| /api/research/* | routes/research-*.js | Research platform (studies, datasets, exports, compliance, ELN, collaboration, recipes, audit, workspace-ops, grants, ethics, hqp, partners, security, reporting, deadlines, publications, equipment, lineage) |
| /api/research/recipes | routes/research-recipes.js | Beta recipe lifecycle: versions, deployments, comparisons, eligibility, rollback |
| /api/research/audit | routes/research-audit.js | Immutable audit log, COI declarations, signoffs, approval chains, contributions |
| /api/research/studies/:id/notes,tasks,change-requests | routes/research-workspace-ops.js | Workspace operations: notes, tasks, change requests, milestone evidence |
| /api/research/grants | routes/research-grants.js | NSERC/tri-council grant lifecycle: applications, reports, publications, milestones, extensions, amendments |
| /api/research/ethics, /api/research/studies/:id/ethics,biosafety | routes/research-ethics.js | Ethics review (REB), biosafety protocols, amendments, renewals, dashboard |
| /api/research/trainees, /api/research/edi | routes/research-hqp.js | HQP trainee records, supervision, milestones, professional development, EDI self-identification |
| /api/research/partners | routes/research-partners.js | Partner institutions, data sharing agreements, contacts, partner network dashboard |
| /api/research/security | routes/research-security.js | Data classification, access policies, security incidents, audits, security dashboard |
| /api/research/reports | routes/research-reporting.js | Unified dashboards, cross-entity health, grant annual reports, study closeout, KPIs, activity feed, budget overview, HQP outcomes, output metrics |
| /api/research/deadlines | routes/research-deadlines.js | Deadline forecasting, auto-task generation, conflict detection, calendar export, bulk operations, upcoming alerts |
| /api/research/publications | routes/research-publications.js | Publication lifecycle, grant attribution, dataset linking, co-author management, citation metrics, metadata export |
| /api/research/equipment | routes/research-equipment.js | Lab equipment registry, booking system, maintenance scheduling, utilization metrics, availability calendar |
| /api/research/lineage | routes/research-lineage.js | Data provenance chains, dataset derivation trees, annotation tracking, governance dashboard, lineage visualization |
| /api/farm-sales/* | routes/farm-sales.js | Farm selling and orders |
| /api/network/*, /api/growers/*, /api/leaderboard | routes/network-growers.js | Network intelligence (18 routes): dashboard, farms, comparative analytics, trends, alerts, benchmarking, recipes, buyer behavior, performance, energy benchmarks, farm performance tracking, leaderboard |
| /api/lots | routes/lot-system.js | Lot tracking |
| /api/grant-wizard | routes/grant-wizard.js | Grant application wizard |
| /api/ai-monitoring | routes/admin-ai-monitoring.js | AI system monitoring |
| /api/assistant-chat | routes/assistant-chat.js | E.V.I.E. chat |
| /api/admin/assistant | routes/admin-assistant.js | F.A.Y.E. admin AI |
| /api/admin/ops-agent | routes/admin-ops-agent.js | Operations agent |
| /api/admin/calendar | routes/admin-calendar.js | Calendar events, tasks, reminders (CRUD) |

#### Inline Compatibility Routes (server.js)
| HTTP | Path | Description |
|------|------|-------------|
| GET | /health | Health check |
| GET | /api/version | API version |
| GET | /api/saas/status | Multi-tenant status |
| GET/PUT | /api/admin/farms/:farmId/slug | Farm subdomain slug |
| POST | /api/debug/track | Client debug tracking |
| GET | /env, /api/env | Telemetry (DB-first, LE-proxy fallback) |
| GET | /plans | Crop plans |
| GET | /api/farm/profile | Farm profile |
| GET/POST | /farm | Legacy farm endpoints |
| GET | /api/setup/data | Setup wizard data |
| POST | /api/setup/save-rooms | Save rooms |
| GET | /forwarder/devicedatas, /api/devicedatas | Device data proxy |
| GET | /api/admin/farms/:farmId/devices | Admin device list |
| GET | /api/weather | Weather API |
| GET/POST | /configuration, /api/farm/configuration | Config management |
| GET/POST/PATCH | /devices, /devices/:deviceId | Device CRUD |
| GET/POST/PUT | /api/groups, /api/groups/:groupId | Group CRUD |
| PUT | /api/sched/:groupId | Schedule updates |
| GET | /api/rooms | Room listing |
| POST | /api/farm/auth/login | Edge-compatible login translation |
| GET | /api/crops, /api/crops/:name | Crop registry |
| GET | /api/inventory/* | Inventory stubs (dashboard, reorder, seeds, nutrients, etc.) |
| GET | /api/traceability* | Traceability endpoints |
| GET | /api/sustainability/* | Sustainability metrics (ESG, energy, water, carbon, waste) |
| GET | /api/automation/* | Automation stubs |
| GET | /api/health/insights, /api/health/vitality | Farm health |
| GET/POST | /api/experiments* | A/B experiment management |
| GET | /api/production/* | Production planning |
| GET | /api/governance/report | Governance review |
| GET | /api/network/* | Network analytics, benchmarking, recipes |
| POST | /api/wholesale/orders/route | Order routing |
| GET | /api/wholesale/demand-analysis | Demand patterns |
| GET | /api/wholesale/pricing-recommendations | Dynamic pricing |

### 4.3 FarmStore System

**File**: greenreach-central/lib/farm-data-store.js

**Purpose**: Multi-tenant SaaS data access layer

**Data Types** (keyed by farm_id in memory Maps + PostgreSQL farm_data table):
- groups, rooms, telemetry, schedules, devices, farm_profile, room_map, tray_formats, plants, inventory, ai_decisions, support_feature_requests

**Methods**:
- farmStore.get(farmId, dataType) -- in-memory Map or DB fallback
- farmStore.set(farmId, dataType, payload) -- updates Map + DB
- farmStore.getGlobal(key) -- global metadata
- farmStore.farmIdFromReq(req) -- extracts from JWT/API key/subdomain/env

### 4.4 Background Services

| Service | Schedule | Purpose |
|---------|----------|---------|
| Health Check | Periodic | System health monitoring |
| Sync Monitor | Continuous | Farm data sync health |
| AI Recommendations Pusher | Every 30 min | GPT-4 recommendations + network_intelligence (crop_benchmarks, demand_signals, recipe_modifiers, risk_alerts, environment_benchmarks, pricing_intelligence) to farms |
| AWS Cost Explorer Sync | Scheduled | Cloud cost accounting |
| GitHub Billing Sync | Scheduled | GitHub Actions costs |
| Wholesale Network Sync | Continuous | Aggregate farm inventory |
| Benchmark Scheduler | Nightly | Crop benchmark aggregation |
| Lot Expiry Scheduler | Nightly | Auto-expire lots past best-by |
| Yield Regression | Weekly | Cross-farm yield analysis |
| Production Plan Scheduler | Weekly | Generate seeding plans |
| Admin Session Cleanup | Every 30min | Delete expired sessions |
| Grant Cleanup | Every 6 hours | Expire old grant applications |
| Farm Data Sync | Every 5 min | Pull data from LE Cloud Run |
| Daily Full Sync | 2 AM | Full data refresh |

---

## 5. Frontend Pages -- Complete Inventory

### 5.1 Central Admin Pages (greenreach-central/public/)

#### GR-central-admin.html -- F.A.Y.E. Admin Dashboard
- **Auth**: localStorage.admin_token required
- **Sidebar**: Dynamically rendered by `central-admin.js` -> `renderContextualSidebar()`, context-aware (platform/farm/room level)
- **Sidebar (platform level)**:
  - Overview: Dashboard, LE Fleet Monitoring, Anomalies, Alerts
  - Wholesale: Admin Dashboard, Pricing & Products, Delivery Services
  - Procurement: Catalog Management, Supplier Management, Revenue
  - Analytics: AI Insights, Market Intelligence, Energy, Harvest Forecast
  - Grant Intelligence: Grant Summary, Grant Users
  - Finance: Network Accounting
  - Marketing: Marketing Dashboard, S.C.O.T.T.
  - Network: Network Dashboard, Grower Network
  - AI Governance: F.A.Y.E. Core (/faye-core.html), AI Rules, AI Reference Sites, AI Agent Monitor
  - Management: All Farms, Users, Recipes
  - Field Tools: Edge Setup Guide (/landing-downloads.html)
- **Sidebar (farm level)**: Farm Overview (Summary, Rooms, Devices), Operations (Inventory, Recipes, Environmental), Performance (Energy, Alerts)
- **NOTE**: Research/G.W.E.N. are NOT in Central sidebar. They are LE-only features.
- **Global Search**: #globalSearch (filters farms, devices, trays)
- **Key Buttons**: Sync Stats, Export Report, Configure Farm, View Logs, Export Farm Data, Change Password, Logout
- **Farm Info Edit**: owner, contact, phone, email, website, address fields (toggle editable)
- **Farm Notes**: textarea with save/toggle
- **Recipe Library**: search + request form (crop input + submit)
- **AI Rules**: title, category, enabled, review, content fields (CRUD)
- **API Calls**:
  - GET /api/network/dashboard, /farms/list, /comparative-analytics, /trends, /alerts, /farms/:farmId
  - GET /api/growers/dashboard, /list, /leaderboard, /performance/:growerId, /invitations/list
  - GET /api/admin/farms, /users
  - POST /api/admin/farms/:farmId/reset-credentials, /reset-user-password, /status
  - POST /api/admin/users/:userId/status, /role
  - POST /api/admin/impersonate/:farmId

#### GR-central-admin-login.html -- Admin Login
- **Form**: email + password
- **Output**: stores admin_token, admin_email, admin_name in localStorage
- **Redirect**: -> GR-central-admin.html

#### LE-farm-admin.html -- E.V.I.E. Farm Dashboard
- **Auth**: localStorage.token or sessionStorage.token
- **Sidebar** (static HTML, sections listed in order):
  - Farm Operations: Setup/Update (/LE-dashboard.html), Activity Hub (/views/tray-inventory.html), Farm Summary (/views/farm-summary.html), Inventory (/views/farm-inventory.html), Planting Scheduler (/views/planting-scheduler.html), Tray Setup (/views/tray-setup.html), Nutrient Management (/views/nutrient-management.html), Heat Map (/views/room-heatmap.html), Crop Weight Analytics (/views/crop-weight-analytics.html)
  - Enterprise ERP: Procurement (/views/procurement-portal.html)
  - Sales: Farm Sales Terminal (/farm-sales-pos.html)
  - Administration: Settings, IoT Manager, Room Mapper, Network, Sustainability, Maintenance, Traceability
  - Support: Help & Docs, Contact Support
  - **Research**: Research Workspace (/views/research-workspace.html), Research Overview (/research-subscription.html)
  - Intelligence: E.V.I.E. Core (/evie-core.html)
- **NOTE**: Research Workspace and G.W.E.N. are LE features. G.W.E.N. is embedded inside Research Workspace (not a separate sidebar link). The Research sidebar section belongs ONLY in LE-farm-admin, NOT in GR-central-admin.
- **Linking**: All sidebar items use `data-url` to load pages in an `<iframe id="admin-iframe">`. Research Workspace loads `/views/research-workspace.html` which contains G.W.E.N. chat, study management, datasets, ELN, compliance, grants, and all research tabs.
- **Sections**:
  - Traceability: search lot codes, view lot details
  - Inventory: seeds, packaging, nutrients, equipment, supplies (CRUD + restock)
  - Sustainability: ESG report, energy/water/carbon/waste tracking
  - IoT Manager: device scanning, auto-assign
  - Network Intelligence: crop benchmarks, demand signals, risk alerts (from Central push)
- **API Calls**:
  - GET /api/traceability, /stats, /lot/:lotCode
  - GET /api/inventory/dashboard, /reorder-alerts, /seeds/list, /nutrients/list, /packaging/list, /equipment/list, /supplies/list
  - POST /api/inventory/seeds, /packaging, /packaging/:id/restock
  - PUT /api/inventory/seeds/:id
  - GET /api/sustainability/esg-report, /energy/usage, /water/usage, /carbon-footprint, /waste/tracking, /trends

#### farm-admin-login.html -- Farm Login
- **Form**: email + password
- **Output**: stores token in localStorage
- **Redirect**: -> LE-farm-admin.html

### 5.2 Dashboard Views (greenreach-central/public/views/)

| Page | Purpose | Key Data Displayed | Key Inputs/Buttons |
|------|---------|-------------------|-------------------|
| farm-summary.html | Farm overview, environment | Temp, humidity per zone, alerts, health score | Refresh, auto-refresh 60s, tab resume |
| farm-inventory.html | Tray inventory with AI insights | Tray counts, growth stage, harvest dates | Search, filter, AI insights popup |
| tray-inventory.html | Activity Hub with EVIE chat | Tray tracking, order management, EVIE assistant (floating orb, chat panel, voice input, task display) | Search, filter, bulk actions, EVIE chat, voice commands |
| tray-setup.html | Tray configuration | Format templates, dimensions | Create format, save |
| room-mapper.html | Room/zone configuration | Room layout, device assignments | Drag-drop zones, save config |
| room-heatmap.html | Environmental heatmap | Temperature/humidity color grid | Zone selection, time range |
| iot-manager.html | Device management | SwitchBot, Kasa, Shelly, MQTT devices | Scan, auto-assign, configure |
| network-dashboard.html | Network device status | Connectivity, throughput | Refresh, filter |
| planting-scheduler.html | Crop planning calendar | Seeding dates, harvest dates | Create plan, drag schedule |
| nutrient-management.html | Nutrient tracking | Dosing schedules, consumption | Set dosing, adjust recipe |
| crop-weight-analytics.html | Yield analytics | Weight trends, targets, variance | Date range, crop filter |
| fan-rotation-monitor.html | Equipment rotation | Fan status, rotation schedule | Rotate, reset schedule |
| field-mapping.html | Field/area definitions | Area layout, zone mapping | Define areas, assign zones |
| procurement-portal.html | Supply ordering | Catalog items, order status | Search, order, reorder |
| farm-maintenance-checklist.html | Task management | Tasks, due dates, completion | Check task, add task |

### 5.3 Wholesale Pages

| Page | Purpose | Key Buttons | API Calls |
|------|---------|-------------|-----------|
| GR-wholesale.html | Marketplace browsing | Browse, Add to Cart, Checkout | Catalog API, cart management |
| GR-wholesale-order-review.html | Order confirmation | Confirm Order, Cancel | Order submission |
| GR-wholesale-farm-performance.html | Performance metrics | Filter, Export | Performance API |
| GR-wholesale-integrations.html | Integration setup | Connect, Disconnect | Integration API |
| LE-wholesale-orders.html | Farm-side order management | Accept, Reject, Fulfill | Order management API |

### 5.4 Landing and Marketing Pages

| Page | Purpose |
|------|---------|
| landing-main.html | Homepage |
| landing-downloads.html | Downloads and documentation |
| landing-purchase.html | Purchase/ordering |
| landing-purchase-success.html | Order confirmation |
| landing-cloud.html | Cloud platform features |
| landing-edge.html | Edge/Light Engine features |
| farm-sales-landing.html | Farm sales features |
| farm-sales-shop.html | Direct-to-consumer shop |
| farm-sales-store.html | Farm retail |
| farm-sales-pos.html | Point of sale system. Loaded as iframe from LE-farm-admin. Embedded mode auto-login from admin session |
| about.html | About GreenReach |
| growing-made-easy.html | Onboarding education |
| grow-and-sell.html | Farming + sales integration |
| id-buy-local.html | Buy local marketplace |
| greenreach-org.html | Organization features |

### 5.5 Utility and Special Pages

| Page | Purpose |
|------|---------|
| research-workspace.html | Research dashboard (studies, datasets, ELN, compliance, collaborators, recipes, tasks, audit). Embedded in LE-farm-admin via iframe. E.V.I.E. enabled. Located in views/. Phase 1 tabs: Studies, Datasets, Notebooks, Compliance, Collaborators, Recipes, Tasks, Audit |
| research-subscription.html | Research tier overview and feature summary. Embedded in LE-farm-admin via iframe. E.V.I.E. enabled |
| setup-wizard.html | New farm setup wizard |
| grant-wizard.html | Grant application wizard (FREE) |
| delivery.html | Delivery management |
| driver-enrollment.html | Driver enrollment |
| activity-hub-qr.html | QR activity tracking |
| LE-qr-generator.html | QR code generator |
| schedule.html | Schedule management |
| LE-dashboard.html | LE configuration wizard (multi-step). Payment wizard removed -- redirects to payment-setup.html |
| payment-setup.html | Standalone Square OAuth connection page. Security-hardened (same-origin returnUrl, DOM API rendering). Lives in BOTH public/ dirs |
| LE-vpd.html | Vapor Pressure Deficit controls |
| LE-switchbot.html | SwitchBot management |
| LE-billing.html | Billing/subscription |
| LE-migration-wizard.html | Data migration wizard |
| LE-notifications.html | Notification inbox |
| LE-notification-settings.html | Notification preferences |
| LE-offline.html | Offline fallback |
| farm-wall-cad-renderer.html | CAD visualization |
| farm-vitality.html | Farm health visualizations |
| health-dashboard.html | System health |
| blog.html, blog-post.html | Blog system |
| purchase.html, purchase-success.html | Purchase flow |
| clear-cache.html | Cache clearing utility |
| login.html | Generic login |
| evie-core.html | E.V.I.E. core interface |
| faye-core.html | F.A.Y.E. core interface |

### 5.6 Key JavaScript Files

| File | Purpose |
|------|---------|
| evie-presence.js | E.V.I.E. 3-layer intelligence (ambient orb -> panel -> conversation) |
| faye-presence.js | F.A.Y.E. 3-layer intelligence (observe, advise, act, explain, learn, escalate) |
| admin-assistant.js | F.A.Y.E. chat widget |
| farm-assistant.js | Farm assistant helper |
| farm-vitality.js | Health visualization |
| iot-manager.js | IoT device scanning/management |
| api-config.js | API endpoint configuration |
| auth-guard.js | Token validation and redirect |
| central-admin.js | Central admin operations |
| wholesale-admin.js | Wholesale admin operations |
| wholesale.js | Wholesale marketplace client |
| header-dropdown-nav.js | Navigation dropdowns |
| switchbot-helpers.js | SwitchBot API helpers |
| device-scanner.js | Device discovery |
| net.guard.js | Network request guard |
| console-guard.js | Console logging guard |
| pwa-installer.js | PWA installation |
| onboarding-checklist.js | Onboarding tasks |

### 5.7 CSS Architecture

| File | Purpose |
|------|---------|
| styles.foxtrot.css | Main theme |
| styles.charlie.css | Alternative theme |
| nav-color-palette.css | Nav button colors |
| light-engine.css | LE-specific |
| le-dashboard-theme.css | LE dark theme |
| evie-core.css | E.V.I.E. styling |
| faye-core.css | F.A.Y.E. styling |
| farm-assistant.css | Assistant widget |
| iot-manager.css | IoT manager UI |
| switchbot-manager.css | SwitchBot UI |
| pwa.css | PWA styling |

### 5.8 Dual-Deploy File Registry (BOTH public/ dirs)

Files that MUST exist in both `greenreach-central/public/` and root `public/`:

| File | Reason |
|------|--------|
| LE-farm-admin.html | Main admin page -- served by Central, also needed on LE |
| LE-dashboard.html | Setup wizard -- embedded in LE-farm-admin iframe |
| farm-sales-pos.html | POS terminal -- embedded in LE-farm-admin iframe |
| payment-setup.html | Square OAuth page -- standalone, linked from LE-dashboard |
| evie-core.css | E.V.I.E. styles |
| evie-presence.js | E.V.I.E. ambient intelligence |
| farm-admin.js | Main admin navigation and section handler |
| auth-guard.js | Client-side JWT validation and redirect |
| research-workspace.html | Research dashboard -- embedded in LE-farm-admin iframe |
| research-subscription.html | Research tier overview -- embedded in LE-farm-admin iframe |

**Rule**: Edit in `greenreach-central/public/` first, then copy to root `public/`. The LE `.dockerignore` excludes `greenreach-central/public/` from the LE Docker image, so root `public/` is the only source for LE Cloud Run.

---

## 6. Data Flows -- Entry to Exit

### 6.1 Farm Login Flow

```
User -> farm-admin-login.html
  -> POST /api/auth/login { farm_id, email, password }
    -> routes/auth.js
      -> PostgreSQL farm_users table (bcrypt compare)
      -> JWT issued (24h expiry, payload: farm_id, user_id, role, email)
    <- { success, token, farm_id, role, email }
  -> localStorage.token = token
  -> Redirect to LE-farm-admin.html
```

### 6.2 Admin Login Flow

```
User -> GR-central-admin-login.html
  -> POST /api/admin/auth/login { email, password }
    -> routes/admin-auth.js (or server routes/admin-auth.js)
      -> PostgreSQL admin_users table (bcrypt compare)
      -> JWT issued (12h expiry, payload: adminId, email, role, name)
    <- { success, token, adminObj }
  -> localStorage.admin_token = token
  -> Redirect to GR-central-admin.html
```

### 6.3 Sensor Data Flow (SwitchBot -> Dashboard)

```
Stage 1: Physical Sensors -> SwitchBot Cloud
  4x WoIOSensor (BLE) -> Hub Mini (WiFi) -> SwitchBot Cloud API

Stage 2: LE Cloud Run Polling (every 30s)
  setupLiveSensorSync() -> GET https://api.switch-bot.com/v1.1/devices/{id}/status
  Auth: HMAC-SHA256 (SWITCHBOT_TOKEN + SWITCHBOT_SECRET)
  Response: { temperature, humidity, battery, version }

Stage 3: EnvStore (in-memory)
  preEnvStore.updateSensor(scopeId, sensorType, reading)
  -> Weighted median aggregation
  -> 50-point history per sensor
  -> Persist to data/automation/env-state.json

Stage 4: LE Cloud Run GET /env
  -> Returns zones array with current, history (12 points), setpoints
  -> CORS enabled

Stage 5: Sync Service (LE -> Central, every 30s)
  sync-service.js reads localhost/env
  -> POST {centralApiUrl}/api/sync/telemetry
  Auth: X-API-Key + X-Farm-ID headers

Stage 6: Central Ingestion
  routes/sync.js -> UPSERT farm_data (farm_id, 'telemetry', data)
  -> Also updates inMemoryStore.telemetry
  -> Async: evaluateAndGenerateAlerts()

Stage 7: Central GET /env (DB-first)
  1. Try PostgreSQL farm_data WHERE data_type='telemetry'
  2. Fallback: proxy to LE Cloud Run GET /env

Stage 8: Dashboard Display
  farm-summary.html -> fetchEnvData()
  -> GET /env?hours=24 with Authorization + x-farm-id
  -> Auto-refresh every 60s
  -> Display: temp/humidity cards per zone, alerts, health
```

### 6.4 Farm Data Sync (Edge -> Central)

```
Trigger: Every 5 minutes + daily at 2 AM + manual via POST /api/sync/pull-farm-data

Source: LE Cloud Run static data files
  -> groups.json -> groups
  -> rooms.json -> rooms
  -> farm.json -> farm_profile
  -> iot-devices.json -> devices
  -> room-map.json -> room_map
  -> env.json -> telemetry
  -> tray-formats.json -> tray_formats
  -> schedules.json (optional) -> schedules
  -> light-setups.json (optional) -> light_setups
  -> plans.json (optional) -> plans

Storage: 
  1. In-memory farmStore Maps (primary read cache)
  2. PostgreSQL farm_data table (durable)
  NOT in flat files (prevents cross-farm data leaks)
```

### 6.5 Wholesale Order Flow

```
Buyer -> GR-wholesale.html (browse catalog)
  -> GET /api/wholesale/catalog (product listing)
    -> Primary: buildAggregateCatalog() from network farms
    -> Fallback: Direct DB query on farm_inventory (if aggregate is empty, v1.3.0)
  -> Add items to cart
  -> POST /api/wholesale/checkout (place order)
    -> Square payment processing (12% commission via app_fee_money)
    -> wholesale_orders table INSERT
    -> Inventory reservation
    -> Notification to farm
  -> Farm: LE-wholesale-orders.html
    -> View pending orders
    -> Accept/Reject/Fulfill
    -> POST /api/wholesale/orders/:id/fulfill
```

### 6.6 Group/Schedule Management Flow

```
User -> LE-dashboard.html (setup wizard) OR farm-admin pages
  -> Groups: crop assignments, tray counts, light configs
    -> POST/PUT /api/groups -> farmStore.set(farmId, 'groups', data)
    -> Persists to PostgreSQL farm_data + in-memory Map
  -> Schedules: light timers, automation rules
    -> PUT /api/sched/:groupId -> farmStore.set(farmId, 'schedules', data)
    -> Schedule Executor reads schedules every 60s
    -> Translates to device commands via CTRL proxy
```

### 6.7 Inventory Management Flow

See **Section 15** for the complete inventory workflow, covering tray-based inventory, manual entry, the dual-quantity system, POS consumption, wholesale catalog, and all known gaps.

**Summary**: Two inventory sources feed farm_inventory:
1. **Auto (Tray Harvest)**: Tray setup -> seeding -> growing -> harvest -> lot code + weight -> recalculateAutoInventoryFromGroups() -> farm_inventory.auto_quantity_lbs
2. **Manual Entry**: POST /api/inventory/manual -> farm_inventory.manual_quantity_lbs

Combined: `quantity_available = auto_quantity_lbs + manual_quantity_lbs`

Exposed to: Wholesale catalog (available_for_wholesale=true), POS checkout, Central admin dashboard.

See Section 15 for critical gaps where sales do NOT deduct from inventory.

### 6.8 Grant Application Flow

```
User -> grant-wizard.html
  -> POST /api/grant-wizard/auth/register { email, password, business_name }
    -> grant_users table INSERT
  -> Browse grant programs (grant_programs table)
  -> Start application (grant_applications INSERT)
  -> Multi-step wizard:
    -> Organization profile, project profile, budget, contacts
    -> AI-powered answer suggestions (OpenAI)
    -> Evidence gathering, document checklists
  -> Export application pack (grant_export_packs)
  -> No fees of any kind (FREE access)
```

### 6.9 Delivery Flow

```
Order placed (farm-sales or wholesale)
  -> delivery_orders INSERT { farm_id, order_id, address, zone }
  -> Route assignment (delivery_routes)
  -> Driver assignment (delivery_drivers)
  -> Driver app: status updates (in-transit, delivered)
  -> Payout calculation (driver_payouts)
  -> Buyer notification
```

---

## 7. Sensor and Environmental Controller Pipeline

### 7.1 Hardware Inventory

| Device | ID | Type | Data |
|--------|-----|------|------|
| Sen 1 | CE2A81460E78 | WoIOSensor | temperature, humidity, battery |
| Sen 2 | CE2A8606558E | WoIOSensor | temperature, humidity, battery |
| Sen 3 | C3343035702D | WoIOSensor | temperature, humidity, battery |
| Sen 4 | D0C841064453 | WoIOSensor | temperature, humidity, battery |
| Hub Mini | D3F85167A57E | Hub (WiFi bridge) | Aggregates sensor data |

### 7.2 SwitchBot Polling Configuration

| Parameter | Value | Env Var |
|-----------|-------|---------|
| Poll Interval | 30 seconds | (hardcoded in setupLiveSensorSync) |
| API Timeout | 8000ms | SWITCHBOT_API_TIMEOUT_MS |
| Device Cache TTL | 30 minutes | SWITCHBOT_DEVICE_CACHE_TTL_MS |
| Status Cache TTL | 15 minutes | SWITCHBOT_STATUS_CACHE_TTL_MS |
| Rate Limit | 6000ms (10/min) | SWITCHBOT_RATE_LIMIT_MS |
| Batch Size | 3 sensors per cycle | SWITCHBOT_SENSOR_STATUS_BATCH |

### 7.3 EnvStore Architecture

**File**: automation/env-store.js

```
EnvStore
  .scopes: Map<scopeId, ScopeData>
    .sensors: Map<sensorType, SensorData>
      .value: number (current reading)
      .unit: string
      .observedAt: ISO timestamp
      .history: array (last 50 readings)
      .sources: Map<sourceId, SourceData> (per-sensor aggregation)
  
  Methods:
    .updateSensor(scopeId, sensorType, reading) -> weighted median aggregation
    .getSnapshot() -> returns all zones with current + history
    .getStaleness() -> 10-minute threshold for marking stale
  
  Persistence: data/automation/env-state.json (survives restarts)
  
  CRITICAL BUG: If SwitchBot polling breaks, stale values from env-state.json
  are served with FRESH timestamps, masking the problem for hours.
```

### 7.4 Automation Engine

**Files**: automation/ directory

| File | Purpose |
|------|---------|
| env-store.js | In-memory state management |
| engine.js | PreAutomationEngine |
| index.js | Factory createPreAutomationLayer() |
| fan-rotation.js | Fan rotation controller |
| rules-store.js | Environmental ruleset storage |
| plug-registry.js | Plugin system |
| plug-manager.js | Plugin manager |
| controllers/ | Room-level control logic |
| drivers/ | Device-specific drivers (kasa, mqtt, modbus) |

### 7.5 Schedule Executor

**File**: lib/schedule-executor.js

- Runs every 60 seconds (SCHEDULE_EXECUTOR_INTERVAL)
- Reads active schedules from groups/schedules data
- Translates to device commands via hardware controller proxy (CTRL)
- ML anomaly detection overlay
- Zone bindings refresh every 30s

### 7.6 MQTT Nutrient Control

| Parameter | Value | Env Var |
|-----------|-------|---------|
| Broker URL | mqtt://192.168.2.42:1883 | NUTRIENT_MQTT_URL |
| Command Topic | commands/NutrientRoom | NUTRIENT_COMMAND_TOPIC |
| Command Timeout | 8000ms | NUTRIENT_COMMAND_TIMEOUT_MS |
| Scope ID | tank-2 | NUTRIENT_SCOPE_ID |
| Backend Scope | NutrientRoom | NUTRIENT_BACKEND_SCOPE |
| Poll Interval | 20000ms | NUTRIENT_POLL_INTERVAL_MS |

### 7.7 VPD Control System

- Vapor Pressure Deficit calculation from temperature + humidity
- Zone-based control with device assignments
- Enable/disable per zone
- Control results history for analysis

---

## 8. Database Schema -- All Tables

### 8.1 Farm Management

**farms**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| farm_id | VARCHAR(255) UNIQUE | e.g., FARM-MLTP9LVH-B0B85039 |
| name | VARCHAR(255) | |
| email | VARCHAR(255) | |
| api_url | VARCHAR(500) | LE Cloud Run URL |
| status | VARCHAR(50) | active, inactive |
| last_heartbeat | TIMESTAMP | |
| slug | VARCHAR(100) UNIQUE | SaaS subdomain |
| metadata | JSONB | contact, location, address, coordinates |
| settings | JSONB | |
| contact_name, city, state | VARCHAR | |
| certifications, practices, attributes | TEXT | |
| tier, registration_code | VARCHAR | |
| farm_type | VARCHAR | |
| last_sync, created_at, updated_at | TIMESTAMP | |

**farm_data**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| farm_id | VARCHAR(255) FK->farms | |
| data_type | VARCHAR(50) | groups, rooms, telemetry, devices, farm_profile, room_map, tray_formats, schedules, plants, inventory, ai_decisions |
| data | JSONB | Arbitrary payload |
| created_at, updated_at | TIMESTAMP | |
| UNIQUE | (farm_id, data_type) | |

**farm_backups**
| Column | Type | Notes |
|--------|------|-------|
| farm_id | VARCHAR(255) PK | |
| groups, rooms, schedules, config | JSONB | Backup snapshots |
| last_synced, created_at | TIMESTAMP | |

**farm_heartbeats**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| farm_id | VARCHAR(255) FK->farms | |
| cpu_usage, memory_usage, disk_usage | FLOAT | |
| metadata | JSONB | |
| timestamp | TIMESTAMP | |

### 8.2 User Management

**farm_users**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| farm_id | VARCHAR(255) FK->farms | |
| email | VARCHAR(255) | |
| first_name, last_name | VARCHAR(255) | |
| role | VARCHAR(50) | admin, manager, operator, viewer |
| password_hash | VARCHAR(255) | bcrypt |
| status | VARCHAR(50) | |
| last_login | TIMESTAMPTZ | |
| created_at, updated_at | TIMESTAMPTZ | |
| UNIQUE | (farm_id, email) | |

**admin_users**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| email | VARCHAR(255) UNIQUE | |
| password_hash | VARCHAR(255) | bcrypt |
| name | VARCHAR(255) | |
| role | VARCHAR(50) | viewer, editor, admin |
| active, mfa_enabled | BOOLEAN | |
| mfa_secret | VARCHAR(255) | |
| permissions | JSONB | |
| failed_attempts | INTEGER | |
| locked_until | TIMESTAMPTZ | |
| last_login, created_at, updated_at | TIMESTAMPTZ | |

**admin_sessions**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| admin_id | INTEGER FK->admin_users CASCADE | |
| token_hash | VARCHAR(255) | |
| ip_address | VARCHAR(45) | |
| user_agent | TEXT | |
| expires_at, created_at | TIMESTAMPTZ | |

**admin_audit_log**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| admin_id | INTEGER FK->admin_users | |
| action | VARCHAR(100) | |
| resource_type, resource_id | VARCHAR | |
| details | JSONB | |
| ip_address | VARCHAR(45) | |
| user_agent | TEXT | |
| success | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

### 8.3 Crop and Production

**planting_assignments**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| farm_id | VARCHAR(255) FK->farms | |
| group_id, tray_id, crop_id | VARCHAR(255) | |
| crop_name | VARCHAR(255) | |
| seed_date, harvest_date | DATE | |
| status | VARCHAR(50) | |
| notes | TEXT | |
| created_at, updated_at | TIMESTAMP | |
| UNIQUE | (farm_id, group_id) | |

**experiment_records**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| farm_id | VARCHAR(255) FK->farms | |
| crop, recipe_id | VARCHAR(255) | |
| grow_days, planned_grow_days | INTEGER | |
| recipe_params_avg, environment_achieved_avg, outcomes | JSONB | weight_per_plant_oz, loss_rate, quality_score |
| farm_context | JSONB | |
| recorded_at, ingested_at | TIMESTAMP | |

**crop_benchmarks**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| crop | VARCHAR(255) UNIQUE | |
| farm_count, harvest_count | INTEGER | |
| avg/min/max weight_per_plant_oz | DECIMAL | |
| avg_grow_days, avg_loss_rate | DECIMAL | |
| avg_temp_c, avg_humidity_pct, avg_ppfd | DECIMAL | |
| computed_at | TIMESTAMP | |

**loss_events**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| farm_id | VARCHAR(255) | |
| crop | VARCHAR(255) | |
| loss_plants | INTEGER | |
| loss_percentage | DECIMAL | |
| loss_value | NUMERIC | |
| cause | VARCHAR(255) | |
| details | JSONB | |
| recorded_at, created_at | TIMESTAMP | |

### 8.4 Inventory and Products

**products**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| sku_id | VARCHAR(255) | |
| farm_id | VARCHAR(255) FK->farms | |
| name | VARCHAR(255) | |
| quantity | INTEGER | |
| unit | VARCHAR(50) | |
| price | DECIMAL(10,2) | |
| organic | BOOLEAN | |
| certifications, metadata | JSONB | |
| created_at, updated_at | TIMESTAMP | |
| UNIQUE | (sku_id, farm_id) | |

**farm_inventory**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| farm_id | VARCHAR(255) FK->farms | |
| product_id, product_name, sku | VARCHAR(255) | |
| quantity, quantity_available | NUMERIC(12,3) | |
| quantity_unit, unit | VARCHAR(50) | |
| price, wholesale_price, retail_price | NUMERIC | |
| available_for_wholesale | BOOLEAN | |
| status, category, variety | VARCHAR | |
| source_data | JSONB | |
| auto_quantity_lbs, manual_quantity_lbs | DECIMAL | |
| inventory_source | VARCHAR(10) default 'auto' | |
| synced_at, last_updated, created_at, updated_at | TIMESTAMP | |
| UNIQUE | (farm_id, product_id) | |

### 8.5 Wholesale

**wholesale_buyers**
| Column | Type | Notes |
|--------|------|-------|
| id | VARCHAR(255) PK | |
| business_name, contact_name | VARCHAR(255) | |
| email | VARCHAR(255) UNIQUE | |
| buyer_type | VARCHAR(50) | |
| location | JSONB | |
| password_hash | VARCHAR(255) | |
| status, phone | VARCHAR(50) | |
| created_at, updated_at | TIMESTAMP | |

**wholesale_orders**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| master_order_id | VARCHAR(64) UNIQUE | |
| buyer_id, buyer_email | VARCHAR(255) | |
| status | VARCHAR(50) | |
| order_data | JSONB | |
| created_at, updated_at | TIMESTAMP | |

**payment_records**
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| payment_id | VARCHAR(64) UNIQUE | |
| order_id | VARCHAR(64) | |
| amount | NUMERIC(10,2) | |
| currency | VARCHAR(3) | |
| provider, status | VARCHAR(30) | |
| metadata | JSONB | |
| created_at | TIMESTAMP | |

**network_farms**
| Column | Type | Notes |
|--------|------|-------|
| farm_id | VARCHAR PK | |
| name | VARCHAR | |
| api_url | VARCHAR | |
| status | VARCHAR | active, inactive |
| contact, location | JSONB | |
| created_at, updated_at | TIMESTAMP | |

### 8.6 Accounting and Finance

**accounting_sources** (id SERIAL PK)
- source_key VARCHAR UNIQUE, source_name, source_type, active BOOLEAN, config JSONB

**accounting_accounts** (id SERIAL PK)
- account_code VARCHAR(20) UNIQUE, account_name, account_class, account_type, parent_account_code, is_active, metadata JSONB

**accounting_transactions** (id BIGSERIAL PK)
- source_id FK->accounting_sources, source_txn_id, idempotency_key UNIQUE, txn_date, description, currency, total_amount NUMERIC(12,2), status, raw_payload JSONB

**accounting_entries** (id BIGSERIAL PK)
- transaction_id FK->accounting_transactions CASCADE, line_number, account_code FK->accounting_accounts, debit/credit NUMERIC(12,2), memo, metadata JSONB
- UNIQUE (transaction_id, line_number), CHECK: NOT (debit > 0 AND credit > 0)

**accounting_classifications** (id BIGSERIAL PK)
- transaction_id, entry_id FKs, suggested_category, rule_applied, confidence, status, reviewer, review_note, approved_at

**accounting_period_closes** (id SERIAL PK)
- period_key VARCHAR(7) UNIQUE, status, opened_at, locked_at, locked_by, snapshot JSONB

**valuation_snapshots** (id SERIAL PK)
- snapshot_date, method, valuation_low/base/high NUMERIC(14,2), confidence_score, assumptions JSONB, notes, created_by

### 8.7 Delivery Service

**farm_delivery_settings** (id SERIAL PK)
- farm_id UNIQUE, enabled, base_fee, min_order, lead_time_hours, max_deliveries_per_window

**farm_delivery_windows** (id SERIAL PK)
- farm_id, window_id, label, start_time, end_time, active
- UNIQUE (farm_id, window_id)

**farm_delivery_zones** (id SERIAL PK)
- farm_id, zone_id, name, description, fee, min_order, postal_prefix, status
- UNIQUE (farm_id, zone_id)

**delivery_orders** (id SERIAL PK)
- farm_id, delivery_id, order_id, delivery_date, time_slot, zone_id, route_id, driver_id, status, address JSONB, contact JSONB, instructions, delivery_fee, tip_amount, driver_payout_amount, platform_margin, payload JSONB
- UNIQUE (farm_id, delivery_id)

**delivery_routes** (id SERIAL PK)
- farm_id, route_id, route_date, time_slot, zone_id, status, payload JSONB
- UNIQUE (farm_id, route_id)

**delivery_drivers** (id SERIAL PK)
- farm_id, driver_id, name, phone, email, vehicle, zones JSONB, pay_per_delivery, cold_chain_bonus, cold_chain_certified, deliveries_30d, rating, status, hired_at

**driver_payouts** (id SERIAL PK)
- farm_id, driver_id, delivery_id, order_id, base_amount, cold_chain_bonus, tip_amount, total_payout, payout_status, paid_at, payout_method

**driver_applications** (id SERIAL PK)
- application_id UNIQUE, name, email, phone, address, city, postal_code, vehicle details, licence info

### 8.8 Pricing Authority

**farm_cost_surveys** (id SERIAL PK)
- farm_id, crop, cost_per_unit, unit, cost_breakdown JSONB, survey_date, valid_until, notes
- UNIQUE (farm_id, crop, survey_date)

**pricing_offers** (offer_id VARCHAR PK)
- crop, wholesale_price, unit, reasoning, confidence, predicted_acceptance, offer_date, effective_date, expires_at, status, created_by, tier, metadata JSONB

**pricing_responses** (response_id SERIAL PK)
- offer_id, farm_id, response, counter_price, justification, notes
- UNIQUE (offer_id, farm_id)

**pricing_history** (history_id SERIAL PK)
- crop, wholesale_price, unit, offer_date, acceptance stats, avg_counter_price, reasoning, tier, metadata JSONB

### 8.9 Grant Wizard

**grant_users** (id SERIAL PK)
- email UNIQUE, password_hash, contact_name, business_name, phone, province, postal_code, organization_type, cra_business_number, incorporation_status, employee_count, ownership_demographics JSONB, farm_details JSONB, website_url, consent flags, timestamps

**grant_programs** (id SERIAL PK)
- program_code UNIQUE, program_name, administering_agency, URLs, intake_status/deadline/opens, description, objectives, priority_areas TEXT[], eligibility_summary/rules JSONB, funding_type/min/max, cost_share_ratio, application_method/url, has_fillable_pdf, pdf_template_url, required_documents TEXT[], question_map JSONB, evidence_snippets JSONB, equity_details JSONB, active BOOLEAN

**grant_applications** (id SERIAL PK)
- user_id FK, program_id FK, status, wizard_step, percent_complete, organization_profile/project_profile/budget/contacts/attachments_checklist JSONB, prior_funding JSONB[], answers/facts_ledger JSONB, milestones/support_letters JSONB[], outcome/outcome_date/outcome_amount/outcome_notes

**grant_export_packs, grant_program_snapshots, grant_outcome_analytics, grant_research_jobs, grant_wizard_events, grant_program_change_alerts, ai_reference_sites** -- supporting tables with audit/analytics

### 8.10 Device Integration

**device_integrations** (id SERIAL PK)
- farm_id_hash, record_id, device_type, device_make_model, driver_id, driver_version, protocol, capabilities/install_context JSONB, validation fields, grower_feedback_rating
- UNIQUE (farm_id_hash, record_id)

**network_recipe_modifiers** (id SERIAL PK)
- modifiers JSONB, computed_at

### 8.11 Audit

**audit_log** (id SERIAL PK)
- event_type, entity_type, entity_id, actor, details JSONB, created_at

### 8.12 Research Platform (Phase 1)

**recipe_versions** (id SERIAL PK)
- farm_id, study_id, title, version_number, parameters JSONB, status (draft|review|approved_beta|live|archived|retired), parent_version_id, created_by, created_at, updated_at

**recipe_deployments** (id SERIAL PK)
- recipe_version_id, farm_id, target_zone, deployed_by, deployed_at, acknowledged, acknowledged_by, acknowledged_at, rolled_back, rollback_reason, rollback_at

**recipe_comparisons** (id SERIAL PK)
- farm_id, recipe_a_id, recipe_b_id, comparison_metrics JSONB, result_summary, created_at

**recipe_eligibility_rules** (id SERIAL PK)
- recipe_version_id, farm_id, rule_type, rule_definition JSONB, created_at

**recipe_operator_acks** (id SERIAL PK)
- deployment_id, farm_id, operator_id, acknowledged_at, notes

**coi_declarations** (id SERIAL PK)
- study_id, farm_id, user_id, declaration_text, relationship_type, status (pending|reviewed|cleared|flagged), reviewed_by, reviewed_at, created_at

**role_signoffs** (id SERIAL PK)
- study_id, farm_id, role, user_id, milestone, signed_at, notes

**approval_chains** (id SERIAL PK)
- study_id, farm_id, approval_type, step_order, approver_role, approver_id, status (pending|approved|rejected), decided_at, notes, created_at

**authorship_contributions** (id SERIAL PK)
- study_id, farm_id, user_id, role (PI|Co-PI|technician|student|collaborator), contribution_description, orcid, affiliation, created_at, updated_at

**workspace_notes** (id SERIAL PK)
- study_id, farm_id, note_type (decision|meeting|general), title, content, created_by, created_at, updated_at

**workspace_tasks** (id SERIAL PK)
- study_id, farm_id, title, description, assigned_to, status (open|in_progress|done|blocked), priority, due_date, institution, created_at, updated_at

**change_requests** (id SERIAL PK)
- study_id, farm_id, title, description, requested_by, status (pending|approved|rejected|implemented), reviewed_by, reviewed_at, created_at

**milestone_evidence** (id SERIAL PK)
- milestone_id, farm_id, evidence_type, description, file_url, uploaded_by, created_at

**protocol_design_elements** (id SERIAL PK)
- protocol_id, farm_id, element_type (randomization|inclusion_exclusion|success_metric|stopping_rule|replication_plan), content JSONB, created_at, updated_at

**dmp_templates** (id SERIAL PK)
- farm_id, template_name, grant_type, sections JSONB, created_at

**dmp_change_log** (id SERIAL PK)
- dmp_id, farm_id, changed_by, field_changed, old_value, new_value, reason, created_at

**data_dictionary_entries** (id SERIAL PK)
- farm_id, study_id, variable_name, description, data_type, unit, allowed_values JSONB, source, collection_method, created_at, updated_at

**metadata_registry** (id SERIAL PK)
- farm_id, study_id, schema_name, schema_version, schema_definition JSONB, standard (Dublin_Core|DataCite|custom), created_at

**budget_contributions** (id SERIAL PK)
- budget_id, farm_id, contributor_type (cash|in_kind), contributor_name, institution, amount, description, confirmed, confirmed_at, created_at

**event_markers** (id SERIAL PK)
- farm_id, study_id, dataset_id, marker_type (anomaly|phase_change|intervention|note), timestamp, title, description, created_by, created_at

**batch_traceability** (id SERIAL PK)
- farm_id, study_id, batch_id, event_type (seeded|transplanted|harvested|tested|shipped), timestamp, location, details JSONB, previous_batch_id, created_at

**data_quality_alerts** (id SERIAL PK)
- farm_id, dataset_id, variable_name, alert_type (missing|outlier|drift|gap), severity (low|medium|high), message, detected_at, resolved, resolved_at

### 8.13 Research Platform (Phase 2)

**grant_applications** (id SERIAL PK)
- farm_id, study_id, title, funding_agency (NSERC|CIHR|SSHRC|CFI|MITACS|provincial|internal|other), program, amount_requested, amount_awarded, currency, pi_name, pi_institution, co_investigators JSONB, grant_number, start_date, end_date, status (draft|submitted|under_review|awarded|active|completed|declined|withdrawn|suspended|terminated), created_at, updated_at

**grant_reports** (id SERIAL PK)
- grant_id, farm_id, report_type (progress|financial|annual|final|interim), title, content, period_start, period_end, status (draft|submitted|accepted|revision_required), submitted_at, created_at, updated_at

**grant_publications** (id SERIAL PK)
- grant_id, farm_id, publication_type (journal_article|conference_paper|thesis|technical_report|book_chapter|preprint|dataset), title, authors JSONB, journal_or_venue, doi, year, status (draft|submitted|accepted|published), acknowledgment_text, created_at, updated_at

**grant_milestones** (id SERIAL PK)
- grant_id, farm_id, title, description, due_date, completed_date, status (pending|in_progress|completed|overdue), created_at, updated_at

**grant_extensions** (id SERIAL PK)
- grant_id, farm_id, extension_type, reason, original_end_date, new_end_date, status (requested|approved|denied), requested_at, decided_at, created_at

**grant_amendments** (id SERIAL PK)
- grant_id, farm_id, amendment_type, description, amount_change, justification, status (draft|submitted|approved|denied), submitted_at, decided_at, created_at, updated_at

**ethics_applications** (id SERIAL PK)
- farm_id, study_id, protocol_title, protocol_number, ethics_type (human_ethics|animal_ethics|biosafety|environmental|dual_use), risk_level (minimal|low|medium|high), involves_humans, involves_animals, involves_biohazards, reb_name, submission_date, decision_date, expiry_date, conditions JSONB, status (draft|submitted|under_review|approved|approved_with_conditions|revisions_required|declined), created_at, updated_at

**ethics_amendments** (id SERIAL PK)
- ethics_id, farm_id, amendment_type, description, submitted_at, status (submitted|approved|denied), decided_at, created_at

**ethics_renewals** (id SERIAL PK)
- ethics_id, farm_id, renewal_year, submitted_at, new_expiry_date, status (submitted|approved|denied), decided_at, changes_description, created_at

**biosafety_protocols** (id SERIAL PK)
- farm_id, study_id, protocol_title, containment_level (1|2|3|4), agents JSONB, risk_assessment JSONB, ppe_requirements JSONB, waste_procedures JSONB, emergency_procedures, status (draft|active|expired|revoked), approved_date, expiry_date, created_at, updated_at

**trainee_records** (id SERIAL PK)
- farm_id, study_id, grant_id, name, email, institution, department, trainee_type (undergraduate|masters|phd|postdoc|research_associate|technician|visiting_scholar|co_op|intern), program, supervisor_name, start_date, expected_end_date, actual_end_date, status (active|completed|withdrawn|on_leave), outcome, created_at, updated_at

**supervision_meetings** (id SERIAL PK)
- trainee_id, farm_id, meeting_date, attendees JSONB, agenda, notes, action_items JSONB, next_meeting_date, created_at

**trainee_milestones** (id SERIAL PK)
- trainee_id, farm_id, milestone_type (comprehensive_exam|thesis_proposal|thesis_defense|publication|conference_presentation|progress_report|coursework_complete|ethics_training|safety_training), title, description, due_date, completed_date, status (pending|in_progress|completed|overdue), created_at, updated_at

**professional_development** (id SERIAL PK)
- trainee_id, farm_id, activity_type, title, description, activity_date, hours, provider, certificate_url, created_at

**edi_self_identification** (id SERIAL PK)
- farm_id, category (gender|indigenous|visible_minority|disability|prefer_not_to_say), response, created_at

**partner_institutions** (id SERIAL PK)
- farm_id, name, partner_type (university|college|research_institute|government|industry|hospital|ngo|international), country, province_state, address, website, notes, status (active|inactive), created_at, updated_at

**data_sharing_agreements** (id SERIAL PK)
- partner_id, farm_id, agreement_type (data_sharing|material_transfer|collaboration|non_disclosure|intellectual_property|service), title, description, data_types JSONB, access_level, start_date, end_date, terms JSONB, signed_date, signed_by, status (draft|submitted|under_review|approved|revisions_required|rejected|active|expired|terminated|renewed|withdrawn|cancelled), created_at, updated_at

**partner_contacts** (id SERIAL PK)
- partner_id, farm_id, name, email, role, department, phone, created_at, updated_at

**data_classifications** (id SERIAL PK)
- farm_id, resource_type, resource_id, classification_level (public|internal|confidential|restricted), justification, handling_instructions, retention_period_days, created_at, updated_at

**access_control_policies** (id SERIAL PK)
- farm_id, name, description, classification_level, allowed_roles JSONB, requires_mfa, requires_vpn, max_export_rows, ip_restrictions JSONB, created_at, updated_at

**security_incidents** (id SERIAL PK)
- farm_id, incident_type, severity (low|medium|high|critical), title, description, affected_resources JSONB, reported_by, containment_actions JSONB, root_cause, remediation_steps JSONB, lessons_learned, status (reported|investigating|contained|escalated|remediating|resolved|dismissed|closed), reported_at, resolved_at, created_at, updated_at

**security_audits** (id SERIAL PK)
- farm_id, audit_type, scope, findings JSONB, recommendations JSONB, auditor, audit_date, next_audit_date, created_at


### 8.14 Research Platform (Phase 3)

**publications** (id SERIAL PK)
- farm_id, study_id, title, publication_type (journal_article|conference_paper|thesis|technical_report|book_chapter|preprint|dataset|poster|workshop_paper), authors JSONB, journal_or_venue, doi, url, volume, issue, pages, publisher, publication_year, abstract, keywords JSONB, status (draft|submitted|in_review|revision|accepted|published|retracted), submitted_at, accepted_at, published_at, created_at, updated_at

**publication_grants** (id SERIAL PK)
- publication_id, grant_id, farm_id, acknowledgment_text, is_primary, created_at

**publication_datasets** (id SERIAL PK)
- publication_id, dataset_id, farm_id, relationship (source_data|supplementary|derived|referenced), description, created_at

**publication_authors** (id SERIAL PK)
- publication_id, farm_id, author_name, email, inst- publication_id, farm_id, author_name, email, inst_au- publication_id, farm_id, author_name, email, inst- publication_id, farm_it** (id SERIAL PK)
- farm_id, name, description, category, manufacturer, model, serial_number, location, purchase_date, purchase_cost, warranty_expiry, maintenance_interval_days, status (available|in_use|maintenance|calibration|retired|out_of_service), specifications JSONB, created_at, updated_at

**equipment_bookings** (id SERIAL PK)
- equipment_id, farm_id, booked_by, purpose, study_id, start_time, end_time, status (pending|confirmed|cancelled|completed|no_show), notes, created_at, updated_at

**equipment_maintenance** (id SERIAL PK)
- equipment_id, farm_id, maintenance_type (preventive|corrective|calibration|inspection|cleaning), description, performed_by, performed_at, next_due_date, cost, parts_replaced JSONB, notes, created_at

**research_deadlines** (id SERIAL PK)
- farm_id, study_id, grant_id, title, description, deadline_type (grant_report|ethics_renewal|milestone|deliverable|conference|publication|review|regulatory|custom), due_date, priority (low|normal|high|critical), status (upcoming|pending|overdue|completed|cancelled|deferred), assigned_to, reminder_days_before, auto_generated, source_entity_type, source_entity_id, completed_at, created_at, updated_at

**deadline_tasks** (id SERIAL PK)
- deadline_id, farm_id, title, description, assigned_to, due_date, status (pending|in_progress|completed|cancelled), completed_at, created_at, updated_at

**report_templates** (id SERIAL PK)
- farm_id, name, description, report_type (grant_annual|grant_final|study_closeout|compliance_summary|ethics_report|hqp_summary|equipment_utilization|custom), template_config JSONB, schedule_cron, last_generated_at, status (active|disabled), created_at, updated_at

**generated_reports** (id SERIAL PK)
- template_id, farm_id, title, report_data JSONB, format (json|pdf|csv|html), generated_at, generated_by, created_at

**dataset_lineage** (id SERIAL PK)
- farm_id, dataset_id, event_type (created|imported|transformed|derived|merged|split|filtered|cleaned|anonymized|exported|archived|deleted|versioned), description, actor, source_datasets JSONB, parameters JSONB, parent_lineage_id, created_at

**data_annotations** (id SERIAL PK)
- farm_id, dataset_id, annotation_type (quality_note|classification|retention|processing_note|access_restriction|compliance_tag|custom), content, author, metadata JSONB, created_at, updated_at

### 8.15 Research Platform (Phase 4 Audit Remediation)

**Security/Tenant Controls**
- Added `greenreach-central/middleware/feature-gate.js` and enforced `requireResearchTier()` in `greenreach-central/server.js` research auth chain.
- Research routes now require both auth and tier gate: `authMiddleware -> requireResearchTier() -> route handler`.
- Tier gate supports env controls: `RESEARCH_TIER_ENABLED=*` (all farms) or `RESEARCH_TIER_FARMS=farm1,farm2`, with DB fallback at `farms.settings.features.research_enabled`.

**Input Safety & IDOR Remediation**
- Removed `req.body.farm_id` fallback across research write endpoints; farm scope now derives from authenticated context (`req.farmId`) only.
- Standardized pagination bounds on research list endpoints: default limit 20, max limit 100, offset >= 0.
- Added validation guards for:
  - `retention_period_years` (integer 1-100)
  - `indirect_rate` (0-100)
  - text fields (title/comment/description/justification/content) with max lengths in high-volume write endpoints.

**Data Query Performance**
- Replaced correlated subquery count patterns (N+1-style) with `LEFT JOIN + GROUP BY` aggregations in:
  - `routes/research-studies.js` list endpoint (protocol/link counts)
  - `routes/research-data.js` dataset list endpoint (observation count)

**ELN Signature Hardening**
- ELN signature hash now includes cryptographic nonce per signature event.
- Stored signature format: `nonce.hash` in `eln_signatures.signature_hash`.

**Admin Navigation**
- Added Research Workspace link in LE admin sidebar (`/views/research-workspace.html`) and mirrored in both deploy-target public directories.

**Post-Remediation Hotfix (Mar 29, 2026)**
- Fixed ELN snapshot endpoint runtime bug by removing an invalid `storedHash` reference in snapshot creation flow.
- De-duplicated Research Workspace sidebar link so LE admin shows a single canonical entry under the Research section.
- Repaired Research Workspace UI workflow API paths (`/dmp`, `/deadlines/upcoming`, `/deadlines/alerts`) to match backend routes.
- Re-synchronized `public/views/research-workspace.html` and `greenreach-central/public/views/research-workspace.html` to keep LE/Central page behavior consistent.

**Architecture Clarification (Mar 30, 2026)**
- G.W.E.N. and farm-facing Research Workspace are Light Engine features.
- GreenReach Central is the admin/hub system and should keep research APIs + admin intelligence, not farm-facing research UI hosting.
- Central requests to `/views/research-workspace.html` and `/gwen-core.html` should redirect to LE.

---

## 9. Authentication Architecture

### 9.1 Three Authentication Systems

| System | Mechanism | Token Expiry | Storage | Used By |
|--------|-----------|------------|---------|---------|
| Farm User Auth | JWT (Bearer token) | 24 hours | localStorage.token or sessionStorage.token | Farm dashboards, E.V.I.E. |
| Admin Auth | JWT (Bearer token) | 12 hours | localStorage.admin_token | Central admin, F.A.Y.E. |
| Farm-to-Central Sync | API Key (X-API-Key header) | No expiry | config/edge-config.json | sync-service.js |

### 9.2 Farm Auth Details

**Login**: POST /api/auth/login { farm_id, email, password }
**DB Table**: farm_users (bcrypt password hashing)
**JWT Payload**: { farm_id, user_id, role, email }
**JWT Secret**: process.env.JWT_SECRET (AWS Secrets Manager)
**Roles**: admin, manager, operator, viewer

**Browser Contract**: UI pages MUST:
1. Read JWT from BOTH sessionStorage AND localStorage
2. Send Authorization: Bearer <token>
3. Send x-farm-id header when available

### 9.3 Admin Auth Details

**Login**: POST /api/admin/auth/login { email, password }
**DB Table**: admin_users (bcrypt, with MFA support, lockout after failed attempts)
**JWT Payload**: { adminId, email, role, name }
**Roles**: viewer, editor, admin
**Session Table**: admin_sessions (auto-cleaned every 30 min)

### 9.4 Sync Auth Details

**Mechanism**: API key in X-API-Key + farm ID in X-Farm-ID header
**Key Source (farm)**: config/edge-config.json apiKey field
**Key Validation (Central)**: PostgreSQL farms table, then config/farm-api-keys.json fallback
**Used By**: sync-service.js, any LE -> Central communication

### 9.5 Central-to-LE Proxy Auth

**Mechanism**: X-Farm-ID + X-API-Key (uses GREENREACH_API_KEY env var)
**Used By**: Central /env endpoint when falling back to LE proxy

### 9.6 Farm Context Extraction (Central, Priority Order)

1. JWT token from Authorization: Bearer <token>
2. X-Farm-ID header (API key method)
3. Subdomain slug from Host header (SaaS cloud mode) -> resolves to farm_id via DB
4. Env default: FARM_ID env var (single-farm mode)

### 9.7 Row-Level Security (RLS) -- Phase A (March 2026)

PostgreSQL RLS is enabled on 19 tenant-scoped tables via Migration 040 in `greenreach-central/config/database.js`.

**Policy**: `gr_tenant_isolation` per table
**Mechanism**: `current_setting('app.current_farm_id', true)` matched against `farm_id::text`
**Admin bypass**: `current_setting('app.is_admin', true) = 'true'`
**Phase**: ENABLE only (table owner bypasses). Phase B will add FORCE.

| Table | Has farm_id | RLS Enabled | Policy |
|-------|------------|-------------|--------|
| farms | Yes | Yes | gr_tenant_isolation |
| farm_backups | Yes | Yes | gr_tenant_isolation |
| farm_data | Yes | Yes | gr_tenant_isolation |
| farm_heartbeats | Yes | Yes | gr_tenant_isolation |
| planting_assignments | Yes | Yes | gr_tenant_isolation |
| experiment_records | Yes | Yes | gr_tenant_isolation |
| products | Yes | Yes | gr_tenant_isolation |
| farm_inventory | Yes | Yes | gr_tenant_isolation |
| farm_users | Yes | Yes | gr_tenant_isolation |
| farm_delivery_settings | Yes | Yes | gr_tenant_isolation |
| farm_delivery_windows | Yes | Yes | gr_tenant_isolation |
| farm_delivery_zones | Yes | Yes | gr_tenant_isolation |
| delivery_orders | Yes | Yes | gr_tenant_isolation |
| farm_alerts | Yes | Yes | gr_tenant_isolation |
| conversation_history | Yes | Yes | gr_tenant_isolation |
| harvest_events | Yes | Yes | gr_tenant_isolation |
| lot_records | Yes | Yes | gr_tenant_isolation |
| producer_accounts | Yes | Yes | gr_tenant_isolation |
| producer_applications | Yes | Yes | gr_tenant_isolation |

**Query wrapper** (`greenreach-central/config/database.js`):
```js
// Standard farm-scoped query
await query(sql, [farmId], { farmId });

// Admin cross-farm query
await query(sql, params, { isAdmin: true });

// Migration/schema query (no tenant context)
await query(sql, params, { skipTenantContext: true });
```

The wrapper calls `set_config('app.current_farm_id', ...)` and `set_config('app.is_admin', ...)` on each acquired client, then resets both in a `finally` block before releasing.

**Fail-closed endpoints** (hardened in Phase A):
- `/api/ai/status` -- returns 401 if no farm context (was: unscoped fallback)
- `/api/network/benchmarking` -- returns 403 if not admin (cross-farm data)
- `/api/network/trends` -- returns 401 if no farm context (was: unscoped fallback)

### 9.8 Client-Side Tenant Isolation (March 2026)

On login and token expiry, all farm-scoped browser storage keys are cleared.

**Functions**:
- `clearStaleFarmData()` in `farm-admin.js` -- on login success
- `clearFarmStorage()` in `auth-guard.js` -- on all 5 expiry/invalid paths

**Cleared keys**: farm_id, farmId, farm_name, farmName, email, token, auth_token, farm_admin_session, gr.farm, farmSettings, qualityStandards, setup_completed, ai_pricing_recommendations, ai_pricing_last_check, ai_pricing_history, pricing_version, usd_to_cad_rate, impersonation_token, impersonation_farm, impersonation_expires, adminFarmId, plus dynamic `pricing_<crop>` keys.

---

## 10. Data Files and Configuration

### 10.1 Root public/data/ (47 files)

| File | Purpose | Key Fields |
|------|---------|------------|
| farm.json | Farm profile | farmId, name, timezone, address, taxRate, currency, integrations.switchbot |
| iot-devices.json | IoT device registry | Array of 5 devices: id, name, type, brand, protocol, zone, telemetry, credentials |
| groups.json | Growing groups | groups[]: id, name, room, zone, roomId, zoneId, trays, plants, lights[] |
| rooms.json | Room definitions | rooms[]: id, name, type, zones[] |
| schedules.json | Light/automation schedules | Per-group schedule data |
| crop-registry.json | Crop database | All crop definitions |
| recipes-environmental-targets.json | Growing recipes | Environmental parameters |
| lighting-recipes.json | Lighting recipes | Spectrum, intensity, duration |
| harvest-log.json | Harvest records | Date, crop, weight, quality |
| farms.json | Farm list | All registered farms |
| controller.json | Controller config | Hardware controller settings |
| equipment.catalog.json | Equipment database | Available equipment |
| device-manufacturers.json | Device manufacturers | Supported manufacturers |
| equipment-metadata.json | Equipment metadata | Specifications |
| farm-api-keys.json | API keys | Farm authentication keys |
| wholesale-products.json | Wholesale catalog | Products for sale |
| wholesale-orders-status.json | Order statuses | Current order states |
| wholesale-deductions.json | Deductions | Fee/deduction records |
| wholesale-reservations.json | Reservations | Inventory reservations |
| procurement-catalog.json | Supply catalog | Available supplies |
| procurement-orders.json | Supply orders | Purchase orders |
| procurement-suppliers.json | Suppliers | Supplier directory |
| nutrient-dashboard.json | Nutrient data | Dosing/consumption |
| nutrient-profiles.json | Nutrient profiles | Recipe profiles |
| demand-succession-suggestions.json | Demand forecast | Next crop suggestions |
| system-alerts.json | System alerts | Active alert list |
| agent-audit-log.json | AI agent log | Agent decision history |
| ai-recommendations.json | AI recommendations | ML suggestions |
| spd-library.json | Spectral power distribution | LED profiles |
| field-mappings.json | Field definitions | Growing area maps |
| network-recipe-modifiers.json | Network modifiers | Cross-farm recipe adjustments |
| target-ranges.json | Target ranges | Environmental targets |
| rooms-metadata.json | Room metadata | Extended room info |
| ml-insights/ | ML model outputs | Forecasts, anomalies |
| ml-models/ | ML model files | Trained models |

### 10.2 config/ Directory

| File | Purpose |
|------|---------|
| edge-config.json | Farm ID, API key, Central URL, sync settings |
| edge-config.production.json | Production overrides |
| database.js | PostgreSQL pool + migration system (migrations 001-040, RLS tenant context wrapper) |
| automation-templates.json | Seedable automation rules |
| channel-scale.json | Channel/facility config |
| demo-license.json | Demo mode flags |
| growth-stages.json | Crop lifecycle stages |
| farms/ | Farm credentials directory |
| buyers/ | Wholesale buyer profiles |
| nginx/ | Nginx proxy config |
| greenreach-firebase.json | Firebase service account |
| greenreach-private.pem | RSA private key |
| greenreach-public.pem | RSA public key |

### 10.3 Environment Variables -- Complete Reference

#### Core Server
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| NODE_ENV | development | Both | No |
| PORT | 8091 (LE), 3000 (Central) | Both | No |
| DEMO_MODE | false | LE | No |

#### Database
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| DB_HOST | 10.87.0.2 | Both | Yes (prod) |
| DB_PORT | 5432 | Both | No |
| DB_NAME | greenreach_central | Both | Yes |
| DB_USER | postgres | Both | Yes |
| DB_PASSWORD | (Secret Manager: ALLOYDB_PASSWORD) | Both | Yes |
| DATABASE_URL | (none) | Central (legacy compat) | Auto-constructed |

#### Authentication
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| JWT_SECRET | (Secret Manager) | Both | Yes (prod) |
| GREENREACH_API_KEY | (Secret Manager) | Both | Yes |
| TOKEN_ENCRYPTION_KEY | (Secret Manager) | LE | Yes |

#### SwitchBot (CRITICAL)
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| SWITCHBOT_TOKEN | (Secret Manager) | LE | YES -- sensors halt silently if missing |
| SWITCHBOT_SECRET | (Secret Manager) | LE | YES -- sensors halt silently if missing |

#### Central Connection
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| FARM_EDGE_URL | `https://light-engine-1029387937866.us-east1.run.app` | Central | No |
| FARM_ID | FARM-MLTP9LVH-B0B85039 | Both | Yes |

#### Payments (See `.github/PAYMENT_WORKFLOW.md`)
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| SQUARE_APP_ID | (none) | Central | For OAuth |
| SQUARE_APP_SECRET | (Secret Manager) | Central | For OAuth |
| SQUARE_ACCESS_TOKEN | (Secret Manager) | Both | For payments |
| SQUARE_ENVIRONMENT | production | Both | Yes |
| SQUARE_LOCATION_ID | (none) | Central | For direct-charge |
| SQUARE_WEBHOOK_SIGNATURE_KEY | (Secret Manager) | Central | For webhooks |
| WHOLESALE_COMMISSION_RATE | 0.12 | Central | No |
| WHOLESALE_DEFAULT_SKU_FACTOR | 0.65 | Central | No |

#### AI
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| OPENAI_API_KEY | (Secret Manager) | Both | For AI features |
| OPENAI_MODEL | gpt-4o-mini | LE | No |
| ANTHROPIC_API_KEY | (Secret Manager) | Central | EVIE fallback |

#### Notifications (Google Workspace SMTP -- no AWS)
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| SMTP_HOST | smtp.gmail.com | Central | For email |
| SMTP_PORT | 587 | Central | For email |
| SMTP_USER | info@greenreachgreens.com | Central | For email |
| SMTP_PASS | (Secret Manager) | Central | For email (Google App Password) |
| FROM_EMAIL | info@greenreachgreens.com | Central | For email |
| ADMIN_ALERT_EMAIL | info@greenreachgreens.com | Central | For alerts |
| ADMIN_ALERT_PHONE | (not set) | Central | For SMS alerts |

#### GCS Storage
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| USE_GCS | true | Both | On Cloud Run |
| GCS_BUCKET | greenreach-storage | Both | On Cloud Run |

---

## 11. External Service Integrations

| Service | Env Vars | Purpose | Server |
|---------|----------|---------|--------|
| SwitchBot Cloud API | SWITCHBOT_TOKEN, SWITCHBOT_SECRET | Sensor data polling | LE |
| Square Payments (Wholesale) | SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID | Wholesale marketplace (12% commission via app_fee_money). See PAYMENT_WORKFLOW.md | Central |
| Square OAuth (Per-Farm) | SQUARE_APP_ID, SQUARE_APP_SECRET | Per-farm Square OAuth. Route: /api/farm/square/*. OAuth via standalone payment-setup.html | Central |
| Square Webhooks | SQUARE_WEBHOOK_SIGNATURE_KEY | Payment/refund status updates. Route: /api/webhooks/square | Central |
| Stripe Webhooks | STRIPE_WEBHOOK_SECRET | Payment status updates. Route: /api/webhooks/stripe | Central |
| Google Workspace SMTP | SMTP_HOST, SMTP_USER, SMTP_PASS | Email delivery (info@greenreachgreens.com) | Central |
| Email-to-SMS Gateway | (via SMTP) | Critical alert SMS via carrier gateways | Central |
| OpenAI (GPT-4) | OPENAI_API_KEY | AI insights, recipe recommendations | Both |
| Anthropic (Claude) | ANTHROPIC_API_KEY | EVIE fallback LLM | Central |
| Google Cloud Storage | USE_GCS, GCS_BUCKET | Persistent file storage (greenreach-storage bucket) | Both |
| Google Secret Manager | (auto via IAM) | Credentials storage | Both |
| AlloyDB | DB_HOST, DB_PASSWORD | PostgreSQL-compatible database (10.87.0.2) | Both |
| Firebase | greenreach-firebase.json | Push notifications | Both |
| IFTTT | IFTTT_KEY, IFTTT_WEBHOOK_KEY | Webhook automations | LE |
| TP-Link Kasa | KASA_EMAIL, KASA_PASSWORD | Smart plug control | LE |
| Shelly | LAN-based | Smart plug control | LE |
| MQTT Broker | NUTRIENT_MQTT_URL | Nutrient controller | LE |
| GitHub Billing | GITHUB_TOKEN, GITHUB_ORG | GitHub costs accounting | Central |

---

## 12. Cross-System Dependency Map

### 12.1 File Change Impact Matrix

When you change a file, here is what else is affected:

| File Changed | Also Affects | Deploy Required |
|--------------|-------------|-----------------|
| server-foxtrot.js | All LE routes, automation, sensors | LE only |
| greenreach-central/server.js | All Central routes, farmStore, auth | Central + LE (AI routes imported) |
| greenreach-central/routes/*.js | Central API behavior | Central only |
| greenreach-central/public/*.html | Central UI | Central only |
| greenreach-central/public/views/*.html | Dashboard views | Central only |
| greenreach-central/public/js/*.js | Client-side behavior | Central only |
| greenreach-central/public/css/*.css | Styling | Central only |
| public/*.html | LE UI | LE only |
| public/data/*.json | LE data (NOT synced to Central) | LE only |
| greenreach-central/public/data/*.json | Central data (NOT synced to LE) | Central only |
| config/edge-config.json | Farm identity, sync auth | LE only |
| automation/*.js | Sensor processing, rules | LE only |
| lib/*.js | Shared utilities | Depends on which server imports it |
| routes/*.js (root) | LE API behavior | LE only |
| greenreach-central/middleware/*.js | Central request processing | Central only |
| greenreach-central/lib/*.js | Central utilities | Central only |
| greenreach-central/services/*.js | Central background services | Central only |

### 12.2 Critical Cross-Server Dependencies

| Dependency | Direction | Mechanism |
|------------|-----------|-----------|
| Telemetry sync | LE -> Central | POST /api/sync/telemetry (every 30s) |
| Farm data sync | Central <- LE | Pull every 5 min via farmStore sync |
| E.V.I.E. chat API | LE -> Central | Proxy via server-foxtrot.js |
| F.A.Y.E. admin API | LE -> Central | Import greenreach-central/routes/admin-assistant.js |
| Ops Agent API | LE -> Central | Import greenreach-central/routes/admin-ops-agent.js |
| Assistant Chat API | LE -> Central | Import greenreach-central/routes/assistant-chat.js |
| Static files | Central serves | greenreach-central/public/ |
| Static files | LE serves | root public/ |
| E.V.I.E. files | BOTH | Must exist in both public/ directories |

### 12.3 Page-to-API Dependency Map

| Page | API Endpoints Used |
|------|-------------------|
| farm-summary.html | GET /env, GET /api/weather, GET /api/health/vitality |
| farm-inventory.html | GET /api/inventory/*, POST /api/inventory/*, GET /api/traceability |
| GR-central-admin.html | GET /api/admin/farms, /users, /network/*, /growers/*, /contracts/* |
| LE-farm-admin.html | GET /api/traceability, /inventory/*, /sustainability/* |
| GR-wholesale.html | GET /api/wholesale/catalog, POST /api/wholesale/checkout |
| LE-wholesale-orders.html | GET /api/wholesale/orders/*, POST /api/wholesale/orders/:id/fulfill |
| iot-manager.html | GET /api/switchbot/devices, /api/kasa/devices, POST /discovery/scan |
| room-mapper.html | GET /api/rooms, POST /api/setup/save-rooms |
| planting-scheduler.html | GET /api/planting/*, POST /api/planting/* |
| nutrient-management.html | MQTT topics, GET /api/automation/*, nutrient endpoints |
| crop-weight-analytics.html | GET /api/crop-weights/*, /api/harvest/* |
| grant-wizard.html | GET /api/grant-wizard/*, POST /api/grant-wizard/* |
| setup-wizard.html | GET /api/setup-wizard/status, POST /api/setup-wizard/* |

---

## 13. Error Log -- Known Issues for Correction

### 13.1 HIGH PRIORITY

#### E-001: Device Status Fallback Bug
- **Files**: server-foxtrot.js (lines 15680, 17440), greenreach-central/public/central-admin.js (line 4563)
- **Pattern**: `status = device.status || 'offline'`
- **Problem**: Incorrectly defaults all devices without explicit status to 'offline', ignoring telemetry.online and lastSeen timestamps
- **Fix**: Use derivation chain: explicit status -> telemetry.online/deviceData.online -> last-seen recency (< 5 minutes = online)
- **Impact**: Devices shown as offline when they are actually online

#### E-002: Hardcoded Farm ID in farm-admin.js
- **Files**: public/farm-admin.js (line 3630), greenreach-central/public/farm-admin.js (line 3841)
- **Pattern**: `farmId: 'FARM-001'` (hardcoded fallback)
- **Problem**: In multi-farm deployments, this sends the wrong farm ID
- **Fix**: Read farm_id from sessionStorage/localStorage, fall back to env var
- **Impact**: Data loaded for wrong farm in multi-farm scenarios

#### E-003: Stale Sensor Data with Fresh Timestamps
- **File**: automation/env-store.js, server-foxtrot.js (setupLiveSensorSync)
- **Problem**: When SWITCHBOT_TOKEN/SECRET are missing, sensor polling silently skips. EnvStore serves stale values from env-state.json with fresh observedAt timestamps.
- **Fix**: EnvStore should not update observedAt if no new reading was received. Add explicit staleness warning when no fresh data arrives.
- **Impact**: Dashboard shows "normal" data that is actually hours/days old

#### E-004: Sandbox Square Credentials in .ebextensions Backup
- **File**: .ebextensions.backup/environment.config
- **Pattern**: `SQUARE_ENVIRONMENT: sandbox` with sandbox application ID and access token
- **Problem**: If these backup configs are ever restored to production, payments would fail
- **Fix**: Remove sandbox credentials from the backup file or clearly mark as non-production
- **Impact**: Potential payment processing failure if backup is restored

### 13.2 MEDIUM PRIORITY

#### E-005: Incomplete TODO Items (12 across codebase)
- server-foxtrot.js:6871 -- Store config save when storefront columns added
- server-foxtrot.js:7075 -- Implement error tracking (recentErrors array)
- server-foxtrot.js:7885 -- Connect to actual nutrient dosing logs
- server-foxtrot.js:13389-13433 -- Implement with database and authentication (4 similar)
- server-foxtrot.js:15533-15536 -- Calculate totalTrays, totalPlants, totalEnergy24h, activeAlerts
- server-foxtrot.js:15795 -- Query actual alerts from farms
- server-foxtrot.js:19668 -- Implement production tray registration

#### E-006: Analytics Using Placeholder Data
- **Location**: server-foxtrot.js lines 15533-15536, 15795
- **Problem**: totalTrays, totalPlants, totalEnergy24h, activeAlerts return hardcoded/zero values
- **Impact**: Dashboard analytics cards show incorrect data

#### E-007: Missing Environment Variable Validation
- **Variables**: _STORE_ENABLED, CHECK_SYNC, FARM_EDGE_URL used without explicit validation
- **Impact**: Silent failures when these variables are expected but missing

### 13.3 LOW PRIORITY

#### E-008: Dual Public Directory Sync Risk
- **Problem**: E.V.I.E. files (evie-core.css, evie-presence.js, LE-farm-admin.html) must exist in BOTH public/ and greenreach-central/public/. No automated sync exists.
- **Impact**: File drift between directories causes inconsistent behavior between LE and Central

#### E-009: CORS Domain Typo
- **Files**: server-foxtrot.js, greenreach-central/server.js
- **Pattern**: `.urbanyeild.ca` -- note "yeild" (possible typo of "yield")
- **Impact**: If domain is actually "urbanyield.ca", CORS would fail for that domain

### 13.4 RESOLVED -- INVENTORY PIPELINE GAPS (fixed v1.2.0)

#### E-010: RESOLVED -- Harvest Now Creates farm_inventory Records
- **Status**: RESOLVED
- **Fix Applied**: (1) New POST /api/sync/harvest endpoint in greenreach-central/routes/sync.js receives harvest data and upserts into farm_inventory with actual weights. (2) New syncHarvest() method added to services/sync-service.js with queue/retry support. (3) server-foxtrot.js harvest endpoint (POST /api/tray-runs/:id/harvest) now calls getSyncService().syncHarvest() after successful harvest, sending crop, lot_code, actual_weight_oz, category, and variety to Central.

#### E-011: RESOLVED -- Recalculation Formula Now Preserves Sales
- **Status**: RESOLVED (partially -- theoretical vs actual harvest distinction is a future enhancement)
- **Fix Applied**: All quantity_available formulas in greenreach-central/routes/inventory.js (recalculate, sync, manual POST/PUT/DELETE) now use: quantity_available = auto_quantity_lbs + manual_quantity_lbs - sold_quantity_lbs. The sold_quantity_lbs column (Migration 025) tracks cumulative sales and is never overwritten by recalculation. Auto-inventory still uses theoretical capacity from groups, but harvest data now also flows in via syncHarvest (E-010 fix), and sales deductions persist across recalculations.

#### E-012: RESOLVED -- POS Sales Now Persist to farm_inventory
- **Status**: RESOLVED
- **Fix Applied**: (1) New POST /api/inventory/deduct endpoint in greenreach-central/routes/inventory.js increments sold_quantity_lbs and recalculates quantity_available atomically in PostgreSQL. (2) New syncDeduction() method in services/sync-service.js with queue/retry. (3) routes/farm-sales/inventory.js confirm handler now calls syncService.syncDeduction() after successful confirmation, sending product_id, quantity, reason='pos_sale', and order_id to Central.

#### E-013: RESOLVED -- Wholesale Confirmation Now Persists Deductions
- **Status**: RESOLVED
- **Fix Applied**: routes/wholesale-reservations.js confirm handler (POST /api/wholesale/confirm) now calls syncService.syncDeduction() when a reservation is confirmed (payment succeeded). Deduction includes sku_id, qty, reason='wholesale_sale', and sub_order_id. This converts the temporary TTL reservation into a permanent sold_quantity_lbs increment in farm_inventory. Deduction happens at payment confirmation, not fulfillment status change, ensuring inventory is reduced as soon as the sale is committed.

#### E-014: RESOLVED -- sold_quantity_lbs Column Prevents Overwrite
- **Status**: RESOLVED
- **Fix Applied**: (1) Migration 025 in greenreach-central/config/database.js adds sold_quantity_lbs DECIMAL(10,2) DEFAULT 0 and lot_code VARCHAR(255) columns. (2) ALL quantity_available formulas in inventory.js (recalculate ON CONFLICT, sync ON CONFLICT, manual POST ON CONFLICT, PUT manual, DELETE manual, GET available_lbs) now use: quantity_available = auto_quantity_lbs + manual_quantity_lbs - sold_quantity_lbs. (3) Recalculation only updates auto_quantity_lbs; sold_quantity_lbs is untouched, preserving sales history across sync cycles.

#### E-015: RESOLVED -- Reservation Availability Now Reads from Database
- **Status**: RESOLVED
- **Fix Applied**: getCatalogAvailableQty() in routes/wholesale-reservations.js now queries farm_inventory via PostgreSQL (req.app.locals.db) instead of reading wholesale-products.json. Falls back to the static JSON only if DB is unavailable. The static file remains as fallback/test data but is no longer the primary source for reservation availability checks.

### 13.5 RESOLVED -- PRICING AND ADMIN UI FIXES (v1.3.0)

#### E-016: AI Pricing Cannot Match Product to Pricing Table -- RESOLVED v1.3.0
- **File**: greenreach-central/public/farm-admin.js (applyRecommendedPrice function)
- **Problem**: When E.V.I.E. recommended a price for a product, applyRecommendedPrice() searched pricingData for a matching product_name. If no row existed, it showed "could not match product to table" error and did nothing.
- **Impact**: AI pricing recommendations were unusable for any product not already in the pricing table.
- **Fix Applied**: When no matching row exists, applyRecommendedPrice() now creates a new pricingData entry with default formula fields (sku_factor=0.65, cost_floor=0.00), then applies the recommendation and triggers syncPricingRow().

#### E-017: Wholesale Dashboard Shows No Products -- RESOLVED v1.3.0
- **File**: greenreach-central/routes/wholesale.js (GET /api/wholesale/catalog)
- **Problem**: buildAggregateCatalog() queries network farms for catalog data. For single-farm or new deployments, the aggregate returns empty, resulting in an empty wholesale dashboard even when farm_inventory has products.
- **Impact**: Wholesale buyers saw an empty catalog despite available inventory.
- **Fix Applied**: Added DB fallback -- when buildAggregateCatalog() returns empty, the endpoint queries farm_inventory directly (WHERE quantity_available > 0 AND available_for_wholesale = true) and formats rows into catalog shape.

#### E-018: Central Admin Inventory Shows Undefined Values -- RESOLVED v1.3.0
- **File**: greenreach-central/public/central-admin.js (loadFarmInventory function)
- **Problem**: loadFarmInventory() assumed the API response shape was data.inventory (array of product-style objects). When the API returned data.trays (tray-style objects with different field names), the function rendered undefined for product_name, quantity, category, and other fields.
- **Impact**: Active Inventory tab in Central Admin showed rows of "undefined" values.
- **Fix Applied**: loadFarmInventory() now prefers data.trays over data.inventory and maps both field name conventions (product_name/crop_type, quantity_available/current_count, category/crop_category) with a fallback chain.

#### E-019: Wholesale Price Not Auto-Computing on Retail Change -- RESOLVED v1.3.0
- **File**: greenreach-central/public/central-admin.js (syncPricingRow), greenreach-central/routes/admin-pricing.js (batch-update)
- **Problem**: When a retail price was changed in the pricing table, syncPricingRow() sent the update to the server but did not compute a new wholesale price. The batch-update endpoint used a hardcoded sku_factor of 0.70 regardless of the product's configured factor.
- **Impact**: Wholesale prices became stale when retail prices changed. All products used the same 0.70 factor instead of their per-product sku_factor (0.50-0.75).
- **Fix Applied**: syncPricingRow() now auto-computes wholesale = retail * 0.75 as a default when syncing. batch-update reads each product's sku_factor (clamped 0.50-0.75) and applies the formula: wholesale = max(cost_floor, retail * sku_factor).


#### E-020: POS Iframe Login Loop -- RESOLVED v1.4.0
- **File**: greenreach-central/public/farm-sales-pos.html, greenreach-central/public/farm-admin.js
- **Problem**: farm-sales-pos.html checked farm_token key in localStorage, but farm-admin.js sets token key. When loaded as iframe from LE-farm-admin, the POS page could not find the token and redirected to login in a loop.
- **Impact**: POS was unusable when embedded as iframe in LE-farm-admin.
- **Fix Applied**: Token fallback chain (checks both token and farm_token) plus embedded mode auto-login that inherits the admin session.

#### E-021: Square Wizard Popup Blocked -- RESOLVED v1.4.0, RECURRED + RESOLVED v1.8.0
- **File**: public/payment-setup.html (both copies)
- **Problem (v1.4.0)**: LE-dashboard payment wizard opened Square OAuth popups from inside an iframe. Browsers block popups from cross-origin iframes by default.
- **Fix (v1.4.0)**: Payment wizard removed from LE-dashboard. Replaced with standalone payment-setup.html page that handles Square OAuth directly (same-origin returnUrl, DOM API rendering).
- **Problem (v1.8.0)**: window.open(authUrl) called after await fetch() in startAuthorization(). Browsers only allow programmatic popups during synchronous user-gesture handlers. The await crosses the gesture boundary, causing the popup to be blocked.
- **Fix (v1.8.0)**: Pre-open the popup window synchronously (window.open('about:blank')) during the click event before any await, then navigate the already-opened window to the auth URL after the fetch returns. Fallback link buttons still shown if even the pre-open is blocked.


#### E-022: AI Pricing Assistant Per-Oz/Per-Lb Mismatch -- RESOLVED v10
- **File**: greenreach-central/public/farm-admin.js (normalizeMarketPriceForCrop, displayRecommendations, generateRecommendations, getCropBackendUnit, defaultPricing, cropGrowthParams)
- **Problem**: normalizeMarketPriceForCrop() divided package price by weight in oz to get a per-oz average, then returned it as marketAverageCAD. The UI displayed this value with a /lb label (via getCropUnitLabel). When a user clicked "Apply Recommended Price", a per-oz value was stored as if it were per-lb -- a 16x underpricing. defaultPricing used flat tier values ($23.52, $43.20, $25.12) instead of per-crop AI-computed values. getCropBackendUnit returned 'oz' but stored values were per-lb.
- **Impact**: All 108 crops had uniform placeholder prices (3 tiers) instead of AI-generated per-crop values. AI recommendations were 16x too low. Unit labels showed /oz and /25g instead of /lb and /100g.
- **Fix Applied**: (1) normalizeMarketPriceForCrop now multiplies per-oz by 16 to return per-lb values. (2) getCropBackendUnit returns 'lb' for weight crops. (3) defaultPricing replaced with AI-computed per-lb CAD values from Canadian retail market data (formula: pkg_price / pkg_weight_oz * 16 * 1.05 premium). (4) crop-pricing.json updated for all 108 crops. (5) cropGrowthParams retailPricePerLb updated. (6) PRICING_VERSION bumped to v10. (7) Display labels changed from /oz,/25g to /lb,/100g.
- **Price range**: $3.53/each (tomato) to $66.97/lb (French Tarragon). 16 unique price points across 108 crops.
- **Deploy**: Central only (ai-pricing-fix-perlb-20260327).


### 13.6 RESOLVED -- AI AGENT + DATA PERSISTENCE FIXES (v1.7.0)

#### E-023: RESOLVED -- E.V.I.E. LLM Failover (No Fallback Provider)
- **Status**: RESOLVED
- **File**: greenreach-central/routes/assistant-chat.js
- **Problem**: E.V.I.E. used GPT-4o-mini as sole LLM. Any OpenAI outage caused full AI assistant failure.
- **Fix Applied**: Added Anthropic (Claude Sonnet 4) as fallback LLM. chatWithAnthropicFallback() implements full tool-calling loop. Both /chat and /chat/stream catch blocks fall back to Anthropic on OpenAI failure. /status endpoint now reports llm.primary and llm.fallback availability.

#### E-024: RESOLVED -- F.A.Y.E. Auto-Recovery (Tool Execution Failures)
- **Status**: RESOLVED
- **File**: greenreach-central/routes/admin-assistant.js
- **Problem**: F.A.Y.E. tool execution failures (DB timeouts, connection drops) caused immediate error without retry.
- **Fix Applied**: attemptAdminAutoRecovery() with 3 strategies: DB retry (1s), connection retry (2s), constraint violation hinting. Wired into both chatWithClaude and chatWithOpenAI tool loops.

#### E-025: RESOLVED -- Heartbeat False Alerts (Data Source Mismatch)
- **Status**: RESOLVED
- **File**: greenreach-central/services/faye-intelligence.js, greenreach-central/routes/sync.js
- **Problem**: F.A.Y.E. intelligence checked farm_heartbeats table, but sync-service heartbeats only wrote to farms.last_heartbeat. farm_heartbeats was permanently stale, triggering false "farm offline" alerts. Query also returned all historical rows instead of latest per farm.
- **Fix Applied**: (1) faye-intelligence.js now queries farms table with GREATEST(farms.last_heartbeat, MAX(farm_heartbeats.last_seen_at)), one row per farm, filters inactive farms. (2) sync.js POST /api/sync/heartbeat now also inserts into farm_heartbeats. (3) Alert text removed "or hardware issues" (cloud-only architecture).

#### E-026: RESOLVED -- Farm Settings Lost on Restart (In-Memory Only)
- **Status**: RESOLVED
- **File**: greenreach-central/routes/farm-settings.js
- **Problem**: farmSettingsStore was a pure in-memory Map. Certifications, notification preferences, and display preferences were lost on EB restart with no recovery mechanism.
- **Fix Applied**: Added persistSettingsToDB() that writes to farm_data table (data_type='farm_settings') on every change. Added hydrateFarmSettings() that restores from DB on module load. 4 persist calls (certifications, ack, notify-preferences, display-preferences).

#### E-027: RESOLVED -- Custom Product Image Upload Broken (Field Name Mismatch)
- **Status**: RESOLVED
- **File**: greenreach-central/public/central-admin.js, greenreach-central/routes/custom-products.js
- **Problem**: Frontend sent image file with field name 'thumbnail' (formData.append('thumbnail', ...)) but backend multer expected field name 'image' (upload.single('image')). All image uploads silently failed with req.file being undefined.
- **Fix Applied**: Changed frontend to formData.append('image', thumbnailFile) to match backend expectation.

#### Pricing Formula Reference (v1.3.0)
- **Formula**: `wholesale_price = max(floor, retail_price * sku_factor)`
- **floor** = `max(cost_floor, manual_floor)` -- ensures wholesale never drops below production cost
- **sku_factor** = per-product multiplier, clamped to range 0.50 - 0.75 (default 0.75)
- **Implemented in**: admin-pricing.js (batch-update, set-wholesale), central-admin.js (syncPricingRow), farm-admin.js (applyRecommendedPrice)
- **Central admin-pricing.js**: Mounted at /api/admin/pricing in greenreach-central/server.js (v1.3.0)

#### Buyer Volume Discount Ladder (v1.4.0)
- Applied AFTER base wholesale price. Based on 30-day trailing spend.
- $0 - $249 cumulative: 0% discount (tier-1)
- $250 - $499: 4% discount (tier-2)
- $500 - $999: 6% discount (tier-3)
- $1,000 - $1,999: 8% discount (tier-4)
- $2,000+: 10% discount (tier-5)
- Example: Genovese Basil retails at $38.47/lb, SKU factor 0.75 -> base wholesale $28.85/lb. Buyer qualifies for 4% -> final $28.85 x 0.96 = $27.70/lb.
- **Single source of truth**: lib/wholesale/buyer-discount-service.js (DISCOUNT_TIERS array)
- **Wired into**: checkout.js (preview + execute), catalog.js (authenticated response), order-allocator.js (line item pricing)

---

## 16. AI Vision -- Network Intelligence Pipeline

**Phase Status** (March 27, 2026): Phase 1 COMPLETE, Phase 2 COMPLETE, Phase 3 COMPLETE, Phase 4 COMPLETE, Phase 5 COMPLETE (all 52 tasks). ALL AI VISION PHASES COMPLETE.
**Reference**: `.github/AI_VISION_RULES_AND_SKILLS.md` for full task list and phase gate rules.

### 16.1 Experiment Records Pipeline

```
LE Harvest Event
  -> server-foxtrot.js records experiment (crop, recipe, grow_days, environment, outcomes)
  -> sync-service.js POSTs to Central /api/sync/experiment-records (every 5 min)
  -> Central experiment-records.js ingests + deduplicates
  -> experiment_records table (PostgreSQL)
  -> crop_benchmarks table (nightly 2 AM aggregation via computeCropBenchmarks)
```

### 16.2 Central-to-Farm Intelligence Push

The `analyzeAndPushToAllFarms()` service runs every 30 minutes, pushing a `network_intelligence` payload:

| Key | Source | Description |
|-----|--------|-------------|
| crop_benchmarks | crop_benchmarks table | Per-crop avg/min/max yield, grow days, loss rate, temp, humidity, PPFD |
| demand_signals | wholesaleMemoryStore.js | Real wholesale order data aggregated per crop |
| recipe_modifiers | yield-regression.js | Cross-farm yield regression adjustments |
| risk_alerts | supply-demand-balancer.js | Harvest conflicts + supply gaps + adaptive loss alerts |
| environment_benchmarks | experiment_records (actual achieved) | Per-crop temp/humidity/PPFD/VPD/DLI/photoperiod min/max/avg |
| device_integrations | Device integration service | Protocol-specific integration recommendations |
| anomaly_correlations | anomaly-correlation.js | Cross-farm loss + env deviation patterns (weekly) |
| pricing_intelligence | market-analysis-agent.js | Market price trends + AI outlook |

### 16.3 Network Intelligence Routes (network-growers.js)

18 routes. All GET. Mounted at /api/ prefix by Central server.js.

| HTTP | Path | Description |
|------|------|-------------|
| GET | /api/network/dashboard | Network KPIs: total/active/offline farms, health, alerts, activity |
| GET | /api/network/farms/list | All farms with status, harvests, yield |
| GET | /api/network/farms/:farmId | Single farm detail |
| GET | /api/network/comparative-analytics | Per-farm yield, loss rate, grow days comparison |
| GET | /api/network/trends | Production trend (week/harvests/yield), demand, network growth |
| GET | /api/network/buyer-behavior | Buyer behavior + 3-tier churn classification |
| GET | /api/network/alerts | High loss rate + below benchmark alerts |
| GET | /api/network/anomaly-correlation | Cross-farm anomaly detection + environmental correlation |
| GET | /api/network/energy-benchmarks | Per-crop and per-farm energy efficiency (kWh/kg) rankings |
| GET | /api/network/farm-performance/:farmId | Per-farm weekly yield/loss trends, period comparison, network rank |
| GET | /api/network/performance-leaderboard | Network-wide ranking with consistency scores + trend direction |
| GET | /api/growers/dashboard | Grower management dashboard |
| GET | /api/growers/list | Grower details with performance |
| GET | /api/farms/list | Alias for farm listing |
| GET | /api/contracts/list | Contract listing |
| GET | /api/leaderboard | Composite scoring: yield 40% + loss 30% + consistency 30% |
| GET | /api/performance/:growerId | Per-grower rating, harvest count, yield, loss |
| GET | /api/invitations/list | Pending invitations |

### 16.4 Farm-Side Intelligence Consumption

- **farm-admin.js**: Fetches `/api/ai/network-intelligence`, renders benchmarks panel
- **LE-farm-admin.html**: Network Intelligence card with crop benchmarks, demand signals, risk alerts
- **Event bus**: `demand_signal_refresh` event triggers succession planting suggestions
- **Onboarding**: `/api/setup-wizard/seed-benchmarks` seeds initial benchmarks from Central

### 16.5 Phase 2 Workflow Automation

| Feature | Implementation |
|---------|---------------|
| Auto-derive plant count | trayFormatsDB lookup at seeding, sets plant_count_source: 'tray_format' |
| AI pre-fill crop | `/api/ai/suggested-crop` scores crops by zone, inventory gaps, demand signals |
| Combined seed + group | Single API call creates tray run + placement + date sync |
| Auto-print harvest labels | Server-side `/api/printer/print-harvest` + client triggerAutoHarvestLabelPrint() |
| Auto-derive photoperiod | Formula: hours = DLI * 1e6 / (PPFD * 3600), clamped [4,24] |
| Seed date sync to group | Seeding action syncs date + crop to group planConfig.anchor |
| Device auto-discovery | Multi-protocol scan (SwitchBot, network, MQTT) + auto-assign to zones |
| Demand signal aggregation | analyzeDemandPatterns() from real wholesale orders, pushed every 30 min |
| Onboarding benchmarks | /api/setup-wizard/seed-benchmarks fetches Central crop benchmarks |
| Environmental benchmark push | getEnvironmentBenchmarksForPush() aggregates actual achieved env data per crop |
| Network trends | Real PostgreSQL aggregations: production, demand, network growth per week |
| Buyer behavior + churn | 3-tier classification (active/at_risk/churned) from wholesale_orders |

### 16.6 Phase 3 Adaptive Intelligence + Central ML

| Feature | Implementation |
|---------|---------------|
| Per-crop recipe modifiers | Modifier engine computes farm-specific adjustments from experiment outcomes |
| Tier 2 adaptive control | HVAC learning curves with environment feedback optimization |
| LED aging detection | Lumen-depreciation tracking + replacement alerting |
| ML harvest date prediction | Grow-day regression on environment data (temp, humidity, PPFD) |
| Loss prediction | Environment trend deviations trigger proactive loss alerts |
| Quality trend analysis | AI vision quality scores blended into yield-quality composites |
| Cross-farm yield regression | yield-regression.js multi-variable regression, weekly retraining |
| Network recipe modifiers | Computed from yield regression, pushed via AI pusher |
| Cross-farm anomaly correlation | anomaly-correlation.js: loss + env deviations affecting 2+ farms, weekly job |
| Adaptive loss alerts | detectAdaptiveLossAlerts() in supply-demand-balancer.js: per-farm rolling baselines, z-score severity |
| Energy benchmarks | GET /network/energy-benchmarks with per-crop and per-farm kWh/kg rankings |
| Performance tracking | GET /network/farm-performance/:farmId (weekly trends) + GET /network/performance-leaderboard (network ranking) |

## 14. Category Quick Reference

### By Domain

| Category | Server | Key Files | Key Tables |
|----------|--------|-----------|------------|
| **Farm Management** | Central | routes/farms.js, routes/auth.js | farms, farm_users, farm_data |
| **Sensor Data** | LE | automation/env-store.js, lib/sync-service.js | farm_data (telemetry) |
| **Device Control** | LE | server-foxtrot.js (SwitchBot, Kasa, Shelly) | device_integrations |
| **Automation** | LE | automation/, lib/schedule-executor.js | (in-memory + file) |
| **Dashboard** | Central | views/farm-summary.html | farm_data |
| **Inventory** | Both | routes/inventory.js + inventory-mgmt.js (Central), farm-sales/inventory.js (LE), server-foxtrot.js tray routes | farm_inventory, products, farm_data (inventory_seeds/nutrients/packaging/equipment/supplies), tray-runs.db, tray-formats.db |
| **Wholesale** | Both | routes/wholesale*.js (LE), routes/wholesale.js (Central) | wholesale_buyers, wholesale_orders, payment_records |
| **Farm Sales** | LE | routes/farm-sales/*.js | products, farm_inventory |
| **Delivery** | Central | routes/admin-delivery.js | delivery_*, driver_* |
| **Accounting** | Central | routes/accounting.js | accounting_* |
| **Grant Wizard** | Central | routes/grant-wizard.js | grant_* |
| **Pricing** | Both | routes/crop-pricing.js, routes/admin-pricing.js | farm_cost_surveys, pricing_* |
| **Traceability** | Both | routes/traceability.js | lot_system |
| **Quality Control** | LE | routes/quality-control.js, routes/ai-vision.js | (via endpoints) |
| **ML/AI** | Both | routes/ml.js, lib/ml-*.js | experiment_records, crop_benchmarks |
| **Network** | Central | routes/network-growers.js | network_farms |
| **Admin** | Central | routes/admin.js, GR-central-admin.html | admin_users, admin_sessions, admin_audit_log |
| **AI Assistants** | Both | E.V.I.E. (farm), F.A.Y.E. (admin) | ai_decisions |

### By User Role

| Role | Pages | Capabilities |
|------|-------|-------------|
| **Farm Admin** | LE-farm-admin.html, farm-summary.html, all views/ | Full farm management, device control, inventory, sustainability |
| **Farm Manager** | LE-farm-admin.html (limited) | Inventory, scheduling, monitoring |
| **Farm Operator** | LE-farm-admin.html (limited) | View dashboards, record data |
| **Farm Viewer** | LE-farm-admin.html (read-only) | View dashboards only |
| **Central Admin** | GR-central-admin.html | Full platform management, farm oversight, user management |
| **Central Editor** | GR-central-admin.html (limited) | Farm management, recipe management |
| **Central Viewer** | GR-central-admin.html (read-only) | View dashboards only |
| **Wholesale Buyer** | GR-wholesale.html | Browse catalog, place orders, view history |
| **Grant Applicant** | grant-wizard.html | Apply for grants, manage applications |
| **Delivery Driver** | driver-enrollment.html | Enrollment, delivery tracking |

### Deploy Quick Reference

```bash
# Build and push (ALWAYS --platform linux/amd64 on Apple Silicon)
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

# Deploy Central ONLY
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest \
  --push ./greenreach-central/
gcloud run services update greenreach-central --region=us-east1 \
  --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest

# Deploy LE ONLY
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest \
  --push .
gcloud run services update light-engine --region=us-east1 \
  --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest

# Deploy BOTH (when changes span both)
# Deploy Central first, then LE
```

**BANNED**: ALL `eb` CLI commands. Platform migrated to Google Cloud Run (April 2026).

---

## 15. Complete Inventory Workflow

### 15.1 System Overview -- Two Inventory Domains

The platform has TWO fundamentally different inventory domains that serve different purposes:

| Domain | What It Tracks | Storage | Server | UI |
|--------|---------------|---------|--------|-----|
| **Supplies Inventory** | Seeds, packaging, nutrients, equipment, supplies (farm inputs) | farm_data JSONB (per-category keys) | Central | LE-farm-admin.html Inventory tab |
| **Crop/Product Inventory** | Harvested crops available for sale (farm outputs) | farm_inventory table (PostgreSQL) | Both | farm-inventory.html, wholesale catalog, POS |

These are separate systems. Supplies inventory is consumption tracking (inputs the farm uses). Crop inventory is what the farm produces and sells. This section maps both, with emphasis on how crop inventory flows from tray harvest to point of sale.

### 15.2 Tray-Based Inventory Lifecycle (Crop Outputs)

#### Phase 1: Tray Format Setup

**UI**: tray-setup.html Tab 1
**Server**: LE (server-foxtrot.js)
**Storage**: NeDB (trayFormatsDB -> ./data/tray-formats.db)

| API | Method | Purpose |
|-----|--------|---------|
| /api/tray-formats | GET | List all formats (8 defaults + custom) |
| /api/tray-formats | POST | Create custom format |
| /api/tray-formats/:id | PUT | Update custom format |
| /api/tray-formats/:id | DELETE | Delete format (blocked if trays using it) |

**TrayFormat Record**:
```
trayFormatId, name, plantSiteCount, isWeightBased,
targetWeightPerSite, weightUnit, systemType (soil/NFT/DWC/aeroponics/zipgrow),
trayMaterial (plastic/metal/tower), description, isCustom
```

#### Phase 2: Physical Tray Registration

**UI**: tray-setup.html Tab 2
**Server**: LE
**Storage**: NeDB (traysDB -> ./data/trays.db)

| API | Method | Purpose |
|-----|--------|---------|
| /api/trays/register | POST | Register physical tray (QR code -> format link) |
| /api/trays | GET | List all registered trays with status |

**Fields**: tray_id (QR code value), tray_format_id, created_at

#### Phase 3: Seeding (Tray Run)

**UI**: planting-scheduler.html or tray-inventory.html (Activity Hub)
**Server**: LE
**Storage**: NeDB (trayRunsDB -> ./data/tray-runs.db, trayPlacementsDB -> ./data/tray-placements.db)

| API | Method | Purpose |
|-----|--------|---------|
| /api/trays/:trayId/seed | POST | Create tray run (seeding event) |
| /api/tray-runs/:id/move | POST | Assign/move tray to group location |

**Seeding Input Fields**: recipe (crop), seedDate, plantCount (optional), seed_source, variety, position, groupId

**Plant Count Auto-Derivation** (priority order):
1. Explicit plantCount in request -> source: "manual"
2. trayFormat.plantSiteCount from trayFormatsDB -> source: "tray_format"
3. Null if neither available

**Target Weight Estimation** (priority order):
1. Verified crop benchmark (getCropBenchmark) -> source: "benchmark"
2. trayFormat.targetWeightPerSite -> source: "format"
3. Null if neither available

**TrayRun Record Created**:
```
tray_run_id: "TR-<timestamp>-<random>"
tray_id, recipe_id, crop, variety,
seeded_at, planted_site_count, plant_count_source,
seed_source, target_weight_oz, target_weight_source,
group_id, status: "GROWING"
```

**Placement Record Created**:
```
tray_run_id, tray_id, location_qr, placed_at,
removed_at: null, removal_reason: null, group_id
```

#### Phase 4: Growing

**Automated**: Schedule executor applies light/env targets per group recipe. Applied recipes logged to appliedRecipesDB for ML benchmarking and traceability.

#### Phase 5: Harvest

**UI**: tray-inventory.html (Activity Hub) -- QR scan + weight entry
**Server**: LE (server-foxtrot.js ~line 21504)
**Storage**: NeDB (trayRunsDB, harvestOutcomesDB -> ./data/harvest-outcomes.db), trace-records.json

| API | Method | Purpose |
|-----|--------|---------|
| /api/tray-runs/:id/harvest | POST | Record harvest, generate lot code |

**Harvest Input Fields**: actualWeight (oz, optional), note, harvestedAt

**Processing Steps**:

1. Look up TrayRun from trayRunsDB
2. Generate Lot Code: `A1-<CROP 8chars>-<YYMMDD>-<4char random>` (e.g., A1-LETTU-260330-AB7C)
3. Calculate weight: manual actualWeight OR target_weight_oz x planted_site_count
4. Update TrayRun: status="HARVESTED", lot_code, actual_weight, harvested_at
5. Create Experiment Record in harvestOutcomesDB (crop, grow_days, weight_per_plant_oz, zone)
6. Create Traceability Record in trace-records.json (SFCR-compliant, 2-year retention)
7. Auto-print thermal label via POST /api/printer/print-harvest
8. Creates/updates farm_inventory via syncHarvest (E-010 RESOLVED v1.2.0)

**Weigh-In Sampling**: 80% rate for unverified crops, 20% for verified crops

**Harvest Response Fields**: success, trayRunId, lotCode, batchId, actualWeight, harvestedCount, harvestedAt, shouldWeigh, weighInReason, trace_id, experiment_id, label_print, auto_print_result

#### Phase 6: Inventory Availability (THE GAP)

**Current State**: Harvested crop data lives in NeDB tray-runs on LE. The farm_inventory table (PostgreSQL on Central) that POS and wholesale read from is populated via a SEPARATE mechanism: recalculateAutoInventoryFromGroups(), which uses theoretical plant counts from groups.json -- NOT actual harvest data. As of Apr 10 2026, stale auto entries are automatically cleaned when crops are removed from groups (syncFarmData runs every 5 min and triggers cleanup).

```
WHAT ACTUALLY HAPPENS:
  Tray Harvest (NeDB: tray-runs.db)
       |
       | [NO DIRECT CONNECTION]
       |
       v
  farm_inventory.auto_quantity_lbs
       ^
       | recalculateAutoInventoryFromGroups()
       | triggered by POST /api/sync/groups
       | AND by syncFarmData() every 5 min
       | ALSO deletes stale auto entries for removed crops
       |
  groups.json (theoretical plant counts)
       + crop_benchmarks (statistical averages)

WHAT SHOULD HAPPEN:
  Tray Harvest (actual weight)
       |
       v
  farm_inventory.auto_quantity_lbs (actual harvested qty)
       |
       v
  Wholesale catalog + POS (real available inventory)
```

### 15.3 Manual Inventory Entry (Crop Outputs)

**UI**: LE-farm-admin.html or direct API
**Server**: Central (greenreach-central/routes/inventory.js)
**Storage**: PostgreSQL farm_inventory table

| API | Method | Purpose |
|-----|--------|---------|
| POST /api/inventory/manual | POST | Add manual inventory item |

**Manual Entry Fields**: product_name, quantity_lbs, retail_price, wholesale_price, category, variety, available_for_wholesale

**Database Effect**:
```sql
INSERT INTO farm_inventory (farm_id, product_id, product_name, manual_quantity_lbs,
  quantity_available, inventory_source, retail_price, wholesale_price)
VALUES (?, ?, ?, manual_qty, auto_qty + manual_qty, 
  CASE WHEN auto_qty > 0 THEN 'hybrid' ELSE 'manual' END, ?, ?)
ON CONFLICT (farm_id, product_id) DO UPDATE SET
  manual_quantity_lbs = EXCLUDED.manual_quantity_lbs,
  quantity_available = farm_inventory.auto_quantity_lbs + EXCLUDED.manual_quantity_lbs,
  inventory_source = CASE 
    WHEN farm_inventory.auto_quantity_lbs > 0 THEN 'hybrid' 
    ELSE 'manual' 
  END
```

**Protection**: Records with inventory_source = 'manual' are NOT overwritten by auto-sync.

### 15.4 Dual-Quantity System

**Three-State Machine**:

| inventory_source | auto_quantity_lbs | manual_quantity_lbs | Sync Behavior |
|-----------------|-------------------|--------------------|----|
| auto | Populated (from groups recalc) | 0 | Auto-sync updates freely |
| manual | 0 | Populated (user-entered) | Auto-sync CANNOT overwrite |
| hybrid | Populated | Populated | Auto-sync updates auto portion, preserves manual |

**Combined Quantity**: `quantity_available = auto_quantity_lbs + manual_quantity_lbs`

**Sync ON CONFLICT Logic** (greenreach-central/config/database.js):
```sql
ON CONFLICT (farm_id, product_id) DO UPDATE SET
  auto_quantity_lbs = EXCLUDED.auto_quantity_lbs,
  quantity_available = EXCLUDED.auto_quantity_lbs + 
                       COALESCE(farm_inventory.manual_quantity_lbs, 0),
  inventory_source = CASE
    WHEN COALESCE(farm_inventory.manual_quantity_lbs, 0) > 0 THEN 'hybrid'
    ELSE 'auto'
  END
WHERE farm_inventory.inventory_source != 'manual'
```

### 15.5 Supplies Inventory (Farm Inputs)

**UI**: LE-farm-admin.html Inventory tab
**Server**: Central (greenreach-central/routes/inventory-mgmt.js)
**Storage**: farm_data JSONB table (keys: inventory_seeds, inventory_nutrients, inventory_packaging, inventory_equipment, inventory_supplies)

**Categories and Endpoints** (pattern: /api/inventory/{category}/*):

| Category | List | Create | Update | Delete | Restock | Usage | Maintenance |
|----------|------|--------|--------|--------|---------|-------|-------------|
| seeds | GET /list | POST | PUT /:id | DELETE /:id | POST /:id/restock | POST /:id/usage | -- |
| nutrients | GET /list | POST | PUT /:id | DELETE /:id | POST /:id/restock | POST /:id/usage | -- |
| packaging | GET /list | POST | PUT /:id | DELETE /:id | POST /:id/restock | POST /:id/usage | -- |
| equipment | GET /list | POST | PUT /:id | DELETE /:id | -- | -- | POST /:id/maintenance |
| supplies | GET /list | POST | PUT /:id | DELETE /:id | POST /:id/restock | POST /:id/usage | -- |

**Aggregation Endpoints**:
| API | Method | Purpose |
|-----|--------|---------|
| /api/inventory/dashboard | GET | Summary overview (counts, value, alerts) |
| /api/inventory/reorder-alerts | GET | Items below minStockLevel |
| /api/inventory/usage/weekly-summary | GET | Weekly consumption across categories |

**Supplies Data Model** (per item):
```
id, name, quantity (or qtyOnHand or volume_remaining_ml),
reorderPoint (or minStockLevel), costPerUnit (or price),
createdAt, updatedAt
```

Usage/maintenance events stored in inventory_usage_log (audit trail with quantity change, remaining balance, performer ID, timestamp).

**These supplies do NOT flow into the crop/product inventory system.** Seeds consumed by planting, packaging used in fulfillment, nutrients used in growing -- these are tracked here as input consumption, not as salable output.

### 15.6 Inventory Sync (LE -> Central)

**Mechanism**: sync-service.js sends data to Central every 30 seconds (telemetry) and every 5 minutes (farm data).

| Sync Route | Trigger | Effect on farm_inventory |
|------------|---------|------------------------|
| POST /api/sync/telemetry | Every 30s | None (environmental data only) |
| POST /api/sync/groups | On group changes | Triggers recalculateAutoInventoryFromGroups() |
| POST /api/sync/inventory | On manual inventory update | Upserts to products + farm_data + inMemoryStore |
| POST /api/sync/harvest | On tray harvest | Creates farm_inventory record via syncHarvest (E-010 RESOLVED) |

### 15.7 Wholesale Catalog Pipeline

**How farm_inventory becomes the wholesale catalog**:

```
farm_inventory table
  WHERE available_for_wholesale = true
  AND quantity_available > 0
       |
       v
GET /api/wholesale/catalog  (routes/wholesale-catalog.js)
  SQL: SELECT fi.*, f.name AS farm_name
       FROM farm_inventory fi
       LEFT JOIN farms f ON f.farm_id = fi.farm_id
       WHERE fi.available_for_wholesale = true
       AND COALESCE(fi.quantity_available, fi.quantity, 0) > 0
       |
       v
Aggregated SKU Map:
  sku_id -> { total_available (sum all farms), min_price, max_price,
              farms: [{ farm_id, qty_available, price }] }
       |
       v
GR-wholesale.html (buyer-facing catalog)
```

**Reservation System** (routes/wholesale-reservations.js):
| API | Method | Purpose |
|-----|--------|---------|
| POST /api/wholesale/reserve | POST | Create TTL-based inventory hold |
| POST /api/wholesale/release | POST | Release hold on checkout cancel |

Reservations stored in NeDB with TTL (default 15 minutes). Availability check: `catalog_available - currently_reserved >= requested`. Order fulfillment now permanently deducts from farm_inventory (E-013 RESOLVED v1.2.0).

**wholesale-products.json**: Legacy static file (no longer used). Wholesale catalog now reads from farm_inventory database via buildAggregateCatalog() (E-015 RESOLVED v1.2.0).

### 15.8 POS Inventory Pipeline

**How POS reads and consumes inventory**:

```
GET /api/farm-sales/inventory  (routes/farm-sales/inventory.js)
  Merges: NeDB in-memory store + PostgreSQL farm_inventory
       |
       v
POS checkout form (farm-sales-pos.html)
       |
       v
POST /api/farm-sales/pos/checkout  (routes/farm-sales/pos.js)
  1. Validates: product.available >= item.quantity
  2. Calculates: subtotal, tax, delivery fees
  3. Creates order record
  4. Deducts from IN-MEMORY store only (farmStores.inventory Map)
  5. Updates farm_inventory: sold_quantity_lbs += item.quantity (E-012 RESOLVED v1.2.0)
```

### 15.9 Central Monitoring

**How Central monitors farm inventory**:

| Endpoint | Purpose | Data Source |
|----------|---------|------------|
| GET /api/inventory/current | Active trays + total plants | farm_backups.groups + farm_inventory |
| GET /api/inventory/:farmId | Farm inventory detail | farm_inventory WHERE qty > 0 |
| GET /api/inventory/forecast/:days | Harvest forecast (7/14/30 day) | groups seed dates + crop growth days |

**Central Admin Dashboard** (central-admin.js, function loadFarmInventory):
- Reads farm_inventory WHERE quantity_available > 0 OR manual_quantity_lbs > 0
- Prefers data.trays over data.inventory response shape (v1.3.0)
- Maps both product-style and tray-style field names with fallback chain (v1.3.0)
- Shows auto_quantity_lbs + manual_quantity_lbs merged as quantity_available
- Displays by category with last-updated timestamps

**Farm Inventory View** (farm-inventory.html):
- **Summary Cards**: Active Trays, Ready for Harvest, Total Plants, Recent Harvests
- **Forecast Grid**: 7-day, 14-day, 30-day, 30+ day projections (trays and plants)
- **Inventory Tree**: Hierarchical crop view with growth stages, locations, harvest dates
- **AI Insights popup**: ML-powered harvest optimization suggestions

### 15.10 NeDB Stores (Tray System -- LE Only)

| Store Variable | File Path | Purpose | Key Fields |
|---------------|-----------|---------|------------|
| trayFormatsDB | ./data/tray-formats.db | Tray format definitions | trayFormatId, name, plantSiteCount, isWeightBased, targetWeightPerSite, systemType |
| traysDB | ./data/trays.db | Registered physical trays | tray_id, tray_format_id, qr_code_value |
| trayRunsDB | ./data/tray-runs.db | Individual seeding cycles | tray_run_id, tray_id, recipe_id, seeded_at, planted_site_count, target_weight_oz, group_id, status (GROWING/HARVESTED), lot_code, actual_weight |
| trayPlacementsDB | ./data/tray-placements.db | Location history of runs | tray_run_id, location_qr, placed_at, group_id |
| trayLossEventsDB | ./data/tray-loss-events.db | Loss/mortality during growing | Event timestamps, loss counts |
| harvestOutcomesDB | ./data/harvest-outcomes.db | Experiment records for ML | crop, grow_days, weight_per_plant_oz, total_weight_oz, zone |

### 15.11 Complete Inventory Data Flow Diagram

```
=== SUPPLY SIDE (Inventory Creation) ===

Source A: Tray Harvest (Actual Production)
  tray-setup.html -> POST /api/tray-formats (define format)
  tray-setup.html -> POST /api/trays/register (register physical tray)
  planting-scheduler -> POST /api/trays/:id/seed (start growing)
  [Schedule executor applies recipes for N days]
  tray-inventory.html -> POST /api/tray-runs/:id/harvest
    -> tray-runs.db: status=HARVESTED, lot_code, actual_weight
    -> trace-records.json: SFCR traceability
    -> harvest-outcomes.db: experiment data
    -> thermal printer: label with lot code
    -> farm_inventory: syncHarvest creates/updates record (E-010 RESOLVED)

Source B: Theoretical Capacity (Groups Recalculation)
  groups.json -> POST /api/sync/groups -> Central receives
    -> recalculateAutoInventoryFromGroups(farmId)
    -> total_plants x yieldFactor x avgWeight / 16
    -> farm_inventory.auto_quantity_lbs (THEORETICAL, not actual)
    -> ALSO: syncFarmData() calls recalculate every 5 min after groups upsert
    -> CLEANUP: DELETEs auto entries for crops no longer in any growth group
    -> Prevents phantom inventory from persisting when crops are removed

Source C: Manual Entry (Farmer Adds Directly)
  LE-farm-admin.html or API -> POST /api/inventory/manual
    -> farm_inventory.manual_quantity_lbs (protected from auto-overwrite)

=== COMBINED INVENTORY ===

farm_inventory table (PostgreSQL, Central):
  quantity_available = auto_quantity_lbs + manual_quantity_lbs
  inventory_source = 'auto' | 'manual' | 'hybrid'

=== DEMAND SIDE (Inventory Consumption) ===

Consumer 1: Wholesale Catalog
  GET /api/wholesale/catalog
    -> Primary: buildAggregateCatalog() from network farms
    -> Fallback: Direct DB query on farm_inventory if aggregate is empty (v1.3.0)
    -> Shows aggregated SKUs across farms
    -> Buyer places order -> reservation (TTL 15 min)
    -> Order fulfilled -> status webhooks
    -> farm_inventory: sold_quantity_lbs deducted on fulfillment (E-013 RESOLVED)

Consumer 2: POS (Point of Sale)
  GET /api/farm-sales/inventory
    -> Reads NeDB + farm_inventory
    -> Customer checkout -> POST /api/farm-sales/pos/checkout
    -> Validates availability -> creates order
    -> In-memory deduction only (lost on restart)
    -> farm_inventory: sold_quantity_lbs deducted on checkout (E-012 RESOLVED)

Consumer 3: Central Admin Dashboard
  GET /api/inventory/current, /api/inventory/:farmId
    -> Read-only monitoring (no deductions)

Consumer 4: Central Forecast
  GET /api/inventory/forecast/:days
    -> Projects from seed dates + crop growth days
    -> Theoretical only (uses groups, not actual harvests)
```

### 15.12 Inventory Error Summary

The inventory pipeline errors E-010 through E-015 were all RESOLVED in v1.2.0. The fixes ensure harvests flow to farm_inventory, sales deduct via sold_quantity_lbs, and the wholesale catalog reads from the database. Summary of resolved errors:

| Step | Expected | Actual | Error |
|------|----------|--------|-------|
| Tray harvested | Creates farm_inventory record with actual weight | RESOLVED: syncHarvest creates farm_inventory record | E-010 |
| Auto quantity calculated | Reflects actual harvested amounts | RESOLVED: formula preserves sold_quantity_lbs across recalculations | E-011 |
| POS sale completed | Reduces farm_inventory permanently | RESOLVED: sold_quantity_lbs updated in PostgreSQL | E-012 |
| Wholesale order fulfilled | Reduces farm_inventory permanently | RESOLVED: sold_quantity_lbs deducted on confirmation | E-013 |
| Groups resync triggers recalc | Preserves sales deductions | RESOLVED: recalculation preserves sold_quantity_lbs | E-014 |
| Wholesale catalog reads | From farm_inventory database | RESOLVED: reads from farm_inventory via buildAggregateCatalog | E-015 |

---

## 17. Square Payment Connection -- Multi-Tenant Architecture

### 17.1 Overview

Two completely separate Square integrations exist. They use different credentials, different scopes, different storage backends, and serve different business purposes.

| System | Route Prefix | Server | Purpose |
|--------|-------------|--------|---------|
| Farm-Individual Square | /api/farm/square/* | LE (proxied via Central) | Each farm processes their own customer payments (POS retail, online store, subscriptions) |
| Wholesale Marketplace Square | /api/square-proxy/* | Central | GreenReach collects 12% broker commission via app_fee_money on wholesale orders |

This section documents the **Farm-Individual Square** system only. Wholesale is documented in the wholesale pipeline section.

### 17.2 Files

| File | Location | Purpose |
|------|----------|---------|
| routes/farm-square-setup.js | LE root | Backend: 7 endpoints (authorize, callback, status, refresh, settings, disconnect, test-payment) |
| public/payment-setup.html | Both public/ dirs | Frontend: standalone Square OAuth connection page |
| greenreach-central/server.js (lines ~3250-3277) | Central | Proxy: forwards all /api/farm/square/* requests to LE via edgeProxy() |
| greenreach-central/routes/square-oauth-proxy.js | Central | Wholesale-only (NOT used by farm-individual flow) |

### 17.3 Environment Variables (LE)

| Variable | Purpose | Required |
|----------|---------|----------|
| SQUARE_APPLICATION_ID | Square app client ID (sq0idp-...) | Yes |
| SQUARE_APPLICATION_SECRET | Square app secret (sq0csp-...) | Yes |
| SQUARE_ENVIRONMENT | "production" or "sandbox" | Yes (defaults to "production") |
| FARM_SQUARE_REDIRECT_URI | OAuth callback URL. Must be: https://greenreachgreens.com/api/farm/square/callback | Yes |
| TOKEN_ENCRYPTION_KEY | 64-char hex key for AES-256-GCM token encryption | Yes in production |
| SQUARE_LOCATION_ID | Default Square location (used by wholesale, not farm-individual) | No |
| SQUARE_ACCESS_TOKEN | GreenReach's own Square token (wholesale only, not farm-individual) | No |

### 17.4 OAuth Connection Flow

```
Step 1: User opens payment-setup.html
        (served from LE or Central -- both copies exist)
        Page reads farmId from URL query param or localStorage

Step 2: User clicks "Connect to Square"
        -> window.open('about:blank', '_blank')  [pre-opens window SYNCHRONOUSLY in click handler]
        -> POST /api/farm/square/authorize { farmId, farmName }
           (if served from Central, proxied to LE via edgeProxy)

Step 3: LE /authorize handler (farm-square-setup.js)
        -> Validates farmId + farmName present
        -> Builds redirect_uri from FARM_SQUARE_REDIRECT_URI env var
           (fallback: req.protocol + '://' + req.get('host') + '/api/farm/square/callback')
        -> Creates signed state token (HMAC-SHA256, 10-min expiry)
           State payload: { farm_id, farm_name, redirect_uri, timestamp, nonce }
        -> Stores state in oauthStates Map + saves to disk
        -> Returns { authorizationUrl, state, expiresIn: 600 }

Step 4: Browser navigates pre-opened window to Square OAuth URL
        https://connect.squareup.com/oauth2/authorize?
          client_id=<SQUARE_APPLICATION_ID>
          &scope=PAYMENTS_WRITE MERCHANT_PROFILE_READ ORDERS_WRITE ORDERS_READ
          &session=false
          &state=<signed_state_token>
          &redirect_uri=https://greenreachgreens.com/api/farm/square/callback

Step 5: User logs into Square and authorizes the app

Step 6: Square redirects to callback URL with ?code=<auth_code>&state=<state_token>
        -> Hits Central (greenreachgreens.com)
        -> Central proxy (server.js line ~3252) forwards to LE via edgeProxy
           (custom handler passes query string, returns HTML content-type)

Step 7: LE /callback handler (farm-square-setup.js)
        -> Validates state token (HMAC signature + 10-min expiry)
        -> Extracts farm_id + redirect_uri from state payload
        -> POST https://connect.squareup.com/oauth2/token
           { client_id, client_secret, code, grant_type, redirect_uri }
        -> Receives access_token, refresh_token, expires_at, merchant_id
        -> Fetches merchant locations via Square SDK
        -> Encrypts access_token + refresh_token (AES-256-GCM)
        -> Stores in farmSquareAccounts Map[farmId] + saves to disk
        -> Returns HTML page with success message

Step 8: Callback HTML signals opener
        -> Writes to localStorage: key="square_connected_signal"
        -> Calls window.opener.postMessage(signalData, "*")
        -> Auto-closes after 3 seconds

Step 9: payment-setup.html detects connection
        -> Storage event listener catches square_connected_signal
        -> OR: polling (every 5s, max 72 attempts) hits GET /status
        -> Shows success: merchant name + location
```

### 17.5 Multi-Tenant Isolation

**Token storage is keyed by farmId.** Each farm's encrypted tokens are stored separately in a single Map (in-memory) and a single JSON file (on disk).

```
farmSquareAccounts Map:
  "FARM-MLTP9LVH-B0B85039" -> { merchantId, locationId, accessToken: {encrypted}, ... }
  "FARM-XXXXXXXX-YYYYYYYY" -> { merchantId, locationId, accessToken: {encrypted}, ... }
```

**Isolation guarantees:**
- GET /status requires farmId in query param or x-farm-id header -- returns only that farm's status
- POST /authorize stores state token with farm_id embedded -- callback extracts it
- POST /refresh, /disconnect, /settings all resolve farmId from header or body
- No endpoint returns a list of all connected farms (no enumeration vector)
- Tokens are encrypted at rest -- raw tokens never written to disk

**Global encryption key:** All farms share a single TOKEN_ENCRYPTION_KEY (AES-256-GCM). Each token gets a unique random IV (16 bytes) and auth tag, so identical plaintext tokens produce different ciphertext. The key itself must be protected as a platform secret.

### 17.6 Token Persistence

| Location | Format | Purpose |
|----------|--------|---------|
| In-memory Map | farmSquareAccounts (farmId -> account) | Fast runtime lookups |
| /var/app/data/greenreach/farm-square-tokens.json | JSON (encrypted values) | Survives LE restarts |
| /var/app/data/greenreach/farm-square-oauth-states.json | JSON (pending auths) | Survives restarts during active OAuth flows |

On startup, farm-square-setup.js calls loadTokensFromDisk() and loadOauthStatesFromDisk() to rehydrate. Legacy fallback checks ./data/ directory and migrates if found.

### 17.7 Popup Blocker Fix History

| Date | Commit | Problem | Fix |
|------|--------|---------|-----|
| Mar 26, 2026 | 5dc98559 | Wizard flow broken | Route buttons to guided setup |
| Mar 26, 2026 | 99e9f764 | postMessage unreliable | Poll status instead |
| Mar 26, 2026 | 5562e0cc | localStorage signal for iframe compat | Added localStorage-based signaling |
| Mar 27, 2026 | 0676ee54 | Iframe popups blocked by browsers | Removed iframe wizard, standalone payment-setup.html |
| Mar 29, 2026 | (current) | window.open() after await loses click context | Pre-open window synchronously before fetch, navigate after |

Root cause pattern: browsers only allow window.open() during synchronous user-gesture handlers. Any await or setTimeout between the click and the open causes the popup to be blocked.

### 17.8 Square Developer Dashboard Requirements

The Square Developer Dashboard (developer.squareup.com) must have these settings for the OAuth flow to work:

- **Application ID**: Must match SQUARE_APPLICATION_ID env var on LE
- **Application Secret**: Must match SQUARE_APPLICATION_SECRET env var on LE
- **OAuth Redirect URL**: Must be exactly `https://greenreachgreens.com/api/farm/square/callback`
- **OAuth Scopes**: PAYMENTS_WRITE, MERCHANT_PROFILE_READ, ORDERS_WRITE, ORDERS_READ
- **Production access**: Must be approved and active

If the redirect URL in the Dashboard does not exactly match FARM_SQUARE_REDIRECT_URI, Square will reject the callback and the flow silently fails.

### 17.9 Central Proxy Configuration

Central does NOT mount farm-square-setup.js routes directly. Instead, server.js defines inline proxy routes (lines ~3250-3277) that forward to LE via edgeProxy():

| Central Route | Method | LE Target | Notes |
|---------------|--------|-----------|-------|
| /api/farm/square/status | GET | edgeProxy | JSON passthrough |
| /api/farm/square/authorize | POST | edgeProxy | JSON passthrough |
| /api/farm/square/callback | GET | Custom proxy | HTML content-type, query string forwarded |
| /api/farm/square/refresh | POST | edgeProxy | JSON passthrough |
| /api/farm/square/settings | POST | edgeProxy | JSON passthrough |
| /api/farm/square/disconnect | POST | edgeProxy | JSON passthrough |
| /api/farm/square/test-payment | POST | edgeProxy | JSON passthrough |

The callback proxy uses a custom handler (not edgeProxy) because it returns HTML, not JSON. It forwards the full query string to LE and passes through the response content-type.

Central resolves the LE URL via resolveEdgeUrlForProxy(): FARM_EDGE_URL env var (currently `https://light-engine-1029387937866.us-east1.run.app`).

---

**END OF COMPLETE SYSTEM MAP**
**Document Version**: 2.0.0
**Generated**: March 29, 2026
**Next Review**: Update when any new routes, pages, tables, or integrations are added
