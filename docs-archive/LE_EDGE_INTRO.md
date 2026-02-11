# Light Engine Edge – Intro and System Overview

## 1. What the Edge Device Is

The Light Engine Edge device (Foxtrot) is the on‑farm control and monitoring system. It runs locally (e.g., on the reTerminal or Raspberry Pi 5) and provides:

- A touchscreen‑optimized setup wizard and dashboard for configuring the farm (rooms, equipment, devices)
- The Farm Admin console for day‑to‑day operations and configuration
- The Activity Hub (tray inventory app) for farm‑floor workflows (seeding, moving, harvesting, inventory)
- Local storage of farm configuration and state in JSON/NeDB files (farm.json, rooms.json, groups.json, wizardStatesDB)
- APIs and data feeds that GreenReach Central consumes for cross‑farm visibility and wholesale inventory

Core entry points:
- Edge server: `server-foxtrot.js`
- Main dashboard: `public/LE-dashboard.html`
- Farm Admin: `public/LE-farm-admin.html`
- First‑run wizard: `public/setup-wizard.html` (legacy: `public/LE-setup-wizard-legacy.html`)
- Activity Hub PWA: `public/views/tray-inventory.html`
- Room/tray views: `public/views/room-heatmap.html`, `public/views/farm-summary.html`, `public/views/farm-inventory.html`, `public/views/tray-setup.html`

For hardware and deployment context, see:
- `FIRST_RUN_GUIDE.md` – hardware, networking, registration with Central
- `EDGE_DEVICE_DATA_FLOW_REPORT.md` – detailed first‑time setup and page‑by‑page data flow
- `LE_DASHBOARD_READINESS_REPORT.md` – known gaps in LE-dashboard wiring (demo data vs real setup data)
- `DATA_FORMAT_STANDARDS.md` – canonical farm.json, rooms.json, groups.json formats the Edge must honor

---

## 2. High‑Level Architecture

At a high level, the Edge stack looks like this:

- **HTTP server (`server-foxtrot.js`)**
  - Serves all HTML/JS/CSS under `public/`
  - Exposes `/api/*` endpoints for setup, configuration, tray operations, inventory, etc.
  - Reads/writes JSON files (farm.json, rooms.json, groups.json, etc.) and NeDB stores (e.g., `wizardStatesDB` for setup wizard state)
- **Touchscreen UI (LE-dashboard)**
  - `public/LE-dashboard.html` + `public/app.foxtrot.js`
  - Provides “Setup & Management” shell (farm registration, rooms, device mapping, business setup)
- **Farm Admin UI**
  - `public/LE-farm-admin.html`
  - Higher‑level view of farm operations, inventory, alerts, and navigation into summary/heatmap views
- **Activity Hub (tray inventory)**
  - `public/views/tray-inventory.html` (iPad‑optimized PWA)
  - Used on the farm floor for scanning trays, managing checklists, and driving inventory state
- **Supporting views**
  - `public/views/room-heatmap.html` – environmental heatmap
  - `public/views/farm-summary.html`, `public/views/farm-inventory.html` – aggregated farm state and inventory
  - `public/views/tray-setup.html` – tray definitions and layouts

Data flow from first‑run to daily operations is described in `EDGE_DEVICE_DATA_FLOW_REPORT.md` and enforced by the JSON schemas in `DATA_FORMAT_STANDARDS.md`.

---

## 3. First‑Run and Setup Wizard

### 3.1 First‑Run Experience (Hardware + Network)

The overall first‑run process is documented in `FIRST_RUN_GUIDE.md`:

- Hardware: Raspberry Pi 5 + touchscreen, networking, sensors/IoT devices
- Network configuration: Ethernet or Wi‑Fi setup
- Farm registration with GreenReach Central via registration code
- Hardware detection (USB, serial/Modbus, network devices)

This guide is descriptive; the live UI implementation is `public/setup-wizard.html`.

### 3.2 Setup Wizard UI (`public/setup-wizard.html`)

`setup-wizard.html` provides a 5‑step, dark‑themed wizard for the initial configuration of the Edge device:

- **Step 1 – Farm Profile**
  - Collects farm name, contact name, email, phone
  - Stores temporary state on the client, then persists to the backend (`wizardStatesDB`) when the wizard completes
- **Step 2 – Grow Rooms**
  - User adds one or more rooms
  - UI builds an in‑memory `farmData.rooms` array
  - Enforces at least one room (auto‑creates a default if the user doesn’t add any)
- **Step 3 – Activity Hub Install**
  - Presents QR code and URL for Activity Hub (tray inventory PWA) at `/views/tray-inventory.html`
  - Describes installation as a home‑screen app on the iPad
