# GreenReach Platform -- Complete System Map

**Version**: 1.0.0
**Date**: March 23, 2026
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

---

## 1. Architecture Overview

### System Diagram

```
                        INTERNET
                           |
              +------------+------------+
              |                         |
    greenreachgreens.com        LE-EB v3 CNAME
    (Route53/CloudFront)        (direct EB URL)
              |                         |
              v                         v
+---------------------------+  +---------------------------+
| GreenReach Central (EB)   |  | Light Engine Foxtrot (EB) |
| greenreach-central-prod-v4|  | light-engine-foxtrot-     |
|                           |  | prod-v3                   |
| greenreach-central/       |  |                           |
|   server.js               |  | server-foxtrot.js         |
|                           |  |                           |
| PostgreSQL (RDS)          |  | EnvStore (in-memory)      |
| farmStore (in-memory)     |  | env-state.json (file)     |
| 45+ database tables       |  | NeDB / SQLite             |
|                           |  |                           |
| F.A.Y.E. (admin AI)      |  | E.V.I.E. (farm AI)       |
| Admin dashboard           |  | Farm dashboard             |
| Wholesale marketplace     |  | Device control             |
| Grant wizard              |  | Sensor polling             |
| Accounting                |  | Automation engine          |
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
| EB Environment | light-engine-foxtrot-prod-v3 | greenreach-central-prod-v4 |
| Domain | EB CNAME (v2 hostname, v3 env) | greenreachgreens.com |
| Deploy from | Repo root | greenreach-central/ subdirectory |
| Port | 8091 | 3000 (HTTP) + 3001 (WS) |
| Platform | Node.js 20 / Amazon Linux 2023 | Node.js 20 / Amazon Linux 2023 |
| Region | us-east-1 | us-east-1 |
| Role | The Farm (sensors, devices, automation) | The Hub (data, admin, marketplace) |

### Critical Rules

- The farm is 100% cloud. No physical device, no Pi, no edge hardware.
- LE-EB IS the farm. "Edge mode" in code is a legacy naming artifact.
- v2 environment is DEAD (CloudFormation DELETE_FAILED). NEVER deploy to v2.
- CNAME swap: v3 answers on v2 URL. This is correct and intentional.
- Two public/ directories: root public/ (LE), greenreach-central/public/ (Central). NOT synced.
- E.V.I.E. files must exist in BOTH public directories.
- server-foxtrot.js NEVER imports from greenreach-central/routes/ (exception: 3 AI routes).
- Changing greenreach-central/ files requires deploying BOTH environments.

---

## 2. AWS Infrastructure

### Elastic Beanstalk Environments

#### Light Engine (Active)

| Property | Value |
|----------|-------|
| Application | light-engine-foxtrot |
| Environment | light-engine-foxtrot-prod-v3 |
| CNAME | light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com |
| Platform | Node.js 20 on 64bit Amazon Linux 2023 |
| Instance | t3.small |
| Auto Scaling | Min 1, Max 4 |
| Storage | gp3 20 GB |
| Entry Point | node server-foxtrot.js (via Procfile) |
| Health Check | /health (30s interval) |
| Proxy | nginx |

#### GreenReach Central (Active)

| Property | Value |
|----------|-------|
| Application | greenreach-central |
| Environment | greenreach-central-prod-v4 |
| Custom Domain | greenreachgreens.com (Route53/CloudFront) |
| Platform | Node.js 20 on 64bit Amazon Linux 2023 |
| Entry Point | npm start -> node server.js (via Procfile) |
| Health Check | /health |

#### Dead Environment (DO NOT USE)

| Property | Value |
|----------|-------|
| Environment | light-engine-foxtrot-prod-v2 |
| Status | TERMINATED / CloudFormation DELETE_FAILED |
| DNS | DOES NOT RESOLVE |

### AWS Services Used

| Service | Purpose |
|---------|---------|
| Elastic Beanstalk | Application hosting (2 environments) |
| RDS PostgreSQL | Database (Central) |
| Route 53 | DNS for greenreachgreens.com |
| CloudFront | CDN/HTTPS termination |
| ACM | TLS certificate (arn:aws:acm:us-east-1:634419072974:certificate/adfc4d01-f688-45a2-a313-24cb4601f8e1) |
| CloudWatch | Metrics + logs (LightEngine/Foxtrot namespace, 60s publish, 7-day retention) |
| SES | Email notifications |
| SNS | Push notifications |
| Secrets Manager | JWT_SECRET storage |
| S3 | EB deployment artifacts |
| Cost Explorer | Cloud cost accounting sync (optional) |

### Deployment Pipeline

```
Developer Machine
       |
       | git add -A && git stash
       | eb deploy <env-name> --staged
       v
