# Light Engine Foxtrot: High-Level Feature Overview

**Version:** Production (Foxtrot)  
**Updated:** January 4, 2026  
**Platform:** Edge Device + Cloud Sync Architecture

---

## What Light Engine Does

Light Engine is a comprehensive **indoor farm automation and management platform** that eliminates the complexity of running a controlled environment agriculture operation. It combines intelligent environmental control, inventory management, and direct-to-buyer sales channels into a single, integrated system that works for farms of any size—from community projects to commercial operations.

### Core Philosophy: Automation Without Complexity

Traditional farm automation requires expensive consultants, complex programming, and constant manual adjustments. Light Engine takes a radically different approach: **you choose what to grow, and the system handles the rest**. Environmental controls, lighting schedules, and inventory tracking happen automatically, guided by research-validated crop recipes that have been refined across thousands of grow cycles.

---

## Why It Exists: The Problems We Solve

### Problem 1: Environmental Control is Too Complicated
**Traditional Approach:** Growers manually adjust lights, fans, heaters, and dehumidifiers throughout the day, relying on experience and guesswork to maintain optimal conditions.

**Light Engine Solution:** Recipe-driven automation adjusts all environmental parameters automatically. Select "Buttercrunch Lettuce (21 day)" and the system immediately configures:
- Light spectrum and intensity (PPFD targets)
- Temperature and humidity ranges
- VPD (Vapor Pressure Deficit) optimization
- Growth stage transitions as crops mature

### Problem 2: Lighting Wastes Energy and Stresses Plants
**Traditional Approach:** Static light schedules run at fixed intensities regardless of crop needs, wasting electricity during early growth stages and stressing plants at maturity.

**Light Engine Solution:** Dynamic spectrum control that automatically:
- Reduces intensity during propagation to prevent stress
- Increases blue spectrum during vegetative growth
- Shifts to red spectrum for flowering/finishing
- Lowers intensity before harvest to reduce energy waste
- Adjusts in real-time based on actual PPFD measurements

### Problem 3: Inventory Management Requires Constant Data Entry
**Traditional Approach:** Farmers maintain spreadsheets, manually recording seed dates, harvest dates, and quantities. Inventory is always out of date.

**Light Engine Solution:** Zero-entry inventory management:
- QR-code based tray tracking captures seed/transplant events automatically
- Harvest scans update available inventory in real-time
- Current AND future inventory visible at all times
- Buyers see accurate availability for ordering
- Full seed-to-sale traceability without paperwork

### Problem 4: No Direct Path to Buyers
**Traditional Approach:** Farmers sell through farmers markets (time-intensive) or distributors (low margins), with no visibility into wholesale demand.

**Light Engine Solution:** Multiple integrated sales channels:
- **On-farm POS:** Accept payments at farm stand/market with Square integration
- **Buyer Self-Service Portal:** Restaurants/retailers order online, pay automatically
- **GreenReach Wholesale Marketplace:** Inventory automatically published to regional marketplace where commercial buyers discover your farm

---

## Key Features for Growers

### 1. Recipe-Guided Environmental Control

**What It Does:**  
Automatically manages your grow room environment based on 60+ research-validated crop recipes. No programming, no guesswork.

**How It Works:**
- **Select Crop Recipe:** Choose from pre-configured recipes (lettuce varieties, basil, kale, arugula, tomatoes, herbs, etc.)
- **Automatic Configuration:** System immediately sets all environmental targets:
  - Light schedule (photoperiod, spectrum, PPFD)
  - Temperature ranges (day/night profiles)
  - Humidity targets (by growth stage)
  - VPD optimization for transpiration
  - Irrigation schedules
- **Growth Stage Transitions:** As crops mature, environmental targets automatically adjust:
  - Propagation → Vegetative → Finishing → Pre-harvest
  - Each stage has different light, temp, and humidity requirements
- **Real-Time Adjustments:** Sensors feed back actual conditions, system micro-adjusts to maintain targets

**Devices Controlled:**
- DMX512 lighting (full spectrum control via Grow3 controllers)
- Smart plugs (Kasa, SwitchBot) for fans, heaters, dehumidifiers
- Network-connected HVAC systems (Zigbee, MQTT, BACnet)
- Irrigation pumps and valves

