# Light Engine - Edge Deployment Architecture
## Multi-Farm Distribution with Central GreenReach Monitoring

**Date**: December 17, 2025  
**Status**: 🔄 ARCHITECTURE REVIEW - Identifying gaps for edge deployment

---

## Executive Summary

The Light Engine software needs to transition from **single-farm cloud deployment** to **distributed edge deployment** where:

- Each farm downloads and installs software on their own edge device (reTerminal/Raspberry Pi)
- Each farm registers and configures their unique setup (location, equipment, sensors, lights, crops, pricing)
- GreenReach monitors all farms from a central dashboard
- Farm inventory is automatically shared with GreenReach Wholesale platform

---

## Current Architecture Analysis

### ✅ What's Already Built

#### 1. Multi-Tenant Authentication System
**File**: `lib/farm-auth.js`

- JWT-based authentication with `farm_id` scoping
- Role-based access control (CASHIER, DELIVERY, MANAGER, ADMIN, PUBLIC)
- Security isolation between farms
- Token generation/verification infrastructure

```javascript
// Each farm gets unique tokens
const token = generateFarmToken({
  farm_id: 'FARM-001',
  user_id: 'USER-123',
  role: 'admin',
  name: 'John Smith',
  email: 'john@farm.com'
});
```

#### 2. Farm Registration UI
**Files**: `public/index.charlie.html`, `public/farm-admin-login.html`

- Farm registration wizard exists
- Farm ID-based login (e.g., "GR-00001")
- Address capture and room/zone mapping
- Currently saves to local database

#### 3. Business Setup Wizards
**Files**: `public/index.charlie.html`, `routes/farm-square-setup.js`, `routes/farm-store-setup.js`

- Payment processing setup (Square OAuth per farm)
- Online store setup (subdomain or custom domain per farm)
- Each farm configures their own payment processor
- Each farm sets up their own customer-facing store

#### 4. Farm Sales System (Multi-Tenant Ready)
**Files**: `routes/farm-sales/*.js`

- POS system with farm_id scoping
- Inventory management per farm
- Order tracking per farm
- Customer management per farm
- QuickBooks integration (per-farm OAuth)
- All data isolated by farm_id

#### 5. Wholesale Integration Framework
**Files**: `routes/wholesale/*.js`, `public/wholesale-admin.html`

- Farm onboarding workflow exists
- Square OAuth per farm for wholesale payments
- Inventory catalog sync framework
- Order fulfillment webhooks
- Multi-farm order management

---

## 🚨 Critical Gaps for Edge Deployment

### 1. Software Distribution & Installation ❌

**Missing**:
- No software packaging for download (Docker, installer, etc.)
- No automated installation script
- No dependency management for edge devices
- No hardware requirement documentation
- No OS compatibility testing (Raspberry Pi OS, Ubuntu, etc.)

**Required**:
```bash
# Installation should be this simple:
curl -sSL https://install.lightengine.io | bash
# Or: Download .deb package, or Docker image
```

### 2. Edge Device Configuration ❌

**Missing**:
- No first-run setup wizard for edge devices
- No network configuration assistant
- No automatic discovery of local hardware (sensors, lights, I2C devices)
- No WiFi/Ethernet setup flow
- No timezone and locale configuration

**Required**:
- Detect Raspberry Pi/reTerminal hardware
- Scan for I2C sensors (Atlas Scientific, etc.)
- Detect GPIO-connected devices
- Configure MQTT broker (local vs cloud)
- Set up local database (SQLite for edge, PostgreSQL for cloud sync)

### 3. Farm Registration & Provisioning ❌