- **Step 4 – Completion**
  - Confirms configuration and redirects to the main dashboard / Farm Admin

Persisted data is kept small but critical: farm profile and list of rooms; more complex structures (zones, groups, equipment) are set up later in other UIs.

### 3.3 Data Persistence

On completion, the wizard calls into `server-foxtrot.js` to store a `setup_config` record in `wizardStatesDB`:

- `farmName`, `ownerName`/contact, email, phone
- `rooms`: array of room objects
- `completed`: boolean and timestamp

This is the ground truth for what the user actually configured, and it is the data source that LE-dashboard **should** be reading from.

`LE_DASHBOARD_READINESS_REPORT.md` documents that the current dashboard implementation still points at demo data instead of this stored setup config; see section 4.2 below.

---

## 4. LE Dashboard (Setup & Management Shell)

### 4.1 Purpose and Role

`public/LE-dashboard.html` is the main on‑device dashboard. It is designed for:

- Visualizing and editing farm setup (rooms, zones, devices)
- Managing IoT devices and equipment
- Launching specialized tools (Room Mapper, Activity Hub, etc.)
- Running business setup wizards (payments, store)

The left sidebar (“Setup & Management”) exposes groups such as Farm Setup, Control Devices, Business Setup, and Resources.

### 4.2 Data Source and Current Gaps

According to `LE_DASHBOARD_READINESS_REPORT.md`:

- The dashboard currently loads room data from `/data/rooms.json` via `loadRoomsFromBackend()` in `public/app.foxtrot.js`.
- `/data/rooms.json` is backed by demo data in `server-foxtrot.js` (`loadDemoFarmSnapshot()`), not the user’s real setup.
- The setup wizard correctly saves the user’s farm profile and rooms to `wizardStatesDB` under key `setup_config`, but the dashboard never reads from this store.

This means:

- **Implemented:**
  - Visual shell, sidebars, layout, and IoT device panels
  - Fetching of `/data/iot-devices.json` and rendering via `renderIoTDeviceCards`
- **Gap (to be fixed):**
  - Dashboard rooms and equipment views are not yet wired to the persisted setup wizard data
  - Demo references (comments, mock data paths) need to be removed for production use

When using this document for implementation, pair it with `LE_DASHBOARD_READINESS_REPORT.md` to understand what needs to change.

### 4.3 Main Navigation Groups

Within `LE-dashboard.html`, key navigation buckets are:

- **Farm Setup**
  - Farm Registration
  - Grow Rooms
  - Light Setup
  - Bus Mapping
  - Integrations
- **Control Devices**
  - IoT Devices (driven by `/data/iot-devices.json`)
  - Equipment Overview
  - Room Mapper (`/views/room-mapper.html`)
- **Business Setup**
  - Payment Processing Setup
  - Online Store Setup
- **Resources**
  - Desktop App Downloads

These panels are mostly UI shells that delegate real data loading to `app.foxtrot.js` and related scripts.

---

## 5. Farm Admin Console

### 5.1 Purpose

`public/LE-farm-admin.html` is a richer, dark‑themed farm admin console. It focuses on:

- High‑level operational overview of the farm
- Quick navigation to Farm Summary, Farm Inventory, Nutrient Management, and Activity Hub
- Inventory and supplies tracking
- Display of alerts/health indicators

### 5.2 Layout and Navigation

Key components in `LE-farm-admin.html` include:

- **Page header**
  - Title “Farm Admin – Light Engine”
  - Action buttons (Farm Summary, Inventory, Nutrient Management, Close)
- **Sidebar**
  - Farm badge (farm name, status)
  - Links to different admin sections (operations, inventory/supplies, alerts, etc.)
- **Main content**
  - Tabs and cards showing:
    - Supplies status
    - Active alerts and warnings
    - Quick‑access tools (e.g., Activity Hub link and summary panels)

Farm Admin is primarily a navigation and aggregation layer; it leans on other views (Farm Summary, Inventory, Activity Hub, Heatmap) to do detailed work.

---

## 6. Activity Hub (Tray Inventory PWA)

### 6.1 Role in the System

The Activity Hub is implemented at `public/views/tray-inventory.html` and is the primary tablet interface for farm‑floor work. It is installed as a PWA on an iPad (via the setup wizard’s QR step) and is designed for:

- Viewing today’s priorities and tasks
- Managing tray lifecycle: seeding, moving between rooms/zones, harvesting
- Running checklists and standard operating procedures
- Capturing data that feeds into groups.json and inventory views

`EDGE_DEVICE_DATA_FLOW_REPORT.md` and the Activity Hub docs describe this as the “Farm Activity Hub.”

### 6.2 Key UI Sections

Within `tray-inventory.html`:

- **Top header**
  - Displays farm name and online status
  - Provides status badges (e.g., connectivity)