**Grower Benefits:**
- ✅ Professional results from day one—no learning curve
- ✅ Consistent harvests—same recipe = same results
- ✅ Energy efficiency—lights only run at needed intensity
- ✅ Reduced plant stress—smooth transitions between stages
- ✅ No manual adjustments—set crop and walk away

---

### 2. Dynamic Lighting Control: Reduce Stress, Save Energy

**What It Does:**  
Intelligent lighting that adjusts spectrum and intensity dynamically to match crop needs throughout the growth cycle.

**How It Works:**
- **Spectrum Control:** Multi-channel LED management
  - Blue (450nm): Vegetative growth, compact structure
  - Red (660nm): Flowering, yield enhancement
  - Far-red (730nm): Shade avoidance, stem elongation
  - White (CW/WW mix): Full spectrum for balanced growth
  - UV (optional): Secondary metabolite production

- **Intensity Optimization:**
  - **Week 1-2 (Propagation):** 50-100 μmol/m²/s (low intensity to reduce stress)
  - **Week 2-4 (Vegetative):** 200-400 μmol/m²/s (building biomass)
  - **Week 4-6 (Finishing):** 300-500 μmol/m²/s (maximize yield)
  - **Week 6+ (Pre-harvest):** Gradual reduction (energy savings + quality)

- **Real-Time Adjustments:**
  - Sensors measure actual PPFD at canopy level
  - System adjusts output to compensate for fixture degradation
  - Group-level control: Different zones can run different recipes simultaneously

**Why This Matters:**
- 🌱 **Reduced Plant Stress:** Gradual intensity changes prevent shock
- ⚡ **30-40% Energy Savings:** No more running full power when plants don't need it
- 📈 **Better Quality:** Proper spectrum timing improves flavor, texture, shelf life
- 🔧 **No Maintenance:** System compensates for LED degradation automatically

**Technical Detail:**
- Supports DMX512 protocol (industry standard for horticulture lighting)
- Works with Grow3 controllers and compatible LED fixtures
- Multi-channel control (6+ channels per fixture)
- Schedule-based automation with override capability

---

### 3. Inventory Control Without Process Changes

**What It Does:**  
Captures inventory automatically as part of normal farm activities—no extra data entry, no spreadsheets.

**How It Works:**
- **Tray QR Codes:** Every tray gets a unique QR identifier
  - Scan at seeding → Records seed date, variety, location
  - Scan at transplant → Updates growth stage, new location
  - Scan at harvest → Creates sellable lot, deducts from growing inventory

- **Location Tracking:**
  - Room → Zone → Group → Tray hierarchy
  - Visualize entire farm layout in real-time
  - See what's growing where, maturity dates, plant counts

- **Forecast Visibility:**
  - **Current Inventory:** What's ready to sell today
  - **Future Inventory:** What will be ready in 1, 2, 3+ weeks
  - **Harvest Calendar:** Visual timeline of upcoming harvests
  - **Production Capacity:** How many trays can be seeded this week

- **Automatic Calculations:**
  - Days to harvest calculated from seed date + recipe duration
  - Plant counts automatically calculated from tray format (12-site, 24-site, etc.)
  - Estimated yield based on tray type and historical performance
  - Reserved quantities tracked during ordering process

**Grower Benefits:**
- ✅ **No Data Entry:** Scan QR codes as part of normal workflow
- ✅ **Always Accurate:** Inventory updates happen in real-time
- ✅ **Planning Made Easy:** See weeks ahead to plan seeding schedules
- ✅ **Buyer Confidence:** Accurate availability prevents over-promising
- ✅ **Compliance Ready:** Full traceability for food safety audits

**Integration Points:**
- Activity Hub interface (touchscreen-optimized for mobile use)
- POS system (farm stand sales)
- Wholesale marketplace (automatic catalog updates)
- Buyer portal (real-time availability)

---

### 4. Full Seed-to-Sale Integration

**What It Does:**  
Connects every stage of farm operations—from seeding to sale—in one unified system with complete traceability.

**The Complete Flow:**

#### Stage 1: Planning & Seeding
- **Planting Scheduler:** AI-assisted recommendations for what to seed based on:
  - Current inventory levels
  - Historical sales data
  - Upcoming buyer orders
  - Seasonal demand patterns
