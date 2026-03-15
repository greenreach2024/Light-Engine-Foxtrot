# GreenReach Central — Deployment Guide

## Overview

GreenReach Central is the cloud gateway for the GreenReach IoT platform. It provides multi-tenant farm management, a wholesale marketplace, procurement administration, billing/metering, and the Square checkout pipeline.

**Stack:** Node.js (ESM) · Express · PostgreSQL · Square SDK v43 · JWT Auth

---

## 1. Pre-requisites

| Component   | Requirement                        |
|-------------|------------------------------------|
| Node.js     | v18+ (tested on v24.7)             |
| PostgreSQL  | 14+ with 70 managed tables        |
| npm         | v9+                                |
| Square      | Production access token + location |

---

## 2. Environment Variables

Copy `.env.example` to `.env` and fill in all required values.

### Required

| Variable               | Description                                       |
|------------------------|---------------------------------------------------|
| `NODE_ENV`             | `production` or `development`                     |
| `BASE_URL`             | Public URL (e.g. `https://greenreachgreens.com`)   |
| `JWT_SECRET`           | ≥ 32 random chars — `openssl rand -hex 32`         |
| `WHOLESALE_JWT_SECRET` | Separate secret for wholesale buyer JWTs           |
| `DATABASE_URL`         | PostgreSQL connection string                       |
| `SQUARE_ACCESS_TOKEN`  | Square payments API token                          |
| `SQUARE_LOCATION_ID`   | Square location for the checkout pipeline          |

### Optional (with defaults)

| Variable                      | Default   | Description                         |
|-------------------------------|-----------|-------------------------------------|
| `PORT`                        | `3000`    | HTTP listen port                    |
| `DB_SSL`                      | `true`    | Set `false` for localhost only      |
| `ADMIN_API_KEY`               | —         | API key for admin endpoints         |
| `ADMIN_EMAIL` / `PASSWORD`    | —         | Bootstrap admin credentials         |
| `SQUARE_ENVIRONMENT`          | `sandbox` | `sandbox` or `production`           |
| `WHOLESALE_COMMISSION_RATE`   | `0.15`    | 15% wholesale broker fee            |
| `PROCUREMENT_COMMISSION_RATE` | `0.10`    | 10% procurement commission          |
| `OPENAI_API_KEY`              | —         | Enables AI agent features           |
| `SES_ENABLED`                 | `false`   | Enable AWS SES email                |

See [.env.example](.env.example) for the full list.

---

## 3. Installation

```bash
git clone <repo-url>
cd greenreach-central
npm install
cp .env.example .env
# Edit .env with production values
```

---

## 4. Database Setup

Migrations run automatically on first server startup via `initDatabase()`. There are 25 migration sets managing 70 tables.

To verify DB connectivity and migration status:

```bash
node preflight-check.mjs
```

### Key Tables by Feature

| Feature          | Tables                                                       |
|------------------|--------------------------------------------------------------|
| Core             | `farms`, `users`, `admin_sessions`, `farm_data`              |
| Sales Terminal   | `orders`, `inventory_items`, `delivery_routes`               |
| Checkout         | `checkout_sessions`, `purchase_leads`                        |
| Wholesale        | `wholesale_buyers`, `wholesale_orders`, `wholesale_payments` |
| Procurement      | `procurement_catalog`, `procurement_suppliers`, `procurement_orders` |
| Billing/Metering | `billing_receipts`, `api_usage_daily`                        |
| Auth Security    | `token_blacklist`, `login_lockouts`                          |

---

## 5. Pre-flight Checklist

Run before every deployment:

```bash
node preflight-check.mjs
```

This validates:
- All required environment variables are set
- JWT secrets have adequate length (≥ 32 chars)
- SSL is enabled for production databases
- PostgreSQL is reachable and migrated
- Reports table count and connectivity status

**Exit code 0 = GO, 1 = blocked.**

---

## 6. Starting the Server

```bash
# Production
NODE_ENV=production node server.js

# Development
node server.js
```

The server:
1. Connects to PostgreSQL and runs any pending migrations
2. Initializes the farm data store (DB → memory → file fallback)
3. Mounts all route modules with middleware chains
4. Starts HTTP + WebSocket listeners on `PORT`

