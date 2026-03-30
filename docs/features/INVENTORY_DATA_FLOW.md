# Inventory Data Flow Architecture

## Overview

**YES** - All inventory originates from the Light Engine (Farm) and flows through multiple channels:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LIGHT ENGINE FOXTROT                         │
│                         (Farm - Port 8091)                          │
│                     SOURCE OF ALL INVENTORY                         │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ├─── Local Farm Channels ────────────────────────────┐
               │                                                      │
               │    1. Farm's Own POS/Online Store                   │
               │       • GET /api/crops (inventory list)             │
               │       • Local SQLite: crops table                   │
               │       • Fields: stock_quantity, current_price       │
               │       • farm-store.js (online store)                │
               │       • farm-admin.html (POS interface)             │
               │                                                      │
               │    2. Mobile App Inventory                          │
               │       • GET /api/inventory/summary                  │
               │       • GET /api/inventory/harvest-forecast         │
               │       • Tray lifecycle tracking                     │
               │       • inventory_routes.py (FastAPI)               │
               │                                                      │
               └──────────────────────────────────────────────────────┘
               │
               └─── External Sync Channels ─────────────────────────┐
                                                                      │
                    3. GreenReach Central Sync                       │
                       • Heartbeat: Every 30 seconds                 │
                       • Inventory: Every 5 minutes                  │
                       • lib/sync-service.js                         │
                       • config/edge-config.json                     │
                       │                                              │
                       ↓                                              │
                ┌──────────────────────────────────────────┐         │
                │      GREENREACH CENTRAL (Port 3000)       │         │
                │       PostgreSQL Database                 │         │
                └──────────────┬────────────────────────────┘         │
                               │                                      │
                               ├─── Central Admin Dashboard          │
                               │    • GET /api/admin/farms            │
                               │    • Shows: Farm status, products    │
                               │    • central-admin.html              │
                               │                                      │
                               └─── Wholesale Portal                 │
                                    • GET /api/wholesale/catalog      │
                                    • Buyer ordering interface        │
                                    • wholesale.html                  │
                                                                      │
                                                                      │
                    4. Future Square POS Sync (Configured)            │
                       • Square OAuth integration                     │
                       • Bidirectional inventory sync                 │
                       • /api/square-proxy routes                     │
                                                                      │
                                                                      │
                    5. Future Additional Channels                     │
                       • Restaurant direct ordering                   │
                       • Third-party marketplaces                     │
                       • Distributor integrations                     │
                                                                      │
                └──────────────────────────────────────────────────────┘
```

---

## 1. Light Engine Farm Inventory (SOURCE)

### Local Database: SQLite
**Location:** `Light-Engine-Foxtrot/data/light-engine.db`

**Crops Table:**
```sql
CREATE TABLE crops (
  crop_id TEXT PRIMARY KEY,
  crop_name TEXT NOT NULL,
  sku TEXT,
  stock_quantity INTEGER DEFAULT 0,
  unit TEXT DEFAULT 'unit',
  current_price REAL DEFAULT 0,
  category TEXT,
  variety TEXT,
  harvest_date TEXT,
  is_deleted INTEGER DEFAULT 0
);
```

### Farm's Own POS/Store
**Purpose:** Farm sells directly to walk-in customers and local online orders

**Endpoints:**
- `GET /api/crops` - List all crops with stock quantities
- `GET /api/inventory/summary` - Dashboard stats
- `GET /api/inventory/harvest-forecast` - Upcoming harvests

**Interfaces:**
- **farm-admin.html** - POS interface for farm staff
- **farm-store.js** - Online ordering system
- **routes/farm-store-setup.js** - Store configuration

**Data Structure:**
```javascript
{
  crop_id: "PROD-001",
  crop_name: "Butterhead Lettuce",
  sku: "LETTUCE-BH-250",
  stock_quantity: 250,
  unit: "heads",
  current_price: 3.50,
  available_for_wholesale: true
}
```

---

## 2. Sync to GreenReach Central

### Configuration: `config/edge-config.json`
```json
{
  "mode": "edge",
  "farmId": "GR-00001",
  "farmName": "Demo Farm - Light Engine Showcase",
  "apiKey": "demo-api-key-12345678901234567890123456789012",
  "centralApiUrl": "http://localhost:3000",
  "syncInterval": 300000,      // 5 minutes
  "heartbeatInterval": 30000,  // 30 seconds
  "syncEnabled": true
}
```

### Sync Service: `lib/sync-service.js`

**Heartbeat Sync (Every 30 seconds):**
```javascript
POST /api/farms/{farmId}/heartbeat
{
  status: "online",
  metrics: {
    cpu: 45.23,
    memory: 62.15,
    disk: 50,
    sensors: 12,
    lights: 8
  }
}
```

**Inventory Sync (Every 5 minutes):**
```javascript
POST /api/inventory/{farmId}/sync
{
  products: [
    {
      product_id: "PROD-001",
      product_name: "Butterhead Lettuce",
      sku: "LETTUCE-BH-250",
      quantity: 250,
      unit: "heads",
      price: 2.50,  // Wholesale price
      available_for_wholesale: true
    }
    // ... more products
  ]
}
```

**Query on Light Engine:**
```sql
SELECT 
  crop_id as product_id,
  crop_name as product_name,
  COALESCE(sku, '') as sku,
  COALESCE(stock_quantity, 0) as quantity,
  COALESCE(unit, 'unit') as unit,
  COALESCE(current_price, 0) as price,
  1 as available_for_wholesale