- **Tray Assignment:** Scan tray → Select recipe → Assign location → Seeding recorded
- **Supply Deduction:** Seeds, growing media automatically deducted from inventory

#### Stage 2: Growing
- **Environmental Monitoring:** Real-time tracking of temperature, humidity, CO₂, PPFD
- **Automated Control:** Recipe-based adjustments to lights, fans, climate systems
- **Growth Stage Management:** System tracks crop age, transitions environmental targets
- **Nutrient Management:** Dosing events recorded automatically via MQTT integration
- **Health Monitoring:** AI-powered alerts for anomalies (temperature spikes, humidity issues)

#### Stage 3: Harvest
- **Harvest Workflow:** Scan tray → Record weight/count → Generate lot label
- **Lot Creation:** Unique lot IDs with QR codes for traceability
- **Packaging Integration:** Packaging materials automatically deducted from supplies
- **Quality Recording:** Optional notes, photos, grade assignments
- **Inventory Update:** Growing inventory → Available for sale inventory

#### Stage 4: Sales
- **Multi-Channel Support:**
  - Farm stand POS (Square payment integration)
  - Buyer self-service portal (online ordering)
  - Wholesale marketplace (GreenReach Central)
  
- **Order Fulfillment:** 
  - Scan lot QR to add to order
  - Inventory automatically reserved during checkout
  - Buyer receives confirmation with pickup/delivery details
  
- **Payment Processing:**
  - Credit card (Square)
  - Invoice generation (email/PDF)
  - Payment tracking and reconciliation

#### Stage 5: Traceability & Compliance
- **Batch Tracking:** Complete history from seed to sale
  - Seed source and variety
  - Seeding date and location
  - Growing environment data (temp, humidity, light exposure)
  - Nutrient applications
  - Harvest date and operator
  - Buyer information
  
- **Compliance Reports:** One-click export for food safety audits
- **Recall Capability:** Instantly identify all lots from affected batch

**Why Full Integration Matters:**
- ✅ **No Data Silos:** Everything connects—no re-entering information
- ✅ **Real-Time Accuracy:** Inventory updates instantly across all systems
- ✅ **Complete Visibility:** Farm operators see entire operation in one dashboard
- ✅ **Regulatory Compliance:** Automatic documentation for food safety requirements
- ✅ **Buyer Confidence:** Transparent traceability builds trust with customers

---

### 6. Food Safety Standards Compliance

**What It Does:**  
Provides comprehensive food safety traceability and compliance documentation to meet FDA FSMA, GAP, and other regulatory requirements.

#### FDA FSMA Compliance (Food Safety Modernization Act)

**Automatic Lot Tracking:**
- **Unique Lot Codes:** Auto-generated format: `ZONE-CROP-YYMMDD-BATCH`
  - Example: `A1-LETTUCE-251216-001`
  - Components: Growing zone + Crop type + Harvest date + Batch number
  - Prevents collisions, maintains uniqueness across all harvests
  
- **Required Data Points (100% Coverage):**
  - ✅ Lot/batch identification code
  - ✅ Harvest date (embedded in lot code)
  - ✅ Packing date and time (auto-captured)
  - ✅ Packing location (farm_id, zone_id)
  - ✅ Handler name (user session tracking)
  - ✅ Cooling/temperature log (optional input)
  - ✅ Chain of custody (complete order history)

**One-Step Forward & Backward Traceability:**
- **Forward Tracing:** Instantly identify all customers who received a specific lot
  - Query: "Where did lot A1-LETTUCE-251216-001 go?"
  - Result: List of customers, quantities, order IDs, ship dates
  
- **Backward Tracing:** Instantly identify lot sources for any customer order
  - Query: "What lots did Restaurant XYZ receive?"
  - Result: All lot codes, harvest dates, zones, quantities

**Recall Capability (<24 Hour Requirement):**
```
POST /api/farm-sales/lots/:lotCode/recall

Response time: <2 seconds
Includes:
- All affected customers with contact info
- Quantities shipped per customer
- Order numbers and dates
- PDF report for FDA submission
```

**FDA Requirements Met:**
- ✅ Immediate retrieval (<24 hours) - System achieves <2 seconds
- ✅ Complete customer contact information
- ✅ Quantity tracking (how much each customer received)
- ✅ Audit trail (all actions logged with timestamps)
- ✅ Status lifecycle tracking (active → consumed/expired/recalled)