**Missing**:
- No central registration endpoint (farms can't "phone home")
- No unique farm ID generation and assignment
- No certificate/credential provisioning
- No farm activation workflow
- No GreenReach approval process

**Required Architecture**:

```
Farm Downloads Software
    ↓
Runs First-Time Setup Wizard
    ↓
Enters GreenReach Registration Code
    ↓
Calls https://central.greenreach.io/api/farms/register
    ↓
GreenReach validates and assigns farm_id
    ↓
Farm receives credentials and certificates
    ↓
Farm starts reporting to GreenReach
```

### 4. Central GreenReach Monitoring Backend ❌

**Missing**:
- No central GreenReach API server
- No farm health monitoring endpoints
- No real-time farm status dashboard
- No alert aggregation across farms
- No centralized logging/metrics

**Required Endpoints**:
```javascript
// Central GreenReach Server
POST   /api/farms/register           // New farm registration
GET    /api/farms                    // List all farms
GET    /api/farms/:id/health         // Farm health status
GET    /api/farms/:id/inventory      // Farm inventory (for wholesale)
POST   /api/farms/:id/alerts         // Farm sends alerts to GreenReach
GET    /api/farms/:id/metrics        // Historical metrics
PATCH  /api/farms/:id/config         // Update farm configuration
```

### 5. Data Synchronization Strategy ❌

**Missing**:
- No inventory sync mechanism (farm → GreenReach)
- No order sync mechanism (GreenReach → farm)
- No conflict resolution for offline/online transitions
- No data replication strategy
- No offline-first architecture

**Required**:
- **Inventory Sync**: Farm pushes inventory updates to GreenReach every 5 minutes
- **Order Sync**: GreenReach pushes wholesale orders to farms in real-time
- **Heartbeat**: Farm sends health ping every 30 seconds
- **Offline Mode**: Farm continues operating locally if internet lost
- **Sync Queue**: Changes queued and synced when connection restored

### 6. Database Architecture ❌

**Current**: Single SQLite database on one server  
**Required**: Distributed database architecture

**Missing**:
- No per-farm database isolation
- No schema for multi-farm data model
- No data migration strategy
- No backup/restore for edge devices

**Required Architecture**:

```
EDGE (Farm Local):
- SQLite database (lightengine-{farm_id}.db)
- Stores: sensors, lights, automations, inventory, orders
- Operates independently

CENTRAL (GreenReach Cloud):
- PostgreSQL database (greenreach_central.db)
- Stores: farms, wholesale_catalog, wholesale_orders, alerts
- Aggregates data from all farms
- Tables:
  - farms (id, name, location, status, last_seen)
  - farm_inventory_sync (farm_id, product_id, quantity, updated_at)
  - farm_orders_sync (farm_id, order_id, status, synced_at)
  - farm_alerts (farm_id, type, message, created_at)
  - farm_metrics (farm_id, metric_type, value, timestamp)
```

### 7. Security & Certificate Management ❌

**Missing**:
- No SSL/TLS certificate provisioning
- No API key management for farms
- No secure credential storage on edge devices
- No certificate rotation/renewal
- No encrypted communication between farm and GreenReach

**Required**:
- Each farm gets unique API key on registration
- Mutual TLS authentication (farm ↔ GreenReach)
- Encrypted storage for credentials (keyring/secrets manager)
- Certificate auto-renewal via Let's Encrypt or internal CA

### 8. Update & Version Management ❌

**Missing**:
- No software update mechanism
- No version tracking
- No rollback capability
- No update notification system
- No breaking change management

**Required**:
- Auto-update agent (check for updates daily)
- Semantic versioning (v1.2.3)
- Update notification in UI
- One-click update or automatic updates
- Rollback to previous version if update fails

### 9. Hardware Inventory & Device Mapping ❌

**Missing**:
- No automatic hardware detection on edge device
- No I2C bus scanning and device enumeration
- No sensor auto-configuration
- No light fixture discovery
- No equipment inventory management

**Required**:
- Scan I2C buses on startup
- Detect Atlas Scientific sensors
- Detect PWM controllers
- Create hardware inventory
- Map devices to rooms/zones during setup

### 10. Offline Operation & Resilience ❌

**Missing**:
- No offline-first architecture
- No local operation when internet unavailable
- No sync queue for offline changes
- No connection loss handling
- No graceful degradation

**Required**:
- Farm operates fully offline (local database)
- Queue all changes for sync
- Retry mechanism for failed syncs
- Connection status indicator in UI
- Alert GreenReach when farm goes offline >5 minutes

---

## Edge Device Selection: Why Symcod W101M N97

### Industrial vs Consumer Hardware

The Symcod W101M N97 TermiCom W was selected over consumer devices (Raspberry Pi, etc.) for several critical reasons:

#### 1. **Industrial Reliability**
- **MTBF**: >50,000 hours (5.7 years continuous operation)
- **Operating Temperature**: -10°C to 60°C (14°F to 140°F)
- **Humidity Tolerance**: 10% to 90% non-condensing
- **Vibration Resistance**: Designed for industrial environments
- **Fanless Design**: No moving parts = lower failure rate

**Why it matters**: Commercial farms run 24/7 in challenging environments (heat, humidity, dust). Consumer devices fail frequently in these conditions.

#### 2. **Built-in Touchscreen Display**
- **10.1" capacitive touchscreen** with tempered glass
- **On-site control** without laptop or phone
- **Real-time monitoring** of sensors, lights, and automation
- **Immediate alerts** visible at a glance
- **Touch-optimized UI** for gloved hands (common in grow rooms)

**Why it matters**: Farmers can check status, adjust settings, and respond to alerts directly in the grow room without pulling out devices or going to an office.

#### 3. **Professional Mounting**
- **VESA 100 mounting** standard
- **Wall mount or arm mount** for optimal viewing angle
- **Industrial aluminum casing** (not plastic)
- **Easy to clean** (smooth surfaces, no crevices)

**Why it matters**: Professional installation in commercial facilities. Can be positioned at eye level for easy viewing and interaction.

#### 4. **Native Industrial Connectivity**
- **Optional RS-485 ports** (Modbus RTU native support)
- **Dual Ethernet** (separate control and data networks)
- **Multiple USB ports** (sensors, barcode scanners, printers)
- **24V DC power** (standard in industrial/agricultural settings)

**Why it matters**: Most commercial agricultural sensors and lighting controllers use Modbus over RS-485. Consumer devices require expensive USB adapters. This device has it built-in.

#### 5. **Superior Processing Power**
- **Intel N97 quad-core** @ 3.6 GHz (vs ARM in consumer devices)
- **8GB RAM** (vs 4GB typical in consumer devices)
- **240GB NVMe SSD** (vs slow microSD cards)
- **Runs complex ML models** for crop health analysis
- **Fast database operations** for large inventories

**Why it matters**: Can run advanced automation, machine learning, and data analysis locally without cloud dependency.

#### 6. **Future-Proof Expandability**
- **PCIe expansion** possible (for specialized sensors)
- **Multiple USB 3.2 Gen 2** ports (10 Gbps)
- **HDMI/DP/SVGA** for additional displays
- **Modular design** for upgrades

**Why it matters**: As farms grow, they can add more sensors, displays, and equipment without replacing the entire system.

---

## Deployment Model

### Distributed Edge Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    GreenReach Central Cloud                     │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ Registration API │  │ Monitoring API   │  │ Wholesale API│ │
│  │                  │  │                  │  │              │ │
│  │ /farms/register  │  │ /farms/:id/health│  │ /catalog     │ │
│  │ /farms/provision │  │ /farms/:id/metrics│  │ /orders      │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐
│  │         PostgreSQL (Central Database)                       │
│  │  - farms, inventory_sync, orders_sync, alerts, metrics      │
│  └─────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
                          ▲  ▲  ▲
                          │  │  │
           ┌──────────────┘  │  └──────────────┐
           │                 │                  │
    HTTPS + TLS          HTTPS + TLS       HTTPS + TLS
           │                 │                  │
┌──────────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐
│   Farm A Edge    │  │   Farm B Edge│  │   Farm C Edge│
│ (Symcod W101M)   │  │ (Symcod W101M)  │ (Symcod W101M)│
│                  │  │                 │  │             │
│ Light Engine SW  │  │ Light Engine SW │  │Light Engine │
│ SQLite on NVMe   │  │ SQLite on NVMe  │  │SQLite NVMe  │
│ Local MQTT       │  │ Local MQTT      │  │Local MQTT   │
│ 10" Touchscreen  │  │ 10" Touchscreen │  │10" Touch UI │
│ RS-485 Modbus    │  │ RS-485 Modbus   │  │RS-485 Modbus│
│ Dual Ethernet    │  │ Dual Ethernet   │  │Dual Ethernet│
└──────────────────┘  └─────────────────┘  └─────────────┘
   │         │            │         │          │         │
Sensors  Lights       Sensors  Lights      Sensors  Lights
(USB/485)(Modbus)    (USB/485)(Modbus)   (USB/485)(Modbus)
```
```

### Data Flow

#### Farm Registration Flow
```
1. Farmer downloads Light Engine software
   → https://download.lightengine.io/latest

2. Farmer installs on Raspberry Pi/reTerminal
   → sudo dpkg -i lightengine_v1.0.0_arm64.deb
   → Installation wizard opens in browser

3. Farmer enters GreenReach registration code
   → Code provided by GreenReach sales team
   → Example: GR-REG-ABC123

4. Software calls GreenReach Central API
   → POST /api/farms/register
   → Sends: {registration_code, farm_name, location, contact}

5. GreenReach validates and provisions farm
   → Assigns unique farm_id (e.g., "FARM-00042")
   → Generates API key
   → Provisions certificates
   → Returns credentials

6. Farm stores credentials securely
   → API key in encrypted keyring
   → Saves farm_id to local config
   → Establishes secure connection to GreenReach

7. Farm begins normal operation
   → Reports health every 30 seconds
   → Syncs inventory every 5 minutes
   → Sends alerts immediately
```

#### Inventory Sync Flow
```
Farm Side (every 5 minutes):
1. Query local SQLite for inventory changes since last sync
2. Build sync payload: {farm_id, products: [{sku, quantity, price, updated_at}]}
3. POST /api/farms/:id/inventory/sync
4. Receive acknowledgment and update last_sync_time

GreenReach Side:
1. Receive inventory sync from farm
2. Update farm_inventory_sync table
3. Update wholesale_catalog if product available for wholesale
4. Trigger webhook to notify buyers of new inventory
```

#### Wholesale Order Flow
```
1. Buyer places order on GreenReach Wholesale portal
   → Order includes products from multiple farms

2. GreenReach splits order by farm
   → Farm A: 20 lbs lettuce
   → Farm B: 15 lbs tomatoes

3. GreenReach sends webhook to each farm
   → POST https://farm-a.lightengine.io/api/wholesale/webhooks/order
   → Payload: {order_id, items, delivery_date, buyer_info}

4. Farm receives order
   → Creates local order record
   → Reserves inventory
   → Sends acknowledgment to GreenReach

5. Farm fulfills order
   → Marks items as packed
   → Updates order status to "ready_for_pickup"
   → POST /api/farms/:id/orders/:order_id/status

6. GreenReach receives fulfillment update
   → Notifies buyer
   → Generates invoice
   → Processes payment
```

---

## Implementation Roadmap

### Phase 1: Central GreenReach Infrastructure (2-3 weeks)

**Tasks**:
1. Create separate GreenReach Central API server
   - Express.js server on AWS/Azure
   - PostgreSQL database for central data
   - Redis for caching and rate limiting

2. Build farm registration endpoints
   - POST /api/farms/register
   - POST /api/farms/:id/provision
   - GET /api/farms/:id/status

3. Create farm monitoring dashboard
   - Real-time farm health status
   - Alert aggregation
   - Metrics visualization
   - Map view of all farms

4. Implement inventory sync endpoints
   - POST /api/farms/:id/inventory/sync
   - GET /api/farms/:id/inventory
   - Webhook system for inventory updates

**Deliverables**:
- `greenreach-central-api/` repository
- Central monitoring dashboard
- Farm registration portal
- Documentation: CENTRAL_API_SPEC.md

---

### Phase 2: Software Packaging & Distribution (1-2 weeks)

**Tasks**:
1. Create installation packages for Symcod W101M
   - Ubuntu 22.04 .deb package (x86_64)
   - Windows 10 IoT installer (.msi)
   - Docker image (x86_64 architecture)
   - Installation script for manual setup

2. Build touchscreen-optimized UI
   - Full-screen kiosk mode (1280x800)
   - Large touch targets (minimum 44x44px)
   - On-screen keyboard support
   - Gesture controls (swipe, pinch-zoom)

3. Create download portal
   - https://download.lightengine.io
   - Version selection
   - Platform detection (Ubuntu/Windows)
   - Installation guides

4. Set up update server
   - Auto-update agent
   - Version checking endpoint
   - Update download and installation
   - Touchscreen notification UI

**Deliverables**:
- `lightengine-installer/` repository
- Ubuntu package: lightengine_v1.0.0_amd64.deb
- Windows installer: LightEngine_v1.0.0_x64.msi
- Docker image: greenreach/lightengine:latest-x86
- Installation guides: INSTALL_UBUNTU.md, INSTALL_WINDOWS.md

---

### Phase 3: First-Run Setup Wizard (1 week)

**Tasks**:
1. Build first-run wizard UI (touchscreen-optimized)
   - Welcome screen with large touch buttons
   - Network configuration (Ethernet priority, WiFi backup)
   - GreenReach registration
   - Hardware detection
   - Farm profile setup

2. Implement hardware detection
   - USB device enumeration (Atlas sensors, DMX adapters)
   - RS-485 port scanning (Modbus devices)
   - Network device discovery (IP cameras, network sensors)
   - GPIO expansion boards (if used)

3. Create registration flow
   - Enter registration code (on-screen keyboard)
   - Call GreenReach API
   - Store credentials securely
   - Test connection
   - Download initial configuration

4. Build farm profile wizard
   - Farm name, address, contact (touch keyboard)
   - Room/zone configuration (drag-and-drop on touchscreen)
   - Crop selection (touch-friendly picker)
   - Equipment inventory (scan barcodes with USB scanner)

5. Touchscreen calibration
   - 5-point calibration for accuracy
   - Test touch responsiveness
   - Gesture configuration

**Deliverables**:
- First-run wizard UI (touch-optimized)
- Hardware detection service
- Farm profile configuration
- Documentation: FIRST_RUN_GUIDE.md, TOUCHSCREEN_SETUP.md

---

### Phase 4: Data Synchronization (2 weeks)

**Tasks**:
1. Implement sync service
   - Background service running on edge device
   - Inventory sync every 5 minutes
   - Health heartbeat every 30 seconds
   - Alert push immediately

2. Build offline queue
   - Queue changes when offline
   - Retry mechanism
   - Conflict resolution
   - Status indicator in UI

3. Create sync monitoring
   - Last sync time tracking
   - Sync error logging
   - Connection status monitoring
   - Automatic reconnection

4. Test offline scenarios
   - Internet disconnection
   - GreenReach server downtime
   - Partial sync failures
   - Data conflict resolution

**Deliverables**:
- Sync service: lib/sync-service.js
- Offline queue: lib/sync-queue.js
- Sync monitoring UI
- Documentation: SYNC_ARCHITECTURE.md

---

### Phase 5: Security & Certificate Management (1 week)

**Tasks**:
1. Implement certificate provisioning
   - Generate unique API keys per farm
   - Issue TLS certificates
   - Store in encrypted keyring

2. Add mutual TLS authentication
   - Farm authenticates to GreenReach
   - GreenReach authenticates to farm
   - Certificate validation

3. Build credential management
   - Secure credential storage
   - Encrypted configuration files
   - Environment variable management

4. Implement certificate rotation
   - Auto-renewal before expiry
   - Notification system
   - Manual renewal option

**Deliverables**:
- Certificate provisioning service
- Mutual TLS implementation
- Credential manager
- Documentation: SECURITY.md

---

### Phase 6: Wholesale Integration (1 week)

**Tasks**:
1. Connect farm inventory to GreenReach catalog
   - Automatic catalog updates
   - Product availability sync
   - Pricing sync

2. Implement order webhook receiver
   - Receive wholesale orders from GreenReach
   - Create local order records
   - Reserve inventory

3. Build fulfillment notification
   - Update order status
   - Send fulfillment confirmation
   - Generate shipping labels

4. Test multi-farm ordering
   - Orders spanning multiple farms
   - Inventory reservation
   - Fulfillment tracking

**Deliverables**:
- Wholesale integration service
- Order webhook handler
- Fulfillment notification system
- Documentation: WHOLESALE_INTEGRATION.md

---

### Phase 7: Testing & Documentation (1 week)

**Tasks**:
1. End-to-end testing
   - Farm registration flow
   - Hardware detection
   - Sync service
   - Wholesale orders

2. Create installation guides
   - Hardware requirements
   - OS compatibility
   - Network requirements
   - Troubleshooting

3. Write admin documentation
   - GreenReach admin portal
   - Farm management
   - Monitoring and alerts
   - Support procedures

4. Create farmer documentation
   - Getting started guide
   - Feature tutorials
   - FAQ
   - Support contacts

**Deliverables**:
- Test suite for edge deployment
- Installation guide
- Admin documentation
- Farmer documentation

---

## Technical Specifications

### Hardware Requirements

**Standard Device**: **Symcod W101M N97 TermiCom W**

**Specifications**:
- **Processor**: Intel Alder Lake N97, 3.6 GHz (quad-core)
- **RAM**: 8 GB DDR4
- **Storage**: 240 GB NVMe SSD (or more)
- **Display**: 10.1" tempered glass touchscreen, 1280x800, 350 nits, capacitive touch
- **Casing**: Industrial aluminum and ABS, VESA 100 mounting
- **Power**: 24 VDC terminal block (industrial standard)
- **Network**: 
  - 1x 2.5 Gigabit Ethernet (2500BaseT)
  - 1x Gigabit Ethernet (1000BaseT)
- **USB**: 
  - 2x USB 3.2 Gen 2 (10 Gbps)
  - 2x USB 2.0
- **Video**: 1x SVGA, 1x HDMI, 1x DisplayPort
- **Optional**: Up to 2 additional COM ports (RS-232/422/485)

**Why This Device**:
- ✅ Industrial-grade reliability (rated for 24/7 operation)
- ✅ Built-in touchscreen for on-site control
- ✅ Powerful Intel processor (runs complex automation algorithms)
- ✅ NVMe storage (fast database operations)
- ✅ Dual Ethernet (separate networks for control/data)
- ✅ 24V DC power (standard in agricultural/industrial settings)
- ✅ VESA mounting (easy installation in grow rooms)
- ✅ Optional RS-485 (native support for Modbus sensors/lights)

**Sensors** (connected via USB/RS-485/Ethernet):
- Atlas Scientific pH, EC, ORP, DO sensors (USB or I2C adapter)
- Temperature/humidity sensors (USB, Modbus, or network)
- CO2 sensors (Modbus RTU via RS-485)
- Light intensity sensors (0-10V or Modbus)

**Lights** (connected via Ethernet/RS-485):
- DMX controllers (USB-DMX adapter)
- Modbus lighting controllers (RS-485 native)
- Network-connected LED drivers (Ethernet)
- PWM controllers (USB or GPIO expansion)

### Software Stack

**Edge Device** (Symcod W101M N97):
- OS: Ubuntu 22.04 LTS or Windows 10 IoT Enterprise LTSC
- Runtime: Node.js 20.x LTS
- Database: SQLite 3.x (fast NVMe storage)
- MQTT: Mosquitto 2.x (local broker for sensors)
- Web Server: Express.js 4.x
- Process Manager: PM2 or systemd
- Touch UI: Full-screen kiosk mode for on-site control

**Central Server** (GreenReach Cloud):
- OS: Ubuntu 22.04 LTS
- Runtime: Node.js 20.x
- Database: PostgreSQL 15.x
- Cache: Redis 7.x
- Web Server: Express.js 4.x
- Reverse Proxy: Nginx
- Hosting: AWS/Azure/Google Cloud

### Network Requirements

**Outbound** (Farm → GreenReach):
- HTTPS (443) for API calls
- WebSocket (443) for real-time updates
- NTP (123) for time synchronization

**Inbound** (GreenReach → Farm):
- HTTPS (443) for webhooks
- Optional: VPN for direct access

**Bandwidth**:
- Minimum: 1 Mbps down / 512 Kbps up
- Recommended: 5 Mbps down / 2 Mbps up

### Database Schema

**Edge (SQLite)**:
```sql
-- Farm configuration
CREATE TABLE farm_config (
  id INTEGER PRIMARY KEY,
  farm_id TEXT UNIQUE,
  farm_name TEXT,
  api_key TEXT ENCRYPTED,
  central_url TEXT,
  last_sync TIMESTAMP
);

-- Existing tables remain the same:
-- sensors, lights, groups, automations, 
-- inventory, orders, customers, etc.
```

**Central (PostgreSQL)**:
```sql
-- Farms registry
CREATE TABLE farms (
  id UUID PRIMARY KEY,
  farm_id VARCHAR(50) UNIQUE,
  farm_name VARCHAR(255),
  location JSONB,
  contact JSONB,
  status VARCHAR(50),
  last_seen TIMESTAMP,
  api_key_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Inventory sync
CREATE TABLE farm_inventory_sync (
  id UUID PRIMARY KEY,
  farm_id VARCHAR(50) REFERENCES farms(farm_id),
  product_sku VARCHAR(100),
  quantity INTEGER,
  price DECIMAL(10,2),
  available_for_wholesale BOOLEAN,
  synced_at TIMESTAMP DEFAULT NOW()
);

-- Order sync
CREATE TABLE farm_orders_sync (
  id UUID PRIMARY KEY,
  farm_id VARCHAR(50) REFERENCES farms(farm_id),
  order_id VARCHAR(100),
  status VARCHAR(50),
  items JSONB,
  delivery_info JSONB,
  synced_at TIMESTAMP DEFAULT NOW()
);

-- Alerts
CREATE TABLE farm_alerts (
  id UUID PRIMARY KEY,
  farm_id VARCHAR(50) REFERENCES farms(farm_id),
  alert_type VARCHAR(100),
  severity VARCHAR(50),
  message TEXT,
  data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  acknowledged_at TIMESTAMP
);

-- Metrics
CREATE TABLE farm_metrics (
  id UUID PRIMARY KEY,
  farm_id VARCHAR(50) REFERENCES farms(farm_id),
  metric_type VARCHAR(100),
  value DECIMAL(10,2),
  unit VARCHAR(50),
  timestamp TIMESTAMP DEFAULT NOW()
);
```

---

## Migration Strategy

### Transitioning Existing Farms

For farms currently running Light Engine in cloud mode:

1. **Backup existing data**
   ```bash
   sqlite3 lightengine.db .dump > farm_backup.sql
   ```

2. **Install edge software on Symcod W101M**
   
   **Ubuntu**:
   ```bash
   wget https://download.lightengine.io/lightengine_v1.0.0_amd64.deb
   sudo dpkg -i lightengine_v1.0.0_amd64.deb
   # Opens full-screen setup wizard on touchscreen
   ```
   
   **Windows 10 IoT**:
   ```powershell
   # Download installer
   Invoke-WebRequest -Uri https://download.lightengine.io/LightEngine_v1.0.0_x64.msi -OutFile LightEngine.msi
   # Run installer (GUI wizard)
   msiexec /i LightEngine.msi
   ```

3. **Import existing data**
   ```bash
   # Copy backup to device
   scp farm_backup.sql farm@device-ip:/tmp/
   
   # Import on device
   sqlite3 /var/lib/lightengine/lightengine.db < /tmp/farm_backup.sql
   ```

4. **Register with GreenReach**
   - Touch "Register Farm" on setup wizard
   - Use existing farm_id if available
   - Or complete new registration flow
   - GreenReach assigns credentials

5. **Configure touchscreen interface**
   - Calibrate touchscreen (5-point calibration)
   - Set display brightness (350 nits max)
   - Configure auto-lock timeout
   - Test gesture controls

6. **Connect sensors and equipment**
   - Plug Atlas sensors into USB ports
   - Connect Modbus devices to RS-485 (if equipped)
   - Connect lighting controllers (DMX/Modbus/Network)
   - Run hardware detection wizard

7. **Verify sync**
   - Check inventory appears in GreenReach catalog
   - Place test wholesale order
   - Confirm order received by farm
   - Test touchscreen control of lights/sensors

8. **Mount device in grow room**
   - Use VESA 100 bracket
   - Position for easy viewing (eye level)
   - Connect 24V DC power supply
   - Connect dual Ethernet cables (primary + backup)

9. **Decommission cloud instance**
   - Once edge device confirmed working
   - Archive cloud data
   - Cancel cloud hosting

---

## Cost Analysis

### Per-Farm Costs

**Hardware** (one-time):
- Symcod W101M N97 TermiCom W: $800-1,200 (depending on configuration)
- 24V DC power supply (industrial): $50-80
- Mounting bracket (VESA 100): $20-30
- Optional RS-485 ports (if needed): $100-150
- **Total**: ~$900-1,400 per farm

**Optional Add-ons**:
- UPS backup (24V DC): $150-300
- Protective enclosure (if outdoor): $100-200
- Extended warranty (3-year): $150-250

**Operating Costs** (monthly):
- Internet bandwidth: $50-100 (shared with farm operations)
- Electricity: ~$10-15 (higher power draw than Pi, but still efficient)
- **Total**: ~$10-15 per farm (marginal)

### Central Infrastructure Costs

**AWS/Azure Hosting** (monthly for 100 farms):
- Compute (t3.large): $70
- Database (PostgreSQL): $100
- Storage (500GB): $50
- Bandwidth (1TB): $90
- **Total**: ~$310/month for 100 farms = $3.10/farm/month

### Comparison: Cloud vs Edge

**Current Cloud Model** (per farm/month):
- AWS hosting: $50-100
- Database: Shared but scales with farms
- Bandwidth: $20-50
- **Total**: ~$70-150/farm/month

**New Edge Model** (per farm/month):
- Edge hardware: $900-1,400 one-time (amortized over 5 years = $15-23/month)
- Operating costs: $10-15
- Central infrastructure: $3.10
- **Total**: ~$28-41/month per farm

**Savings**: $30-110 per farm per month  
**For 100 farms**: $3,000-11,000/month savings

**Additional Benefits**:
- ✅ Better performance (local processing, no latency)
- ✅ Offline operation (farm continues if internet down)
- ✅ Data sovereignty (farm owns their data)
- ✅ Lower bandwidth usage (only sync/telemetry)
- ✅ Industrial reliability (rated for 24/7 operation)
- ✅ Built-in touchscreen (on-site control without phone/laptop)

---

## Success Metrics

### Technical Metrics

- **Installation Success Rate**: >95% of farmers complete installation without support
- **Sync Reliability**: >99.9% of sync attempts succeed
- **Uptime**: >99.5% farm uptime (excluding internet outages)
- **Data Loss**: 0% data loss during sync or offline periods
- **Update Success**: >98% of automatic updates succeed

### Business Metrics

- **Time to Onboard**: <30 minutes from download to first harvest
- **Support Tickets**: <5% of farms require support in first month
- **Wholesale Orders**: >50% of farms receive wholesale order within first week
- **Farmer Satisfaction**: >4.5/5 stars on ease of setup
- **GreenReach Visibility**: 100% of farm inventory visible in wholesale catalog

---

## Risk Analysis

### Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Hardware failure | High | Low | Industrial-grade components, 3-year warranty, hot-swap support |
| Touchscreen damage | Medium | Medium | Tempered glass protection, replaceable screen, touch calibration backup |
| Network unreliability | High | High | Dual Ethernet (primary + backup), robust offline mode, sync queue |
| Data conflicts during sync | Medium | Medium | Timestamp-based conflict resolution, manual review UI |
| Certificate expiry | High | Low | Auto-renewal 30 days before expiry, alert GreenReach |
| Software updates breaking farm | High | Low | Staged rollouts, automatic rollback, manual update option |
| RS-485 communication errors | Medium | Medium | Automatic retry, error logging, fallback to USB sensors |
| 24V power fluctuations | Medium | Low | Industrial power supply with surge protection, UPS backup recommended |

### Business Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Farmers struggle with installation | Medium | Low | Video tutorials, phone support, optional professional installation service |
| Touchscreen UI learning curve | Medium | Medium | Intuitive design, on-screen help, tutorial mode on first use |
| Farms go offline for extended periods | Medium | Medium | Alert GreenReach after 5 min, escalate after 1 hour, automatic diagnostics |
| Inventory sync delays | Medium | Low | Real-time sync for critical updates, batch for others, manual sync button |
| Wholesale orders lost | High | Low | Acknowledgment required, retry mechanism, manual fallback, SMS alerts |
| Data privacy concerns | Medium | Medium | Encrypted transmission, GDPR compliance, opt-out options, local-only mode |
| Device theft or damage | Medium | Low | VESA lock points, theft alerts (heartbeat monitoring), data encrypted at rest |

---

## Next Steps

### Immediate Actions (This Week)

1. **Review this architecture** with GreenReach leadership
2. **Prioritize Phase 1-3** for initial MVP
3. **Create project plan** with timelines and resources
4. **Assign development team** for Central API and installer
5. **Procure test hardware** (5x Raspberry Pi setups)

### Q1 2026 Goals

- ✅ Central GreenReach API operational
- ✅ Linux installer packages ready
- ✅ First-run wizard complete
- ✅ 10 pilot farms running on edge devices
- ✅ Wholesale integration fully tested

### Q2 2026 Goals

- ✅ 50+ farms migrated to edge deployment
- ✅ Auto-update system operational
- ✅ 100% wholesale inventory sync
- ✅ GreenReach monitoring dashboard live
- ✅ Documentation complete

---

## Appendix: File Structure Changes

### New Repositories

```
greenreach-central-api/
├── server.js
├── routes/
│   ├── farms.js          # Farm registration
│   ├── monitoring.js     # Health & metrics
│   ├── inventory.js      # Inventory sync
│   ├── orders.js         # Order management
│   └── alerts.js         # Alert aggregation
├── db/
│   ├── migrations/
│   └── schema.sql
└── docs/
    └── API.md

lightengine-installer/
├── build/
│   ├── debian/          # .deb package (Ubuntu, x86_64)
│   ├── windows/         # .msi installer (Windows 10 IoT)
│   └── docker/          # Dockerfile (x86_64)
├── scripts/
│   ├── install.sh       # Auto-installer (Ubuntu)
│   ├── install.ps1      # Auto-installer (Windows)
│   ├── first-run.sh     # First-run wizard (Ubuntu)
│   ├── first-run.ps1    # First-run wizard (Windows)
│   └── update.sh        # Update agent
├── touchscreen/
│   ├── calibration.js   # Touchscreen calibration utility
│   ├── kiosk-mode.sh    # Full-screen kiosk setup
│   └── gestures.js      # Touch gesture library
└── docs/
    ├── INSTALL_UBUNTU.md
    ├── INSTALL_WINDOWS.md
    ├── TOUCHSCREEN_GUIDE.md
    └── HARDWARE_SETUP.md
```

### Modified Light Engine Files

```
Light-Engine-Delta/
├── lib/
│   ├── sync-service.js           # NEW: Sync with GreenReach
│   ├── hardware-detection.js    # NEW: USB/RS-485/Network device detection
│   ├── registration-client.js   # NEW: GreenReach registration
│   ├── touchscreen-ui.js        # NEW: Touch-optimized UI components
│   ├── modbus-client.js         # NEW: Modbus RTU/TCP support (RS-485)
│   └── farm-auth.js              # MODIFY: Add cert management
├── routes/
│   └── first-run/                # NEW: First-run wizard routes
│       ├── network.js
│       ├── registration.js
│       ├── hardware.js
│       └── touchscreen.js
└── public/
    ├── first-run.html            # NEW: First-run wizard UI (touch-optimized)
    ├── touchscreen-calibrate.html # NEW: Calibration utility
    └── kiosk.css                 # NEW: Full-screen touch styles
```

---

**STATUS**: 📋 Architecture defined, awaiting approval to begin Phase 1 implementation.
