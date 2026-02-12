# Light Engine (Foxtrot) — Technology Overview + Page Index

**Date:** 2026-02-11  
**Scope:** This document summarizes Light Engine Foxtrot’s capabilities and provides a page-by-page index of the UI entrypoints found in this repo.

## What Light Engine Is

Light Engine is an indoor farm automation and management platform that combines:

- **Recipe-guided grow automation** (lighting + environment targets by crop and growth stage)
- **Operational workflows** (touch-friendly daily actions and planning)
- **Inventory + traceability** (tray/lot tracking designed to avoid spreadsheet overhead)
- **Sales channels** (farm-side sales and buyer-side wholesale ordering)

The guiding idea in the system documentation is “automation without complexity”: growers select what to grow, and the system applies the operational targets and schedules.

Primary source: [APP_FEATURE_OVERVIEW.md](../APP_FEATURE_OVERVIEW.md)

## How It Works (High-Level)

### Recipe-guided environmental control
The platform is designed around crop “recipes” that define targets and schedules such as:

- Lighting schedule + intensity/spectrum targets
- Temperature/humidity/VPD ranges
- Stage transitions over the crop lifecycle

See: [APP_FEATURE_OVERVIEW.md](../APP_FEATURE_OVERVIEW.md)

### Inventory without extra data entry
The core operational pattern described is **QR-based tray tracking**:

- Scan at seeding/transplant/harvest to capture events in the normal flow of work
- Keep current and future inventory visible
- Support seed-to-sale traceability via lot/tray identifiers

See: [APP_FEATURE_OVERVIEW.md](../APP_FEATURE_OVERVIEW.md)

### Grow-and-sell integration
Light Engine includes multiple sales surfaces and an integrated wholesale path:

- Farm-side POS / sales terminal patterns
- Buyer self-service ordering and order tracking
- A wholesale marketplace surface (“GreenReach Wholesale”)

See: [APP_FEATURE_OVERVIEW.md](../APP_FEATURE_OVERVIEW.md), [BUYER_ONBOARDING_GUIDE.md](../BUYER_ONBOARDING_GUIDE.md)

## AI Capabilities (Factual)

### AI Agent (natural language → actions)
This repo includes an AI Agent service that is designed to:

- Accept natural-language commands
- Classify intent and extract parameters
- Execute farm-scoped actions through API routes
- Require confirmation for destructive operations
- Apply rate limiting per farm

Documentation and implementation references:

- [AI_AGENT_DOCUMENTATION.md](../AI_AGENT_DOCUMENTATION.md)
- Service: `services/ai-agent.js` (referenced in the doc)
- Routes: `routes/farm-sales/ai-agent.js` (referenced in the doc)
- UI test page: [public/ai-agent-test.html](../public/ai-agent-test.html)

The AI Agent documentation also describes additional capabilities that are explicitly marked as not yet fully implemented (for example, some inventory/product creation and export/report generation workflows). This document keeps those statements aligned to the AI Agent documentation.

## Cloud ↔ Edge Sync (Architecture Summary)

Light Engine includes a cloud-to-edge synchronization model (documented as polling + acknowledgement) where GreenReach Central can store pending farm settings changes and an edge device can periodically pull and apply them.

See: [CLOUD_EDGE_SYNC_ARCHITECTURE.md](../CLOUD_EDGE_SYNC_ARCHITECTURE.md)

## Page-by-Page Index

The tables below are generated from the HTML entrypoints under `public/` and `public/views/` by extracting each page’s `<title>`.

See also: [page-index.md](page-index.md)

For a compact **page-by-page summary** (title + H1 + meta description + a few in-page feature signals), see: [PAGE_BY_PAGE_SUMMARY.md](PAGE_BY_PAGE_SUMMARY.md)

---

## Page Index

### Operational Views (public/views)

