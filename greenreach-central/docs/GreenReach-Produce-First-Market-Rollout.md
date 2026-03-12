# GreenReach Produce-First Market Rollout

### Creating buyer demand first to power wholesale growth and Light Engine adoption

---

**Prepared:** March 2026
**Platform:** GreenReach Central — greenreachgreens.com
**Technology:** Light Engine Foxtrot IoT Platform

---

## Executive Summary

GreenReach's path to market starts with produce demand — not software. The strategy is built on one principle: buyers come for fresher local produce, farms adopt Light Engine to serve that demand reliably, and the platform grows because both sides need it.

This document defines the positioning, product ladder, target market sequence, rollout phases, messaging architecture, channel plan, 90-day execution timeline, and success metrics for bringing GreenReach to market.

---

## 1. Light Engine: Market Position

Light Engine is the cloud-based farm management software that helps farms meet wholesale expectations for consistency, inventory visibility, traceability, planning, and delivery readiness.

### What This Means in Practice

**Do not lead with:**
- Software features
- Dashboards
- AI
- IoT
- Compliance tools

**Lead with:**
- Harvested today
- Local and traceable
- Consistent year-round supply
- Simpler ordering
- Better shelf life
- Menu and merchandising differentiation

The software becomes the proof of how GreenReach delivers this reliably — not the headline.

---

## 2. Product Ladder

### Offer 1: The Produce Demand Story

*This is the market-facing entry point.*

**Message:**
- Fresher local produce
- Year-round availability
- Full traceability
- Reliable wholesale access
- A better local food story for grocers and restaurants

**Key Platform Features Behind This Offer:**

| Feature | What It Delivers |
|---------|-----------------|
| **Lot Code Traceability** | Seed-to-sale batch tracking with QR codes; SFCR-compliant export |
| **QR Label Generator** | Scannable provenance cards for in-store and in-package storytelling |
| **Predicted Inventory** | Pre-harvest visibility — buyers see "Available Feb 28" with confidence levels |
| **Food Miles Tracking** | Quantified distance from farm to shelf, proving the local story |
| **Browse Catalog** | Real-time wholesale availability with farm source, pricing, and demand trends |
| **Farms Directory** | Buyer-facing farm profiles with location, certifications, and produce types |
| **Quality Reports** | Lab-backed quality data (freshness, appearance) attached to every lot |

**Primary Audience:**
- Independent grocers
- Premium food retailers
- Chefs
- Restaurant groups
- Hospitality buyers
- Institutions with food service

---

### Offer 2: GreenReach Wholesale

*This is the commercial layer.*

**Value:**
- One place to order from local farms
- Consistent inventory visibility
- Simpler procurement
- Lot-level traceability
- Recurring supply programs
- Coordinated local delivery

**Key Platform Features Behind This Offer:**

| Feature | What It Delivers |
|---------|-----------------|
| **Wholesale Catalog** | Aggregated real-time inventory from all network farms via **Wholesale Network Aggregator** |
| **Buyer Registration & Login** | Self-service buyer accounts with JWT authentication |
| **Checkout & Square Payments** | Full e-commerce: cart preview, tax calculation, Square card processing |
| **My Orders** | Order history, status tracking (new → confirmed → processing → shipped → delivered) |
| **Invoice Download** | Per-order invoice generation and download |
| **Delivery Quote** | Zone-based delivery cost estimates before checkout |
| **Delivery Services** | Delivery zone management, driver enrollment, fee configuration, driver payouts |
| **Quality-Based Order Routing** | Routes each order to the best farm: quality (40%), proximity (30%), capacity (20%), price (10%) |
| **Dynamic Pricing Engine** | Recommended wholesale prices based on supply, demand, quality, seasonality, and competition |
| **Order State Machine** | Enforced status transitions ensuring fulfillment visibility at every step |
| **Wholesale Fulfillment** | Farm-side order acceptance, tracking number assignment, status updates |
| **Wholesale Financial Exports** | CSV exports for orders, payments, CRA-compliant tax summaries |
| **Demand Analysis** | Wholesale demand pattern analysis for buyer and crop forecasting |
| **Payment Reconciliation** | Automated payment reconciliation via webhook |

**Primary Audience:**
- Grocery buyers
- Produce managers
- Chefs
- Food service operators

---

### Offer 3: Light Engine

*This is the farm-side conversion layer.*

**Value:**
- Farm visibility to wholesale demand
- Crop planning tied to real orders
- Traceability and lot-code readiness
- Better harvest forecasting
- Delivery and inventory coordination
- Easier compliance and buyer reporting

**Key Platform Features Behind This Offer:**