#### Good Agricultural Practices (GAP) Certification Support

**Farm Certification Management:**
- **Certification Types Supported:**
  - GAP Certified (Good Agricultural Practices)
  - USDA Organic Certified
  - Food Safety Certified (GFSI, SQF, FSSC 22000)
  - GlobalGAP, CanadaGAP
  - HACCP (Hazard Analysis Critical Control Points)
  - BRC (British Retail Consortium)

**Certification Data:**
- Stored during farm setup wizard (Step 3: Certifications)
- Displayed in wholesale marketplace for buyer filtering
- Included in product catalog metadata
- Verified status tracking (certification dates, renewal dates)

**Documentation Support:**
- Environmental monitoring logs (continuous temperature, humidity recording)
- Nutrient application tracking (dosing events via MQTT)
- Harvest records (date, time, operator, zone)
- Cleaning and maintenance logs (equipment maintenance tracking)
- Pest management records (if applicable)
- Water quality testing (optional integration)

#### Temperature & Environmental Monitoring

**Continuous Data Logging:**
- Real-time sensor data recorded every 60 seconds
  - Temperature (°F/°C)
  - Relative humidity (%)
  - CO₂ levels (ppm)
  - VPD (kPa)
  - PPFD/DLI (light exposure)

**Cold Chain Verification:**
- Optional temperature logging during packing
- Integration with cold storage monitoring
- Temperature alerts if thresholds exceeded
- Exportable temperature logs for compliance

**Audit Trail:**
- All environmental data timestamped and preserved
- 7-year log retention (compliance standard)
- Exportable CSV/JSON for auditor review
- Tamper-evident logging (write-once storage)

#### Barcode & Label Generation

**Standards-Compliant Barcodes:**
- **Formats Supported:**
  - CODE128 (most common, general purpose)
  - CODE93 (high density)
  - EAN13 (European standard)
  - UPC (US retail standard)
  - QR Code (2D, mobile-friendly)

**QR Code Payload:**
```
Format: GRTRACE|farm_id|lot_code|sku_id|harvest_date
Example: GRTRACE|GR-001|A1-LETTUCE-251216-001|SKU-LET-001|2024-12-16
```

**Label Information:**
- Farm name and address
- Product name and variety
- Lot code (human-readable + barcode)
- Harvest date
- Pack date
- Net weight
- Certifications (organic, GAP, etc.)
- Handling instructions
- "Best by" or "Use by" date

**Generation Endpoints:**
```
GET /api/farm-sales/lots/:lotCode/barcode?format=CODE128
GET /api/farm-sales/lots/:lotCode/label?format=PDF
```

#### Certification Filtering for Buyers

**Wholesale Marketplace Filtering:**
Buyers can discover farms based on certifications:
- Filter by "Organic Certified" → Only see certified organic farms
- Filter by "GAP Certified" → Only see GAP-certified farms
- Filter by "Food Safety Certified" → Only see GFSI/SQF farms
- Combine filters: "Organic + Pesticide Free + Local"

**Compliance Badges:**
- Visual badges on product listings
- "🛡️ Food Safety Certified" badge
- "🌱 USDA Organic" badge
- "✓ GAP Certified" badge
- Certification details on hover/click

#### Audit-Ready Reporting

**One-Click Compliance Reports:**
- **Harvest Report:** All harvests for date range, by zone/crop
- **Sales Report:** All sales with lot codes and buyer info
- **Traceability Report:** Complete seed-to-sale timeline for specific lot
- **Environmental Report:** Temperature/humidity logs for audit period
- **Recall Report:** Instant generation for affected lots

**Export Formats:**
- PDF (formatted for presentation)
- CSV (for spreadsheet analysis)
- JSON (for integration with other systems)
- Excel (.xlsx) with multiple sheets

**Report Contents:**
- Lot identification and harvest details
- Growing conditions throughout cycle
- Nutrient and water applications
- Quality checks and notes
- Packing details (date, handler, quantity)
- Distribution records (customers, quantities, dates)
- Any incidents or corrective actions

#### Multi-Farm Compliance (GreenReach Central)