| Page | Title |
|---|---|
| [public/views/fan-rotation-monitor.html](../public/views/fan-rotation-monitor.html) | Fan Rotation Monitor - Light Engine Charlie |
| [public/views/farm-inventory.html](../public/views/farm-inventory.html) | Farm Inventory \| Light Engine |
| [public/views/farm-maintenance-checklist.html](../public/views/farm-maintenance-checklist.html) | Farm Maintenance Checklist \| Light Engine |
| [public/views/farm-summary.html](../public/views/farm-summary.html) | Farm Summary - Light Engine |
| [public/views/field-mapping.html](../public/views/field-mapping.html) | Field Mapping Matrix - Light Engine Charlie |
| [public/views/iot-manager.html](../public/views/iot-manager.html) | NO_TITLE |
| [public/views/nutrient-management.html](../public/views/nutrient-management.html) | Nutrient Management - Light Engine |
| [public/views/planting-scheduler.html](../public/views/planting-scheduler.html) | Planting Scheduler - Light Engine |
| [public/views/procurement-portal.html](../public/views/procurement-portal.html) | Procurement Portal \| Light Engine |
| [public/views/room-heatmap.html](../public/views/room-heatmap.html) | Heat Map - Light Engine |
| [public/views/room-mapper.html](../public/views/room-mapper.html) | Room Mapper - Light Engine Charlie |
| [public/views/tray-inventory-old-backup.html](../public/views/tray-inventory-old-backup.html) | Tray Assignments \| Light Engine |
| [public/views/tray-inventory.html](../public/views/tray-inventory.html) | Activity Hub - Light Engine |
| [public/views/tray-setup.html](../public/views/tray-setup.html) | Tray Setup - Light Engine |

### Top-Level Pages (public/)

