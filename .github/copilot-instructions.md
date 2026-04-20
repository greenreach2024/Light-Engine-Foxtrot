Production Light Engine Foxtrot system

## ARCHITECTURE: THE FARM IS 100% CLOUD -- GOOGLE CLOUD RUN (REQUIRED READING)

**There is NO physical farm device. No Raspberry Pi. No edge hardware. No on-premise server.**

**PLATFORM MIGRATED TO GOOGLE CLOUD RUN (April 2026). AWS Elastic Beanstalk is DEPRECATED.**

The farm runs entirely on Google Cloud Run. The Light Engine Cloud Run service IS the farm. "Edge" and "cloud" are MERGED into a single cloud deployment. Any references to "edge mode" or "hardware" in the code are legacy artifacts. Any references to "EB," "Elastic Beanstalk," "eb deploy," or EB environment names are DEPRECATED and must not be used.

**Read `.github/CLOUD_ARCHITECTURE.md` for the full architecture reference.**
**Read `.github/SENSOR_DATA_PIPELINE.md` for the complete sensor data flow.**
**Read `.github/CRITICAL_CONFIGURATION.md` for all credentials, env vars, and config files.**
**Read `.github/PAYMENT_WORKFLOW.md` for the complete payment, checkout, Square integration, and accounting reference.**
**Read `.github/TROUBLESHOOTING_ENV_DATA.md` before debugging any sensor data issues.**
**Read `.github/COMPLETE_SYSTEM_MAP.md` for the full platform mapping -- every page, route, table, data flow, button, sensor, and known error. Consult this BEFORE making changes to understand cross-system impacts.**

**VS Code Extension: Google Cloud Code** (`googlecloudtools.cloudcode`) is installed. Provides Cloud Run explorer, Secret Manager browser, Artifact Registry viewer, and log streaming in the sidebar. Agents use `gcloud` CLI for operations; the extension is for user-facing IDE convenience.

### Critical Facts Every Agent Must Know

1. **LE Cloud Run IS the farm.** Service `light-engine` at `https://light-engine-1029387937866.us-east1.run.app`. Entry point: `server-foxtrot.js`.
2. **Central Cloud Run is the hub -- NOT the farm UI.** Service `greenreach-central` at `https://greenreach-central-1029387937866.us-east1.run.app`. Custom domain `greenreachgreens.com` (pending DNS migration). Central handles record keeping, admin, password resets, business management, and is the multi-farm data hub. Central hosts backend APIs (including `/api/research/*`) but is NOT the primary UI host for farm features like Research Workspace or G.W.E.N.
3. **Database is AlloyDB** (PostgreSQL-compatible) at private IP `10.87.0.2` on `greenreach-vpc`. Cluster: `greenreach-db`. Both services connect via Direct VPC egress (Gen2).
4. **Two data directories exist.** `public/data/` (LE) and `greenreach-central/public/data/` (Central). NOT synced.
5. **SwitchBot credentials are required for sensor data.** Set as Cloud Run secrets (`SWITCHBOT_TOKEN`, `SWITCHBOT_SECRET`) on `light-engine` service via Secret Manager. Also in `public/data/farm.json` under `integrations.switchbot`. If these are missing, sensors silently stop updating.
6. **Farm ID**: `FARM-MLTP9LVH-B0B85039` ("The Notable Sprout")
7. **NO cross-origin redirects between LE and Central.** Never redirect UI page requests from one server to the other -- it breaks iframes, CSP, and HTTPS. Both servers serve the same static UI files directly.
8. **AWS/EB is DEPRECATED.** Do not reference EB environments, use `eb deploy`, or use any `aws elasticbeanstalk` commands. All infrastructure is Google Cloud Run. See `.github/CLOUD_ARCHITECTURE.md`.
9. **GCP Project**: `project-5d00790f-13a9-4637-a40`, region `us-east1`. Artifact Registry: `us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach`.
10. **GitHub is the deployable source of truth.** Do not leave production fixes only in local branches or local `main`. Before any Cloud Run deploy, commit and push the exact code being deployed.
11. **Production drift reconciliation is mandatory.** If the expected production fixes live on feature, salvage, or local-only branches, merge or cherry-pick them into the branch that will be pushed to GitHub first. Record the source branches and commit SHAs in `docs/operations/`.

### Recent Fixes (Apr 19, 2026)

41. **Phase 2 #9: 3D Viewer -- Zone Status Coloring from Live Sensor Targets**
    - Branch: `impl/phase2-setup-template-aware` (continued).
    - **3d-farm-viewer.html** (both copies): The viewer already fetched live sensor data via `/env?hours=24` (not mock). Added: (1) Fetch `target-ranges.json` in `loadAllData()` and store in `S.targetRanges`. (2) `computeZoneDeviations()` called from `buildZoneDataMap()` -- classifies each zone as ok/caution/warning/critical per metric (temperature, humidity, VPD) using severity thresholds. (3) Always-on zone tinting when overlay is `none` -- zones glow green (ok), amber (warning), or red (critical) at subtle opacity. (4) New "Status" overlay button -- prominent zone-level deviation coloring with legend showing in-range/warning/critical counts. (5) `findZoneDataForMesh()` helper resolves zone ID mismatches between room maps and env data.
    - Implementation plan: `docs/IMPLEMENTATION_PLAN.md` item #9 marked SHIPPED.

40. **Phase 2 #8: Zone-Aware Recommendation Rollup + Confidence**
    - Branch: `impl/phase2-setup-template-aware` (continued).
    - **LE route** (`routes/zone-recommendations.js`, NEW ~310 lines): `GET /api/zone-recommendations` (all zones), `GET /api/zone-recommendations/:zoneId` (single). Reads env-cache.json, target-ranges.json, groups.json, rooms.json. Zone ID normalization handles inconsistent formats (env-cache "zone-1" vs groups.json "room-xxx-zZone 1"). Per-zone output: readings (temp/rh/vpd/sensor_count), drift from midpoint, group context summary (crops, trays, equipment), actionable recommendations with priority, crop conflict detection (>3 unique crops), confidence scoring (1.0 base minus penalties for missing sensors/readings/groups/crops/targets, levels: high/medium/low).
    - **E.V.I.E. tool** (`greenreach-central/routes/farm-ops-agent.js`): Added `get_zone_recommendations` tool to Central farm-ops-agent catalog. Reads same data files via `readJSON()`. Category: read. Optional param: zone_id.
    - **server-foxtrot.js**: Added import + mount for zoneRecommendationsRouter at `/api/zone-recommendations`.
    - Implementation plan: `docs/IMPLEMENTATION_PLAN.md` item #8 marked SHIPPED. Also un-checked 3 false-shipped items (env-recommendation routes that never existed).


39. **Phase 2 #12: Template-Aware Setup Agent + Grow-Systems API**
    - Branch: `impl/phase2-setup-template-aware`. Commit `9572ade6`.
    - **Setup-agent phase merge**: Merged `grow_rooms` (order 2) + `room_specs` (order 3) into unified `room_design` (order 2, weight 14). Added `build_plan` (order 3, weight 4). Total phases still 12, weights sum 100. Backwards-compat: old phase IDs remap to `room_design` in both evaluatePhase() and guidance endpoint.
    - **`room_design` evaluatePhase**: Checks rooms exist, have dimensions (length_m/width_m/area_m2), ceiling_height_m, and tracks installedSystems[] from grow-systems.json. Complete when all rooms have dims + ceiling. Templates tracked but not blocking.
    - **`build_plan` evaluatePhase**: Checks rooms for buildPlan/build_plan property. Complete when at least one room has a computed plan.
    - **Grow-Systems API** (new file `routes/grow-systems.js`): First runtime consumer of `public/data/grow-systems.json`. GET /api/grow-systems (all templates), GET /api/grow-systems/:templateId (single), POST /api/grow-systems/compute-room-load (runs farm-load-calculator), POST /api/grow-systems/reload (force-reload). Caches registry in memory.
    - File: `greenreach-central/routes/setup-agent.js` (+78 lines, now ~650 lines)
    - File: `routes/grow-systems.js` (NEW, ~120 lines)
    - File: `server-foxtrot.js` (added import + mount for growSystemsRouter at /api/grow-systems)
    - Implementation plan: `docs/IMPLEMENTATION_PLAN.md` item #12 marked SHIPPED.
