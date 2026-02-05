# Implementation Proposal: Wizard Room Persistence (DB-Backed + Edge Fallback)
**Date**: 2026-02-04
**Owner**: Implementation Agent
**Status**: Approved (Review Agent) → Implementation Pending

## 1) Problem Statement
Wizard room/equipment data is not durably persisted. After completing room setup, the Grow Rooms summary shows no equipment because `rooms.json` remains empty and `localStorage` is not a durable source of truth.

## 2) Goals
- Persist room wizard output reliably in **cloud** (DB) and **edge** (rooms.json).
- Use a single API endpoint for save/load and remove localStorage as a source of truth.
- Maintain existing room schema from DATA_FORMAT_STANDARDS.md.

## 3) Non‑Goals
- No UI redesign.
- No changes to `rooms.json` schema.
- No changes to equipment selection workflow beyond persistence.

---

## 4) Proposed Storage Design
### 4.1 DB Schema (Cloud)
Create a dedicated table for wizard room configurations.

**DDL (Postgres):**
```sql
CREATE TABLE IF NOT EXISTS farm_room_configs (
  id SERIAL PRIMARY KEY,
  farm_id TEXT NOT NULL,
  rooms_json JSONB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_farm_room_configs_farm_id
  ON farm_room_configs (farm_id);

CREATE INDEX IF NOT EXISTS idx_farm_room_configs_updated_at
  ON farm_room_configs (updated_at DESC);
```

**Notes**
- Unique `farm_id` = one config per farm.
- `rooms_json` stores complete room payload (current schema).
- `updated_at` for tracking.

### 4.2 Edge Storage (Single‑device)
Continue to write to `public/data/rooms.json` for edge mode.

---

## 5) API Contract
### 5.1 POST /api/setup/save-rooms
**Auth**: Required in cloud (Authorization: Bearer &lt;token&gt;). Optional on edge if no token available.

**Request Body**
```json
{
  "rooms": [
    {
      "id": "ROOM-A",
      "name": "Room A",
      "zones": [{ "id": "ROOM-A-Z1", "name": "Zone 1" }],
      "equipment": [/* optional legacy */],
      "categoryProgress": { /* wizard data */ },
      "_categoryProgress": { /* wizard data */ }
    }
  ]
}
```

**Response (Success)**
```json
{
  "success": true,
  "message": "N room(s) saved successfully",
  "savedTo": ["db", "rooms.json", "nedb"]
}
```

**Response (Validation Error)**
```json
{
  "success": false,
  "message": "rooms validation failed with X error(s)",
  "errors": [
    { "field": "/rooms/0/id", "message": "must have required property 'id'" }
  ]
}
```

**Validation**
- Validate against `lib/schema-validator.js` rooms schema.
- Reject malformed payload.

### 5.2 GET /api/setup/rooms
**Auth**: Required in cloud. Optional on edge.

**Response**
```json
{
  "success": true,
  "rooms": [/* rooms */],
  "schemaVersion": "1.0.0",
  "source": "db"
}
```

**Source of truth**
- Cloud: `farm_room_configs.rooms_json`
- Edge: `public/data/rooms.json`

---

## 6) Client Load/Save Logic
### 6.1 saveRooms
Use `/api/setup/save-rooms` exclusively.
- On cloud: saves to DB.
- On edge: saves to rooms.json and NeDB.
- Sends Authorization header if token exists.

### 6.2 loadRoomsFromBackend
- **Primary**: GET `/api/setup/rooms`.
- **Secondary**: GET `/api/setup/data` (legacy setup config).
- **LocalStorage**: cache only (optional), not source of truth.

---

## 7) Migration Strategy
### 7.1 Existing Edge Data
- If `rooms.json` exists, API can read and write it (no migration required).

### 7.2 Cloud Migration
- Apply `migrations/012_create_farm_room_configs.sql` via deployment migration process (manual psql or migration runner).
- One‑time backfill script (optional): read `rooms.json` for each farm and insert into `farm_room_configs` if empty.
- Big Green Farm: preserve existing DB records; only insert if no config exists.

**Backfill Pseudocode**
```js
for each farmId:
  if no farm_room_configs row:
    if rooms.json exists:
      insert rooms_json
```

### 7.3 Rollback
- Drop `farm_room_configs` table.
- Edge remains on rooms.json and NeDB.
- No schema changes to rooms.json.

---

## 8) Validation Checklist
- Verify rooms schema matches DATA_FORMAT_STANDARDS.md.
- Update SCHEMA_CONSUMERS.md if new data consumers are added.
- Run `npm run validate-schemas`.

---

## 9) Testing Checklist
### Edge Mode
- Save room via wizard → `rooms.json` updated.
- Reload → Grow Rooms summary shows equipment.

### Cloud Mode
- Save room via wizard → DB row updated.
- Reload from `/api/setup/rooms` → UI reflects equipment.

### Regression
- No changes to groups.json format.
- No breaking changes in setup wizard steps.

### Failure/Fallback Tests
- DB down: save uses rooms.json (edge) and returns error in cloud.
- File write failure: backup restore is attempted, API returns 500.
- Unauthorized request in cloud returns 401/403.

---

## 10) Open Questions
- Confirm farms table key: `farm_id` vs `farmId`.
- Confirm auth middleware for `/api/setup/*` endpoints.

## 11) Implementation Details (Refinement)
### Write Logic
- Validate payload against rooms schema.
- Edge: update NeDB `setup_config`, then write `public/data/rooms.json` with backup + atomic rename.
- Cloud: upsert into `farm_room_configs` by `farm_id` (from token).

### Read Logic
- Cloud: fetch latest `farm_room_configs` row by `farm_id`.
- Edge: read `rooms.json`; fallback to NeDB if file missing.

---

## 12) Approval Request
**Review Agent**: ✅ Approved with conditions.
**Architecture Agent**: Pending.