AWS Elastic Beanstalk
       |
       | .platform/hooks/prebuild/
       |   01_install_dependencies.sh
       |   02_install_python_deps.sh
       |
       | .platform/hooks/predeploy/
       |   00_preserve_runtime_data.sh
       |   01_install_central_deps.sh
       |
       | .platform/hooks/postdeploy/
       |   00_recover_runtime_data.sh
       |   01_restart_web.sh
       |   99_restart_app.sh
       v
Running Application

Deploy Commands:
  LE:      cd /Volumes/CodeVault/Projects/Light-Engine-Foxtrot && eb deploy light-engine-foxtrot-prod-v3 --staged
  Central: cd greenreach-central && eb deploy greenreach-central-prod-v4 --staged
  eb CLI:  /Users/petergilbert/Library/Python/3.9/bin/eb
```

### .ebignore (LE Bundle Exclusions)

The LE bundle excludes greenreach-central/ entirely (191MB with video/images). The buildspec.yml separately installs Central dependencies. Key exclusions: node_modules/, .git/, .github/, tests/, mobile-app/, desktop-app/, docs/, *.md, .env files.

### .ebignore (Central Bundle Exclusions)

Central excludes: .git, .github, .vscode, node_modules, logs, *.md, public/videos/ (images are included for marketing).

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
| /api/farm-settings | routes/farm-settings.js | Settings sync to edge |
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
| /api/farm-sales/* | routes/farm-sales.js | Farm selling and orders |
| /api/network/*, /api/growers/* | routes/network-growers.js | Network marketplace |
| /api/lots | routes/lot-system.js | Lot tracking |
| /api/grant-wizard | routes/grant-wizard.js | Grant application wizard |
| /api/ai-monitoring | routes/admin-ai-monitoring.js | AI system monitoring |
| /api/assistant-chat | routes/assistant-chat.js | E.V.I.E. chat |
| /api/admin/assistant | routes/admin-assistant.js | F.A.Y.E. admin AI |
| /api/admin/ops-agent | routes/admin-ops-agent.js | Operations agent |

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
| AI Recommendations Pusher | Scheduled | GPT-4 recommendations to farms |
| AWS Cost Explorer Sync | Scheduled | Cloud cost accounting |
| GitHub Billing Sync | Scheduled | GitHub Actions costs |
| Wholesale Network Sync | Continuous | Aggregate farm inventory |
| Benchmark Scheduler | Nightly | Crop benchmark aggregation |
| Lot Expiry Scheduler | Nightly | Auto-expire lots past best-by |
| Yield Regression | Weekly | Cross-farm yield analysis |
| Production Plan Scheduler | Weekly | Generate seeding plans |
| Admin Session Cleanup | Every 30min | Delete expired sessions |
| Grant Cleanup | Every 6 hours | Expire old grant applications |
| Farm Data Sync | Every 5 min | Pull data from LE-EB |
| Daily Full Sync | 2 AM | Full data refresh |

---

## 5. Frontend Pages -- Complete Inventory

### 5.1 Central Admin Pages (greenreach-central/public/)

#### GR-central-admin.html -- F.A.Y.E. Admin Dashboard
- **Auth**: localStorage.admin_token required
- **Navigation**: Sidebar (Overview, Farms, Users, Analytics, AI Rules)
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
- **Navigation**: Farm Summary (green), Farm Admin (purple), Inventory (yellow)
- **Sections**:
  - Traceability: search lot codes, view lot details
  - Inventory: seeds, packaging, nutrients, equipment, supplies (CRUD + restock)
  - Sustainability: ESG report, energy/water/carbon/waste tracking
  - IoT Manager: device scanning, auto-assign
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
| tray-inventory.html | Detailed tray tracking | Tray IDs, locations, dates | Search, filter, bulk actions |
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
| farm-sales-pos.html | Point of sale system |
| about.html | About GreenReach |
| greenreach-grow.html | Growing guides |
| growing-made-easy.html | Onboarding education |
| grow-and-sell.html | Farming + sales integration |
| id-buy-local.html | Buy local marketplace |
| greenreach-org.html | Organization features |

### 5.5 Utility and Special Pages

| Page | Purpose |
|------|---------|
| setup-wizard.html | New farm setup wizard |
| grant-wizard.html | Grant application wizard (FREE) |
| delivery.html | Delivery management |
| driver-enrollment.html | Driver enrollment |
| activity-hub-qr.html | QR activity tracking |
| LE-qr-generator.html | QR code generator |
| schedule.html | Schedule management |
| LE-dashboard.html | LE configuration wizard (multi-step) |
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

Stage 2: LE-EB Polling (every 30s)
  setupLiveSensorSync() -> GET https://api.switch-bot.com/v1.1/devices/{id}/status
  Auth: HMAC-SHA256 (SWITCHBOT_TOKEN + SWITCHBOT_SECRET)
  Response: { temperature, humidity, battery, version }

Stage 3: EnvStore (in-memory)
  preEnvStore.updateSensor(scopeId, sensorType, reading)
  -> Weighted median aggregation
  -> 50-point history per sensor
  -> Persist to data/automation/env-state.json

Stage 4: LE-EB GET /env
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
  2. Fallback: proxy to LE-EB GET /env

Stage 8: Dashboard Display
  farm-summary.html -> fetchEnvData()
  -> GET /env?hours=24 with Authorization + x-farm-id
  -> Auto-refresh every 60s
  -> Display: temp/humidity cards per zone, alerts, health
```