38. **Phase 1 Data Integrity: Server-Authoritative Timestamps + Groups.json Write Safety**
    - Branch: `impl/phase1-data-integrity`. PR pending.
    - **Server-authoritative timestamps (XC-5)**: Seed (`POST /api/trays/:trayId/seed`) and harvest (`POST /api/tray-runs/:id/harvest`) routes now validate client-provided timestamps against server time. Client hints accepted only if drift < 15 min; otherwise overridden with server time and warning logged. Responses include `timestamp_source` and `seeded_at`/`harvestedAt`. Event bus emissions include authoritative `timestamp` field.
    - **Groups.json write safety (XC-2)**: Added `withGroupsLock()` async mutex (promise-chain pattern, no npm dependency) to serialize all read-modify-write operations on `groups.json`. All 5 LE write sites wrapped: `POST /data/groups.json`, `POST /groups`, `PUT /groups/:id`, seed route group sync, zone cascade in `syncZonesToRoomsJson()`.
    - File changed: `server-foxtrot.js` (+135 -77 lines). 86/86 tests pass.
    - Implementation plan: `docs/IMPLEMENTATION_PLAN.md` created and maintained.

### Recent Fixes (Apr 14, 2026)

37. **Multi-Unit Equipment/Group Bulk Updates + 3D Viewer LE Visibility**
    - Root cause (visibility): `3d-farm-viewer.html` existed only in `greenreach-central/public/views/` but LE-farm-admin.html links to `/views/3d-farm-viewer.html`. Users on the LE URL got 404 for the 3D viewer.
    - Fix: Copied `3d-farm-viewer.html` to `public/views/` so LE can serve it. Like other E.V.I.E. files, must be kept in sync between both locations.
    - Root cause (ZipGrow bulk): `update_group` only supported single-group updates by `group_id`. ZipGrow units are groups (78 of them: "ZipGrow Standard 1" through "ZipGrow Standard 78"), so multi-unit changes were impossible.
    - Fix: Added `bulk=true` + `match_name` support to `update_group`. Partial name matching (contains). Example: `bulk=true, match_name="ZipGrow Standard", crop="Genovese Basil"` updates all 78 towers at once.
    - Root cause (equipment matching): `update_equipment` bulk mode used exact name equality (`===`). "ZipGrow Standard" would NOT match "ZipGrow Standard 30".
    - Fix: Changed to partial matching (`includes()`) for both bulk and non-bulk paths. "ZipGrow" now matches "ZipGrow Standard 30", "ZipGrow Tower 5", etc.
    - Files changed: `greenreach-central/routes/farm-ops-agent.js` (update_group bulk handler, update_equipment name matching), `greenreach-central/routes/assistant-chat.js` (update_group schema + system prompt), `public/views/3d-farm-viewer.html` (new copy from Central)

### Recent Fixes (Apr 13, 2026)

35. **E.V.I.E. Bulk Alert Clearing + Stale Alert Cleanup**
    - Root cause: E.V.I.E. could only dismiss ONE alert at a time by exact ID (`dismiss_alert`). No bulk clear capability. Central had 4 stale environment alerts from March 21 (23 days old). LE had 14 ancient test alerts from December 2025.
    - File: `greenreach-central/routes/farm-ops-agent.js` -- Added `resolve_all_alerts` tool (resolves ALL active alerts at once) and `resolve_stale_alerts` tool (resolves alerts older than N hours, default 24).
    - File: `greenreach-central/routes/farm-ops-agent.js` -- Added staleness auto-cleanup in `syncSensorData()`: alerts older than 48 hours are auto-resolved during each sensor sync cycle, preventing indefinite accumulation.
    - File: `greenreach-central/routes/assistant-chat.js` -- Added function schemas for both new tools. Both in `quick_confirm` trust tier.
    - File: `greenreach-central/public/data/system-alerts.json` -- Resolved 4 stale March 21 environment alerts (env-temp-low/env-rh-low for zone-1 and zone-2).
    - File: `public/data/system-alerts.json` -- Resolved 14 stale December 2025 test alerts (test-farm-001 offline, overselling-detected).
    - F.A.Y.E. backend already had bulk resolve/acknowledge endpoints (`/alerts/resolve-all`, `/alerts/bulk-resolve`). No changes needed.
    - Files changed: `farm-ops-agent.js`, `assistant-chat.js`, `system-alerts.json` (both Central and LE)

36. **3D Farm Viewer Gap Corrections**
    - File: `greenreach-central/public/views/3d-farm-viewer.html`
    - **Cache busting**: Added `?t=Date.now()` to `groups.json`, `iot-devices.json`, and `crop-registry.json` fetches. Previously only `rooms.json` and `env` had cache busters, causing stale data display after deployments.
    - **Zone overlay gaps**: Reduced zone geometry inset from 0.2m to 0.12m (`BoxGeometry(zw - 0.12, ...)`). Narrower visual gaps between adjacent zones while maintaining zone distinction. Heatmap gradients now cover more floor area.
    - **Group placement**: Replaced fixed 2.5m grid spacing with dimension-aware spacing using actual persisted group dimensions (`cellW`, `cellD`). Groups no longer overlap when large or waste space when small.
    - **Stale data indicator**: Added staleness detection -- if env data hasn't refreshed in >5 minutes, status bar shows warning with elapsed time in amber color.
    - **Full data refresh**: Added 10-minute interval for full data reload (rooms, groups, devices, env). Previously only env data refreshed every 2 minutes; new sensors, rooms, or group changes required manual page reload.

### Recent Fixes (Apr 10, 2026)

34. **Trait-Based Salad Mix System (deployed greenreach-central-00113-7r9, light-engine-00069-sqt)**
    - **401 Fix**: Farm inventory page called `/api/admin/salad-mixes` (admin-auth-protected). Created new farm-accessible endpoint `/api/farm/salad-mixes` (no admin auth). Added LE proxy to forward requests to Central.
    - **Trait-Based Components**: Admin now defines mix component slots with trait metadata (role name + color/taste/texture profiles) instead of just specific crop names. Farms can substitute crops within matching trait profiles.
    - **DB Schema**: Migration 058 adds `trait_role`, `color_profile`, `taste_profile`, `texture_profile` columns to `mix_components`. New `crop_traits` table (29 salad-eligible crops seeded). New `farm_mix_overrides` table for per-farm crop substitutions.
    - **New Central Endpoint**: `/api/farm/salad-mixes` (GET list, GET :id/alternatives, PUT /overrides, DELETE /overrides/:id, GET /crop-traits). File: `greenreach-central/routes/farm-salad-mixes.js` (new).
    - **Admin UI**: Component rows now include trait role input + color/taste/texture dropdowns. Table shows trait tags per component.
    - **Farm UI**: Template selector now shows component panel with swap dropdowns. Each slot shows default crop + alternatives filtered by matching traits (2-of-3 trait match). Overrides saved to server and remembered per farm.
    - Files changed: `greenreach-central/config/database.js`, `greenreach-central/routes/admin-salad-mixes.js`, `greenreach-central/routes/farm-salad-mixes.js` (new), `greenreach-central/server.js`, `greenreach-central/public/central-admin.js`, `greenreach-central/public/GR-central-admin.html`, `public/views/farm-inventory.html`, `greenreach-central/public/views/farm-inventory.html`, `server-foxtrot.js`

### Recent Fixes (Apr 9-10, 2026)