- **Today’s Priorities**
  - Cards for tasks such as “Seed trays”, “Harvest trays”, “Move trays”, etc.
- **Tray Inventory and Filters**
  - Lists trays, with filters for status, crop, room/zone, age, etc.
- **Checklists and SOPs**
  - UI for running through daily/weekly checklists tied to the tray/workflow context
- **Voice assistant button and modal**
  - Floating action button for a voice‑driven assistant (leveraging browser speech APIs and external voice services)

The Activity Hub is heavily interactive; it calls Edge APIs to:

- Reserve and update trays
- Mark trays as seeded, moved, or harvested
- Reflect changes into `groups.json` and related inventory structures

### 6.3 QR and Auto‑Login

`EDGE_DEVICE_DATA_FLOW_REPORT.md` and the Activity Hub setup docs explain:

- `setup-wizard.html` generates a QR code pointing to `/views/tray-inventory.html` (local device origin)
- A separate `activity-hub-qr.html` view can embed farm identifiers and tokens, allowing “one tap” pairing of the PWA to a specific farm account

This enables a workflow where:

1. Admin sets up the farm and generates QR.
2. Farm staff scan the QR with an iPad.
3. Activity Hub opens, pre‑associated with the correct farm, and is installed to the home screen.

---

## 7. Room Heatmap and Farm Summary/Inventory Views

### 7.1 Room Heatmap (`public/views/room-heatmap.html`)

The environmental heatmap view shows room‑level conditions and navigation to other tools:

- **Header**
  - Title “Environmental Heat Map”
  - Room selector dropdown
  - Navigation buttons with dropdown menus linking to:
    - Farm Summary
    - Farm Inventory
    - Tray Setup
    - Activity Hub (tray inventory)
    - Lot traceability and related views
- **Status bar**
  - Tiles for metrics such as average temperature, humidity, VPD, etc.
- **Heatmap panel**
  - Visual grid representing trays, racks, or zones with color coding

It is intended to consume telemetry data (sensors, controllers) but the exact telemetry wiring is still evolving.

### 7.2 Farm Summary and Inventory

The summary and inventory views live in:

- `public/views/farm-summary.html`
- `public/views/farm-inventory.html`

They:

- Aggregate data from `farm.json`, `rooms.json`, and `groups.json`
- Display high‑level cards for:
  - Number of rooms and zones
  - Active groups
  - Total trays and plants
- Provide inventory views sorted by crop, room, or group

For data shape and invariants, see `DATA_FORMAT_STANDARDS.md`:

- `farm.json` – farm identity, contact, coordinates, metadata
- `rooms.json` – rooms, zones, optional equipment
- `groups.json` – groups (plantings) with `roomId`, `zone`, `crop`, `trays`, `plants`, etc.

These views should be treated as **consumers** of the canonical schemas; they must adapt to data via adapters rather than altering the file formats.

---

## 8. Data Formats and Governance on Edge

`DATA_FORMAT_STANDARDS.md` defines canonical schemas and governance rules. For the Edge device, the key points are:

- **groups.json**
  - `groups[]` entries with required fields: `id`, `name`, `roomId`, `zone`, `crop`, `trays`, `plants`
  - No format changes (e.g., don’t rename `crop` to `recipe`, or convert `trays` into an array) to “fix” a single page
- **farm.json**
  - Core contact information plus optional metadata used by Central
- **rooms.json**
  - Rooms with zones and optional equipment listings

Any Edge UI or route (Activity Hub, Farm Summary, Inventory, Sync) consuming this data must:

- Use adapters/helpers to handle legacy variants
- Avoid writing back modified schemas
- Pass validation via `npm run validate-schemas` before deployment

This ensures that Edge data stays compatible with GreenReach Central and external analytics/automation pipelines.

---

## 9. How LE Edge and GreenReach Central Fit Together

- The Edge device owns:
  - Local farm configuration and real‑time operations
  - Tray lifecycle and on‑farm inventory state
  - Device control and telemetry ingestion
- GreenReach Central owns:
  - Cross‑farm aggregation and dashboards
  - Wholesale catalog and buyer portal
  - Multi‑tenant analytics and AI/ML aggregation

Data moves from Edge → Central via sync routines (see `greenreach-central/routes/sync.js` and related docs). Central reads the canonical JSON/DB representations produced by Edge and exposes them in Central’s admin and wholesale views.

When onboarding engineers to LE Edge, this document, combined with `EDGE_DEVICE_DATA_FLOW_REPORT.md`, `FIRST_RUN_GUIDE.md`, and `LE_DASHBOARD_READINESS_REPORT.md`, should be the starting point for understanding how the on‑farm UI, data formats, and Central integration fit together.