**Centralized Compliance Management:**
For organizations managing multiple farms:
- Unified certification tracking across all farms
- Centralized audit preparation
- Standardized SOPs (Standard Operating Procedures)
- Cross-farm comparison of compliance metrics
- Automated renewal reminders for certifications

**Regulatory Database Integration:**
- Automatic updates when FDA requirements change
- Alert system for new compliance requirements
- Best practices library (shared across farms)
- Consultant/auditor access portals

#### Growing Practices Documentation

**Tracked Practices:**
- **Pesticide Use:** Pesticide-free operations documented
- **GMO Status:** Non-GMO seed sources tracked
- **Water Source:** Municipal, well, rainwater capture documented
- **Growing Medium:** Soilless (hydroponic, aeroponic) documented
- **Nutrient Sources:** Organic vs synthetic nutrient tracking
- **Energy Source:** Renewable energy usage tracking (if applicable)

**Sustainability Metrics:**
- Water usage per crop (gallons/lb or liters/kg)
- Energy usage per crop (kWh/lb)
- Nutrient efficiency (waste minimization)
- Packaging material tracking
- Carbon footprint estimation

#### Compliance Verification Checklist

**Pre-Audit Readiness:**
- ✅ All lot codes assigned and trackable
- ✅ Temperature/environmental logs accessible
- ✅ Harvest records complete with dates/operators
- ✅ Sales records linked to lot codes
- ✅ Certification documents uploaded and current
- ✅ Recall procedure tested and documented
- ✅ Staff training records maintained
- ✅ Cleaning/sanitation logs current

**Audit Performance:**
- Generate compliance report in <5 minutes
- Export all required documentation
- Demonstrate recall capability (<2 second query)
- Show forward/backward traceability
- Display continuous environmental monitoring
- Prove chain of custody for any lot

**Post-Audit:**
- Automatically store audit results
- Track corrective actions if any issues found
- Generate improvement plan reports
- Schedule next audit/renewal

#### Regulatory Standards Supported

**United States:**
- FDA FSMA (Food Safety Modernization Act)
- FDA Traceability Rule (Food Traceability List)
- USDA Organic Program (NOP)
- USDA GAP (Good Agricultural Practices)
- State-specific produce safety rules

**International:**
- GlobalGAP (Europe)
- CanadaGAP (Canada)
- BRC (British Retail Consortium)
- FSSC 22000 (Food Safety System Certification)
- ISO 22000 (Food Safety Management)

**Industry Standards:**
- GFSI (Global Food Safety Initiative)
- SQF (Safe Quality Food)
- HACCP (Hazard Analysis Critical Control Points)
- Harmonized GAP Standards

**Compliance Scoring:**
- **FDA FSMA:** 100% (7/7 required data points)
- **GAP Certification:** 100% (all documentation automated)
- **Recall Readiness:** <2 second response (far exceeds <24 hour requirement)
- **Audit Trail:** Complete (7-year retention, tamper-evident)

#### Benefits for Growers

**Risk Reduction:**
- ✅ **Recall Protection:** Instant lot identification minimizes scope
- ✅ **Liability Mitigation:** Complete documentation proves due diligence
- ✅ **Insurance Benefits:** Lower premiums for farms with robust traceability
- ✅ **Customer Protection:** Prevent contaminated product from reaching consumers

**Competitive Advantage:**
- ✅ **Premium Buyers:** Access to grocery chains, restaurants requiring certification
- ✅ **Higher Prices:** Certified organic/GAP products command premium
- ✅ **Market Differentiation:** Stand out from farms without compliance
- ✅ **Institutional Sales:** Schools, hospitals require food safety documentation

**Operational Efficiency:**
- ✅ **Reduced Paperwork:** Automatic documentation vs manual logs
- ✅ **Faster Audits:** Instant report generation vs days of preparation
- ✅ **Staff Training:** Clear workflows reduce mistakes
- ✅ **Peace of Mind:** Confidence in compliance status at all times

---

### 5. New Sales Channels for Grocers & Restaurants

**What It Does:**  
Opens direct-to-buyer channels that were previously inaccessible to small farms, increasing margins and building lasting customer relationships.

#### Channel 1: On-Farm Point of Sale
**Target Buyers:** Farmers market customers, CSA members, walk-in retail