28. **Wholesale Admin Dashboard Data Accuracy (deployed greenreach-central-00081 through 00084, light-engine-00042 through 00046)**
    - Restored 12% broker commission across 12+ files after prior agent reverted it. Commission (`WHOLESALE_COMMISSION_RATE=0.12`) is GreenReach's revenue model -- NEVER change it.
    - File: `greenreach-central/routes/admin-wholesale.js` -- Fixed Network Accounting tab showing $0 revenue: `revenue-summary` endpoint now reads `grand_total` from order root (not nonexistent `totals.total`).
    - File: `greenreach-central/routes/admin-wholesale.js` -- Fixed Buyers tab $0 revenue: `buyer-analytics` endpoint now reads `grand_total`, `broker_fee_total`, `net_to_farms_total` from order root.
    - File: `greenreach-central/routes/admin-wholesale.js` -- Implemented `filterOrders()` and `filterPayments()` helpers for date range and status filtering across Network Accounting, Orders, and Buyers tabs.
    - File: `greenreach-central/routes/admin-wholesale.js` -- Completed order status dropdown with full lifecycle states.
    - File: `greenreach-central/public/farm-admin.js` -- Fixed Farm Accounting tab $0 revenue: corrected field names (`grand_total` not `total`), fixed broken DB query for wholesale orders, added proper broker fee and net calculations.
    - File: `greenreach-central/routes/farm-sales.js` -- Fixed `/farm-accounting` endpoint: corrected `x.grand_total` field access, added fallback for orders without broker_fee_total.
    - Files changed: `admin-wholesale.js`, `farm-admin.js`, `farm-sales.js`, `procurement-admin.js`, `wholesale-fulfillment.js`, `wholesale.js`, `central-admin.js`

29. **Phantom Farm Value Fix (deployed greenreach-central-00085-4km)**
    - Root cause: `recalculateAutoInventoryFromGroups()` in `inventory.js` only UPSERTed auto-inventory rows but never DELETEd them when crops were removed from growth groups. Four phantom rows (Salad Bowl Oakleaf 1912 lb, Buttercrunch 2390 lb, Bibb Butterhead 2868 lb, Astro Arugula 1434 lb) persisted indefinitely, inflating "Today's Farm Value" to $99,433.01.
    - File: `greenreach-central/routes/inventory.js` -- `recalculateAutoInventoryFromGroups()` now DELETEs `inventory_source='auto'` rows for crops no longer in any growth group. Preserves manual and custom entries.
    - File: `greenreach-central/server.js` -- `syncFarmData()` now calls `recalculateAutoInventoryFromGroups()` after groups DB upsert. Runs every 5 min, cleaning stale auto entries automatically.
    - File: `greenreach-central/server.js` -- `upsertFarmData()` uses JSONB equality comparison to only bump `updated_at` when data actually changes, preventing activity feed noise from unchanged groups/rooms/schedules being refreshed every 5 minutes.
    - Investigation confirmed LE sync-service feedback loop is NOT active in production (`edgeConfig.isEdgeMode()` returns false on Cloud Run -- `EDGE_MODE` env var not set, default mode is `'cloud'`).

30. **Wholesale Admin Cross-Page Data Consistency (deployed greenreach-central-00086-8zh, light-engine-00047-clx)**
    - File: `greenreach-central/public/js/wholesale-admin.js` -- Buyers page revenue now uses completed payments (same source as Overview GMV) instead of all orders regardless of status.
    - File: `greenreach-central/public/js/wholesale-admin.js` -- Payment tables resolve farm names from `order.farm_sub_orders` and `payment.split` instead of showing raw null `farm_id`. Payout summary groups by resolved farm name.
    - File: `greenreach-central/routes/wholesale.js` -- Square reconciliation endpoint now queries Square Payments API to cross-check local records (status + amount). Shows Square discrepancy details (status mismatch, amount mismatch, lookup failures) separately from internal mismatches.
    - File: `greenreach-central/services/wholesaleMemoryStore.js` -- Loads `square_details` and `greenreach_held` from DB metadata for reconciliation cross-checks.
    - Files changed: `wholesale-admin.js` (both locations), `wholesale.js`, `wholesaleMemoryStore.js`

31. **Crop Inventory Card Fixes (deployed greenreach-central-00087-n7v through 00089, light-engine-00048-x2x through 00049)**
    - File: `greenreach-central/public/farm-admin.js` -- `loadAccountingData()`: deduplicated orders by `master_order_id` between `/api/farm-sales/orders` and `/api/wholesale/order-events` (both query `wholesale_orders` table, causing POS doubling).
    - File: `greenreach-central/public/farm-admin.js` -- `loadRevenueBreakdown()`: default channel changed from `'POS (Retail)'` to `'Wholesale (B2B)'` to match `loadAccountingData` fallback. Non-POS orders were being classified as POS, inflating retail revenue.
    - File: `greenreach-central/public/farm-admin.js` -- `loadCropValueData()`: removed `yieldFactor` from value calculation. `quantity_available` already represents actual weight; multiplying by `yieldFactor` double-discounted auto entries.
    - File: `greenreach-central/public/views/farm-inventory.html` -- Available Inventory card now computes from `dbProducts` (same source as Total Value card) instead of separate `generalInventoryLbs` that only included manual items.

32. **Phantom Inventory Elimination (deployed greenreach-central-00090-9f8, light-engine-00050-78q)**
    - Root cause: `recalculateAutoInventoryFromGroups()` UPSERT phase sets `last_updated = NOW()` on every call, causing phantom entries to reappear in activity feed ("Inventory updated: Salad Bowl Oakleaf -- 3336.000 lb" etc.) even when groups have zero crops. Values were INCREASING on each page load because UPSERT recalculates from `trays * 12`.
    - Fix: replaced ALL 4 call sites with inline DELETE-only queries that remove stale auto-inventory entries without ever creating/upserting new ones. The `recalculateAutoInventoryFromGroups()` function itself is preserved in `inventory.js` for future use when groups actually have crop assignments.
    - File: `greenreach-central/routes/inventory.js` -- GET `/:farmId` uses inline DELETE-only cleanup.
    - File: `greenreach-central/routes/farm-sales.js` -- GET `/farm-sales/inventory` uses inline DELETE-only cleanup. Removed `recalculateAutoInventoryFromGroups` import.
    - File: `greenreach-central/server.js` -- `syncFarmData()` uses inline DELETE-only cleanup. Removed `recalculateAutoInventoryFromGroups` import.
    - File: `greenreach-central/routes/sync.js` -- POST `/sync/groups` uses inline DELETE-only cleanup. Removed `recalculateAutoInventoryFromGroups` import.
    - Current revisions: Central `greenreach-central-00090-9f8`, LE `light-engine-00050-78q`.

33. **HYBRID Phantom Inventory + Tray Enrichment Fix (deployed greenreach-central-00092-ssg, light-engine-00052-8k2)**
    - Root cause 1: DELETE-only cleanup only targeted `inventory_source = 'auto'` rows. HYBRID rows (with both auto and manual quantities) survived cleanup, showing 15544 lbs phantom inventory ($192k value) from 4 products (Astro Arugula, Bibb Butterhead, Buttercrunch Lettuce, Salad Bowl Oakleaf).
    - Root cause 2: `database.js` backfill migration ran on every container start, restoring `auto_quantity_lbs` from `quantity` column regardless of inventory source.
    - Root cause 3: LE `farm-inventory.html` synthetic tray enrichment summed ALL groups' tray counts (1170 from 78 empty groups) as "active trays" when API returned 0.
    - Root cause 4: LE `farm-inventory.html` was never synced with Central's rendering fixes (missing `effectiveLbs`, `wholesaleProductCount` from `dbProducts`).
    - Fix: All 4 cleanup sites now also UPDATE hybrid rows -- zero `auto_quantity_lbs`, set `quantity = manual_quantity_lbs`, change `inventory_source = 'manual'` for crops no longer in groups.
    - Fix: `database.js` backfill migration now only applies to `inventory_source = 'auto'` rows (prevents re-inflating cleaned hybrid/manual rows).
    - Fix: Tray enrichment in `farm-inventory.html` (both LE + Central) now filters groups by `(g.crop && g.crop !== '') || (g.plan && g.plan !== '') || (g.plants > 0)` before summing trays. Empty groups no longer inflate active tray count.
    - Fix: Synced `farm-inventory.html` from Central to LE (2435 lines, includes `effectiveLbs` and `wholesaleProductCount` rendering).
    - Files changed: `greenreach-central/routes/inventory.js`, `greenreach-central/routes/farm-sales.js`, `greenreach-central/server.js`, `greenreach-central/routes/sync.js`, `greenreach-central/config/database.js`, `greenreach-central/public/views/farm-inventory.html`, `public/views/farm-inventory.html`
    - Current revisions: Central `greenreach-central-00092-ssg`, LE `light-engine-00052-8k2`.

