# GreenReach Light Engine — Data Mapping Document

> **Last Updated:** 2026-03-28  
> **Purpose:** Canonical reference for all data storage locations, API endpoints, and data flow paths.  
> **Rule:** Always consult this document before debugging data issues. See `.github/copilot-instructions.md` for enforcement.

> **Architecture Alignment (2026-03-28):** The farm is cloud-only. LE-EB is the farm runtime. Terms such as "edge" in older sections are legacy naming and should be interpreted as "cloud-hosted farm runtime" unless explicitly marked as historical context.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [PostgreSQL Database Tables — Central Cloud](#2-postgresql-database-tables--central-cloud)
3. [PostgreSQL Database Tables — Foxtrot Farm Runtime](#3-postgresql-database-tables--foxtrot-farm-runtime)
4. [farmStore — Key-Value Store (farm_data table)](#4-farmstore--key-value-store-farm_data-table)
5. [NeDB Stores — Foxtrot Farm Runtime](#5-nedb-stores--foxtrot-farm-runtime)
6. [JSON Data Files](#6-json-data-files)
7. [API Endpoint → Storage Mapping](#7-api-endpoint--storage-mapping)
8. [Data Sync Flow (Farm Runtime ↔ Central)](#8-data-sync-flow-farm-runtime--central)
9. [Authentication Data Flow](#9-authentication-data-flow)
10. [Key Data Resolution Chains](#10-key-data-resolution-chains)
11. [Common Debugging Scenarios](#11-common-debugging-scenarios)
12. [Custom Product Feature -- Data Flow](#13-custom-product-feature--data-flow)
13. [Issue Log](#14-issue-log)

---

## 1. Architecture Overview

```
┌─────────────────────────┐                              ┌──────────────────────────┐
│  FOXTROT (Farm Runtime) │     POST /api/sync/*          │  CENTRAL (Cloud Server)  │
│  light-engine-foxtrot   │  ────────────────────────►   │  greenreach-central      │
│  foxtrot.greenreachgreens│  API Key auth (X-API-Key)    │  greenreachgreens.com    │
│                         │                              │                          │
│  Storage:               │                              │  Storage:                │
│  ├─ Local PostgreSQL    │                              │  ├─ RDS PostgreSQL       │
│  ├─ NeDB files (.db)    │                              │  ├─ farm_data (KV store) │
│  ├─ JSON files (data/)  │                              │  ├─ In-Memory Maps       │
│  └─ devices.nedb        │                              │  └─ JSON files (public/) │
│                         │                              │                          │
│  Users NEVER access     │  ◄── GET /api/sync/:id/*     │  Users access via        │
│  Foxtrot directly       │  ◄── POST /api/sync/restore  │  CloudFront → Central   │
└─────────────────────────┘                              └──────────────────────────┘
```

**Key Rule:** All user traffic routes through Central (`greenreachgreens.com` → CloudFront → Central EB). Foxtrot is only accessed server-to-server for sync operations.

---

## 2. PostgreSQL Database Tables — Central Cloud

Database: `light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com:5432/lightengine`  
Schema defined in: `greenreach-central/config/database.js`

### Core Tables

| Table | Primary Key | Key Columns | Purpose | Consumers |
|-------|------------|-------------|---------|-----------|
| **farms** | `farm_id` | name, email, api_url, status, last_heartbeat, metadata (JSONB), settings (JSONB), slug, setup_completed | Master farm registry | Admin dashboard, profile API, sync, wholesale |
| **farm_data** | `farm_id + data_type` (UNIQUE) | data (JSONB), updated_at | **Key-value store** for tenant-scoped data | farmStore abstraction → all Central APIs |
| **farm_users** | `id` (UUID) | farm_id (FK→farms), email, password_hash, role, status | Multi-tenant farm authentication | `/api/auth/login` |
| **farm_inventory** | farm_id + product_id | sku, quantity, quantity_available, price, wholesale_price, retail_price, is_custom, is_taxable, description, thumbnail_url, status, inventory_source, category, unit | Inventory for wholesale catalog + custom products | `/api/wholesale/catalog`, `/api/farm/products`, `/api/inventory/:farmId` |
| **farm_heartbeats** | farm_id + timestamp | cpu_usage, memory_usage, disk_usage, metadata | Server health telemetry | Admin dashboard KPIs |
| **farm_backups** | `farm_id` (FK→farms) | groups, rooms, schedules, config (all JSONB) | Disaster recovery snapshots | `/api/sync/restore` |

### Product & Agriculture Tables

| Table | Primary Key | Purpose |
|-------|------------|---------|
| **products** | sku_id + farm_id | Synced product inventory from edge |
| **planting_assignments** | farm_id + group_id | Crop selection per grow group |
| **experiment_records** | farm_id + crop + recorded_at | AI harvest outcome data |
| **crop_benchmarks** | crop (UNIQUE) | Nightly aggregated yield benchmarks |
| **network_recipe_modifiers** | singleton | AI Phase 3 recipe adjustments |
| **loss_events** | farm_id + crop + timestamp | Plant loss tracking with environment snapshot |

### Wholesale / Commerce Tables

| Table | Primary Key | Purpose |
|-------|------------|---------|
| **wholesale_buyers** | email (UNIQUE) | Buyer accounts (self-registration) |
| **wholesale_orders** | master_order_id (UNIQUE) | Persistent order records |
| **payment_records** | payment_id (UNIQUE) | Payment tracking |
| **farm_delivery_settings** | farm_id (UNIQUE) | Delivery service configuration |
| **farm_delivery_windows** | farm_id + window_id | Delivery time slots |
| **farm_delivery_zones** | farm_id + zone_id | Geographic delivery zones |

### Admin / Auth Tables

| Table | Primary Key | Purpose |
|-------|------------|---------|
| **admin_users** | email (UNIQUE) | Central admin accounts |
| **admin_sessions** | admin_id + token_hash | Admin session management (DB_ENABLED=true) |
| **admin_audit_log** | auto-increment | Admin action audit trail |
| **audit_log** | auto-increment | General system audit trail |

### Grant Wizard Tables (Migrations 011-017)

| Table | Purpose |
|-------|---------|
| **grant_users** | Grant wizard user accounts |
| **grant_programs** | Government grant programs |
| **grant_applications** | User grant applications |
| **grant_export_packs** | Export packages |
| + 5 more analytics/tracking tables | Change alerts, research jobs, outcomes |

---

## 3. PostgreSQL Database Tables — Foxtrot Farm Runtime

Schema defined in: `lib/database.js`

| Table | Primary Key | Purpose |
|-------|------------|---------|
| **farms** | farm_id | Local farm registry |
| **users** | farm_id + email | Farm runtime user accounts (separate from Central farm_users) |
| **farm_inventory** | farm_id + sku_id | Local inventory with reservation tracking |
| **wholesale_reservations** | order_id | Active checkout holds (TTL-based) |
| **wholesale_deductions** | order_id + sku_id | Confirmed inventory deductions |
| **farm_api_keys** | farm_id | API key management for sync auth |
| **qa_checkpoints** | batch_id + checkpoint_type | Quality control checks |
| **qa_standards** | checkpoint_type | QA criteria definitions |
| **qa_photos** | checkpoint_id | QA photo evidence |
| **farm_metadata** | farm_id | Dashboard analytics cache |
| **admin_users** | email | Farm runtime admin accounts |
| **farm_delivery_settings/windows/zones** | Same as Central | Local delivery config |

---

## 4. farmStore — Key-Value Store (farm_data table)

**Abstraction layer:** `greenreach-central/lib/farm-data-store.js`  
**Table:** `farm_data` with columns `(farm_id, data_type, data JSONB, updated_at)`

### Resolution Order (per .get() call):
1. PostgreSQL: `SELECT data FROM farm_data WHERE farm_id=$1 AND data_type=$2`
2. In-Memory Map: `inMemoryStore[data_type].get(farmId)`
3. Flat JSON File: `public/data/{fallback_file}` (single-tenant mode only)
4. Default value: Empty array `[]` or object `{}`

### Known data_type Keys

| data_type | JSON Fallback File | Default | Primary API Consumer |
|-----------|-------------------|---------|---------------------|
| `groups` | groups.json | `[]` | `/api/groups`, `/api/sync/groups`, admin panel |
| `rooms` | rooms.json | `[]` | `/api/rooms`, `/api/sync/rooms`, admin panel |
| `schedules` | schedules.json | `[]` | `/api/sync/schedules` |
| `telemetry` | env.json | `{ zones: [] }` | `/api/env`, AI insights |
| `devices` | iot-devices.json | `[]` | `/api/sync/device-integrations` |
| `farm_profile` | farm.json | `null` | `/api/farm/profile`, setup wizard |
| `config` | configuration.json | `{}` | `/api/sync/config` |
| `tray_formats` | tray-formats.json | `[]` | Tray management |
| `trays` | trays.json | `[]` | Tray tracking |
| `crop_pricing` | crop-pricing.json | `{ crops: [] }` | `/api/crop-pricing` |
| `dedicated_crops` | dedicated-crops.json | `[]` | Wholesale crop assignments |
| `room_map` | room-map.json | `{}` | `/data/room-map.json` |
| `inventory` | inventory.json | `[]` | `/api/sync/inventory` |
| `procurement_catalog` | procurement-catalog.json | `{ products: [] }` | `/api/procurement` |
| `procurement_suppliers` | procurement-suppliers.json | `{ suppliers: [] }` | `/api/procurement` |
| `procurement_orders` | procurement-orders.json | `{ orders: [] }` | `/api/procurement` |
| `nutrient_dashboard` | — | `{}` | Nutrient monitoring |
| `quality_tests` | — | `[]` | `/api/quality-tests` |
| `room_layouts` | — | `{}` | `/api/room-mapper` |
| `harvest_records` | — | `[]` | `/api/harvest-records` |
| `ai_decisions` | — | `[]` | `/api/ai-decisions` |
| `plans` | plans.json | `[]` | Production planning |

---

## 5. NeDB Stores — Foxtrot Farm Runtime

### Core NeDB Stores (`server-foxtrot.js`)

| File Path | Purpose |
|-----------|---------|
| `data/devices.nedb` | IoT device registry |
| `data/notifications.db` | User notifications |
| `data/notification-prefs.db` | Notification preferences |
| `data/wizard-states.db` | Setup wizard persistence |
| `data/trays.db` | Tray registry |
| `data/tray-runs.db` | Tray grow cycle runs |
| `data/tray-formats.db` | Tray format definitions |
| `data/tray-placements.db` | Tray physical placements |
| `data/tray-loss-events.db` | Loss event tracking |
| `data/applied-recipes.db` | AI recipe parameters per group per day |
| `data/harvest-outcomes.db` | AI harvest experiment records |
| `data/agent-audit.db` | AI agent action audit |

### Inventory NeDB Stores

| File Path | Purpose |
|-----------|---------|
| `data/db/seeds-inventory.db` | Seeds inventory |
| `data/db/packaging-inventory.db` | Packaging inventory |
| `data/db/nutrients-inventory.db` | Nutrients inventory |
| `data/db/equipment-inventory.db` | Equipment inventory |
| `data/db/supplies-inventory.db` | General supplies |

### Wholesale NeDB Stores (`lib/wholesale/`)

| File Path | Purpose |
|-----------|---------|
| `data/wholesale-orders.db` | Master wholesale orders |
| `data/wholesale-sub-orders.db` | Farm sub-orders |
| `data/farm-perf-events.db` | Farm performance metrics |
| `data/inventory-reservations.db` | Checkout inventory holds (TTL) |
| `data/wholesale-payments.db` | Payment reconciliation |
| `data/wholesale-refunds.db` | Refund records |
| `data/wholesale-sla-rules.db` | SLA rule definitions |
| `data/wholesale-substitution-policies.db` | Product substitution policies |
| `data/wholesale-buyer-preferences.db` | Buyer preference profiles |
| `data/wholesale-sla-violations.db` | SLA violation records |
| `data/stripe-accounts.db` | Stripe Connect accounts |

---

## 6. JSON Data Files

### Central (`greenreach-central/public/data/`)
Static files served to frontend, **overridden by farmStore** via middleware when DB has tenant data:

`farm.json`, `groups.json`, `rooms.json`, `lighting-recipes.json`, `crop-registry.json`, `env.json`, `iot-devices.json`, `schedules.json`, `configuration.json`, `room-map.json`, `crop-pricing.json`, `tray-formats.json`, `wholesale-products.json`

### Foxtrot Farm Runtime (`public/data/`)
Same set as Central plus farm-runtime-specific:

`harvest-log.json`, `lights-catalog.json`, `nutrient-profiles.json`, `field-mappings.json`, `rooms-metadata.json`, `benchmark-seed.json`, `demand-succession-suggestions.json`, `procurement-catalog.json`, `network-recipe-modifiers.json`, `market-intelligence-cache.json`, `ai-recommendations.json`

### Central Server-Side (`greenreach-central/data/`)
`ai-rules.json`, `automation/`, `recipes-v2/`

---

## 7. API Endpoint → Storage Mapping

### Authentication Endpoints

| Endpoint | Method | Storage | Notes |
|----------|--------|---------|-------|
| `/api/farm/auth/login` | POST | **farm_users** JOIN **farms** | Translates `{farmId}` → `{farm_id}`. Fallback: `ADMIN_PASSWORD` env var |
| `/api/auth/login` | POST | **farm_users** JOIN **farms** | Direct farm auth (Central internal) |
| `/api/admin/auth/login` | POST | **admin_users** → **admin_sessions** | Creates session + audit log entry |
| `/api/admin/auth/verify` | GET | **admin_sessions** JOIN **admin_users** | Validates admin JWT + session |
| `/api/wholesale/buyers/login` | POST | **wholesale_buyers** | Separate JWT secret |
| `/api/wholesale/buyers/register` | POST | INSERT **wholesale_buyers** | Self-service registration |

### Farm Data Endpoints

| Endpoint | Method | Storage Source | Resolution Chain |
|----------|--------|---------------|-----------------|
| `/api/farm/profile` | GET | **farms** table + farmStore(`farm_profile`) | DB farms → farmStore → farm.json |
| `/api/rooms` | GET | farmStore(`rooms`) | farm_data → in-memory → rooms.json |
| `/api/groups` | GET | farmStore(`groups`) | farm_data → in-memory → groups.json |
| `/api/recipes` | GET | farmStore or lighting-recipes.json | Global recipes, not farm-scoped |
| `/api/setup-wizard/status` | GET | farmStore(`farm_profile`) + COUNT(rooms) | Checks `setup_completed` flag |
| `/api/setup-wizard/complete` | POST | farmStore.set (profile, rooms, groups) | Writes to farm_data |
| `/data/rooms.json` | GET | farmStore(`rooms`) via pre-serve middleware | Overrides static file |
| `/data/groups.json` | GET | farmStore(`groups`) via pre-serve middleware | Overrides static file |
| `/data/room-map.json` | GET | farmStore(`room_map`) | Overrides static file |

### Sync Endpoints (Farm Runtime → Central)

| Endpoint | Method | Writes To | data_type |
|----------|--------|-----------|-----------|
| `/api/sync/rooms` | POST | **farm_data** + in-memory + rooms.json | `rooms` |
| `/api/sync/groups` | POST | **farm_data** + in-memory + groups.json | `groups` |
| `/api/sync/schedules` | POST | **farm_data** + in-memory | `schedules` |
| `/api/sync/config` | POST | **farm_data** | `config` |
| `/api/sync/inventory` | POST | **farm_data** + **farm_inventory** | `inventory` |
| `/api/sync/telemetry` | POST | **farm_data** + in-memory | `telemetry` |
| `/api/sync/heartbeat` | POST | **farms**.last_heartbeat + **farm_heartbeats** | — |
| `/api/sync/farm-registration` | POST | **farms** table (UPSERT) | — |
| `/api/sync/device-integrations` | POST | **farm_data** | `devices` |

### Admin Endpoints

| Endpoint | Method | Storage Source |
|----------|--------|---------------|
| `/api/admin/farms` | GET | **farms** table |
| `/api/admin/farms/:farmId` | GET | **farms** + **farm_data** (groups, rooms, telemetry) |
| `/api/admin/farms/:farmId/rooms` | GET | **farm_data** WHERE data_type='rooms' |
| `/api/admin/farms/:farmId/groups` | GET | **farm_data** WHERE data_type='groups' |
| `/api/admin/farm-users` | GET | **farm_users** table |
| `/api/admin/farm-users/reset-password` | POST | UPDATE **farm_users** password_hash |
| `/api/admin/farm-users/create` | POST | UPSERT **farm_users** |
| `/api/admin/farms/:farmId/mark-setup-complete` | POST | UPDATE **farms** setup_completed |
| `/api/admin/users` | GET/POST | **admin_users** table |
| `/api/admin/kpis` | GET | Aggregates: farms, farm_data, wholesale_orders |

### Wholesale Endpoints

| Endpoint | Method | Storage Source |
|----------|--------|---------------|
| `/api/wholesale/catalog` | GET | **farm_inventory** JOIN **farms** |
| `/api/wholesale/checkout/preview` | POST | **farm_inventory** (read) |
| `/api/wholesale/checkout/execute` | POST | NeDB orders + PostgreSQL wholesale_orders + payment_records |
| `/api/wholesale/orders` | GET | NeDB wholesale-orders.db |
| `/api/wholesale/delivery/quote` | POST | **farm_delivery_zones** + **farm_delivery_settings** |

---

## 8. Data Sync Flow (Farm Runtime ↔ Central)

### Push Flow (Farm Runtime → Central)
```
Foxtrot server-foxtrot.js
  │ Reads: JSON files (groups.json, rooms.json, etc.)
  │ Auth: X-API-Key header (farm_api_keys table)
  │
  └─► POST /api/sync/{data_type}
       │
       ├─ 1. Validate API key → find farm_id
       ├─ 2. UPSERT farm_data (farm_id, data_type, JSONB)
       ├─ 3. Update in-memory Map: inMemoryStore[type].set(farmId, data)
       └─ 4. Write flat file backup: public/data/{type}.json
```

### Pull Flow (Central → Farm Runtime)
```
Foxtrot requests data from Central:
  └─► GET /api/sync/:farmId/{data_type}
       └─ Reads from farm_data table → returns JSONB
```

### Startup Hydration (Central)
```
Central server start → hydrateFromDatabase()
  └─ SELECT farm_id, data_type, data FROM farm_data
     └─ Populates in-memory Maps:
        rooms, groups, schedules, inventory, telemetry, devices, config
```

---

## 9. Authentication Data Flow

### Farm User Login
```
login.html → POST /api/farm/auth/login { farmId, password }
  │
  ├─ server.js wrapper: translates farmId → farm_id, wraps response
  │
  └─► routes/auth.js POST /login
       │
       ├─ DB Mode (farm_users COUNT > 0):
       │   SELECT fu.*, f.name FROM farm_users fu
       │     JOIN farms f ON fu.farm_id = f.farm_id
       │     WHERE fu.farm_id = $1 AND fu.role = 'admin'
       │   → bcrypt.compare(password, password_hash)
       │   → jwt.sign({ farm_id, user_id, role, email }, JWT_SECRET, 24h)
       │
       └─ Fallback Mode (no farm_users match):
           Compare password against env ADMIN_PASSWORD
           → jwt.sign({ farm_id, role: 'admin' }, JWT_SECRET, 24h)

Token stored: localStorage('token', 'farm_id', 'farm_name', 'planType')
```

### Admin Login
```
POST /api/admin/auth/login { email, password }
  │
  ├─ DB Mode (DB_ENABLED=true):
  │   SELECT * FROM admin_users WHERE email = $1
  │   → Check locked_until, active, failed_attempts
  │   → bcrypt.compare → generateAdminToken (12h)
  │   → INSERT admin_sessions (token_hash, expires_at)
  │   → INSERT admin_audit_log (LOGIN_SUCCESS)
  │
  └─ Fallback Mode (dev only):
      Compare against ADMIN_FALLBACK_PASSWORD
```

### Admin Auth Middleware
```
adminAuthMiddleware:
  ├─ DB Mode: Verify JWT + JOIN admin_sessions (token_hash) + check expires_at
  └─ JWT Mode: Trust JWT payload only
```

### Farm Auth Middleware
```
authMiddleware:
  → jwt.verify(token, JWT_SECRET)
  → req.farmId = decoded.farm_id
  → req.user = { email, role, user_id }
```

### Wholesale Buyer Auth
```
POST /api/wholesale/buyers/login { email, password }
  → SELECT * FROM wholesale_buyers WHERE email = $1
  → bcrypt.compare → jwt.sign (WHOLESALE_JWT_SECRET)

requireBuyerAuth middleware:
  → jwt.verify(token, WHOLESALE_JWT_SECRET)
  → req.buyer = decoded
```

---

## 10. Key Data Resolution Chains

### When user opens farm dashboard:
```
1. login.html → POST /api/farm/auth/login → farm_users JOIN farms → JWT
2. LE-dashboard.html → GET /api/setup-wizard/status → farms.setup_completed + farm_data('rooms') count
3. Dashboard loads → GET /api/farm/profile → farms table + farmStore('farm_profile')
4. Dashboard loads → GET /api/rooms → farmStore('rooms') → farm_data → in-memory → rooms.json
5. Dashboard loads → GET /api/groups → farmStore('groups') → farm_data → in-memory → groups.json
6. Dashboard loads → GET /api/recipes → farmStore or lighting-recipes.json
```

### When Farm Runtime syncs to Central:
```
1. Foxtrot reads local JSON files (groups.json, rooms.json, etc.)
2. POST /api/sync/groups with X-API-Key header
3. Central validates API key → finds farm_id
4. UPSERT farm_data(farm_id, 'groups', JSONB)
5. Update in-memory Map
6. Write backup to public/data/groups.json
```

### When admin views farm in dashboard:
```
1. POST /api/admin/auth/login → admin_users → admin_sessions → JWT
2. GET /api/admin/farms → farms table (list)
3. GET /api/admin/farms/:farmId → farms + farm_data(groups, rooms, telemetry, devices)
4. GET /api/admin/farms/:farmId/rooms → farm_data WHERE data_type='rooms'
```

---

## 11. Common Debugging Scenarios

### "Farm login fails"
1. Check `farm_users` table: `GET /api/admin/farm-users?farm_id=FARM-xxx`
2. If no users → ADMIN_PASSWORD env var must be set
3. If users exist → password_hash must match (use `/api/admin/farm-users/reset-password`)
4. Check `farms` table: farm must have `status = 'active'`

### "Setup wizard keeps showing"
1. Check `farms.setup_completed`: `GET /api/admin/farms/:farmId` → look for `setup_completed`
2. Check farmStore: `GET /api/setup-wizard/status` with farm JWT
3. Fix: `POST /api/admin/farms/:farmId/mark-setup-complete`
4. Note: Wizard also checks room count in farm_data

### "Farm data not loading (rooms, groups, recipes)"
1. Check farm JWT is valid (not expired, correct farm_id)
2. Verify farmStore has data: `GET /api/admin/farms/:farmId/rooms` and `/groups`
3. Check if farm runtime has synced recently: `GET /api/admin/farms/:farmId` → last_heartbeat
4. Verify static fallback files exist: `GET /data/rooms.json`, `/data/groups.json`

### "Admin dashboard returns 401"
1. Check admin_users exists in DB: query via admin login
2. Verify admin_sessions not expired
3. Check DB_ENABLED env var — if true, session must exist in admin_sessions table
4. Re-login to create fresh session

### "Wholesale catalog empty"
1. Check farm_inventory table has entries for active farms
2. Verify farm status = 'active' in farms table
3. Check if farm runtime inventory sync has run: farm_data WHERE data_type='inventory'


---

## 13. Custom Product Feature — Data Flow

### Overview
Custom products allow farms to add non-automated (user-defined) products to the wholesale catalog. These products are stored in the shared `farm_inventory` table alongside auto-synced and manually entered items, distinguished by `is_custom = TRUE` and `inventory_source = 'custom'`.

### Database Schema (farm_inventory — custom product columns)

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | SERIAL | auto | Primary key |
| `farm_id` | TEXT | required | Farm identifier |
| `product_id` | TEXT | generated | Derived from product name (slugified) |
| `product_name` | TEXT | required | Display name |
| `sku` | TEXT | generated | Format: `CUSTOM-{FARM_SHORT}-{RANDOM_HEX}-{TIMESTAMP_HEX}` |
| `category` | TEXT | null | Product category (Leafy Greens, Herbs, Microgreens, Mix, Bundle, etc.) |
| `variety` | TEXT | null | Product variety |
| `description` | TEXT | null | Product description displayed in catalog and invoices |
| `is_custom` | BOOLEAN | TRUE | Distinguishes custom vs auto-synced products |
| `is_taxable` | BOOLEAN | TRUE | Per-item tax flag; FALSE exempts from tax calculation |
| `wholesale_price` | NUMERIC | required | Price charged to wholesale buyers |
| `retail_price` | NUMERIC | null | Retail reference price |
| `price` | NUMERIC | COALESCE(wholesale, retail) | Fallback price field |
| `quantity_available` | NUMERIC | required | Available stock in specified unit |
| `quantity` | NUMERIC | = qty_available | Alias for compatibility |
| `unit` | TEXT | 'lb' | Unit of measure (lb, oz, bunch, unit, bag, etc.) |
| `available_for_wholesale` | BOOLEAN | TRUE | Whether product appears in wholesale catalog |
| `inventory_source` | TEXT | 'custom' | Source tag: auto, manual, hybrid, custom |
| `status` | TEXT | 'active' | Lifecycle: active, inactive (soft-delete) |
| `thumbnail_url` | TEXT | null | Product image path (uploaded via multer, 2MB max) |
| `created_at` | TIMESTAMPTZ | NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOW() | Last modification timestamp |

### API Endpoints — Custom Products

| Endpoint | Method | Auth | Storage | Description |
|----------|--------|------|---------|-------------|
| `/api/farm/products` | GET | Farm JWT | `farm_inventory WHERE is_custom = TRUE AND status != 'inactive'` | List all custom products for authenticated farm |
| `/api/farm/products/:productId` | GET | Farm JWT | `farm_inventory WHERE id = $1 AND is_custom = TRUE AND status != 'inactive'` | Get single custom product |
| `/api/farm/products` | POST | Farm JWT | INSERT `farm_inventory` | Create custom product (generates SKU, sets is_custom=TRUE) |
| `/api/farm/products/:productId` | PUT | Farm JWT | UPDATE `farm_inventory` | Update custom product fields |
| `/api/farm/products/:productId` | DELETE | Farm JWT | UPDATE `farm_inventory SET status = 'inactive'` | Soft-delete (sets status to inactive) |
| `/api/farm/products/:productId/thumbnail` | POST | Farm JWT | UPDATE `farm_inventory SET thumbnail_url` + file disk | Upload product thumbnail (multer, 2MB, jpeg/png/webp/gif) |

**Route file:** `greenreach-central/routes/custom-products.js`
**Mounted at:** `greenreach-central/server.js` via `app.use('/api/farm/products', customProductsRouter)`
**Auth middleware:** `farmAuthMiddleware` (JWT from farm login)

### SKU Generation

```
Format: CUSTOM-{FARM_SHORT}-{RANDOM}-{TIMESTAMP}
Example: CUSTOM-MLTP9LVH-A1B2C3D4-18F3C5A2B1

Components:
  FARM_SHORT = farm_id stripped of "FARM-" prefix, first 8 chars
  RANDOM     = crypto.randomBytes(4).toString('hex').toUpperCase()
  TIMESTAMP  = Date.now().toString(16).toUpperCase()
```

### Data Flow: Custom Product Creation to Invoice

```
1. CREATION
   Farm Admin UI (central-admin.js: showAddProductModal)
     -> POST /api/farm/products
     -> INSERT farm_inventory (is_custom=TRUE, inventory_source='custom', status='active')
     -> Optional: POST /api/farm/products/:id/thumbnail (image upload)

2. CATALOG VISIBILITY
   Wholesale Catalog (routes/wholesale/catalog.js)
     -> SELECT FROM farm_inventory
        WHERE available_for_wholesale = true
        AND COALESCE(quantity_available, quantity, 0) > 0
        AND COALESCE(status, 'active') != 'inactive'
     -> Returns: sku, product_name, description, wholesale_price, is_taxable,
                 thumbnail_url, quantity_available, unit, category, is_custom

3. ORDER ALLOCATION
   Order Allocator (lib/wholesale/order-allocator.js)
     -> Groups line items by farm
     -> Each line item includes: is_taxable, description, unit_price, qty
     -> Tax calculation: per-item based on is_taxable flag
        taxable_subtotal = SUM(line_total WHERE is_taxable != false)
        tax_amount = ROUND(taxable_subtotal * tax_rate, 2)

4. INVOICE GENERATION
   Invoice Generator (lib/wholesale/invoice-generator.js)
     -> assembleInvoice() copies is_taxable and description to invoice line items
     -> HTML render shows product name, qty, unit, price, total
     -> Description and tax indicator displayed for custom products

5. PAYMENT
   Checkout (routes/wholesale/checkout.js)
     -> Square Payments API
     -> Broker fee: 12% of subtotal (WHOLESALE_COMMISSION_RATE=0.12)
     -> app_fee_money = broker fee amount in cents
     -> Tax collected separately per farm sub-order

6. INVENTORY DEDUCTION
   After confirmed payment:
     -> UPDATE farm_inventory SET quantity_available = quantity_available - ordered_qty
     -> Reservation released
```

### Farm Inventory Dashboard — Data Access

The farm inventory dashboard (`greenreach-central/public/views/farm-inventory.html`) displays ALL inventory types in a unified table:

| Endpoint | Router | Query |
|----------|--------|-------|
| `GET /api/inventory/:farmId` | `routes/inventory-manual.js` | `SELECT * FROM farm_inventory WHERE farm_id = $1 AND COALESCE(status, 'active') != 'inactive'` |

**Response fields per item:**
- `product_name`, `product_id`, `sku`
- `auto_quantity_lbs`, `manual_quantity_lbs`, `available_lbs` (computed)
- `retail_price`, `wholesale_price`
- `inventory_source` (auto, manual, hybrid, custom)
- `is_custom`, `description`, `thumbnail_url`

**Source badge colors in UI:**
- `auto` = blue
- `manual` = green
- `hybrid` = yellow
- `custom` = purple

**Delete behavior:**
- `manual`/`hybrid` items: Remove button available (DELETE /api/inventory/manual/:productId)
- `custom` items: Managed via admin product catalog (no delete from inventory page)
- `auto` items: No delete button (system-managed)

### Admin Product Catalog — Central Admin UI

**File:** `greenreach-central/public/central-admin.js`

| Function | Purpose |
|----------|---------|
| `renderProductCatalog(products)` | Renders catalog table with Custom badges, descriptions, edit/delete buttons |
| `showAddProductModal(editData)` | Full modal form for creating/editing custom products |
| `saveCustomProduct(productId)` | POST/PUT to /api/farm/products with optional FormData image upload |
| `editProduct(sku)` | Routes custom products to full edit form, auto products to pricing-only modal |
| `deleteProduct(sku)` | Soft-deletes custom product via DELETE /api/farm/products/:id |
| `_catalogProductsCache` | In-memory array populated by renderProductCatalog, used for edit/delete lookups |

**Data source:** `GET /api/wholesale/catalog` -> products array -> renderProductCatalog -> _catalogProductsCache

### Inventory Source Types

| Source | How Created | Delete Behavior | Managed By |
|--------|------------|-----------------|------------|
| `auto` | Sync from farm runtime tray/harvest data | Cannot delete (system-managed) | Tray management, harvest pipeline |
| `manual` | User adds via farm-inventory.html form | Full delete from farm_inventory | Farm admin |
| `hybrid` | Manual entry overlaid on auto data | Zeros manual portion, preserves auto | Farm admin |
| `custom` | Created via /api/farm/products POST | Soft-delete (status='inactive') | Central admin product catalog |


---

## 14. Issue Log

### 2026-03-01: Farm Login Failure (FARM-MLTP9LVH-B0B85039)

**Problem:** Farm login returned "Invalid email or password" for The Notable Sprout.

**Root Cause:** The `farm_users` table had an entry for `admin@greenreachgreens.com` with a bcrypt password hash that did not match the user's password (`admin123`). The auth code found the user in DB mode and bcrypt.compare() failed. The fallback mode (ADMIN_PASSWORD env var) was never reached because a farm_users entry existed.

**How the mismatch occurred:** The farm_users entry was likely created with a different password during an earlier setup/sync operation. The user always used `admin123` as the farm password via the old fallback auth path (ADMIN_PASSWORD), but when user-based DB auth became primary, the stored hash didn't match.

**Fix Applied:**
1. Added admin endpoints: `POST /api/admin/farm-users/reset-password`, `POST /api/admin/farm-users/create`, `POST /api/admin/farms/:farmId/mark-setup-complete`
2. Set `ADMIN_PASSWORD=admin123` env var on Central production (safety fallback)
3. Used new admin endpoint to reset farm_users password_hash to bcrypt('admin123')
4. Marked `farms.setup_completed = true` for this farm

**Data Path:** `login.html` → `POST /api/farm/auth/login` → `routes/auth.js` → `farm_users` table JOIN `farms` → bcrypt compare → JWT

**Lesson:** Always verify both the data path AND the stored data when debugging auth issues. The code path may be correct but the data may be stale or incorrect.

### 2026-03-01: Central Farm Detail Loaded Only Registration Info (401 on rooms/inventory/telemetry)

**Problem:** In GreenReach Central, farm detail pages showed basic registration metadata but failed to load operational sections (Rooms, Inventory, Environmental), with browser errors showing `HTTP 401` on `rooms`, `inventory`, and `telemetry` requests.

**Root Cause:** `greenreach-central/public/central-admin.js` still called sync-auth endpoints (`/api/sync/:farmId/rooms`, `/api/sync/:farmId/inventory`, `/api/sync/:farmId/telemetry`) from admin views. Those endpoints are designed for farm API-key auth (`X-API-Key`/`X-Farm-ID`) and can return 401 for admin JWT sessions.

**Fix Applied:**
1. Updated Central admin UI data loaders to use admin endpoints first:
  - `/api/admin/farms/:farmId/rooms`
  - `/api/admin/farms/:farmId/inventory`
  - `/api/admin/farms/:farmId/zones` (for telemetry/environmental data)
2. Kept sync endpoints as fallback only when admin endpoint is unavailable.
3. Deployed to production (`greenreach-central-prod-v4`) and verified admin endpoints return `200`.

**Data Path (Correct for Admin UI):**
`GR-central-admin.html`/`central-admin.js` → `authenticatedFetch` (admin JWT) → `/api/admin/farms/:farmId/*` → `farm_data` (`rooms`, `groups`, `telemetry`, `inventory`) and/or `farm_inventory`

**Verification Snapshot (FARM-MLTP9LVH-B0B85039):**
- `GET /api/admin/farms/:farmId/rooms` → `200`, count `1`
- `GET /api/admin/farms/:farmId/zones` → `200`, count `1`
- `GET /api/admin/farms/:farmId/inventory` → `200`, count `1170`

**Lesson:** Do not use `/api/sync/*` endpoints for Central admin UX flows. Sync routes are integration transport paths (edge/cloud sync auth), while admin dashboards must use `/api/admin/*` routes with admin JWT.


### 2026-03-28: Custom Product Audit Fixes

**Problem:** Comprehensive audit of custom product workflow found 10 issues across backend, frontend, and invoice generation.

**Fixes Applied:**
1. `custom-products.js`: GET single endpoint missing `status != 'inactive'` filter
2. `custom-products.js`: PUT route SQL string quoting broken (single quotes inside single quotes) -- fixed with backtick template literal
3. `custom-products.js`: SKU collision resistance upgraded from `Math.random()` to `crypto.randomBytes(4)`
4. `catalog.js`: Inactive/soft-deleted products appeared in wholesale catalog -- added `COALESCE(status, 'active') != 'inactive'` filter
5. `order-allocator.js`: Tax calculated on full subtotal ignoring `is_taxable` flag -- changed to per-item taxable subtotal
6. `invoice-generator.js`: Line items missing `description` and `is_taxable` fields -- added propagation
7. `central-admin.js`: `renderProductCatalog` rewritten with Custom badges, description preview, delete buttons, quantity display
8. `central-admin.js`: `_catalogProductsCache` was never populated -- added assignment in renderProductCatalog
9. `central-admin.js`: `editProduct`/`deleteProduct` lookup missed `p.id` match -- added `p.id` to find() predicates
10. `farm-inventory.html`: Table header mismatch (6 headers vs 8 columns) -- added Retail/Wholesale headers, fixed colspan
11. `farm-inventory.html`: Custom product source badge (purple CSS), conditional delete button
12. `inventory-manual.js`: GET /:farmId missing inactive status filter -- added `COALESCE(status, 'active') != 'inactive'`

**Data Path:** Custom Product CRUD -> Wholesale Catalog -> Order Allocation -> Invoice -> Payment -> Admin UI -> Farm Inventory Dashboard

**Lesson:** Custom products share `farm_inventory` table with auto/manual entries. All queries must filter by `status != 'inactive'` to exclude soft-deleted custom products. Tax calculation must be per-item based on `is_taxable` flag, not blanket subtotal.

### 2026-03-28: Farm Sync Rejected With Invalid API Key (FARM-MLTP9LVH-B0B85039)

**Problem:** FAYE reported farm sync failure. Central rejected both `/api/sync/heartbeat` and `/api/sync/telemetry` with `Invalid API key` for `FARM-MLTP9LVH-B0B85039`.

**Root Cause:** API key drift between LE runtime key (`config/edge-config.json`) and Central DB (`farms.api_key`) combined with strict fallback gating in `public/data/farm-api-keys.json` (`status: migrated`, `api_key: MOVED_TO_DATABASE`). This prevented fallback auth during key drift.

**Fix Applied:**
1. Updated fallback key entry in `public/data/farm-api-keys.json` for `FARM-MLTP9LVH-B0B85039` to the active LE key and set `status: active`.
2. Updated sync reconciliation in `routes/sync.js` for `/api/sync/heartbeat` and `/api/sync/health` UPSERT logic:
  - from `api_key = COALESCE(farms.api_key, EXCLUDED.api_key)`
  - to `api_key = EXCLUDED.api_key`
3. Deployed Central (`greenreach-central-prod-v4`) so the next valid heartbeat can self-heal `farms.api_key` and restore steady-state auth.

**Data Path:** LE runtime -> `POST /api/sync/heartbeat` (`X-Farm-ID`, `X-API-Key`) -> `authenticateFarm` (`isValidFarmApiKey`) -> `farms` UPSERT (`api_key` reconciliation) -> telemetry ingest (`farm_data` `data_type='telemetry'`)

**Verification Snapshot:**
- `POST /api/sync/heartbeat` with farm key returns `success: true`
- `POST /api/sync/telemetry` with farm key returns `success: true`
- `farms.last_heartbeat` advances for `FARM-MLTP9LVH-B0B85039`
- `farm_data.updated_at` advances for telemetry row

**Lesson:** When key migration leaves fallback entries in non-active state, any DB key drift can deadlock sync auth. Heartbeat should reconcile `farms.api_key` from authenticated requests to avoid manual DB intervention.

### 2026-03-28: EVIE/FAYE Chat Memory Lost After UI Reload

**Problem:** EVIE and FAYE appeared to "forget" chat context after page refresh even though backend conversation tables were active.

**Root Cause:** Presence frontends initialized `conversationId` in memory only (`null` on reload) and did not restore it from browser storage. Backend memory persisted by `(farm_id/admin_id, conversation_id)`, so missing `conversation_id` from the client caused a new conversation chain each reload.

**Fix Applied:**
1. Added scoped browser persistence for conversation IDs:
  - `public/js/evie-presence.js` and root mirror `../public/js/evie-presence.js`: `evie_presence_conversation_id:<farmId>`
  - `public/js/faye-presence.js`: `faye_presence_conversation_id:<admin_email>`
2. On successful chat response, scripts now save returned `conversation_id` and reuse it on subsequent requests.

**Data Path:** Presence UI localStorage key -> `POST /api/assistant/chat` or `POST /api/admin/assistant/chat` with `conversation_id` -> conversation table upsert/read (`conversation_history` or `admin_assistant_conversations`)

**Verification Snapshot:**
- Send message in EVIE/FAYE presence panel, refresh page, send follow-up.
- Follow-up request continues prior conversation thread instead of starting a new UUID thread.

**Lesson:** Persistent backend memory requires client-side conversation key continuity. UI reload-safe conversation ID storage is mandatory for perceived memory.

### 2026-03-28: Security Audit Failed on Missing `farm_heartbeats.last_seen_at`

**Problem:** Security audit routines failed with missing-column errors (`last_seen_at`) and could not complete stale-connection checks.

**Root Cause:** Legacy `farm_heartbeats` schema only guaranteed `timestamp`, `cpu_usage`, `memory_usage`, `disk_usage`. Security tooling later assumed compatibility columns (`last_seen_at`, `farm_name`, percent fields) existed.

**Fix Applied:**
1. Added migration 048 in `config/database.js`:
  - Adds `last_seen_at`, `farm_name`, `cpu_percent`, `memory_percent`, `disk_percent`, `uptime_seconds`, `node_version`
  - Backfills from existing columns (`timestamp` and usage fields)
  - Adds index on `last_seen_at`
2. Updated heartbeat write path (`routes/farms.js`) to populate compatibility columns on insert.
3. Hardened `run_security_audit` stale heartbeat query to use `COALESCE(last_seen_at, timestamp)`.

**Data Path:** `POST /api/farms/:farmId/heartbeat` -> `farm_heartbeats` insert (compatibility fields) -> `run_security_audit` / freshness checks -> stale-connection findings

**Verification Snapshot:**
- `run_security_audit` executes without missing-column failure.
- Stale connection checks return finding objects instead of query errors.

**Lesson:** Security analytics must include explicit schema compatibility migrations whenever they depend on new telemetry fields.