| Feature | What It Delivers |
|---------|-----------------|
| **Dashboard** | Farm overview with active trays, recent activity, quick-action cards |
| **Farm Summary** | Real-time view of all growing zones: temperature, humidity, VPD, CO₂, alerts |
| **Farm Inventory** | Complete crop list with growth stages, harvest estimates, location |
| **Planting Scheduler** | Succession planting, seed-to-harvest timelines, AI crop recommendations |
| **Activity Hub** (Tray Inventory) | Tray movement tracking, plantings, harvests, QR code scanning |
| **Harvest Prediction Engine** | Statistical predictions with confidence intervals, probability windows (3/7/14/30 day) |
| **Farm Vitality** | Multi-dimensional health scoring: environment, crop readiness, nutrients, operations |
| **Room Heat Map** | Visualize temperature/humidity distribution; identify hot spots |
| **Crop Weight Analytics** | Harvest weight benchmarks by crop, environment, and grow time |
| **Nutrient Management** | Monitor EC/pH levels, feeding schedules, nutrient solutions |
| **Farm Supplies** | Inventory management for seeds, nutrients, packaging, equipment |
| **Quality Control** | Record quality tests, set crop standards, track freshness and appearance |
| **Lot Code Traceability** | Batch tracking from seed to sale with QR codes and SFCR export |
| **Wholesale Orders** (Farm view) | View and fulfill wholesale orders assigned to this farm |
| **Crop Pricing** | Set wholesale and retail prices; tiered and bulk discount support |
| **Crop Value** | Real-time dollar valuation of all crops currently growing |
| **Farm Sales Terminal** (POS) | Point-of-sale for on-site retail with transaction processing |
| **Financial Summary** | Revenue, expenses, profit margins, payment history |
| **QuickBooks Integration** | Sync invoices, payments, customer data with QuickBooks |
| **Farm Ops Agent** | Deterministic daily to-do generator, command parser, tool gateway |
| **Farm Assistant** | Natural language assistant with command recognition |
| **Room Mapper** | Visual room layout configuration tool |
| **Fan Rotation Monitor** | Fan rotation schedules and equipment maintenance tracking |
| **Farm Maintenance Checklist** | Equipment and facility maintenance tracking |
| **Procurement Portal** | Order from approved suppliers; browse catalog, place POs, track deliveries |
| **Users & Access** | Team member management with roles and permissions |
| **Farm Settings** | Subscription, notifications, certifications, display preferences |

**Primary Audience:**
- Existing network farms
- Prospective indoor farms
- Partner farms being recruited into the wholesale network

---

## 3. Target Market Order

### First Target: Independent Grocery

**Why first:**
- Strong need for differentiation
- Local merchandising potential
- Repeat purchase behavior
- Easier storytelling at shelf
- Visible proof for consumers

**Best targets:**
- Independent grocers
- Specialty retailers
- Premium markets
- Regional chains open to local sourcing pilots

---

### Second Target: Restaurants

**Why second:**
- Chefs respond strongly to quality and provenance
- Faster feedback loop
- Menu storytelling value
- Easier early wins with herbs, greens, and specialty items

**Best targets:**
- Chef-driven restaurants
- Farm-to-table operators
- Hotel kitchens
- Institutional kitchens with local procurement goals

---

### Third Target: Farms for Light Engine Enrollment

**Why third:**
- Strongest when backed by buyer demand
- Easier conversion when software is tied directly to sales opportunity
- Reduces "nice-to-have" perception

---

## 4. Rollout Framework

### Phase 1: Build the Demand Narrative

**Goal:** Create buyer interest in the produce itself.

#### What to Launch

- A "local produce, harvested today" campaign
- A buyer-facing wholesale landing page
- A grocer page
- A restaurant page
- A farm partner page
- A short proof deck for meetings
- Produce availability sheets for launch crops

#### Core Message Themes

**For Grocery:**
- The freshest shelf in town
- Local, traceable produce with a better local story
- Reduce waste through faster harvest-to-shelf timelines
- Year-round consistency for key greens and herbs

**For Restaurants:**
- Farm-to-table with proof — via **Lot Code Traceability** and **QR Label Generator**
- Reliable quality and provenance — via **Quality Reports** and **Farm Certifications**
- Pre-harvest visibility and planning — via **Predicted Inventory**
- One ordering relationship, multiple local farm sources — via **Browse Catalog** and **Wholesale Network Aggregator**

**For Farms:**
- Access to real wholesale demand — via **Demand Analysis** and **Network Dashboard**
- Better crop planning — via **Planting Scheduler** and **Production Planner**
- Simplified sales and fulfillment — via **Wholesale Fulfillment** and **Order State Machine**
- A path to recurring orders — via **GreenReach Wholesale** marketplace

#### Marketing Assets Needed

| Asset | Purpose |
|-------|---------|
| One-page buyer sell sheet | Grocery buyer meetings |
| One-page restaurant sell sheet | Chef and food service outreach |
| One-page farm sell sheet | Farm recruitment |
| Pilot case study template | Early proof documentation |
| Produce traceability card | In-store / in-package storytelling |
| Sample packaging inserts | Consumer-facing provenance |
| "Harvested today" visual assets | Social media, signage, shelf tags |
| Local impact infographic | Buyer pitch decks and landing pages |

---

### Phase 2: Enroll Buyers into GreenReach Wholesale

**Goal:** Convert interest into active grocery and restaurant accounts.

#### Sales Motion

This should be a direct, hands-on enrollment push.