### Recent Fixes (Apr 8, 2026)

26. **FAYE Diagnostic Tools Fix + New Tools (deployed greenreach-central-00048-fhx)**
    - File: `greenreach-central/routes/admin-ops-agent.js`
    - Fixed `get_sync_status` tool: was querying non-existent columns (`sync_type`, `last_success_at`, `last_failure_at`, `error_count`). Now uses actual `data_type` and `updated_at` columns from `farm_data` table.
    - Added `search_codebase` tool: cross-file grep search with regex support (max 5 files, 3 matches/file). Enables FAYE to trace code paths during diagnostics.
    - Added `get_page_route_map` tool: returns architecture mapping of all pages to their code files, API routes, and data flows. Enables FAYE to understand page-to-route dependencies.
    - Fixed `check_dependencies` description: removed misleading Stripe reference.
    - Updated FAYE system prompt with diagnostic workflow: get_sync_status -> search_codebase -> get_page_route_map -> check_dependencies.

27. **Documentation Overhaul (April 8, 2026)**
    - Created `PAYMENT_WORKFLOW.md`: Complete reference for Square integration, checkout flow, pricing model, double-entry accounting, webhook processing, order state machine, and database schemas.
    - Updated `CRITICAL_CONFIGURATION.md` to v2.0.0: Replaced all AWS/EB references with Cloud Run env vars and Secret Manager. Added Square, SMTP, AlloyDB, and Anthropic credentials.
    - Updated `CLOUD_ARCHITECTURE.md` to v2.1.0: Added Payment Infrastructure section, FAYE diagnostic tools section, updated deployment log.
    - Updated `COMPLETE_SYSTEM_MAP.md` to v2.0.0: Replaced Section 2 (AWS Infrastructure) with Google Cloud, updated env vars, external services, deploy commands, all LE-EB references.
    - Updated `SENSOR_DATA_PIPELINE.md` to v2.0.0: Replaced all LE-EB references with Cloud Run, added Cloud Run specifics section (GCS FUSE, Cloud Scheduler keepalive, Secret Manager).
    - Files changed: PAYMENT_WORKFLOW.md (new), CRITICAL_CONFIGURATION.md, CLOUD_ARCHITECTURE.md, COMPLETE_SYSTEM_MAP.md, SENSOR_DATA_PIPELINE.md, copilot-instructions.md

### Recent Fixes (Apr 4, 2026)

25. **Email/SMS Notification Infrastructure -- Full Google Migration (No AWS)**
    - All notification services now use Google Workspace SMTP exclusively. AWS SES and AWS SNS have been fully removed.
    - Email: Google Workspace SMTP (`smtp.gmail.com`). Sender: `info@greenreachgreens.com`. No AWS fallback.
    - SMS: Email-to-SMS via carrier gateways through same Google Workspace SMTP. Allowlist: `+16138881031` -> `6138881031@txt.bell.ca`.
    - Updated `email-service.js`: Removed SES client/fallback. SMTP-only transport.
    - Updated `email.js`: Removed SES import/client/fallback. SMTP-only transport.
    - Updated `sms-service.js`: Replaced AWS SNS with email-to-SMS via nodemailer + carrier gateway.
    - Updated `alert-notifier.js`: Comment updated (no more SES/SNS references).
    - Added CAN-SPAM/CASL-compliant business address (`GreenReach Greens -- Ottawa, ON, Canada`) to ALL email template footers (8 templates across 3 files).
    - Alert notifier (`alert-notifier.js`): Rate-limited email+SMS for critical/high alerts. Requires `ADMIN_ALERT_EMAIL` and `ADMIN_ALERT_PHONE` env vars.
    - Updated `CLOUD_ARCHITECTURE.md` and `CRITICAL_CONFIGURATION.md` to reflect no-AWS notification stack.
    - **ACTION REQUIRED**: Generate Google App Password for `info@greenreachgreens.com` and store as `SMTP_PASS` in Secret Manager. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `FROM_EMAIL`, `ADMIN_ALERT_EMAIL` env vars on Central Cloud Run.
    - Files changed: `email-service.js`, `email.js`, `email-new-templates.js`, `sms-service.js`, `alert-notifier.js`, `CLOUD_ARCHITECTURE.md`, `CRITICAL_CONFIGURATION.md`

24. **Re-Audit Correction Plan (25 findings, all remediated)**
    - RE-AUDIT-REPORT.md: Full platform + AI agent audit. 2 P0, 4 P1, 11 P2, 8 P3.
    - **S1 (P0)**: `greenreach-central/routes/wholesale-fulfillment.js` -- removed duplicate `isDatabaseAvailable` ESM import (line 25). Module was failing to load; all fulfillment endpoints were dead.
    - **SEC1 (P0)**: `greenreach-central/server.js` -- added `authMiddleware` to `customProductsRouter` mount. CRUD on `/api/farm/products/*` was exposed without auth.
    - **SEC2 (P1)**: `greenreach-central/server.js` -- added `authMiddleware` or `adminAuthMiddleware` to 22 inline endpoints (experiments, dynamic-pricing, governance, production, admin seed, recipe versions). All were callable without authentication.
    - **A10 (P1)**: `greenreach-central/routes/gwen-research-agent.js` -- replaced `execSync(cmd)` with `execFileSync(bin, args)` in `execute_code` tool. Eliminated shell interpretation (command injection via `$()` or backticks). Also restricted env vars to PATH/HOME/TMPDIR/MPLBACKEND only.
    - **A14 (P1)**: `greenreach-central/middleware/agent-enforcement.js` -- added circuit-breaker: when 3+ violations detected, response is blocked and replaced with safe fallback. Previously advisory-only (logged but never blocked).
    - **SEC5 (P2)**: `greenreach-central/server.js` -- removed `/api/sync/` from rate limiter skip. Only `/api/debug/` (logging-only) is now skipped.
    - **A1/A6/A11 (P2)**: Fail-closed auth fallbacks. EVIE no longer falls back to `'demo-farm'`, FAYE no longer falls back to `'unknown'`, GWEN no longer falls back to `'anon'`. All three return 401 when identity is missing.
    - **A2/A7 (P2)**: Tightened confirmation regex. Removed `yes`, `ok`, `sure`, `yeah`, `yep` from both EVIE and FAYE. Now requires explicit: `confirm`, `do it`, `go ahead`, `proceed`, `approved`.
    - **A3/A8 (P2)**: Added `.slice(0, 8000)` tool result truncation to EVIE (3 paths: Anthropic, OpenAI main, OpenAI stream) and FAYE (1 path). GWEN already had this.
    - **A4 (P2)**: Confirmed-action summaries in EVIE now route through `sendEnforcedResponse` instead of plain `res.json()`.
    - **A9 (P2)**: FAYE `send_test_email` tool: added email format validation, blocked disposable domains (mailinator, guerrillamail, etc.), and HTML-escaped `params.message` in email body (XSS fix).
    - **A12 (P2)**: GWEN `get_network_sensor_data` now returns error if no active data sharing agreement exists. Previously returned data with advisory `has_agreement: false`.
    - **S2 (P2)**: `greenreach-central/routes/sync.js` -- added `ON CONFLICT DO NOTHING` to sensor_readings INSERT. Added unique index `idx_sensor_readings_dedup` on `(farm_id, zone_id, sensor_type, recorded_at)`.
    - **S3 (P3)**: `greenreach-central/routes/sync.js` -- parameterized cleanup query (was `'${RETENTION_DAYS} days'`, now uses `$1` param).
    - **S4 (P2)**: `server-foxtrot.js` -- fixed setup_completed read to query `farms` table (was `users` table, which never had the column populated).
    - Files changed: `wholesale-fulfillment.js`, `server.js` (Central), `gwen-research-agent.js`, `agent-enforcement.js`, `assistant-chat.js`, `admin-assistant.js`, `admin-ops-agent.js`, `sync.js`, `database.js`, `server-foxtrot.js`

