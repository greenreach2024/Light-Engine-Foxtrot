# Missing Backend Endpoints -- Implementation Tracker

Last audited: 2026-02-11
Status: Pending implementation

All farm data must flow to GreenReach Central. Maintain global CSS style and standard header menu.

---

## Individual Missing Endpoints

### 1. GET /api/admin/farms/:farmId/devices
- **Called from:** greenreach-central/public/farm-admin.html
- **Current state:** No route handler in GRC routes
- **Fix:** Add route in greenreach-central/routes/farms.js that proxies to farm server or returns synced device data
- **Priority:** High
- **Status:** [ ] Not started

### 2. GET /api/wholesale/order-events
- **Called from:** Wholesale order management UI
- **Current state:** Route exists on Foxtrot (server-foxtrot.js) but not on GRC
- **Fix:** Add GRC proxy route or sync order events to central database
- **Priority:** Medium
- **Status:** [ ] Not started

### 3. GET /api/wholesale/order-statuses
- **Called from:** Wholesale dashboard
- **Current state:** No route handler
- **Fix:** Add route returning order status enum/list from wholesale module
- **Priority:** Medium
- **Status:** [ ] Not started

### 4. GET /api/wholesale/tracking-numbers
- **Called from:** Wholesale order tracking UI
- **Current state:** No route handler
- **Fix:** Add route in wholesale routes
- **Priority:** Low
- **Status:** [ ] Not started

### 5. GET /api/wholesale/order-tracking
- **Called from:** Wholesale shipment tracking UI
- **Current state:** No route handler
- **Fix:** Add route in wholesale routes
- **Priority:** Low
- **Status:** [ ] Not started

### 6. GET /data/farm-summary.json
- **Called from:** Dashboard or farm overview pages
- **Current state:** Static file not generated
- **Fix:** Either generate farm-summary.json on startup/sync or add a dynamic API route
- **Priority:** Medium
- **Status:** [ ] Not started

### 7. GET /api/ai/insights/count
- **Called from:** Dashboard badge/notification count
- **Current state:** No route handler
- **Fix:** Add route in AI routes or return count from existing insights array
- **Priority:** Low
- **Status:** [ ] Not started

### 8. GET /api/billing/receipts
- **Called from:** Billing/account management page
- **Current state:** No billing routes exist
- **Fix:** Stub route returning empty array until billing is implemented
- **Priority:** Low
- **Status:** [ ] Not started

### 9. POST /rooms
- **Called from:** Room creation UI
- **Current state:** GET /rooms exists, POST handler missing
- **Fix:** Add POST handler that creates room in rooms.json and syncs to GreenReach
- **Priority:** High
- **Status:** [ ] Not started

### 10. GET /api/inventory/tray-formats (path mismatch)
- **Called from:** Inventory/tray management UI
- **Current state:** Route exists as /api/tray-formats, but frontend calls /api/inventory/tray-formats
- **Fix:** Add alias route or update frontend fetch path
- **Priority:** Medium
- **Status:** [ ] Not started

### 11. GET /api/admin/farms/:farmId/users
- **Called from:** greenreach-central/public/farm-admin.html
- **Current state:** No route handler in GRC
- **Fix:** Add route in GRC farms routes returning farm user list
- **Priority:** Medium
- **Status:** [ ] Not started

### 12. GET /api/quality/tests/:farmId
- **Called from:** Quality control page
- **Current state:** No quality routes exist
- **Fix:** Stub route or implement quality test data retrieval
- **Priority:** Low
- **Status:** [ ] Not started

### 13. POST /api/farm/configuration
- **Called from:** Farm settings/configuration page
- **Current state:** No route handler
- **Fix:** Add route to persist farm configuration changes
- **Priority:** High
- **Status:** [ ] Not started

---

## Missing Modules (Entire Route Groups)

### 14. Planning Module (7 endpoints)
- **Called from:** planning.html, crop planning UI
- **Endpoints needed:**
  - GET /api/planning/schedules
  - POST /api/planning/schedules
  - PUT /api/planning/schedules/:id
  - DELETE /api/planning/schedules/:id
  - GET /api/planning/templates
  - GET /api/planning/forecasts
  - POST /api/planning/forecasts
- **Current state:** No routes/planning.js file exists
- **Fix:** Create routes/planning.js with schedule and forecast CRUD operations
- **Priority:** Medium
- **Status:** [ ] Not started

### 15. Traceability Module (6 endpoints)
- **Called from:** traceability.html, batch tracking UI
- **Endpoints needed:**
  - GET /api/traceability/batches
  - POST /api/traceability/batches
  - GET /api/traceability/batches/:id
  - PUT /api/traceability/batches/:id
  - GET /api/traceability/batches/:id/events
  - POST /api/traceability/batches/:id/events
- **Current state:** No routes/traceability.js file exists
- **Fix:** Create routes/traceability.js with batch tracking CRUD
- **Priority:** Medium
- **Status:** [ ] Not started

### 16. Sustainability Module (6 endpoints)
- **Called from:** sustainability.html
- **Endpoints needed:**
  - GET /api/sustainability/metrics
  - GET /api/sustainability/energy
  - GET /api/sustainability/water
  - GET /api/sustainability/waste
  - GET /api/sustainability/reports
  - POST /api/sustainability/reports
- **Current state:** Frontend references external Python service at localhost:8000
- **Fix:** Either integrate as Node.js routes or set up proper proxy to Python service
- **Priority:** Low
- **Status:** [ ] Not started

---

## GreenReach Central Inventory Gaps

### 17. Inventory sub-routes on GRC
- **Called from:** greenreach-central/public/inventory.html (central admin)
- **Endpoints needed on GRC (currently only on farm server):**
  - GET /api/inventory/dashboard
  - GET /api/inventory/seeds/list
  - GET /api/inventory/supplies
  - POST /api/inventory/reserve
  - GET /api/inventory/reservations
- **Current state:** GRC has basic /api/inventory route but lacks sub-routes
- **Fix:** Add proxy routes in GRC that forward to registered farm servers, or sync inventory data centrally
- **Priority:** High
- **Status:** [ ] Not started

---

## Implementation Notes

1. All new routes must follow Express router pattern used in existing routes/ directory
2. Data must sync to GreenReach Central -- no standalone endpoints that bypass central
3. Use existing auth middleware (requireAuth, requireAdmin) as appropriate
4. Stub routes should return proper JSON structure with empty data, not 404
5. Frontend pages already exist for most of these -- backend routes are the gap
6. Run `npm run validate-schemas` before committing any data format changes