**Start with:**
- 10–20 grocers
- 20–30 restaurants
- 2–3 anchor accounts that can generate recurring volume

#### Enrollment Message

> "GreenReach makes it easier to buy local produce that is fresher, more transparent, and more consistent than conventional supply."

#### Entry Offers

Use low-friction pilot offers:

| Offer | Target |
|-------|--------|
| Featured local greens trial | Grocery produce managers |
| First recurring order setup | All buyers |
| Chef sampler box | Restaurants and chefs |
| Produce manager launch bundle | Grocery stores |
| Limited-time local shelf program | Independent grocers |

#### Buyer Onboarding Structure

Each buyer should be onboarded into GreenReach Wholesale with:

1. Product list — via **Browse Catalog** with real-time availability
2. Ordering cadence — configured through **Checkout** with recurring order support
3. Delivery windows — priced via **Delivery Quote**, managed in **Delivery Services**
4. Merchandising / menu suggestions — supported by **Predicted Inventory** and crop seasonality data
5. Traceability explanation — demonstrated through **Lot Code Traceability** and **QR Label Generator**
6. Local farm story assets — sourced from **Farms Directory** profiles and **Food Miles Tracking**

#### What Matters Most Here

- Not broad awareness.
- Not vanity traffic.
- Not software demos.

**The goal is active accounts and repeat orders.**

---

### Phase 3: Create Recurring Wholesale Demand

**Goal:** Turn pilot interest into predictable demand.

This is where GreenReach Wholesale becomes real infrastructure instead of a directory.

#### Core Mechanisms

- Standing weekly orders
- Recurring restaurant subscriptions
- Featured crop programs
- Local produce shelf sections
- Menu-linked recurring supply
- Seasonal promotional windows

#### Important Principle

Demand must become visible and measurable.

**Track:**

| Metric | Why It Matters | Platform Feature |
|--------|---------------|-----------------|
| Crop-level interest | Guides farm planting coordination | **Demand Analysis**, **Network Dashboard** |
| Buyer reorder rate | Measures stickiness | **My Orders**, **Buyer Behavior Analytics** |
| Average order size | Measures depth of adoption | **Wholesale Admin Dashboard**, **Reports** |
| Weekly demand by category | Informs network capacity planning | **Supply/Demand Analysis**, **Network Trends** |
| Out-of-stock requests | Identifies supply gaps | **Supply/Demand Balancer**, **Network Risk Alerts** |
| Requested but unavailable items | Strongest Light Engine sales signal | **Harvest Conflict Detection**, **Planting Suggestions** |

This demand data becomes the strongest Light Engine sales tool later.

#### Commercial Focus

Prioritize crops that are high-frequency, high-visibility, easy to explain, high repeat-purchase, and meaningful for freshness claims.

**Best launch crops:**

| Crop | Why |
|------|-----|
| Lettuce | Volume leader, freshness visible |
| Basil | High value, strong provenance story |
| Parsley | Consistent demand, year-round need |
| Cilantro | Frequent shortage in conventional supply |
| Arugula | Premium positioning, short shelf life conventional |
| Microgreens | High margin, chef demand, visual appeal |
| Premium mixes | Merchandising anchor, subscription-friendly |

---

### Phase 4: Convert Wholesale Demand into Light Engine Adoption

**Goal:** Use real buyer demand to recruit and retain farms on Light Engine.

This is the key pivot point.

At this stage, GreenReach should approach farms with evidence:

- These buyers are ordering
- These crops are moving
- These volumes are recurring
- These traceability expectations exist
- These supply gaps remain open

#### Light Engine Sales Narrative

**Do not say:** *"Here is farm software."*

**Say:** *"To win and keep wholesale demand in this network, farms need better planning, inventory visibility, traceability, and harvest coordination. That is what Light Engine provides."*

#### Light Engine Adoption Triggers

A farm should be approached for Light Engine when one or more of these are true:

- Buyer demand exceeds current coordination capacity → introduce **Production Planner** and **Supply/Demand Balancer**
- Recurring orders require stronger forecasting → introduce **Harvest Prediction Engine** and **Planting Scheduler**
- The farm needs traceability for buyers → introduce **Lot Code Traceability** and **QR Label Generator**
- Crop planning needs to be aligned with network demand → introduce **Network Planting Coordinator** and **Coordinated Planting**
- Fulfillment consistency is becoming a growth constraint → introduce **Wholesale Fulfillment**, **Farm Vitality**, and **Farm Ops Agent**

#### Best Light Engine Positioning

Light Engine is:

- The software layer behind dependable local wholesale supply
- The system that helps farms become wholesale-ready
- The tool that turns production into repeatable commercial fulfillment

#### Feature-Mapped Value Propositions for Farm Conversion