FROM crops 
WHERE is_deleted = 0
```

---

## 3. GreenReach Central Database

### PostgreSQL: `greenreach_central`

**farm_inventory Table:**
```sql
CREATE TABLE farm_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES farms(id),
  product_id VARCHAR(50),
  product_name VARCHAR(255),
  category VARCHAR(100),
  variety VARCHAR(100),
  quantity INTEGER,
  quantity_unit VARCHAR(20),
  wholesale_price DECIMAL(10,2),
  retail_price DECIMAL(10,2),
  status VARCHAR(20),
  harvest_date DATE,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Current Demo Data:**
```sql
SELECT 
  farm_id, 
  product_name, 
  quantity, 
  quantity_unit, 
  wholesale_price 
FROM farm_inventory;

-- Results:
GR-00001 | Butterhead Lettuce | 250 | heads   | 2.50
GR-00001 | Curly Kale         | 180 | bunches | 3.00
GR-00001 | Sweet Basil        | 120 | bunches | 4.50
```

---

## 4. Data Consumption Endpoints

### A. Central Admin Dashboard
**URL:** http://localhost:3000/central-admin.html

**API:**
```javascript
GET /api/admin/farms
{
  farms: [{
    farmId: "GR-00001",
    name: "Demo Farm - Light Engine Showcase",
    status: "active",
    productCount: 3,
    lastHeartbeat: "2025-12-20T19:56:03.675Z"
  }]
}

GET /api/admin/farms/GR-00001
{
  farmId: "GR-00001",
  stats: {
    productCount: 3,
    totalInventoryItems: 550
  }
}
```

### B. Wholesale Catalog
**URL:** http://localhost:3000/wholesale.html

**API:**
```javascript
GET /api/wholesale/catalog
{
  status: "ok",
  data: {
    skus: [
      {
        sku_id: "PROD-001",
        product_name: "Butterhead Lettuce",
        unit: "heads",
        price_per_unit: 2.50,
        total_qty_available: 250,
        farms: [{
          farm_id: "GR-00001",
          farm_name: "Demo Farm - Light Engine Showcase",
          qty_available: 250,
          location: "Demo City, CA"
        }]
      }
      // ... more products
    ]
  }
}
```

**Buyers can:**
- Browse all products from all farms
- Filter by farm, certifications, practices
- Add to cart and place orders
- Track shipments and reorder

---

## 5. Data Flow Summary

### Complete Inventory Journey

1. **Origin: Light Engine Farm**
   - Farmer harvests: 250 heads of Butterhead Lettuce
   - Updates local inventory: `stock_quantity = 250`
   - Available in farm's own POS and online store

2. **Sync to Central (5 min)**
   - Sync service reads from local SQLite
   - POSTs to GreenReach Central API
   - Stored in PostgreSQL `farm_inventory` table