### Recent Fixes (Apr 2, 2026)

21. **Activity Hub order sync fix**
    - File: `server-foxtrot.js` (lines ~8168-8300)
    - Added POST `/api/wholesale/order-events` handler on LE. Central was sending order notifications via `farmCallWithTimeout()` but LE had no POST handler, only GET. Orders were invisible to farms.
    - Added GET `/api/wholesale/order-events` handler to return sub-orders from NeDB orderStore.
    - File: `routes/activity-hub-orders.js`
    - Replaced 3 broken PostgreSQL fallback queries (`pool.query` to `wholesale_orders`) with Central API fetch calls (`getCentralUrl() + '/api/wholesale/admin/orders'`). LE uses SQLite, not PostgreSQL -- the PG queries failed silently.
    - Known remaining issue: `logOrderAction()` (line ~69) still uses `pool.query` with PG-syntax SQL against SQLite. Non-fatal (try/catch) but audit log is dead code on LE.

22. **EVIE chat integration in Activity Hub**
    - File: `greenreach-central/public/views/tray-inventory.html` (synced to root `public/views/`)
    - Added floating EVIE orb (green circle with "E" icon, bottom-right)
    - Added slide-in chat panel with message history, typing indicator, input field
    - Added EVIE voice input (WebkitSpeechRecognition, continuous listen, TTS responses)
    - Added task display panel within EVIE panel (loads from `/api/admin/calendar/tasks`)
    - Added `routeToEvie()` function -- voice commands fall through to EVIE when unrecognized
    - Voice routing: "ask evie" / "hey evie" prefix, task commands, order commands, and default fallback all route to EVIE
    - KNOWN GAP: `/api/admin/calendar` is not mounted or proxied on LE. Task loading will 404 on LE. Needs adminCalendarRouter import or proxy.

23. **Calendar and tasks system**
    - File: `greenreach-central/routes/admin-calendar.js`
    - Full CRUD for calendar events, tasks, and reminders (Central only)
    - Three PostgreSQL tables auto-created: `admin_calendar_events`, `admin_tasks`, `admin_task_reminders`
    - Mounted at `/api/admin/calendar` in Central server.js

### Recent Fixes (Mar 30, 2026)

20. **GWEN tool schema fix**
    - File: `greenreach-central/routes/gwen-research-agent.js`
    - OpenAI rejects tool definitions where array parameters lack a required `items` sub-schema. 6 tool parameters were missing `items`: `create_custom_display.data`, `create_research_table.columns`, `generate_chart.data_sources`, `generate_chart.annotations`, `match_programs_to_project.project_goals`, `analyze_competitive_overlap.competitors`.
    - Added typed `items` definitions to all 6. GWEN functional again.

19. **Incident #2: REPEAT agent-caused Central outage via config-only update**
    - SAME ROOT CAUSE as incident #18 below. Another agent ran a configuration-only update on Central at 00:42 UTC Mar 31, causing 100% 5xx errors (Degraded then Severe). Recovered by proper `eb deploy` at 01:03.
    - This is the SECOND time an agent has crashed Central this way. Protective rules added below.

18. **Incident #1: Agent-caused Central outage (recovered)**
    - A previous agent used `aws elasticbeanstalk update-environment` to set env vars (FAYE_WEBHOOK_URL, AWS_REGION, SES_ENABLED, SES_FROM_EMAIL, SES_REGION) on Central. This triggered a config-only restart that skipped the prebuild `npm install` hook, crashing the server with `ERR_MODULE_NOT_FOUND: Cannot find package 'express'`.
    - Central was down ~20 minutes (00:43-01:03 UTC, Mar 31). LE was unaffected.
    - Agent also created a redundant `greenreach-central/utils/email.js` (duplicate of existing `services/email-service.js`) and added a duplicate buyer POST endpoint to `admin-wholesale.js`.
    - Fix: reverted all uncommitted changes, removed `utils/email.js`, redeployed Central. Health restored to Green.
    - **LESSON**: NEVER use `aws elasticbeanstalk update-environment` or `eb setenv`. Period. These commands are BANNED. See "BANNED COMMANDS" section below. Config-only restarts skip `.platform/hooks/prebuild/01_npm_install.sh`, leaving `node_modules/` empty. To set env vars, add them to `.ebextensions/` and do a full `eb deploy`.
    - **LESSON**: `services/email-service.js` is the ONLY email utility. It already handles SES with lazy init and graceful fallback. Do not create parallel email utilities.

17. **Research Integration Layer**
    - Migration 029: 17 new tables (researcher_orcid_profiles, dataset_dois, osf_projects, research_protocol_versions, instrument_registry, instrument_sessions, instrument_telemetry, workflow_definitions, workflow_runs, globus_transfers, mlflow_experiments, mlflow_runs, research_roles, approval_gates, immutable_run_records, cfd_pipeline_jobs, jupyter_sessions)
    - New route file: `greenreach-central/routes/research-integrations.js` -- REST endpoints for ORCID, DataCite, OSF, protocols.io, instruments, workflows, Globus, governance, CFD, MLflow, JupyterHub
    - GWEN: 19 new tools (74 total) -- ORCID linkage/lookup, DataCite DOI metadata, OSF project management, protocol versioning, instrument registration/telemetry/run requests, workflow creation/submission/status, Globus transfers, governance roles/approvals/immutable records, CFD pipeline jobs/templates
    - GWEN system prompt: added Research Integration Layer section covering Identity/Provenance, Project Coordination, Instrument Abstraction (SiLA 2, OPC UA, SCPI), Workflow Engine, CFD Pipeline, Data Transfer, Governance
    - Workspace HTML: 7 new Integrations tabs (Instruments, Workflows, Protocols, Provenance, Governance, CFD Pipeline, Transfers) with lazy-loading data handlers
    - server.js: mounted researchIntegrationsRouter behind researchAuthGuard
    - database.js: added 17 tables to auto-creation init function
    - Deployed both Central and LE

### Recent Fixes (Mar 29, 2026)

14. **E.V.I.E. LLM Fallback (Anthropic)**
    - File: `greenreach-central/routes/assistant-chat.js`
    - Added Anthropic (Claude Sonnet 4) as fallback when OpenAI fails
    - chatWithAnthropicFallback() with full tool-calling loop
    - Both /chat and /chat/stream catch blocks fall back automatically
    - Env var: ANTHROPIC_API_KEY, ANTHROPIC_FALLBACK_MODEL (default: claude-sonnet-4-20250514)

15. **F.A.Y.E. Auto-Recovery**
    - File: `greenreach-central/routes/admin-assistant.js`
    - attemptAdminAutoRecovery() with 3 strategies: DB retry, connection retry, constraint hinting
    - Wired into both chatWithClaude and chatWithOpenAI tool loops

16. **Heartbeat False Alert Fix**
    - Files: `greenreach-central/services/faye-intelligence.js`, `greenreach-central/routes/sync.js`
    - faye-intelligence.js now queries farms table (primary) with GREATEST() fallback to farm_heartbeats
    - sync.js heartbeat endpoint now writes to BOTH farms and farm_heartbeats tables
    - Removed "hardware issues" from alert text (cloud-only architecture)

17. **Farm Settings DB Persistence**
    - File: `greenreach-central/routes/farm-settings.js`
    - farmSettingsStore now backed by farm_data table (data_type='farm_settings')
    - persistSettingsToDB() called on every settings change (4 endpoints)
    - hydrateFarmSettings() restores from DB on module load

18. **Custom Product Image Upload Fix**
    - File: `greenreach-central/public/central-admin.js`
    - Fixed field name mismatch: frontend sent 'thumbnail', backend expected 'image'