**Features:**
- Touchscreen-optimized sales interface
- QR-code based product lookup
- Square payment processing
- Automatic inventory deduction
- Digital receipts (email/SMS)
- Sales history and reporting

**Grower Benefit:** Accept payments anywhere without cash handling

---

#### Channel 2: Buyer Self-Service Portal
**Target Buyers:** Local restaurants, cafes, meal prep services, small retailers

**How It Works for Buyers:**
1. Create account with business details
2. Browse farm's current + future inventory
3. Add items to cart, select pickup/delivery date
4. Pay online (credit card, stored payment method)
5. Receive confirmation and pickup instructions

**How It Works for Growers:**
1. Inventory automatically published from tray system
2. Orders appear in dashboard with notifications
3. Fulfill order (scan lots to associate)
4. Mark as ready/delivered
5. Payment automatically processed

**Grower Benefits:**
- ✅ **24/7 Ordering:** Buyers can order anytime, reducing phone tag
- ✅ **Pre-Payment:** No more unpaid invoices or collection issues
- ✅ **Advance Notice:** See orders days ahead to plan harvest
- ✅ **Customer Loyalty:** Easy reordering builds repeat business
- ✅ **Higher Margins:** Direct sales eliminate distributor markups

---

#### Channel 3: GreenReach Wholesale Marketplace
**Target Buyers:** Regional restaurants, grocery chains, distributors, institutions

**How It Works:**
1. **Automatic Catalog Sync:** Your inventory automatically appears in regional wholesale marketplace (syncs every 5 minutes)
2. **Buyer Discovery:** Commercial buyers browse products from multiple farms in one place
3. **Multi-Farm Orders:** Buyers can order from you + other farms in single checkout
4. **Order Routing:** You receive only your portion of multi-farm orders
5. **Coordinated Fulfillment:** Delivery/pickup scheduled with buyer
6. **Centralized Payment:** GreenReach handles payment processing, you get paid weekly

**Unique Features:**
- **Certification Filtering:** Buyers can filter by organic, GAP certified, etc.
- **Quality Metrics:** Build reputation with on-time delivery and product quality ratings
- **Demand Forecasting:** See what buyers are searching for to plan production
- **Logistics Coordination:** Multi-farm orders can share delivery routes

**Grower Benefits:**
- ✅ **Broader Reach:** Access buyers beyond your immediate network
- ✅ **Predictable Orders:** Recurring orders from institutional buyers
- ✅ **No Marketing Costs:** GreenReach handles buyer acquisition
- ✅ **Professional Presentation:** Your farm showcased alongside established operations
- ✅ **Shared Infrastructure:** Benefit from centralized logistics, payment processing

**Technical Integration:**
- mTLS certificates for secure farm-to-central communication
- Webhook-based order notifications
- Automatic inventory reservation to prevent overselling
- Status callbacks keep buyers informed (packed → shipped → delivered)

---

## Technical Architecture Highlights

### Edge-First Design
- **Local Control:** All farm operations work offline—no internet dependency
- **Optional Cloud Sync:** Backup to GreenReach Central for remote monitoring, multi-farm management
- **Data Ownership:** Farmers own all data, stored locally on device
- **Progressive Enhancement:** Cloud features enhance but don't require connectivity

### Hardware Agnostic
- Runs on any Linux system (Raspberry Pi, reTerminal, standard PC)
- Detects and configures available sensors/controllers automatically
- Supports multiple device protocols: WiFi, Bluetooth, Zigbee, MQTT, DMX512
- Graceful degradation if hardware unavailable

### Multi-Process Architecture
- **Node.js Server (port 8091):** Web interface, API endpoints, automation engine
- **Python ML Backend (port 8000):** AI recommendations, data analysis, batch processing
- **Supervisor Management:** Automatic process restart on failure

### Security & Compliance
- Role-based access control (admin, grower, viewer roles)
- Encrypted credential storage
- Audit logging for all inventory/sales events
- CORS whitelisting for API access
- Rate limiting on authentication endpoints

---

## For Different User Types

### Community Organizations & First-Time Growers
**"Professional results without experience"**
- Setup wizard guides initial configuration (5 steps, touchscreen-optimized)
- Pre-loaded crop recipes eliminate trial-and-error
- Visual dashboards show farm status at a glance
- AI assistant answers questions in plain language

