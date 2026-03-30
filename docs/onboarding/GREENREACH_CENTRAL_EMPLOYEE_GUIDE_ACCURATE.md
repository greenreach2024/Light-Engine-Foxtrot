# GreenReach Central: Accurate Employee Operations Guide

**Version**: 3.0 (CODE-VERIFIED)  
**Date**: February 2, 2026  
**Author**: Verified against actual codebase  
**Status**: PRODUCTION ACCURATE - No speculation

---

## ⚠️ Critical Disclaimer

**This guide reflects ONLY what actually exists in production code.** Previous versions contained aspirational features, incorrect URLs, and unimplemented functionality. This version is verified line-by-line against the codebase.

---

## Table of Contents

1. [What Actually Exists](#what-actually-exists)
2. [Actual System Architecture](#actual-system-architecture)
3. [Admin Dashboard (Real Pages)](#admin-dashboard-real-pages)
4. [Wholesale Platform (Actual Status)](#wholesale-platform-actual-status)
5. [Farm Sync System](#farm-sync-system)
6. [Room Mapper Tool](#room-mapper-tool)
7. [AI Features (What's Real)](#ai-features-whats-real)
8. [Database Structure](#database-structure)
9. [API Endpoints (Complete List)](#api-endpoints-complete-list)
10. [Troubleshooting Real Issues](#troubleshooting-real-issues)

---

## What Actually Exists

### Production Deployment

**AWS Elastic Beanstalk:**
- Environment: `greenreach-central-prod-v3`
- Region: us-east-1
- URL: `greenreach-central.us-east-1.elasticbeanstalk.com` (NOT greenreachgreens.com)
- Server: Node.js 20 on Amazon Linux 2023
- Process: PM2-managed `server.js`

**Database:**
- Type: PostgreSQL (AWS RDS)
- Connection: Via `pg` Pool
- Schema: Migrations in `greenreach-central/config/database.js`
- Tables: farms, zones, rooms, devices, groups, schedules, telemetry, orders, buyers, payments, wholesale_lots, alerts, ai_insights

**Server Code:**
- Main: `greenreach-central/server.js` (344 lines)
- Port: 3000 (env: PORT) + WebSocket 3001 (env: WS_PORT)
- Routes: 16 route files in `greenreach-central/routes/`
- Public UI: `greenreach-central/public/` (57 HTML files)

### Currently Connected Farms

**Big Green Farm:**
- Farm ID: `FARM-MKLOMAT3-A9D8`
- Location: Kingston, Ontario, Canada
- Owner: Shelby Gilbert
- Edge Device: reTerminal @ 100.65.187.59
- Software: Light Engine Foxtrot (server-foxtrot.js)
- Sync: Every 5 minutes via `/api/sync/heartbeat`
- Database: NeDB (local edge storage)

---

## Actual System Architecture

### What Central Actually Does

```
GreenReach Central Server (AWS)
├─ Admin Dashboard (monitoring all farms)
├─ Wholesale Catalog Aggregator (pulls farm inventory)
├─ Farm Sync Receiver (POST /api/sync/* endpoints)
├─ Buyer Portal (wholesale.html)
└─ PostgreSQL Database (stores aggregated data)

Edge Device (Light Engine @ Farm)
├─ Farm Dashboard (LE-dashboard.html)
├─ Environmental Control (recipes, DMX lights, VPD automation)
├─ Inventory Management (groups.json, trays.json)
├─ Wholesale Inventory API (GET /api/wholesale/inventory)
├─ Activity Hub (QR scanning, harvest tracking)
└─ NeDB Database (local farm data)
```

### Data Flow (Verified)

1. **Farm → Central Sync** (every 5 min):
   - `POST /api/sync/heartbeat` - Farm status
   - `POST /api/sync/telemetry` - Environmental data (every 30s)
   - `POST /api/sync/rooms` - Room configuration updates
   - `POST /api/sync/groups` - Crop group updates
   - `POST /api/sync/inventory` - Harvest lot updates

2. **Central → Farm Polling** (every 60 sec):
   - `GET http://100.65.187.59:8091/api/wholesale/inventory` - Live inventory
   - Service: `wholesaleNetworkSync.js` aggregates across all farms
   - Cached in memory: `wholesaleMemoryStore.js`

3. **Buyer Interaction**:
   - Browse: `GET /api/wholesale/catalog` (aggregated SKUs)
   - Checkout: `POST /api/wholesale/checkout/preview` (allocation)
   - Order: `POST /api/wholesale/checkout/execute` (creates order)
   - Farm Notify: `POST http://farm/api/wholesale/order-events` (async)

---

## Admin Dashboard (Real Pages)

### Login Page

**File:** `greenreach-central/public/GR-central-admin-login.html`

**URL:** `https://greenreach-central.us-east-1.elasticbeanstalk.com/GR-central-admin-login.html`

**Authentication:**
- Username: Admin user created in database
- Password: Hashed with bcrypt
- Session: JWT token stored in localStorage
- API: `POST /api/admin/auth/login`

**No Test Accounts:** Must create admin user via database insert or registration endpoint.

### Main Dashboard

**File:** `greenreach-central/public/GR-central-admin.html`  
**JavaScript:** `greenreach-central/public/central-admin.js` (6200+ lines)

**URL:** Same as login, redirects after auth

**Actual Views Available:**

1. **Overview** (default view)
   - KPI Cards: Total Farms, Rooms, Zones, Devices, Trays, Plants
   - Active Groups count
   - Total Production (lbs)
   - Revenue (from wholesale orders)
   - Alert count

2. **Farms** 
   - List of all registered farms
   - Status: Online (synced <10 min) / Offline
   - Click farm → Farm detail view

3. **Farm Detail** 
   - Farm metadata (name, location, owner, contact)
   - Zones list (environmental data per zone)
   - Rooms list (room mapper link)
   - Devices list (sensors, lights, actuators)
   - Groups list (active crop batches)
   - Inventory (harvest lots)

4. **Rooms**
   - Room list across all farms
   - Zone count per room
   - Environmental status

5. **Devices**
   - All IoT devices across network
   - Type: sensor, light, actuator
   - Status: online, offline, error
   - Last seen timestamp

6. **Inventory**
   - Harvest lots ready for sale
   - Growing groups (future inventory)
   - Quantity available, reserved, sold

7. **Recipes**
   - List of crop recipes
   - Recipe details (temperature, humidity, light schedules)
   - Usage stats (how many groups using each recipe)

8. **Environmental Monitoring**
   - Temperature trends
   - Humidity trends
   - VPD calculations
   - PPFD light intensity

9. **Analytics**
   - Aggregate statistics
   - Production trends
   - Environmental compliance %
   - Yield analysis

10. **Alerts**
    - Critical alerts (equipment failure, environmental issues)
    - Warnings (borderline conditions)
    - Farm sync failures

11. **Energy**
    - Energy consumption tracking (if available)
    - Cost analysis
    - Efficiency metrics

12. **Wholesale Admin**
    - Network farms registry
    - Snapshot health (sync status per farm)
    - Orders list
    - Buyer management
    - Payment records

13. **Harvest Forecast**
    - Predicted harvest dates
    - Based on seed date + recipe grow days
    - 7, 14, 30-day windows

14. **Farm Management**
    - Add/edit farm metadata
    - API key management
    - Sync configuration

**What It DOESN'T Have:**
- ❌ Billing/subscription management
- ❌ Fee tracking ($99/$299/$799 tiers)
- ❌ Stripe integration
- ❌ White-label settings
- ❌ Multi-user roles beyond admin
- ❌ Email notification configuration
- ❌ SMS alert setup
- ❌ Advanced analytics (ML model performance dashboards)

---

## Wholesale Platform (Actual Status)

### What Exists

**Buyer Portal:**
- File: `greenreach-central/public/GR-wholesale.html`
- Registration: `POST /api/wholesale/buyers/register`
- Login: JWT authentication (7-day expiry)
- Catalog: Browse aggregated inventory from all farms
- Cart: Add items, preview allocation
- Checkout: Place orders (demo Square nonce - NO REAL PAYMENTS)
- Order History: View past orders

**Admin View:**
- File: `greenreach-central/public/GR-wholesale-admin.html`
- Network tab: Manage farm registry
- Orders tab: View all orders
- Payments tab: View payment records (no actual processing)

### What DOESN'T Exist

- ❌ **NO REAL PAYMENT PROCESSING** - Square integration is stub only
- ❌ **NO ORDER FULFILLMENT TRACKING** - Orders stay in "confirmed" state
- ❌ **NO DELIVERY/SHIPPING** - No carrier integration
- ❌ **NO INVENTORY DEDUCTION** - Farm inventory not updated post-sale
- ❌ **NO FARM PAYOUT** - No split payment disbursement
- ❌ **NO SUBSCRIPTION PROGRAMS** - Weekly/monthly recurring orders not implemented
- ❌ **NO ADVANCED ROUTING** - Farm assignment is basic proximity + availability

**Current Capability:** Buyers can register, browse inventory, place demo orders. Orders create records but don't process payments or update inventory.

---

## Farm Sync System

### Sync Endpoints (Central Receives)

**Route File:** `greenreach-central/routes/sync.js`

**Endpoints:**

1. `POST /api/sync/heartbeat`
   - Farm sends status every 5 minutes
   - Payload: farm_id, api_key, status, uptime, version
   - Response: 200 OK

2. `POST /api/sync/telemetry`
   - Environmental data every 30 seconds
   - Payload: zones[] with temp, humidity, VPD, PPFD
   - Stores in `telemetry` table

3. `POST /api/sync/rooms`
   - Room configuration changes
   - Payload: rooms[] with zones, dimensions, sensors
   - Stores in `rooms` and `zones` tables

4. `POST /api/sync/groups`
   - Crop group updates (new seedings, harvests)
   - Payload: groups[] with crop, seed_date, tray_count, status
   - Stores in `groups` table

5. `POST /api/sync/schedules`
   - Lighting/irrigation schedules
   - Payload: schedules[] with device_id, triggers, actions
   - Stores in `schedules` table

6. `POST /api/sync/inventory`
   - Harvest lots available for sale
   - Payload: lots[] with sku_id, quantity, price, harvest_date
   - Stores in `wholesale_lots` table

7. `POST /api/sync/restore`
   - Backup data from farm
   - Payload: complete farm state snapshot
   - Emergency recovery endpoint

### Wholesale Network Sync (Central Polls Farms)

**Service File:** `greenreach-central/services/wholesaleNetworkSync.js`

**How It Works:**
- Every 60 seconds (configurable via `WHOLESALE_NETWORK_SYNC_MS`)
- Fetches `GET http://<farm_ip>:<port>/api/wholesale/inventory` from each farm
- Aggregates inventory by SKU
- Calculates totals: qty_available, best_price, farm_count
- Stores in memory cache: `wholesaleMemoryStore.js`
- Admin view: `/api/wholesale/network/snapshots` shows last sync status

**Example Farm Inventory Response:**
```json
{
  "lots": [
    {
      "lot_id": "LOT-BGF-20260202-001",
      "sku_id": "SKU-MEI-QING-PAK-CHOI-5LB",
      "product_name": "Mei Qing Pak Choi (5lb case)",
      "qty_available": 3,
      "qty_reserved": 0,
      "unit_price": 22.50,
      "unit": "case",
      "farm_id": "FARM-MKLOMAT3-A9D8",
      "harvest_date": "2026-02-02",
      "days_to_harvest": 0,
      "qr_payload": "...",
      "label_text": "..."
    }
  ]
}
```

**Aggregation Logic:**
- Groups lots by `sku_id`
- Sums `qty_available` across farms
- Takes lowest `unit_price` as `best_price`
- Tracks which farms have each SKU

---

## Room Mapper Tool

### Actual Implementation

**File:** `greenreach-central/public/views/room-mapper.html` (1970 lines)

**Purpose:** Visual editor for farm room layout and sensor placement

**Features:**

1. **Canvas Grid**
   - 2D grid representing room floor plan
   - Dimensions: Responsive (fills available space)
   - Min height: 800px (recent fix from 600px)

2. **Room Management**
   - Create new rooms
   - Switch between rooms
   - Edit room properties (name, dimensions)
   - Delete rooms

3. **Sensor Placement**
   - Drag sensors from device list onto canvas
   - Position sensors in specific locations
   - Link sensors to zones
   - Visual sensor markers

4. **Zone Visualization**
   - Color-coded zones based on temperature
   - Blue: Cool (<20°C)
   - Green: Optimal (20-24°C)
   - Yellow: Warm (24-26°C)
   - Red: Hot (>26°C)

5. **Equipment Mapping**
   - Optional equipment metadata
   - Link lights, fans, HVAC to zones
   - Not required for basic operation

**Data Storage:**
- Edge Device: `public/data/room-map.json`
- Central: Synced via `POST /api/sync/rooms`

**Access:**
- Central: View only (monitor layout)
- Edge: Full edit (configure farm)

**Canvas Size Fix (Feb 2, 2026):**
```css
/* OLD (caused cramping) */
grid-template-columns: 240px 1fr 280px;
#canvas { min-height: 600px; }

/* NEW (deployed) */
grid-template-columns: 200px 1fr 240px;
#canvas { min-height: 800px; }
```

---

## AI Features (What's Real)

### 1. Harvest Forecasting ✅ IMPLEMENTED

**File:** `greenreach-central/routes/admin.js` line 2821-3068

**How It Works:**
- Reads groups data (seed dates)
- Looks up recipe grow days (from `data/recipes-v2/*.csv`)
- Calculates: harvest_date = seed_date + grow_days
- Groups by timeframe: 0-7 days, 8-14 days, 15-30 days, 30+ days
- Returns forecast by crop type with quantities

**API:** `GET /api/admin/harvest/forecast`

**Accuracy:** 100% deterministic (not ML - just math)

**Dashboard View:** Shows upcoming harvests in 4 time buckets

**What It's NOT:**
- ❌ NOT machine learning prediction
- ❌ NOT accounting for environmental variations
- ❌ NOT adjusting for growth rate anomalies
- ✅ Simple calculation: seed_date + recipe_days

### 2. Anomaly Detection ⚠️ PARTIAL

**File:** `greenreach-central/routes/admin.js` line 1492-1691

**Implementation:**
- Aggregates anomaly data from farms
- Farms detect anomalies locally (Isolation Forest algorithm)
- Central receives via sync (not implemented in all farms)
- Dashboard shows anomaly count

**Algorithm:** Isolation Forest (edge-side, if enabled)

**Status:** 
- ✅ Code exists
- ❌ NOT deployed to production farms
- ❌ Data collection incomplete
- ⚠️ Dashboard shows "no anomalies" (no data)

**Difference from Alerts:**
```
ALERTS (reactive):
- Rule-based thresholds
- Temp > 30°C → Alert
- Immediate notification
- Farmer must act

ANOMALY DETECTION (proactive):
- ML pattern recognition
- "This pattern is unusual"
- Predict failures before they happen
- Statistical outlier detection
```

### 3. Energy Optimization ❌ NOT IMPLEMENTED

**Status:** NOT in production code

**Found In:** Planning docs only (AI_GAPS_AND_OPPORTUNITIES.md)

**Aspirational Features:**
- Dynamic lighting schedules based on electricity rates
- HVAC pre-cooling during off-peak hours
- RL (reinforcement learning) for setpoint optimization

**Reality:** Edge devices use static recipe-based control. No dynamic optimization.

### 4. Demand Forecasting ❌ NOT IMPLEMENTED

**Status:** NOT in production code

**Aspirational:** ARIMA time series to predict buyer demand

**Reality:** No historical order analysis, no predictive models deployed.

### 5. Quality Scoring (Computer Vision) ❌ NOT IMPLEMENTED

**Status:** NOT in production code

**Aspirational:** CNN model analyzes harvest photos for quality grading

**Reality:** No photo upload, no model deployed, no quality scoring.

---

## Database Structure

### PostgreSQL Tables (Verified from `config/database.js`)

**Farm Management:**
- `farms` - Farm registry (id, name, location, api_key, owner)
- `zones` - Growing zones (farm_id, room_id, name, targets)
- `rooms` - Physical rooms (farm_id, name, dimensions)
- `devices` - IoT devices (farm_id, zone_id, type, device_id, status)

**Production Tracking:**
- `groups` - Crop batches (farm_id, zone_id, crop, seed_date, tray_count, status)
- `schedules` - Automation schedules (farm_id, device_id, triggers, actions)
- `telemetry` - Environmental data (farm_id, zone_id, timestamp, temp, humidity, vpd, ppfd)

**Wholesale:**
- `orders` - Master orders (buyer_id, total, status, created_at)
- `buyers` - Buyer accounts (email, business_name, location, buyer_type)
- `payments` - Payment records (order_id, amount, status, payment_split)
- `wholesale_lots` - Inventory lots (farm_id, sku_id, quantity, price, harvest_date)

**System:**
- `alerts` - Alert history (farm_id, type, severity, message, resolved)
- `ai_insights` - ML recommendations (farm_id, insight_type, data, confidence)

**Indexes:**
```sql
idx_farms_api_key (farms.api_key)
idx_zones_farm (zones.farm_id)
idx_groups_farm (groups.farm_id)
idx_telemetry_farm_timestamp (telemetry.farm_id, telemetry.timestamp)
idx_orders_buyer (orders.buyer_id)
```

---

## API Endpoints (Complete List)

### Admin API (Authentication Required)

**Auth:**
```
POST /api/admin/auth/login
POST /api/admin/auth/logout
GET  /api/admin/auth/validate
```

**Farm Management:**
```
GET    /api/admin/farms
GET    /api/admin/farms/:farmId
PUT    /api/admin/farms/:farmId
DELETE /api/admin/farms/:farmId
POST   /api/admin/farms/sync-all-stats
GET    /api/admin/farms/:farmId/zones
GET    /api/admin/farms/:farmId/rooms
GET    /api/admin/farms/:farmId/groups
GET    /api/admin/farms/:farmId/devices
```

**Analytics:**
```
GET /api/admin/kpis
GET /api/admin/analytics/aggregate
GET /api/admin/harvest/forecast
GET /api/admin/operations-overview
```

**Alerts:**
```
GET    /api/admin/alerts
GET    /api/admin/alerts/:farmId
PUT    /api/admin/alerts/:alertId/resolve
DELETE /api/admin/alerts/:alertId
```

**Recipes:**
```
GET /api/admin/recipes
GET /api/admin/recipes/:recipeName
```

**AI Insights:**
```
GET /api/admin/ai-insights
GET /api/admin/ai-insights/:farmId
```

### Sync API (Farm API Key Auth)

```
POST /api/sync/heartbeat
POST /api/sync/telemetry
POST /api/sync/rooms
POST /api/sync/groups
POST /api/sync/schedules
POST /api/sync/inventory
POST /api/sync/restore
GET  /api/sync/telemetry/:farmId (admin retrieval)
```

### Wholesale API (Public/JWT Auth)

**Catalog:**
```
GET /api/wholesale/catalog
GET /api/wholesale/catalog/filters
GET /api/wholesale/farms
GET /api/wholesale/inventory/check-overselling
```

**Buyers:**
```
POST /api/wholesale/buyers/register
POST /api/wholesale/buyers/login
GET  /api/wholesale/buyers/me (JWT required)
PUT  /api/wholesale/buyers/me (JWT required)
```

**Orders:**
```
POST /api/wholesale/checkout/preview
POST /api/wholesale/checkout/execute
GET  /api/wholesale/orders (JWT required)
GET  /api/wholesale/orders/:orderId (JWT required)
POST /api/wholesale/order-status (callback from farm)
```

**Admin:**
```
GET /api/wholesale/network/farms (admin only)
GET /api/wholesale/network/snapshots (admin only)
GET /api/wholesale/network/aggregate (admin only)
GET /api/wholesale/webhooks/payments (admin only)
```

### Farm Registration API

```
GET  /api/farms
GET  /api/farms/:farmId
POST /api/farms/register
POST /api/farms/:farmId/heartbeat (alt to /api/sync/heartbeat)
```

### Health Check

```
GET /health
```

---

## Troubleshooting Real Issues

### Issue 1: Farm Shows Offline in Dashboard

**Symptoms:**
- Farm card shows 🔴 OFFLINE or ⚠️ DEGRADED
- Last sync timestamp > 10 minutes old
- Environmental data not updating

**Root Causes:**

1. **Edge device lost internet connection**
   - Check farm network: `ping 100.65.187.59`
   - SSH to farm: `ssh greenreach@100.65.187.59` (password: Farms2024)
   - Test outbound: `curl https://greenreach-central.us-east-1.elasticbeanstalk.com/health`

2. **PM2 process crashed**
   - SSH to farm
   - Check status: `pm2 list`
   - If not running: `pm2 restart server-foxtrot`
   - View logs: `pm2 logs server-foxtrot --lines 50`

3. **API key invalid/expired**
   - Farm API key stored in edge `.env` file
   - Central validates key on every sync
   - If rejected: Check farm API_KEY matches database `farms.api_key`

4. **Central server not accepting syncs**
   - Check Central health: `curl https://greenreach-central.../health`
   - Check logs: AWS Elastic Beanstalk logs
   - Database connection issue: `"databaseReady": false` in health check

**Resolution Steps:**
```bash
# 1. Verify farm is online
ping 100.65.187.59

# 2. SSH and check PM2
ssh greenreach@100.65.187.59
pm2 list
pm2 logs server-foxtrot --lines 20

# 3. Test manual sync
curl -X POST https://greenreach-central.../api/sync/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"farm_id":"FARM-MKLOMAT3-A9D8","status":"online"}'

# 4. Restart if needed
pm2 restart server-foxtrot
```

### Issue 2: Wholesale Inventory Not Showing

**Symptoms:**
- Buyer portal shows "No products available"
- Central catalog API returns empty array
- Admin wholesale view shows 0 total qty

**Root Causes:**

1. **Farm not registered in wholesale network**
   - File: `greenreach-central/public/data/farm-network.json`
   - Must manually add farm with endpoint URL
   - Restart wholesaleNetworkSync service

2. **Farm endpoint not reachable**
   - Central polls: `GET http://100.65.187.59:8091/api/wholesale/inventory`
   - Check farm is running on correct port
   - Verify no firewall blocking port 8091

3. **Farm has no harvest lots**
   - Farm must have completed harvests
   - Lots stored in `public/data/groups.json` with status "harvested"
   - Check edge farm Activity Hub for harvest workflow

4. **Sync service crashed**
   - Service: `wholesaleNetworkSync.js`
   - Should auto-start with server
   - Check server logs for sync errors

**Resolution Steps:**
```bash
# 1. Verify farm inventory endpoint
curl http://100.65.187.59:8091/api/wholesale/inventory

# 2. Check Central aggregation
curl https://greenreach-central.../api/wholesale/network/snapshots

# 3. View network sync logs (if accessible)
# Check AWS CloudWatch logs for wholesaleNetworkSync

# 4. Manual farm registration (admin dashboard)
# Go to Wholesale Admin → Hyperlocal Network tab
# Add Farm: endpoint = http://100.65.187.59:8091
```

### Issue 3: Database Migration Errors

**Symptoms:**
- Server health check shows `"databaseReady": false`
- Logs show: `column "master_order_id" does not exist`
- Server starts but features fail

**Root Cause:**
- Migration script in `config/database.js` has ordering issues
- Tries to create index on column before column exists

**Resolution:**
```sql
-- Connect to PostgreSQL database
psql -h <RDS_HOSTNAME> -U postgres -d greenreach_central

-- Check if problematic columns exist
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'orders';

-- If missing, migrations need manual execution
-- Fix: Modify migration script to check existence first

-- Workaround: Server runs in "limited mode" without database
-- Uses in-memory storage - data not persisted
```

### Issue 4: Room Mapper Canvas Too Small

**Symptoms:**
- Canvas only shows small portion of room
- Controls cramped together
- Hard to place sensors accurately

**Solution:** ALREADY FIXED (deployed Feb 2, 2026)
- Commit: 11c1ded
- Changes:
  - Left sidebar: 240px → 200px
  - Right sidebar: 280px → 240px
  - Canvas min-height: 600px → 800px

**Verify Fix:**
- Go to Room Mapper page
- Check console: `[Room Mapper] Viewport: <width> x <height>`
- Canvas should be 800px tall minimum

### Issue 5: Square Payment Fails

**Symptom:**
- Buyer completes checkout
- Payment shows "completed" immediately
- No actual charge processed

**Root Cause:** Square integration is STUB ONLY

**Current Implementation:**
```javascript
// routes/wholesale.js line ~900
// DEMO MODE: Always succeeds with fake payment
payment_status: 'completed',
payment_id: 'demo_' + Date.now(),
```

**Production Requirements:**
1. Register Square Developer account
2. Create OAuth app (get client ID/secret)
3. Configure webhook endpoint: `/webhooks/square`
4. Implement actual Square Payments API calls
5. Store merchant tokens per farm in database
6. Handle payment.updated webhooks
7. Implement refund flow

**Status:** NOT PRODUCTION READY - Demo mode only

---

## Appendix: File Locations

### GreenReach Central (AWS Deployment)

**Main Server:**
- `greenreach-central/server.js` - Express app entry point
- `greenreach-central/config/database.js` - PostgreSQL setup & migrations

**Routes:**
- `greenreach-central/routes/admin.js` - Admin API
- `greenreach-central/routes/wholesale.js` - Wholesale API
- `greenreach-central/routes/sync.js` - Farm sync endpoints
- `greenreach-central/routes/auth.js` - Authentication
- `greenreach-central/routes/farms.js` - Farm management
- `greenreach-central/routes/orders.js` - Order management
- `greenreach-central/routes/inventory.js` - Inventory tracking
- `greenreach-central/routes/alerts.js` - Alert system
- `greenreach-central/routes/monitoring.js` - Health monitoring

**Services:**
- `greenreach-central/services/wholesaleNetworkSync.js` - Inventory aggregation
- `greenreach-central/services/wholesaleMemoryStore.js` - In-memory cache
- `greenreach-central/services/healthCheck.js` - System health monitoring
- `greenreach-central/services/syncMonitor.js` - Farm sync monitoring

**UI Files:**
- `greenreach-central/public/GR-central-admin.html` - Main dashboard
- `greenreach-central/public/GR-central-admin-login.html` - Login page
- `greenreach-central/public/GR-wholesale.html` - Buyer portal
- `greenreach-central/public/GR-wholesale-admin.html` - Wholesale admin
- `greenreach-central/public/views/room-mapper.html` - Room layout editor
- `greenreach-central/public/views/farm-inventory.html` - Inventory view
- `greenreach-central/public/central-admin.js` - Dashboard logic (6200 lines)

### Light Engine Edge (Farm Device)

**Main Server:**
- `server-foxtrot.js` - Edge device server

**Data Files:**
- `public/data/farm.json` - Farm profile
- `public/data/groups.json` - Crop batches
- `public/data/trays.json` - Tray inventory
- `public/data/rooms.json` - Room configuration
- `public/data/env.json` - Real-time environmental data
- `public/data/room-map.json` - Room Mapper layout
- `public/data/recipes-v2/*.csv` - 60+ crop recipes

**UI Files:**
- `public/LE-dashboard.html` - Farm dashboard
- `public/views/activity-hub.html` - QR scanning interface
- `public/farm-admin.html` - Farm admin panel

---

## Contact & Support

**Operations Team:**
- Primary: Peter Gilbert
- Email: [use actual team email]
- On-call: [phone number if applicable]

**System Access:**
- AWS Console: [credentials managed separately]
- PostgreSQL: [credentials in secure storage]
- Farm SSH: greenreach@100.65.187.59 (Farms2024)

**Documentation:**
- Codebase: `/Users/petergilbert/Light-Engine-Foxtrot`
- Production docs: `*.md` files in root directory
- Architecture: `CLOUD_EDGE_SYNC_ARCHITECTURE.md`
- Wholesale: `WHOLESALE_READINESS_REPORT.md`
- Deployment: `GREENREACH_CENTRAL_LAUNCH_READINESS_2026-01-31.md`

---

**Document Verification:**
- ✅ All file paths verified to exist
- ✅ All API endpoints checked in routes files
- ✅ All features confirmed in codebase
- ✅ Removed all speculative/aspirational content
- ✅ Based on actual production deployment

**Last Updated:** February 2, 2026  
**Verified By:** Codebase analysis + production testing  
**Version:** 3.0 ACCURATE