19. **LE Instance Pinned to 1** (HISTORICAL -- EB is now deprecated, Cloud Run manages scaling)
    - Was: `eb scale 1` applied to light-engine-foxtrot-prod-v3
    - Now: Cloud Run `light-engine` min-instances=1, max-instances=3

20. **Research Subscriber Tier (Light Engine Research)**
    - Two subscription plans: Light Engine Cloud ($29 CAD/mo, 500 AI calls, 50MB data) and Light Engine Research (TBA pricing, $10/mo test placeholder, 2500 AI calls, 500MB data)
    - Pro plan removed -- usage-based billing (data + AI tranches) replaces tiered approach
    - Files: billing.js (SUBSCRIPTION_PLANS), farms.js (registration), auth.js + farms.js (JWT plan_type), setup-wizard.js (research profile), feature-gate.js (plan_type check), admin.js (revenue breakdown), database.js (migration 049)
    - Registration accepts plan_type ('light-engine' or 'research') + affiliation fields (affiliation_type, institution, department, orcid)
    - Research farms auto-enable research features via settings.features.research_enabled flag and plan_type in JWT
    - Feature gate updated: checks JWT plan_type first, then DB plan_type, then settings flag
    - Admin KPIs include planBreakdown + new GET /api/admin/subscriptions/summary endpoint
    - Affiliation types: school, research_facility, independent_researcher
    - New setup wizard endpoints: GET/PUT /api/setup-wizard/research-profile

### Recent Fixes (Mar 28, 2026)

8. **Security Hardening -- Research Platform + Core Routes (9 patches)**
   - C2 FIX: Multi-tenant data isolation -- NEW middleware `greenreach-central/middleware/research-tenant.js` (14 ownership verification functions injected into 62 sub-resource endpoints across 6 research route files). Every sub-resource endpoint now verifies parent entity belongs to requesting farm.
   - C3 FIX: SQL injection in EVIE tools -- 4 string-interpolated queries in `greenreach-central/routes/farm-ops-agent.js` replaced with parameterized queries (get_my_studies, get_eln_entries, get_calibration_status, get_bus_mappings).
   - C4 FIX: ELN signature spoofing -- `POST /api/research/entries/:id/sign` in `research-eln.js` now derives signer_id from authenticated session (req.userId) instead of accepting it from request body.
   - C5 FIX: currval() race condition -- research-data.js observation+provenance INSERT now uses RETURNING id pattern instead of currval().
   - x-farm-id header validation hardened in `greenreach-central/server.js` (format regex check).
   - EVIE tenant binding: `greenreach-central/routes/assistant-chat.js` -- 8 farmId resolution patterns fixed to use req.farmId from auth middleware first.
   - Inventory farm resolver rewritten in `greenreach-central/routes/inventory.js`.
   - C1 NOTE: autoEnforceFeatures() import into Central ATTEMPTED then REVERTED -- Central cannot import from ../server/middleware/ (path outside deploy bundle). Needs Central-local implementation.

9. **Auth fallback for farm login**
   - File: `greenreach-central/routes/auth.js`
   - Login now falls back to ADMIN_PASSWORD env var comparison (bcrypt) when stored password_hash does not match. Prevents lockout when DB hash is stale.

10. **UI fixes: EVIE orb/help/mute overlap, POS inventory, inventory edit/delete**
    - EVIE floating elements spaced vertically: orb 20px, help button 100px, voice FAB 160px
    - POS inventory endpoint (`farm-sales.js` line ~444) fixed from SELECT * to aliased SELECT with proper field names (name, retail_price, available)
    - Farm inventory page: Edit button with modal for qty/retail/wholesale pricing
    - Force-delete endpoint: DELETE with ?force=true bypasses auto/hybrid guard for permanent removal

11. **Custom Farm Product Entry (full feature)**
    - NEW route file: `greenreach-central/routes/custom-products.js` mounted at `/api/farm/products`
    - 4 new farm_inventory columns: description, thumbnail_url, is_taxable, is_custom
    - Full CRUD + image upload (multer), wholesale catalog integration, POS integration
    - Auto-sync protection: custom products (is_custom=TRUE) skipped by recalculateAutoInventoryFromGroups()
    - See `.github/CUSTOM_PRODUCT_FEATURE.md` and `.github/CUSTOM_PRODUCT_IMPLEMENTATION.md`

12. **Usage billing policy update (Subscription + $15 tranches)**
   - File: `greenreach-central/routes/billing.js`
   - Data and AI usage are now surfaced as per-farm $15 tranche estimates.
   - Data tranche model includes 85% margin target (`DATA_MARGIN_TARGET=0.85`) using measured storage usage and configurable cost basis.
   - `/api/billing/usage/:farmId` now returns `usage_billing_estimate` with data/ai tranche counts and total usage charge.

13. **EVIE -> FAYE feature-request pipeline**
   - File: `greenreach-central/routes/assistant-chat.js`
   - New EVIE tool: `submit_feature_request` for missing-feature asks (e.g. inventory trend graph).
   - Requests are sent to FAYE with `context.request_type = feature_request` and `review_cycle = weekly`.
   - File: `greenreach-central/routes/admin-ops-agent.js`
   - New FAYE tool: `get_weekly_feature_request_todo` to build weekly review queue from EVIE-submitted feature requests.

### Recent Fixes (Mar 27, 2026)

5. **POS iframe auto-login from LE-farm-admin**
   - File: `greenreach-central/public/farm-sales-pos.html` (synced to root `public/`)
   - POS token lookup now falls back through `farm_token`, `token` (localStorage), `token` (sessionStorage)
   - New embedded mode (`?embedded=1`): inherits admin session, skips login screen
   - Default role is `manager` when `user_role` unset

6. **Square connection: standalone payment-setup.html**
   - File: `greenreach-central/public/payment-setup.html` (synced to root `public/`)
   - 614 lines of wizard HTML/JS removed from LE-dashboard.html
   - payment-setup.html is security-hardened: same-origin returnUrl, DOM API rendering
   - LE-dashboard.html `openPaymentWizard()` now redirects to `/payment-setup.html`


7. **Wholesale remediation (order lifecycle, payments, inventory)**
   - Files: `greenreach-central/routes/wholesale.js`, `greenreach-central/services/wholesaleMemoryStore.js`, `greenreach-central/routes/payment-webhooks.js`, `greenreach-central/lib/wholesale/invoice-generator.js`
   - Order expiry: 48h auto-expire for unconfirmed orders
   - Payment reconciliation: idempotent webhook handling, refund state machine
   - Inventory: hold-to-commit pattern, restock on order cancel/expire

### Recent Fixes (Mar 19, 2026)

Agents touching dashboard, weather, or devices must preserve these behaviors:

1. **Weather fallback is server-side in Central**
	- Route: `greenreach-central/server.js` `/api/weather`
	- If `lat/lng` query params are missing, Central resolves coordinates from farm profile data (`farm_data`), then safe static fallback.
	- `farm-summary.html` may call `/api/weather` without coordinates when farm profile payload is incomplete.

2. **Farm Summary auto-refresh has visible status + logging**
	- File: `greenreach-central/public/views/farm-summary.html`
	- `loadData(source)` labels cycles (`Initial`, `Auto`, `Tab Resume`, `Manual`), updates `#envRefreshStatus`, and logs cycle duration.
	- Interval refresh (`60s`) and visibility refresh both clear env cache before reloading.

3. **Central Devices page status is derived, not defaulted offline**
	- File: `greenreach-central/public/central-admin.js`
	- Do NOT use `device.status || 'offline'` as the fallback.
	- Correct order: explicit `status` -> `telemetry.online`/`deviceData.online` -> last-seen recency (< 5 minutes = online).