| Farm Pain Point | Light Engine Feature | Outcome |
|----------------|---------------------|---------|
| "I don't know what buyers want" | **Demand Analysis**, **Network Dashboard** | Visible crop-level demand data |
| "I can't predict my harvest" | **Harvest Prediction Engine** | Statistical predictions with confidence intervals |
| "I need lot codes for compliance" | **Lot Code Traceability**, **SFCR Export** | Automated seed-to-sale batch tracking |
| "Planning is guesswork" | **Planting Scheduler**, **Production Planner** | AI-recommended succession planting tied to orders |
| "I don't know my costs" | **Financial Summary**, **Crop Value**, **QuickBooks Integration** | Real-time crop valuation and accounting |
| "Quality is inconsistent" | **Crop Weight Analytics**, **Quality Control**, **Room Heat Map** | Weight benchmarks, quality tests, environmental mapping |
| "I can't manage my team" | **Users & Access**, **Farm Maintenance Checklist**, **Farm Ops Agent** | Role-based access, daily to-do generation, task tracking |
| "My environment is hard to monitor" | **Farm Summary**, **Farm Vitality**, **Nutrient Management** | Real-time VPD, CO₂, pH, EC monitoring with health scoring |
| "I need help with grants" | **Grant Wizard** | AI-powered program matching, eligibility checks, draft generation |

---

### Phase 5: Expand from Produce Demand to Platform Demand

**Goal:** Make GreenReach Wholesale and Light Engine reinforce each other.

Once the first market has:
- Recurring buyers
- Visible demand patterns
- Active farms
- Successful reorder behavior

Then GreenReach can expand with a stronger story:

- Buyers join because the supply is strong
- Farms join because the demand is real
- The software works because the network is active

**This creates a flywheel.**

---

## 5. The Flywheel

The rollout is built around one reinforcing loop:

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   GreenReach markets the value of fresher local produce      │
│                          ↓                                   │
│   Grocery stores and restaurants join GreenReach Wholesale    │
│                          ↓                                   │
│   Their orders create visible local demand                   │
│                          ↓                                   │
│   Farms join or deepen participation to serve that demand    │
│                          ↓                                   │
│   Light Engine is adopted to coordinate production           │
│                          ↓                                   │
│   Better farm coordination improves service quality          │
│                          ↓                                   │
│   Better service quality increases buyer trust & reorders    │
│                          ↓                                   │
│   Stronger reorders create stronger demand                   │
│                          ↓                                   │
│   Stronger demand attracts more farms and more buyers        │
│                          ↓                                   │
│   ─────────────── (cycle repeats) ───────────────            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

That is the real product rollout.

---

## 6. Messaging Architecture

### Consumer-Facing Message

Even though wholesale is the commercial priority, consumer pull matters because grocers and restaurants need a retail story.

**Core message:** Fresher. Local. Traceable. Grown close to home. Available year-round.

---

### Grocery-Facing Message

**Core message:**
- Differentiate your produce department — via **Browse Catalog** and **Farms Directory**
- Improve freshness and reduce waste — via **Predicted Inventory** and **Harvest Prediction Engine**
- Create a stronger local shelf story — via **Food Miles Tracking** and **QR Label Generator**
- Source local produce more reliably — via **Wholesale Network Aggregator** and **Quality-Based Order Routing**

**Suggested line:**

> *"The freshest local shelf in town, backed by traceability."*

---

### Restaurant-Facing Message

**Core message:**
- Real farm-to-table logistics — via **Lot Code Traceability** and **Delivery Services**
- Consistent quality — via **Quality-Based Order Routing** and **Quality Reports**
- Better provenance — via **Farms Directory**, **Farm Certifications**, and **Food Miles Tracking**
- Simpler local sourcing — via **Browse Catalog**, **Checkout**, and **Delivery Quote**

**Suggested line:**

> *"Local produce with the consistency chefs need and the story diners believe."*

---

### Farm-Facing Message

**Core message:**
- Access to real wholesale demand — via **Demand Analysis** and **Network Dashboard**
- Better planning — via **Planting Scheduler**, **Production Planner**, and **Harvest Prediction Engine**
- Simpler fulfillment — via **Wholesale Fulfillment** and **Farm Ops Agent**
- Visibility into what buyers actually want — via **Buyer Behavior Analytics** and **Supply/Demand Analysis**

**Suggested line:**

> *"Light Engine helps farms grow for demand, not guesswork."*

---

## 7. Channel Plan

### A. Direct Sales — Primary Launch Channel

| Activity | Purpose |
|----------|---------|
| Founder-led outreach | Build early trust and feedback |
| In-person buyer meetings | Close pilot accounts |
| Chef visits | Demonstrate quality and provenance |
| Grocery produce manager demos | Show shelf differentiation |
| Local account onboarding | Convert interest to recurring orders |

### B. Content Marketing

Use content to create demand for produce — not generic software awareness.

**Content themes:**
- Harvested today
- Local shelf differentiation
- Menu differentiation
- Traceability and trust
- Shelf-life advantage
- Year-round local supply
- Meet the farm partner
- From grow room to shelf

### C. In-Store and In-Menu Storytelling

This is critical.

**Assets:**
- Signage
- Lot-code story cards
- Local farm partner labels
- Menu callouts
- "Grown nearby" shelf tags
- QR-linked farm story pages

### D. Pilot Partnerships

Launch with a few visible accounts that can act as proof points.