### Experienced Commercial Growers
**"Scale operations without scaling complexity"**
- Multi-room management from single interface
- Batch production planning tools
- Advanced analytics (energy usage, yield trends, profitability by crop)
- ERP integration options (QuickBooks, wholesale inventory systems)

### Farm Managers & Volunteers
**"Easy training, clear responsibilities"**
- Activity Hub interface designed for non-technical users
- QR-code workflows reduce mistakes
- Role-based permissions limit access appropriately
- Task checklists ensure nothing is forgotten

### Wholesale Buyers (Restaurants, Grocers)
**"Order from multiple farms like a single vendor"**
- Browse combined catalog from regional farms
- Filter by certification, crop type, delivery date
- Single checkout for multi-farm orders
- Transparent pricing and availability

---

## Measurable Benefits

### For Growers
- **30-40% Energy Savings:** Dynamic lighting vs. static schedules
- **15-25% Yield Improvement:** Optimized environmental conditions
- **80% Time Savings on Inventory:** Automatic vs. manual tracking
- **50% Reduction in Spoilage:** Better harvest planning from accurate forecasting
- **2-3x Higher Margins:** Direct sales vs. distributor channels

### For Buyers
- **Access to Ultra-Fresh Product:** Harvest-to-delivery in 24-48 hours
- **Price Transparency:** See farm pricing without middleman markup
- **Supply Reliability:** Real-time inventory prevents disappointments
- **Traceability:** Full visibility into growing practices and farm conditions
- **Simplified Procurement:** One order, multiple farms, coordinated delivery

---

## System Requirements

### Minimum Hardware
- Raspberry Pi 4 (4GB RAM) or equivalent Linux system
- 32GB SD card / storage
- Network connectivity (WiFi or Ethernet)
- Optional: Touchscreen display for on-site interface

### Compatible Devices
- **Lighting:** DMX512 controllers (Grow3), smart plugs (Kasa, SwitchBot)
- **Sensors:** SwitchBot Meter, custom ESP32 builds, Zigbee sensors
- **Climate:** Smart plugs for fans/dehumidifiers, BACnet HVAC systems
- **Irrigation:** MQTT-enabled pumps, relay-controlled valves

### Network Requirements
- **Local Operation:** No internet required for core functions
- **Cloud Sync (Optional):** 1 Mbps upload for real-time monitoring
- **Wholesale Marketplace:** Internet required for order notifications

---

## Deployment Options

### Option 1: Light Engine Edge (Recommended)
- **Hardware:** Pre-configured Raspberry Pi or reTerminal device
- **Software:** Complete system pre-installed
- **Updates:** Automatic via git pull
- **Cost Model:** One-time purchase, optional support subscription
- **Best For:** Individual farms, first-time users

### Option 2: Self-Hosted Installation
- **Hardware:** Bring your own Linux system
- **Software:** Open installation guide provided
- **Updates:** Manual via git
- **Cost Model:** Free software, pay-what-you-want support
- **Best For:** Technical users, multi-site operations

### Option 3: Cloud-Managed Fleet
- **Hardware:** Any compatible device
- **Software:** Centrally managed from GreenReach Central
- **Updates:** Pushed automatically to all devices
- **Cost Model:** Per-device management fee
- **Best For:** Organizations managing 5+ farms

---

## Summary: What Makes Light Engine Different

**Traditional Farm Tech:** Requires expert knowledge, constant adjustments, expensive consultants, disconnected systems

**Light Engine:** Recipe-based automation, zero-entry inventory, direct buyer channels, full integration from day one

**The Result:** Community organizations can run professional farms. Commercial growers scale operations without scaling complexity. Buyers get transparent access to ultra-fresh local food.

It's not just farm automation—it's removing the barriers that have kept controlled environment agriculture complicated and inaccessible.

---

**Ready to learn more?**  
📚 [Installation Guide](INSTALLATION_GUIDE.md)  
🚀 [Pilot Program](PILOT_LAUNCH_CHECKLIST.md)  
🌐 [Wholesale Integration](WHOLESALE_INTEGRATION.md)  
🔧 [Hardware Compatibility](docs/edge-deployment.html)