4. **AI Insights/Sustainability popup hardening requires farm-auth fetches**
	- Files:
	  - `greenreach-central/public/views/farm-inventory.html`
	  - `greenreach-central/public/LE-farm-admin.html`
	- `fetchWithFarmAuth` must read token from both `sessionStorage` and `localStorage`.
	- Include `x-farm-id` header when farm ID is available (`farm_id`/`farmId` in storage).
	- Sustainability dashboard fetches (`/api/sustainability/metrics`, `/utility-bills`, `/food-miles`, `/trends`) must fail soft on non-OK responses (no hard JSON parse crash/popups).


### AI Vision Phase Completion (Mar 27, 2026)

**Phase 1 -- Data Foundation + Central Benchmarks**: COMPLETE (12/12 tasks)
- Experiment records pipeline, crop benchmarks, loss events, network dashboard, leaderboard
- Frontend: network-view in GR-central-admin, sidebar navigation, farm correlation panel

**Phase 2 -- Workflow Automation + Central Intelligence**: COMPLETE (12/12 tasks)
- Farm: auto-derive plant count, AI pre-fill crop, combined seed+group, auto-print labels, auto-derive photoperiod, seed date sync, device auto-discovery
- Central: demand signal aggregation, onboarding benchmarks, environmental benchmark push, network trends, buyer behavior + churn detection

**Phase 3 -- Adaptive Intelligence + Central ML**: COMPLETE (12/12 tasks)
- Central ML: yield regression, recipe modifiers, anomaly correlation, adaptive loss alerts
- Endpoints: energy benchmarks, farm performance tracking, performance leaderboard

**Phase 4 -- Network Coordination**: COMPLETE (8/8 tasks)
- Farm: planting suggestion accept UI, harvest schedule reporter, recipe modifier one-tap accept/dismiss
- Central: harvest conflict detection, supply/demand balancing, A/B test orchestration, quality order routing, dynamic pricing

**Phase 5 -- Autonomous Operations**: COMPLETE (8/8 tasks)
- Farm: autonomous recipe adjustment with guardrails, AI harvest timing with readiness scoring, voice-first Activity Hub (Web Speech API + TTS)
- Central: weekly production planning + distribution, dynamic recipe versioning + push, predictive inventory + auto wholesale listing, autonomous wholesale matching, market intelligence (10 routes)

**ALL 52 AI VISION TASKS COMPLETE.** Full autonomous operations live.

**Key files**: `.github/AI_VISION_RULES_AND_SKILLS.md` (full task list), `greenreach-central/routes/network-growers.js` (18 network routes), `greenreach-central/routes/experiment-records.js` (benchmarks + env benchmarks), `greenreach-central/services/ai-recommendations-pusher.js` (30-min push cycle), `greenreach-central/jobs/anomaly-correlation.js` (weekly cross-farm anomaly detection), `greenreach-central/jobs/supply-demand-balancer.js` (risk alerts + adaptive loss alerts), `greenreach-central/jobs/production-planner.js` (weekly seeding plans), `greenreach-central/routes/market-intelligence.js` (10 market data routes), `lib/recipe-modifier.js` (autonomous recipe engine + guardrails), `lib/harvest-predictor.js` (readiness scoring)


### Research Platform (Added Session 2026-03-28)

**Tier**: `research` in feature-flags.js (includes all `full` tier features plus research-specific).

**30 new tables** across migrations 042-047:
- 042: studies, study_protocols, treatment_groups, study_links, trial_milestones, protocol_deviations
- 043: research_datasets, research_observations, data_transformations, provenance_records, calibration_logs, device_maintenance
- 044: export_packages, data_quality_flags, qc_reviews, study_alerts
- 045: data_management_plans, retention_policies, grant_budgets, budget_line_items, researcher_profiles, citation_records, project_closeouts
- 046: eln_notebooks, eln_templates, eln_entries, eln_attachments, eln_links, eln_signatures, eln_snapshots
- 047: study_collaborators, review_comments, share_links, onboarding_checklists

**6 route files** in `greenreach-central/routes/`:
- `research-studies.js` -- Study design, protocols, treatment groups, milestones, deviations
- `research-data.js` -- Datasets, observations, provenance, calibrations, maintenance
- `research-exports.js` -- Export packages, quality flags, QC reviews, alerts
- `research-compliance.js` -- DMPs, retention, budgets, profiles, citations, closeouts
- `research-eln.js` -- Electronic lab notebook: notebooks, entries, attachments, signatures, snapshots, templates
- `research-collaboration.js` -- Collaborators, review comments, share links, onboarding checklists

**AI Integration**:
- EVIE (farm-ops-agent.js): 10 research tools + 3 scanning integration tools (get_my_studies, get_study_timeline, record_observation, get_dataset_summary, get_eln_entries, get_calibration_status, get_study_budget, scan_bus_channels, get_bus_mappings, save_bus_mapping)
- FAYE (admin-ops-agent.js): 4 admin tools (get_research_dashboard, get_study_compliance_status, get_research_audit_log, manage_study_collaborators)

**Feature Gating**: ENDPOINT_FEATURES maps `/api/research` to `research_workspace`. All 6 route files are mounted at `/api` with authMiddleware in server.js.

**UI**: Research Workspace HTML exists in BOTH `public/views/research-workspace.html` (LE) and `greenreach-central/public/views/research-workspace.html` (Central). Both servers serve it directly as a static file. The primary access path is through LE-farm-admin.html sidebar (iframe-view). API calls use relative paths (`/api/research/*`) -- on LE these are proxied to Central.