**Best pilot partners:**
- Respected independent grocers
- Chef-driven restaurants
- Institutions with local food goals

### E. Farm Recruitment

Farm recruitment should follow buyer traction — not precede it too heavily.

---

## 8. 90-Day Rollout

### Days 1–30: Package the Offer

**Build:**

- [ ] Buyer-facing wholesale pages
- [ ] Sales deck
- [ ] Crop list
- [ ] Pilot offer
- [ ] Outreach scripts
- [ ] Case study shell
- [ ] Produce signage and shelf/menu assets

**Target Outcomes:**

| Metric | Target |
|--------|--------|
| Qualified grocery meetings | 10 |
| Qualified restaurant meetings | 15 |
| Pilot accounts in onboarding | 3 |

---

### Days 31–60: Launch Pilots

**Run:**

- [ ] Grocery shelf pilots
- [ ] Chef trial programs
- [ ] Recurring order pilots
- [ ] Local produce storytelling campaign

**Target Outcomes:**

| Metric | Target |
|--------|--------|
| Active wholesale buyers | 5 |
| Recurring weekly buyers | 3 |
| First reorder data | Collected |
| First buyer testimonials | Captured |
| First demand-gap report by crop | Published |

---

### Days 61–90: Convert Demand into Farm-Side Platform Adoption

Use pilot proof to recruit farms into Light Engine.

**Target Outcomes:**

| Metric | Target |
|--------|--------|
| Farms enrolled or upgraded on Light Engine | 2–5 |
| Recurring buyer demand mapped by crop | Complete |
| First "wholesale-ready farm" package | Defined |
| Proof deck: produce demand → software demand | Delivered |

---

## 9. Success Metrics

### Produce Demand Metrics

| Metric | Description |
|--------|-------------|
| Pilot account count | Number of grocers/restaurants in active pilot |
| Recurring order count | Orders placed on standing schedule |
| Reorder rate | Percentage of buyers placing repeat orders |
| Average order value | Revenue per order |
| Crop-level demand frequency | Which crops are ordered most often |
| Restaurant and grocery retention | Buyer churn / retention rate |

### GreenReach Wholesale Metrics

| Metric | Description | Measured By |
|--------|-------------|-------------|
| Active buyers | Total accounts with orders in trailing 30 days | **Wholesale Admin Dashboard** |
| Weekly GMV | Gross merchandise value per week | **Reports**, **Revenue Dashboard** |
| Order frequency | Average orders per buyer per week | **Buyer Behavior Analytics** |
| Recurring programs | Number of active subscriptions / standing orders | **Wholesale Admin Dashboard** |
| Average fulfillment rate | Percentage of orders fulfilled completely | **Wholesale Fulfillment**, **KPI Dashboard** |
| On-time delivery rate | Percentage of deliveries within promised window | **Delivery Services**, **KPI Dashboard** |

### Light Engine Metrics

| Metric | Description | Measured By |
|--------|-------------|-------------|
| Farms onboarded after demand proof | Farms that joined because of visible buyer demand | **Farm Registration** |
| Wholesale-serving farms on Light Engine | Percentage of active farms using the platform | **All Farms** registry |
| Planning accuracy | Predicted vs actual harvest alignment | **Harvest Prediction Engine** |
| Inventory sync compliance | Percentage of farms syncing within SLA | **Sync Monitor** |
| Lot traceability completeness | Percentage of orders with full lot-code chain | **Lot Code Traceability** |
| Harvest forecast accuracy | Predicted vs actual harvest date variance | **Harvest Prediction Engine** |

### Strategic Metrics

| Metric | Description |
|--------|-------------|
| Buyers using local storytelling publicly | Grocers / restaurants promoting local produce sourcing |
| Farms recruited via visible demand | Farms that joined because of provable buyer traction |
| Demand → Light Engine conversion rate | Percentage of wholesale demand opportunities that convert to Light Engine sales |

---

## 10. Platform Feature Reference

This section catalogs every named feature in the platform, organized by product tier and capability area. These are the actual feature names as implemented in the codebase.

---

### 10.1 GreenReach Central — Platform & Admin Features

| Feature | Description |
|---------|-------------|
| **Platform Dashboard** | MRR, connected farm count, system health, uptime, API performance |
| **LE Fleet Monitoring** | Real-time monitoring of all Light Engine edge devices across the network |
| **Anomaly Detection** | ML-based anomaly detection with severity bucketing (critical/warning/info) |
| **Alert Manager** | Environmental alerts from farm sensors; alert resolution workflow |
| **All Farms** (Farm Registry) | Farm CRUD, subscription tiers, heartbeat tracking, drill-down |
| **Farm Detail View** | Per-farm tabs: Summary, Rooms, Devices, Inventory, Recipes, Environmental, Energy, Alerts |
| **Admin Users** | Admin user management with role-based access (admin, operations, support) |
| **Recipes** | Network-wide growing recipe library with environment parameters |
| **Remote Support** | Remotely diagnose Light Engine edge devices: health, logs, restart, sync |
| **Network Device Analytics** | Protocol analysis, driver status, problematic device identification |
| **Sync Monitor** | Real-time sync health: success/failure timestamps, per-farm lag, queue depth |
| **Farm Registration** | New farm onboarding with API key generation and heartbeat registration |
| **Setup Wizard** | First-time farm setup: profile, rooms, zones, password |
| **Billing/Usage** | Farm billing receipts and usage metrics |
| **Reports** | Financial exports: revenue, order volume, harvest performance, buyer analytics |
| **Email Service** | AWS SES: order confirmations, recall notifications |
| **Environmental Monitoring** | Real-time sensor data, device status, room conditions |
| **Crop Registry** | Central source of truth for all crop metadata, growth parameters, nutrient profiles |
| **Impersonate Farm** | Admin view-as-farm capability |