| Page | Title |
|---|---|
| [public/about.html](../public/about.html) | About GreenReach - Research & Food Security Solutions |
| [public/activity-hub-qr.html](../public/activity-hub-qr.html) | Activity Hub Setup - Light Engine |
| [public/ai-agent-test.html](../public/ai-agent-test.html) | AI Agent Test - Light Engine |
| [public/anomaly-diagnostics-demo.html](../public/anomaly-diagnostics-demo.html) | Anomaly Diagnostics \| Light Engine Foxtrot |
| [public/clear-cache.html](../public/clear-cache.html) | Clear Cache & Logout |
| [public/downloads.html](../public/downloads.html) | Redirecting to Downloads... |
| [public/farm-admin-login.html](../public/farm-admin-login.html) | Farm Admin Sign In - Light Engine |
| [public/farm-admin.html](../public/farm-admin.html) | Farm Admin - Light Engine |
| [public/farm-sales-landing.html](../public/farm-sales-landing.html) | NO_TITLE |
| [public/farm-sales-pos.html](../public/farm-sales-pos.html) | Farm Sales Terminal |
| [public/farm-sales-shop.html](../public/farm-sales-shop.html) | Farm Shop - Fresh Local Produce |
| [public/farm-sales-store.html](../public/farm-sales-store.html) | Farm Online Store |
| [public/farm-vitality.html](../public/farm-vitality.html) | Farm Vitality Dashboard - Light Engine |
| [public/farm-wall-cad-renderer.html](../public/farm-wall-cad-renderer.html) | Farm Wall CAD Renderer - Professional Layout Tool |
| [public/GR-admin.html](../public/GR-admin.html) | GreenReach Wholesale Admin |
| [public/GR-central-admin-login.html](../public/GR-central-admin-login.html) | Admin Login - GreenReach Central |
| [public/GR-central-admin.html](../public/GR-central-admin.html) | GreenReach Central Operations |
| [public/GR-farm-performance.html](../public/GR-farm-performance.html) | Farm Performance Dashboard - Light Engine |
| [public/GR-wholesale-admin.html](../public/GR-wholesale-admin.html) | Wholesale Admin - GreenReach |
| [public/GR-wholesale-farm-performance.html](../public/GR-wholesale-farm-performance.html) | Farm Performance Dashboard - Light Engine |
| [public/GR-wholesale-integrations.html](../public/GR-wholesale-integrations.html) | Farm Integrations - Light Engine |
| [public/GR-wholesale-legacy.html](../public/GR-wholesale-legacy.html) | GreenReach Wholesale \| Order Fresh Produce |
| [public/GR-wholesale-order-review.html](../public/GR-wholesale-order-review.html) | Review Order Modifications |
| [public/GR-wholesale.html](../public/GR-wholesale.html) | GreenReach Wholesale \| Order Fresh Produce |
| [public/greenreach-org.html](../public/greenreach-org.html) | GreenReach \| Building Canadian Food Sovereignty |
| [public/grow-and-sell.html](../public/grow-and-sell.html) | Grow & Sell \| GreenReach Wholesale Portal |
| [public/growing-made-easy.html](../public/growing-made-easy.html) | Growing Made Easy \| Light Engine by GreenReach |
| [public/health-dashboard.html](../public/health-dashboard.html) | System Health Dashboard |
| [public/index.charlie.html](../public/index.charlie.html) | Home - Light Engine |
| [public/index.html](../public/index.html) | Light Engine |
| [public/landing-cloud.html](../public/landing-cloud.html) | Light Engine Cloud - Farm Management Software \| Inventory, POS & Online Sales |
| [public/landing-downloads.html](../public/landing-downloads.html) | Download Light Engine - Installers for All Platforms |
| [public/landing-edge.html](../public/landing-edge.html) | Light Engine Edge - Complete Farm Automation \| Professional Vertical Farm Control |
| [public/landing-home.html](../public/landing-home.html) | Light Engine - Farm Management Solutions |
| [public/landing-main.html](../public/landing-main.html) | Light Engine - Farm Management Solutions |
| [public/landing-purchase-success.html](../public/landing-purchase-success.html) | Purchase Complete - Light Engine |
| [public/landing-purchase.html](../public/landing-purchase.html) | Purchase Light Engine - Farm Management Solutions |
| [public/LE-admin-legacy.html](../public/LE-admin-legacy.html) | Farm Admin - Light Engine |
| [public/LE-ai-agent-test.html](../public/LE-ai-agent-test.html) | AI Agent Test - Light Engine |
| [public/LE-billing.html](../public/LE-billing.html) | Billing & Subscription - Light Engine |
| [public/LE-create-test-farm.html](../public/LE-create-test-farm.html) | Create Test Farm - AWS |
| [public/LE-dashboard.html](../public/LE-dashboard.html) | Setup/Update - Light Engine |
| [public/LE-downloads.html](../public/LE-downloads.html) | Downloads - Light Engine |
| [public/LE-farm-admin.html](../public/LE-farm-admin.html) | Farm Admin - Light Engine |
| [public/LE-migration-wizard.html](../public/LE-migration-wizard.html) | Cloud to Edge Migration - Light Engine |
| [public/LE-notification-settings.html](../public/LE-notification-settings.html) | Notification Settings - Light Engine |
| [public/LE-notifications.html](../public/LE-notifications.html) | Notification Settings - Light Engine |
| [public/LE-offline.html](../public/LE-offline.html) | Offline - Light Engine |
| [public/LE-qr-generator.html](../public/LE-qr-generator.html) | QR Code Bulk Generator - Light Engine Foxtrot |
| [public/LE-setup-wizard-legacy.html](../public/LE-setup-wizard-legacy.html) | GreenReach Setup Wizard |
| [public/LE-switchbot.html](../public/LE-switchbot.html) | SwitchBot Device Manager - Light Engine Charlie |
| [public/LE-vpd.html](../public/LE-vpd.html) | VPD Automation Dashboard |
| [public/LE-wholesale-orders.html](../public/LE-wholesale-orders.html) | Wholesale Orders - Farm Dashboard |
| [public/LE-wholesale-review.html](../public/LE-wholesale-review.html) | Review Order Modifications |
| [public/LEMarketing-downloads.html](../public/LEMarketing-downloads.html) | Download Light Engine - Installers for All Platforms |
| [public/login.html](../public/login.html) | Login - Light Engine |
| [public/purchase-success.html](../public/purchase-success.html) | Purchase Complete - Light Engine |
| [public/purchase-test.html](../public/purchase-test.html) | Purchase Flow Test |
| [public/purchase.html](../public/purchase.html) | Purchase Light Engine - Farm Management Solutions |
| [public/schedule.html](../public/schedule.html) | Schedule a Call \| GreenReach |
| [public/setup-wizard-old.html](../public/setup-wizard-old.html) | Setup Wizard - Light Engine |
| [public/setup-wizard.html](../public/setup-wizard.html) | Light Engine Setup |
| [public/test-LE-footer.html](../public/test-LE-footer.html) | Footer Test |
| [public/test-LE-matrix-solver.html](../public/test-LE-matrix-solver.html) | Matrix Solver Test |
| [public/test-scanner.html](../public/test-scanner.html) | Scanner Test |
| [public/test-wizard.html](../public/test-wizard.html) | Test Wizard - Light Engine |
| [public/wholesale-about.html](../public/wholesale-about.html) | About GreenReach \| Research-First Food Security Solutions |
| [public/wholesale-landing.html](../public/wholesale-landing.html) | GreenReach Wholesale \| Farm-Fresh Produce, Simplified |
| [public/wholesale-learn-more.html](../public/wholesale-learn-more.html) | GreenReach \| Learn More |
| [public/wholesale.html](../public/wholesale.html) | GreenReach Wholesale \| Order Fresh Produce |