**Landing Page**: Third product card (amber #f59e0b border) added to `greenreach-central/public/landing-main.html`.


**Security Remediation (Mar 28, 2026)**: Audit score improved from 58/100 to ~82/100. Critical findings C2-C5 remediated (see Recent Fixes Mar 28 above). C1 (feature gate enforcement on Central) remains open -- requires Central-local middleware implementation. See `.github/RESEARCH_PLATFORM_AUDIT.md` for full details.

**Tenant Isolation Middleware**: NEW file `greenreach-central/middleware/research-tenant.js` provides 14 ownership verification functions. Applied to all 62 sub-resource endpoints across 6 research route files. Pattern: verify parent entity belongs to req.farmId before allowing sub-resource access.
### DO NOT (Architecture Rules)

- DO NOT assume any physical device exists (no Pi, no edge box, no local server)
- DO NOT reference or deploy to AWS Elastic Beanstalk environments (deprecated)
- DO NOT use `eb deploy`, `eb setenv`, `eb printenv`, or any `eb` CLI command
- DO NOT use `aws elasticbeanstalk` CLI commands
- DO NOT reference EB CNAMEs or `.elasticbeanstalk.com` URLs
- DO NOT "fix" edge mode settings (LE Cloud Run running as "edge" in cloud is intentional)
- DO NOT remove or modify SwitchBot credentials from Cloud Run secrets or farm.json
- DO NOT change the Central `/env` endpoint to proxy-first (DB-first is correct)
- DO NOT modify `setupLiveSensorSync()`, `ensureSwitchBotConfigured()`, or `getFarmIntegrations()` without reading SENSOR_DATA_PIPELINE.md
- DO NOT modify sync-service.js authentication without verifying both auth systems (Farm API key vs GREENREACH_API_KEY)
- DO NOT assume `foxtrot.greenreachgreens.com` resolves (it does not)
- DO NOT create or use VPC connectors (Direct VPC egress is the pattern)
- DO NOT build Docker images without `--platform linux/amd64` (Apple Silicon default is ARM64, Cloud Run requires amd64)

### BANNED COMMANDS (HARD BLOCK)

**AWS Elastic Beanstalk is DEPRECATED. The platform has migrated to Google Cloud Run (April 2026).**

The following commands are ABSOLUTELY FORBIDDEN:

```
# BANNED -- AWS/EB infrastructure is deprecated:
eb deploy
eb setenv
eb printenv
eb scale
aws elasticbeanstalk update-environment
aws elasticbeanstalk describe-environments
# Any eb CLI command or aws elasticbeanstalk command

# BANNED -- destructive operations:
DROP TABLE / TRUNCATE / DELETE without WHERE
gcloud run services delete (without explicit user approval)
```

**The ONLY safe deployment commands are:**
```bash
# Build and push images (ALWAYS use --platform linux/amd64 on Apple Silicon)
docker buildx build --platform linux/amd64 -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest --push ./greenreach-central/
docker buildx build --platform linux/amd64 -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest --push .

# Deploy (update to latest image)
gcloud run services update greenreach-central --region=us-east1 --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest
gcloud run services update light-engine --region=us-east1 --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest

# Update env vars (safe on Cloud Run -- creates new revision)
gcloud run services update SERVICE_NAME --region=us-east1 --update-env-vars="KEY=value"

# Update secrets (after updating in Secret Manager)
echo -n "new-value" | gcloud secrets versions add SECRET_NAME --data-file=-
```

**Additional infrastructure rules:**
- NEVER create duplicate utility files (check `services/` first)
- NEVER run destructive DB commands (DROP TABLE, TRUNCATE, DELETE without WHERE)
- NEVER build Docker images without `--platform linux/amd64`
- NEVER use VPC connectors (Direct VPC egress is the pattern)
- NEVER reference EB environment names, EB CNAMEs, or `.elasticbeanstalk.com` URLs

## Workspace Location (REQUIRED)

**All coding projects live on the external CodeVault drive:**

| Item | Path |
|------|------|
| **Canonical workspace** | `/Volumes/CodeVault/Projects/Light-Engine-Foxtrot` |
| **Symlink (backward compat)** | `~/Light-Engine-Foxtrot` → CodeVault |
| **All active projects** | `/Volumes/CodeVault/Projects/` |
| **Archived/reference repos** | `/Volumes/CodeVault/Archive/` |

**Rules:**
- New projects MUST be created under `/Volumes/CodeVault/Projects/`
- Use relative paths in code; use CodeVault absolute paths in scripts
- The `~/Light-Engine-Foxtrot` symlink is for backward compatibility only
- If CodeVault is not mounted, do NOT create projects on the internal drive — alert the user
- The drive is APFS-formatted (supports Unix permissions, symlinks, case-sensitive operations)

## Agent Skills Framework (REQUIRED READING)

**ALL agents MUST read `.github/AGENT_SKILLS_FRAMEWORK.md` before any work.**

This framework defines:
- Project mission & core philosophy
- Programming themes (simplicity, database-driven, workflow-centric)
- Multi-agent collaboration model (Implementation → Review → Architecture)
- Technical standards & validation requirements
- Agent performance tracking & selection criteria

**Key Principles:**
1. **Simplicity Over Features** - Reduce grower workload, don't add steps
2. **Database-Driven** - Configuration is data, not code
3. **Workflow-Centric UI** - Design by task, not entity
4. **Multi-Agent Review** - Propose → Validate → Strategic Review before implementing
5. **Zero Data Format Violations** - Use adapters, never modify source formats
6. **Central-First Intelligence** - GreenReach Central is the mother ship, active from Phase 1

## AI Vision Rules & Skills (REQUIRED for AI/ML work)

**ALL agents working on AI/ML features, feedback loops, network intelligence, or workflow automation MUST read `.github/AI_VISION_RULES_AND_SKILLS.md` before any work.**

This document codifies the `AI_VISION_REPORT.md` into enforceable rules:
- Central-First Architecture (dual-track Farm + Central implementation)
- Experiment Record Standard (canonical schema for harvest outcomes)
- 5 Feedback Loops (Recipe→Yield, Environment→Loss, Spectrum→Quality, Timing→Efficiency, Demand→Production)
- Recipe Modifier bounds and revert-on-regression safety
- Phase Gate rules (Phase 1 before Phase 2, etc.)
- 52 prioritized AI opportunities across 5 phases
- Automatic rejection criteria for non-compliant AI proposals

**Before ANY code change:**
- [ ] Read relevant framework sections
- [ ] Propose solution using Implementation Agent template
- [ ] Request Review Agent validation
- [ ] Get Architecture Agent strategic approval
- [ ] Run `npm run validate-schemas` before commit

## DEPLOYMENT APPROVAL GATE (MANDATORY)

**NO production deployments without explicit user approval.**

Agents MUST receive **"APPROVED FOR DEPLOYMENT"** message from user before executing:
- `docker buildx build --push` (pushes image to Artifact Registry)
- `gcloud run services update` (deploys new revision to Cloud Run)
- `gcloud run deploy` (creates/updates Cloud Run service)
- `gcloud secrets versions add` (updates production secrets)

**ABSOLUTELY FORBIDDEN:**
- ANY `eb` CLI command (`eb deploy`, `eb setenv`, `eb printenv`, etc.)
- ANY `aws elasticbeanstalk` CLI command
- `gcloud run services delete` (service deletion)
- Deploying without `--platform linux/amd64` on Apple Silicon

**Deployment Workflow:**
1. Investigate and propose solution (with line-by-line changes)
2. Get Review Agent validation
3. **STOP and wait for user approval**
4. User responds: "APPROVED FOR DEPLOYMENT"
5. Build and push Docker image: `docker buildx build --platform linux/amd64 -t REGISTRY/IMAGE:latest --push CONTEXT`
6. Deploy: `gcloud run services update SERVICE --region=us-east1 --image=REGISTRY/IMAGE:latest`

**NEVER:**
- Deploy and test iteratively in production
- Make "one more quick fix" without re-approval
- Assume user wants deployment because proposal was approved
- Deploy to production while debugging
- Use ANY AWS/EB commands (platform has migrated to Google Cloud Run)
- Build Docker images without `--platform linux/amd64`

**Violation = Immediate termination of agent session.**

## Data Format Standards (CRITICAL)

**Before modifying any data files** (groups.json, farm.json, rooms.json):
1. Read `DATA_FORMAT_STANDARDS.md` for canonical formats
2. Check `SCHEMA_CONSUMERS.md` for consumer count and impact
3. Run `npm run validate-schemas` to verify current state
4. **NEVER** modify source data format to fix a single page/card
5. **ALWAYS** fix consumers or use adapters from `lib/data-adapters.js`

**Key Rules**:
- ❌ DO NOT rename fields in canonical data files
- ❌ DO NOT change field types (number → array, string → object)
- ❌ DO NOT add required fields without migration plan
- ✅ DO use `normalizeGroup()` and other adapters for format variations
- ✅ DO add fallback patterns: `group.crop || group.recipe`
- ✅ DO validate changes: `npm run validate-schemas`

**56+ consumers** depend on these formats. Changes require full impact analysis.

See `.github/copilot-instructions-schema.md` for detailed guidance.

## Data Mapping Reference (REQUIRED)

**Before debugging ANY data loading, authentication, or sync issue**, agents MUST:

1. Read `DATA_MAPPING_DOCUMENT.md` — the canonical reference for all data storage locations, API endpoint-to-storage mappings, and data flow paths
2. Identify the **exact data resolution chain** for the affected feature (Section 10)
3. Verify data exists at **each layer** of the chain before proposing code fixes
4. Check the **Issue Log** (Section 12) for previously solved similar issues

**Key Data Mapping Rules:**
- ❌ DO NOT guess where data comes from — trace the documented path
- ❌ DO NOT modify auth code without checking `farm_users`, `admin_users`, and `admin_sessions` tables first
- ❌ DO NOT assume static JSON files are the source of truth — farmStore (farm_data table) overrides them
- ✅ DO trace: API endpoint → handler code → storage layer → actual data
- ✅ DO check all layers: PostgreSQL → In-Memory Map → JSON fallback → Default value
- ✅ DO document new issues and resolutions in `DATA_MAPPING_DOCUMENT.md` Section 12

**Resolution chains to check (from DATA_MAPPING_DOCUMENT.md):**
- Farm login: `login.html` → `/api/farm/auth/login` → `farm_users` JOIN `farms` → bcrypt → JWT
- Farm data: API → farmStore → `farm_data` table → in-memory Map → JSON file → default
- Admin auth: `/api/admin/auth/login` → `admin_users` → `admin_sessions` → JWT
- Sync: LE Cloud Run → `POST /api/sync/*` → `farm_data` UPSERT → in-memory Map → file backup