---

### 10.2 GreenReach Wholesale — Buyer Features

| Feature | Description |
|---------|-------------|
| **Browse Catalog** | Real-time wholesale availability with pricing, farm source, demand trends |
| **Buyer Registration** | Self-service buyer account creation |
| **Buyer Login/Auth** | JWT authentication, password reset |
| **Buyer Profile** | View/update business info and contact details |
| **Checkout Preview** | Cart preview with itemized totals, delivery fees, tax calculation |
| **Checkout Execute** | Place orders with Square payment processing, multi-farm allocation |
| **My Orders** | Order history, status tracking, order details |
| **Order Cancellation** | Cancel pending/confirmed orders |
| **Invoice Download** | Generate and download order invoices |
| **Delivery Quote** | Zone-based delivery cost estimates |
| **Farms Directory** | Browse available farms with certifications and produce types |
| **Predicted Inventory** | Pre-order before harvest with confidence levels |

---

### 10.3 GreenReach Wholesale — Admin & Operations

| Feature | Description |
|---------|-------------|
| **Wholesale Admin Dashboard** | All orders, buyer management, KPIs, audit log |
| **Buyer Management** | View, deactivate, reactivate buyers; reset passwords |
| **Refund Processing** | Issue refunds on wholesale orders |
| **Pricing & Products** (Wholesale Pricing Authority) | Cost surveys, set wholesale prices, batch updates, offer/counter-offer |
| **Delivery Services** | Delivery zones, driver management, fee configuration, driver payouts |
| **Driver Enrollment** | Public driver application portal |
| **Wholesale Fulfillment** | Farm-side order status, tracking numbers, fulfillment workflow |
| **Wholesale Financial Exports** | CSV exports — orders, payments, CRA-compliant tax summaries |
| **Wholesale Network Aggregator** | Aggregate real inventory across all registered network farms |
| **Wholesale Network Sync** | 5-minute periodic refresh of aggregated inventory |
| **Square OAuth Proxy** | Square payment OAuth flow between Central and farm edge devices |
| **Demand Analysis** | Wholesale demand pattern analysis for forecasting |
| **Payment Reconciliation** | Automated payment reconciliation via webhook |
| **Order State Machine** | Enforced order status transitions (new → pending → confirmed → processing → shipped → delivered) |
| **Quality-Based Order Routing** | Routes orders to best farm: quality 40%, proximity 30%, capacity 20%, price 10% |
| **Dynamic Pricing Engine** | Recommended prices based on supply, demand, quality, seasonality, competition |

---

### 10.4 Light Engine — Farm Management Features

| Feature | Description |
|---------|-------------|
| **Dashboard** | Farm overview with active trays, recent activity, quick-action cards |
| **Farm Summary** | Real-time growing zones: temperature, humidity, VPD, CO₂, alerts |
| **Farm Inventory** | All crops with growth stages, harvest estimates, location |
| **Activity Hub** (Tray Inventory) | Tray movements, plantings, harvests; QR code scanning |
| **Planting Scheduler** | Succession planting, seed-to-harvest timelines, AI crop recommendations |
| **Tray Setup** | Configure tray types, sizes, growing media, templates |
| **Nutrient Management** | EC/pH monitoring, feeding schedules, nutrient solutions |
| **Room Heat Map** | Temperature/humidity distribution visualization |
| **Crop Weight Analytics** | Harvest weight benchmarks by crop, environment, grow time |
| **Farm Vitality** | Multi-dimensional health scoring: environment, crop readiness, nutrients, operations |
| **Room Mapper** | Visual room layout configuration |
| **Fan Rotation Monitor** | Fan rotation schedules and equipment maintenance |
| **Farm Maintenance Checklist** | Equipment and facility maintenance tracking |
| **Field Mapping** | Visual field/growing area mapping tool |
| **Farm Supplies** | Seeds, nutrients, packaging, equipment — level tracking and usage logging |
| **Procurement Portal** | Order from approved suppliers; browse catalog, place POs |
| **Quality Control** | Quality tests, crop standards, freshness/appearance tracking, lab reports |
| **Lot Code Traceability** | Seed-to-sale batch tracking with QR codes |
| **QR Label Generator** | Generate QR codes for trays and lot tracing |
| **SFCR Export** | Safe Food for Canadians Regulation compliant data export |
| **Wholesale Orders** (Farm view) | View/manage wholesale orders assigned to this farm |
| **Farm Sales Terminal** (POS) | On-site retail point-of-sale with transaction processing |
| **Crop Pricing** | Wholesale/retail price setting; tiered pricing, bulk discounts |
| **Crop Value** | Real-time dollar valuation of standing inventory |
| **Financial Summary** | Revenue, expenses, profit margins, payment history |
| **QuickBooks Integration** | Sync invoices, payments, customer data |
| **Users & Access** | Team members with roles and permissions |
| **Farm Settings** | Subscription, notifications, certifications, display preferences |
| **Farm Assistant** | Natural language farm assistant with command recognition |
| **Farm Ops Agent** | Deterministic daily to-do generator, tool gateway, command parser |
| **Subscription Plans** | Farm subscription plan management |