3. **Central Admin Visibility**
   - Admin dashboard shows farm status
   - Displays: 3 products, 550 total items
   - Monitor heartbeat and health

4. **Wholesale Portal**
   - Product appears in wholesale catalog
   - Buyers see: Butterhead Lettuce @ $2.50/head
   - Available for restaurant/distributor orders

5. **Order Fulfillment**
   - Buyer places order for 50 heads
   - Farm receives fulfillment notification
   - Farm ships product
   - Inventory updated: `stock_quantity = 200`
   - Next sync updates Central: quantity = 200

### Dual Channel Sales

**Farm's Own Sales:**
```
Local Customer → Farm POS (farm-admin.html)
  → Updates: crops.stock_quantity
  → Next sync: Updates Central inventory
```

**Wholesale Sales:**
```
Restaurant → Wholesale Portal (wholesale.html)
  → Order → Farm notification
  → Farm fulfills → Updates local inventory
  → Next sync: Updates Central inventory
```

---

## 6. Current Status

### ✅ Working (As of Dec 20, 2025)

1. **Light Engine Farm**
   - Local inventory database (SQLite)
   - Farm POS/admin interface
   - Mobile app inventory APIs
   - Sync service configured

2. **GreenReach Central**
   - PostgreSQL database running
   - Demo farm registered (GR-00001)
   - 3 products seeded
   - Admin API functional
   - Wholesale catalog API functional

3. **Data Flow**
   - Admin dashboard shows farm
   - Wholesale catalog shows 3 products
   - Products display correct quantities/prices
   - Farm attribution working

### ⏳ Pending Activation

1. **Live Sync Service**
   - Sync service code exists in `lib/sync-service.js`
   - Not currently activated in server startup
   - Would require: `syncService.start()` on Foxtrot server

2. **Real-Time Inventory Updates**
   - Manual sync: Call `/api/inventory/{farmId}/sync`
   - Automatic sync: Activate sync service
   - Webhook notifications: Future enhancement

---

## 7. Activating Full Data Flow

### To Enable Live Sync:

1. **Start Sync Service on Light Engine:**
```javascript
// In server-foxtrot.js startup
import SyncService from './lib/sync-service.js';
const syncService = new SyncService(db);
syncService.start();
```

2. **Verify Edge Config:**
```bash
cat config/edge-config.json
# Check: syncEnabled = true
```

3. **Test Sync:**
```bash
# Check GreenReach Central logs
tail -f /tmp/greenreach-central.log | grep sync

# Update farm inventory
curl -X POST http://localhost:8091/api/crops \
  -H "Content-Type: application/json" \
  -d '{"crop_name":"Tomatoes","stock_quantity":300}'

# Wait 5 minutes or trigger manual sync
# Verify in wholesale catalog
curl http://localhost:3000/api/wholesale/catalog | jq '.data.items'
```

4. **Monitor Data Flow:**
- Farm updates: Check SQLite database
- Sync events: Check Foxtrot logs
- Central updates: Check PostgreSQL database
- Portal display: Refresh wholesale.html

---

## 8. Architecture Benefits

### Single Source of Truth
- All inventory originates from farm
- No manual dual-entry required
- Real-time accuracy across channels

### Multi-Channel Sales
- Farm's own POS/online store
- Wholesale platform (restaurants/distributors)
- Future: Third-party integrations

### Scalability
- Add more farms → Same architecture
- Each farm syncs independently
- Central aggregates all inventory

### Offline Resilience
- Farm operates offline if needed
- Sync queue stores pending updates
- Auto-resume when connection restored

---

## Summary

**Answer to Your Question:**

✅ **YES** - All inventory originates from the Light Engine (Farm)

✅ **YES** - Inventory flows to GreenReach Central and Wholesale Portal

✅ **YES** - Farm's inventory populates its own POS and online ordering

**Current State:**
- Architecture is built and configured
- Demo data flowing successfully
- 3 products visible in wholesale catalog
- Admin dashboard showing farm status

**To Activate Live Sync:**
- Start sync service in server-foxtrot.js
- Inventory will auto-sync every 5 minutes
- Both farm and wholesale channels will stay in sync