---

## 7. Running Tests

```bash
npm test
```

- **4 test suites, 38 tests** covering:
  - Module import smoke tests (9 tests — all route/middleware/store modules)
  - Auth middleware unit tests (2 tests)
  - Purchase admin auth tests (7 tests)
  - Farm sales auth tests (20 tests)

Tests use Jest with ESM (`--experimental-vm-modules`).

---

## 8. Architecture Overview

```
Browser / Buyer App
       │
       ▼
┌─────────────────────────────────────────┐
│  GreenReach Central (server.js)         │
│  ├── /api/purchase    (Square checkout) │
│  ├── /api/sales       (farm POS)       │
│  ├── /api/wholesale   (B2B marketplace)│
│  ├── /api/procurement (supply chain)   │
│  ├── /api/billing     (metering/usage) │
│  └── /api/admin       (farm mgmt)      │
├─────────────────────────────────────────┤
│  PostgreSQL (70 tables, 25 migrations) │
└─────────────────────────────────────────┘
       │
       ▼
   Light Engine (server-foxtrot.js)
   IoT devices, sensors, schedules
```

### Authentication Layers

| Layer               | Middleware              | Used By               |
|---------------------|-------------------------|-----------------------|
| Farm JWT            | `authMiddleware`        | Farm sales, billing   |
| Admin JWT           | `adminAuthMiddleware`   | Purchase admin, procurement |
| Combined            | `authOrAdminMiddleware` | Shared endpoints      |
| API Key             | `x-api-key` + `x-farm-id` | External integrations |
| Wholesale Buyer JWT | `requireBuyerAuth`      | Wholesale marketplace |

### Data Storage

Three-tier with automatic fallback:
1. **PostgreSQL** — primary (multi-tenant, `farm_data` JSONB)
2. **In-memory Maps** — hot cache
3. **Flat JSON files** — offline fallback

---

## 9. API Metering

Every API request is counted per-farm per-day in `api_usage_daily` (fire-and-forget, non-blocking). The billing usage endpoint (`GET /api/billing/usage/:farmId`) returns:

- `api_calls_today` — real-time call count from DB
- `storage_gb` — calculated from `pg_column_size` on `farm_data`
- Overage calculations against plan limits (50 devices, 10K calls, 5 GB)

---

## 10. Security Notes

- **Token blacklist** persists to `token_blacklist` table (survives restarts)
- **Login lockouts** persist to `login_lockouts` table (5 attempts → 30 min lock)
- Expired tokens and lockouts are cleaned up on access
- Helmet, CORS, and rate limiting are configured in `server.js`
- All admin endpoints require `adminAuthMiddleware`
- All farm endpoints require `authMiddleware`

---

## 11. Known Stub Endpoints

These endpoints return `501 Not Implemented` and require future integration work:

| Route File       | Endpoint                | Integration Needed |
|------------------|-------------------------|--------------------|
| `farm-sales.js`  | `POST /quickbooks/sync` | QuickBooks API     |
| `farm-sales.js`  | `GET /quickbooks/status`| QuickBooks API     |
| `farm-sales.js`  | `POST /quickbooks/...`  | QuickBooks (6 endpoints) |
| `farm-sales.js`  | `POST /ai-agent/query`  | OpenAI integration |
| `farm-sales.js`  | `GET /ai-agent/insights`| OpenAI integration |
| `farm-sales.js`  | `POST /subscriptions/...`| Subscription billing |

These are guarded by auth and return informative 501 responses.

---

## 12. Deployment Checklist

```
□ All env vars set (node preflight-check.mjs → exit 0)
□ PostgreSQL accessible with SSL enabled
□ npm test passes (38/38)
□ SQUARE_ENVIRONMENT=production (not sandbox)
□ JWT secrets are unique, random, ≥ 32 chars
□ WHOLESALE_REQUIRE_DB_FOR_CRITICAL=true
□ BASE_URL matches production domain
□ Git changes committed and pushed
□ Rate limiting tuned for expected traffic
□ Monitoring/logging configured
```