---

### 10.5 AI & Intelligence Features

| Feature | Description |
|---------|-------------|
| **AI Insights** (GPT-4) | Per-farm AI-powered insights and recommendations |
| **AI Recommendations Pusher** | Periodic GPT-4 analysis; pushes recommendations to farm servers |
| **AI Status Dashboard** | AI engine readiness, experiment records, ML model status |
| **AI Rules** | Configure rules governing AI agent behavior |
| **AI Agent Monitor** | Monitor AI agent activity, usage, and performance |
| **Harvest Prediction Engine** | Statistical predictions with confidence intervals and probability windows |
| **Loss Prediction** | Environmental risk scoring per zone (temperature, humidity heuristics) |
| **Health Insights** | Farm health scoring per zone (environment-based) |
| **ML Temperature Forecast** | Temperature forecasting via edge device models |
| **ML Anomaly Detection** | Anomaly statistics with hourly severity buckets |
| **ML Energy Forecast** | 12-hour energy consumption prediction |
| **Cross-Farm Yield Regression** | Weekly OLS regression: yield ~ spectrum, PPFD, temp, humidity, grow_days |
| **Supply/Demand Balancer** | Aggregates demand + harvest predictions; identifies gaps and surpluses |
| **A/B Recipe Experiment Orchestrator** | Central assigns spectrum experiments to farms; analyzes outcomes |
| **Production Planner** | Auto weekly seeding plans per farm based on demand, capacity, succession |
| **Network Planting Coordinator** | Cross-farm demand coordination: saturation detection, gap identification, stagger recommendations |
| **Market Intelligence** | North American retail produce price monitoring and anomaly detection |
| **Dynamic Pricing Engine** | Recommended wholesale prices from supply, demand, quality, seasonality |
| **Quality-Based Order Routing** | AI-scored farm selection per order using multi-factor weighting |
| **KPI Dashboard** | Fill rate, OTIF, contribution margin, loss rate, forecast error, labor efficiency |
| **AI Crop Recommendations** | Growth-focused crop/seeding suggestions with compare/apply workflow |
| **Planting Recommendations** | AI-powered recommendations using market intelligence + historical data |

---

### 10.6 Marketing AI Features

| Feature | Description |
|---------|-------------|
| **Marketing AI Agent** | Claude-powered social media content generation with brand voice |
| **Marketing Rules Engine** | 6-rule evaluation: character limits, compliance checks, risk tiers |
| **Marketing Platform Publishing** | Publish to Twitter, LinkedIn, Instagram, Facebook with OAuth |
| **Marketing Queue** | Content queue with approve/reject/schedule workflow + cron scheduling |
| **Marketing Skills** | 8 configurable agent skills: content-drafter, compliance-screener, analytics-summarizer, engagement-responder, schedule-optimizer, content-planner, learning-engine, blog-writer |
| **Marketing Settings** | Blocked actions, approval modes, skill risk tiers |

---

### 10.7 Sustainability, Compliance & ESG Features

| Feature | Description |
|---------|-------------|
| **ESG Scoring Engine** | Weighted ESG scoring: Environmental 50%, Social 25%, Governance 25%; letter grades A–F |
| **ESG Report** | Full ESG report generation from operational data |
| **Utility Bill Tracking** | Enter/track electricity, water, gas bills |
| **Sustainability Metrics** | Derived metrics from utility bills + harvest data |
| **Carbon Footprint** | Carbon footprint calculation and tracking |
| **Food Miles Tracking** | Calculate and display food miles for deliveries |
| **Energy Usage** | Energy consumption tracking and analysis |
| **Water Usage** | Water consumption monitoring |
| **Waste Tracking** | Waste reduction monitoring |
| **Sustainability Trends** | Historical trend analysis for sustainability metrics |
| **SFCR Export** | Safe Food for Canadians Regulation compliance export |
| **Quality Reports** | Lab report metadata, QA checkpoints |
| **Governance Report** | Monthly AI governance review: decisions, experiment findings |
| **Farm Certifications** | Track/sync farm certifications (organic, GAP, etc.) |
| **Recall Notification** | Email-based recall alerts for food safety events |

---

### 10.8 Grant Wizard Features