### 6.4 Farm Data Sync (Edge -> Central)

```
Trigger: Every 5 minutes + daily at 2 AM + manual via POST /api/sync/pull-farm-data

Source: LE-EB static data files
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

```
User -> LE-farm-admin.html (Inventory tab)
  -> Seeds: POST /api/inventory/seeds { name, variety, qty, unit }
  -> Packaging: POST /api/inventory/packaging { type, qty }
  -> Nutrients: POST /api/inventory/nutrients { name, concentration }
  -> Equipment: POST /api/inventory/equipment { name, status }
  -> Supplies: POST /api/inventory/supplies { name, qty }
  
  -> farm_inventory table (PostgreSQL)
  -> Auto-sync to wholesale catalog when available_for_wholesale=true
  -> Reorder alerts when qty < threshold
```

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
| api_url | VARCHAR(500) | LE-EB URL |
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
| database.js | PostgreSQL pool + migration system |
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
| DATABASE_URL | (none) | Central | Yes (prod) |
| DB_HOST | localhost | LE | No |
| DB_PORT | 5432 | LE | No |
| DB_NAME | (none) | LE | No |
| DB_USER | (none) | LE | No |
| DB_PASSWORD | (none) | LE | No |
| DB_SSL | true | Both | No |
| RDS_HOSTNAME, RDS_PORT, RDS_DB_NAME, RDS_USERNAME, RDS_PASSWORD | (none) | Central (EB auto) | Auto |

#### Authentication
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| JWT_SECRET | auto-generated | Both | Yes (prod) |
| GREENREACH_API_KEY | (none) | Central | Yes |

#### SwitchBot (CRITICAL)
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| SWITCHBOT_TOKEN | (none) | LE | YES -- sensors halt silently if missing |
| SWITCHBOT_SECRET | (none) | LE | YES -- sensors halt silently if missing |

#### Central Connection
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| GREENREACH_CENTRAL_URL | EB CNAME fallback | LE | No |
| FARM_EDGE_URL | (none) | Central | No |
| FARM_ID | (none) | Both | Yes |

#### Payments
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| SQUARE_APPLICATION_ID | (none) | Central | For payments |
| SQUARE_ACCESS_TOKEN | (none) | Central | For payments |
| SQUARE_ENVIRONMENT | (none) | Central | For payments |

#### AI
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| OPENAI_API_KEY | (none) | Both | For AI features |
| OPENAI_MODEL | gpt-4o-mini | LE | No |

#### Notifications
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| SENDGRID_API_KEY | (none) | Central | For email |
| TWILIO_ACCOUNT_SID | (none) | Central | For SMS |
| TWILIO_AUTH_TOKEN | (none) | Central | For SMS |
| TWILIO_PHONE_NUMBER | (none) | Central | For SMS |

#### CloudWatch
| Variable | Default | Used By | Required |
|----------|---------|---------|----------|
| CLOUDWATCH_ENABLED | false | LE | No |
| AWS_REGION | us-east-1 | Both | For AWS services |

---

## 11. External Service Integrations

| Service | Env Vars | Purpose | Server |
|---------|----------|---------|--------|
| SwitchBot Cloud API | SWITCHBOT_TOKEN, SWITCHBOT_SECRET | Sensor data polling | LE |
| Square Payments | SQUARE_APPLICATION_ID, SQUARE_ACCESS_TOKEN | Wholesale payments (12% commission) | Central |
| Stripe | Farm-configured | Farm payment setup | LE |
| OpenAI (GPT-4) | OPENAI_API_KEY | AI insights, recipe recommendations | Both |
| AWS CloudWatch | CLOUDWATCH_ENABLED, AWS_REGION | Metrics/logs | LE |
| AWS SES | AWS credentials | Email delivery | Central |
| AWS SNS | AWS credentials | Push notifications | Central |
| AWS Secrets Manager | JWT_SECRET_ARN | Secret storage | Both |
| AWS Cost Explorer | AWS credentials | Cloud cost accounting | Central |
| SendGrid | SENDGRID_API_KEY | Email (alternative) | Central |
| Twilio | TWILIO_* | SMS notifications | Central |
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

---

## 14. Category Quick Reference

### By Domain

| Category | Server | Key Files | Key Tables |
|----------|--------|-----------|------------|
| **Farm Management** | Central | routes/farms.js, routes/auth.js | farms, farm_users, farm_data |
| **Sensor Data** | LE | automation/env-store.js, lib/sync-service.js | farm_data (telemetry) |
| **Device Control** | LE | server-foxtrot.js (SwitchBot, Kasa, Shelly) | device_integrations |
| **Automation** | LE | automation/, lib/schedule-executor.js | (in-memory + file) |
| **Dashboard** | Central | views/farm-summary.html | farm_data |
| **Inventory** | Both | routes/inventory.js (Central), farm-sales/inventory.js (LE) | farm_inventory, products |
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

```
# Deploy Light Engine ONLY
cd /Volumes/CodeVault/Projects/Light-Engine-Foxtrot
git add -A && git stash
/Users/petergilbert/Library/Python/3.9/bin/eb deploy light-engine-foxtrot-prod-v3 --staged

# Deploy Central ONLY
cd /Volumes/CodeVault/Projects/Light-Engine-Foxtrot/greenreach-central
/Users/petergilbert/Library/Python/3.9/bin/eb deploy greenreach-central-prod-v4 --staged

# Deploy BOTH (when changes span both)
# Deploy Central first, then LE
```

---

**END OF COMPLETE SYSTEM MAP**
**Document Version**: 1.0.0
**Generated**: March 23, 2026
**Next Review**: Update when any new routes, pages, tables, or integrations are added