| Feature | Description |
|---------|-------------|
| **Grant User Registration/Login** | CASL-compliant user registration with consent management |
| **My Applications** | Create, view, edit, export grant applications |
| **Find Programs** | Browse Canadian agricultural grant programs (AAFC, AgPal, Pocketed) |
| **Program Eligibility Check** | Check farm eligibility against program requirements |
| **AI Program Matching** | AI-powered matching of farm profile to best-fit programs |
| **AI Draft Generation** | AI auto-drafts grant application responses |
| **Application Export / PDF** | Export completed applications as formatted documents |
| **Corporation Search** | Canadian corporation/business lookup |
| **Competitor Search & Analysis** | Search and analyze competitor farms for grant positioning |
| **Application Outcome Tracking** | Track application outcomes (awarded/rejected) |
| **Consent & Unsubscribe** | CASL consent management, email unsubscribe |

---

### 10.9 Network Coordination & Cross-Farm Features

| Feature | Description |
|---------|-------------|
| **Network Dashboard** | Network-wide farm overview, comparative analytics, buyer behavior |
| **Network Trends** | Aggregated yield, demand, and farm activity trends |
| **Harvest Conflict Detection** | Detect simultaneous harvest plans across farms for the same crop |
| **Supply/Demand Analysis** | Network-wide supply vs demand gap analysis per crop |
| **Network Risk Alerts** | Cross-farm risk alerts for flooding or shortages |
| **Planting Suggestions** | Network-aware planting recommendations per farm |
| **Coordinated Planting** | Cross-farm planting coordination with saturation index |
| **Multi-Farm Benchmarking** | Compare yield rankings, loss rates, consistency scoring |
| **Farm Harvest Projections** | Receive/store farm-reported harvest projections |
| **Network Recipe Versions** | Track/push recipe version adoption across all farms |
| **Grower Management** | Grower dashboard, leaderboard, performance metrics, invitations |
| **Buyer Behavior Analytics** | Buyer purchasing pattern analysis |
| **Network Anomaly Correlation** | Cross-farm anomaly correlation analysis |
| **Energy Benchmarks** | Compare energy efficiency across network farms |

---

### 10.10 Infrastructure & Integration Features

| Feature | Description |
|---------|-------------|
| **Edge-Cloud Sync** | Bi-directional sync: rooms, groups, schedules, config, inventory, telemetry |
| **WebSocket Real-Time Sync** | WebSocket server for real-time farm-to-central updates |
| **Edge Proxy** | Cloud-to-edge request proxying for IoT device management |
| **Device Discovery Proxy** | Discover IoT devices on farm networks via cloud proxy |
| **SwitchBot Integration** | SwitchBot device status and commands via cloud proxy |
| **Kasa Smart Plug Integration** | TP-Link Kasa smart plug discover/configure/power control |
| **Bus Mapping** | DMX512/I2C bus device mapping and scanning |
| **Experiment Records Sync** | Sync experiment records and crop benchmarks between farms and Central |
| **Network Accounting** | Chart of accounts, transaction ledger, period locking |
| **AWS Cost Explorer Sync** | Pull AWS infrastructure costs into accounting ledger |
| **GitHub Billing Sync** | Pull GitHub platform costs into accounting |
| **Square Payment Processing** | Full Square payment integration for wholesale orders |

---

### 10.11 Finance & Accounting Features

| Feature | Description |
|---------|-------------|
| **Network Accounting** | Chart of accounts, transaction ledger, period locking, classification queue |
| **Transaction Ingestion** | Ingest transactions from multiple sources |
| **Auto-Classification** | Rule-based transaction classification with review workflow |
| **Period Locking** | Month-end close controls |
| **AWS Cost Explorer Sync** | Pull AWS infrastructure costs into accounting ledger |
| **GitHub Billing Sync** | Pull GitHub platform costs into accounting |
| **Valuations** | Asset/business valuations for reporting |
| **QuickBooks Export** | Export transactions in QuickBooks-compatible format |
| **Procurement Catalog** | Central supply catalog with SKUs |
| **Supplier Management** | Manage approved supplier relationships |
| **Commission Report** | Network commission calculations |
| **Revenue Dashboard** | Procurement revenue tracking |

---

## 11. What Not to Do

| Avoid | Why |
|-------|-----|
| Leading with software features | Buyers care about produce quality, not dashboards |
| Marketing Light Engine before demand exists | Software without demand is a solution without a problem |
| Scaling too many crops too early | Focus wins; breadth dilutes the freshness story |
| Overcomplicating the buyer offer | Simplicity drives adoption |
| Presenting GreenReach as a general marketplace | Local proof must come before broad positioning |
| Relying on broad consumer advertising | Wholesale buyer channels must be active first |

---

## 12. Master Narrative

GreenReach tells one clear story:

> **We help local grocers and restaurants source better produce from nearby indoor farms.**
>
> **That demand creates a stronger local food economy.**
>
> **And Light Engine is the software that helps farms fulfill that demand reliably.**

That is simpler, stronger, and more commercially effective than trying to sell software first.

---

*GreenReach — The foundation for smarter farms. From seed to sales, all in one place.*
