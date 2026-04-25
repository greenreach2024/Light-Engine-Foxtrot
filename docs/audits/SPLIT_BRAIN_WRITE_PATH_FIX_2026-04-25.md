# Split-Brain Write Path — Fix Instructions (2026-04-25)

**Status:** Patch ready; not yet applied. Validation procedure included.
**Scope:** Closes the highest-volume write-path leak identified in the GROW_MANAGEMENT audit follow-up. Does NOT close every drift surface — see "What this does not close" below.
**Severity:** High — currently corrupting state on every page-driven group save.

---

## TL;DR

The Apr 24/25 split-brain fix routed `GET /data/rooms.json` and `GET /data/groups.json` to LE (the canonical store) but did not symmetrically route the `POST` paths. As a result:

- `POST /data/groups.json` is silently captured by `farmDataWriteMiddleware` and persisted to Postgres `farm_data` only — LE's GCS-backed groups.json never sees the write.
- `POST /data/rooms.json` has no proxy registered at all, so it lands in Postgres for the same reason.
- Subsequent `GET /data/groups.json` correctly proxies to LE and returns the *old* data → user-visible "I saved and it reverted."

This document specifies the minimal patch to close the leak, the round-trip validation that must pass before the patch is considered effective, and the remaining surfaces that this fix does not address.

---

## 1. The bug

### 1.1 Where it lives

`greenreach-central/server.js`, in the order routes are registered:

```
L439: app.get('/data/rooms.json',  (req, res) => proxyToLE(req, res, '/data/rooms.json'));
L440: app.get('/data/groups.json', (req, res) => proxyToLE(req, res, '/data/groups.json'));
L441:
L442: app.use(farmDataWriteMiddleware(_inMemoryStore)); // PUT/POST /data/*.json -> Postgres
L443: app.use(farmDataMiddleware(_inMemoryStore));       // GET     /data/*.json -> Postgres
...
L465: app.post('/data/groups.json', authMiddleware, (req, res) => proxyToLE(req, res, '/data/groups.json'));
```

The intent is captured in the comment at L434: "These must come BEFORE farmDataMiddleware so the DB-backed middleware cannot shadow them." That intent was honored for the GETs (L439–L440) but violated for the POST at L465.

### 1.2 Why L465 never runs

`farmDataWriteMiddleware` in `greenreach-central/middleware/farm-data.js:263-327`:

- L265: `if (req.method !== 'PUT' && req.method !== 'POST') return next();` — captures both write methods.
- L268: `if (!match) return next();` — only matches `/data/*.json`.
- L272: `if (!dataType) return next();` — `groups.json` and `rooms.json` are both in `FILE_TO_DATA_TYPE` (L48-61), so this is satisfied.
- L274: `const farmId = extractFarmId(req);` — extractFarmId at L85-132 falls back to `process.env.FARM_ID || 'default'` at L131, so `farmId` is essentially always truthy.
- L288-311: writes to `farm_data` (or in-memory) and `return res.json(...)` — **never calls `next()`**.

Express runs middleware in registration order. The middleware at L442 always wins over the explicit handler at L465. The L465 handler is dead code for this route.

### 1.3 Observable symptom

The Apr 24 GROW_MANAGEMENT audit notes that `groups-v2.js` "directly mutates `STATE.groups` then `POST /data/groups.json`." Per the bug above, that POST persists to Postgres and never reaches LE. The page then refreshes via `GET /data/groups.json` (correctly proxied to LE) and renders LE's older snapshot. From the user's perspective the edit "saved and reverted."

---

## 2. The patch

### 2.1 Exact change to `greenreach-central/server.js`

**Before** (L439-L465 today):

```js
app.get('/data/rooms.json',  (req, res) => proxyToLE(req, res, '/data/rooms.json'));
app.get('/data/groups.json', (req, res) => proxyToLE(req, res, '/data/groups.json'));

app.use(farmDataWriteMiddleware(_inMemoryStore)); // PUT /data/*.json -> DB
app.use(farmDataMiddleware(_inMemoryStore));       // GET /data/*.json -> DB

// ... (other routes) ...

// Room-map routes MUST be before express.static to avoid flat-file fallback
app.post('/data/groups.json', authMiddleware, (req, res) => proxyToLE(req, res, '/data/groups.json'));
```

**After:**

```js
// LE is the single authoritative store for rooms.json and groups.json.
// Both READS and WRITES must be proxied to LE BEFORE farmDataWriteMiddleware /
// farmDataMiddleware capture them. See docs/audits/SPLIT_BRAIN_WRITE_PATH_FIX_2026-04-25.md.
app.get('/data/rooms.json',   (req, res) => proxyToLE(req, res, '/data/rooms.json'));
app.get('/data/groups.json',  (req, res) => proxyToLE(req, res, '/data/groups.json'));
app.post('/data/rooms.json',  authMiddleware, (req, res) => proxyToLE(req, res, '/data/rooms.json'));
app.post('/data/groups.json', authMiddleware, (req, res) => proxyToLE(req, res, '/data/groups.json'));

app.use(farmDataWriteMiddleware(_inMemoryStore)); // PUT /data/*.json -> DB (other types only now)
app.use(farmDataMiddleware(_inMemoryStore));       // GET /data/*.json -> DB (other types only now)

// ... (other routes) ...

// REMOVED: the duplicate POST handler that previously sat here at L465.
// It was unreachable due to farmDataWriteMiddleware ordering.
```

Two changes:

1. Add a new `app.post('/data/rooms.json', ...)` proxy (does not exist today).
2. Move `app.post('/data/groups.json', ...)` from L465 up to immediately follow the GET proxies.
3. Delete the now-orphaned L465 line so future readers don't think there are two handlers.

### 2.2 Files touched

| File | Change |
|------|--------|
| `greenreach-central/server.js` | Add POST /data/rooms.json proxy; move POST /data/groups.json proxy above farmDataWriteMiddleware; delete the dead L465 line. |

No other files need to change for this patch.

---

## 3. Validation procedure

`node --check` is **not** sufficient to validate a routing change — it only verifies the file parses. The change is verified only when a write makes it to LE end-to-end and Postgres is confirmed not to have shadowed it.

Run all four steps below in order. The patch is verified only if every step matches the expected output.

### 3.1 Pre-flight: capture baselines

```bash
# LE state BEFORE
curl -s https://light-engine-1029387937866.us-east1.run.app/data/groups.json \
  | jq '.groups | length' > /tmp/le-groups-before.txt

# Central proxied GET BEFORE
curl -s https://greenreachgreens.com/data/groups.json \
  | jq '.groups | length' > /tmp/cen-groups-before.txt

# Postgres farm_data row for groups BEFORE (run via Cloud SQL or AlloyDB client)
gcloud sql connect ...  # or your standard AlloyDB access path
# NOTE: farmDataWriteMiddleware (farm-data.js:281-286) unwraps {groups:[...]}
# to a bare array before INSERT, so the stored `data` column is a JSON array,
# not an object. Query the array directly — `data->'groups'` is null.
# psql> SELECT updated_at,
#              CASE WHEN jsonb_typeof(data) = 'array'
#                   THEN jsonb_array_length(data)
#                   ELSE jsonb_array_length(data->'groups')
#              END AS n
#       FROM farm_data
#       WHERE farm_id='FARM-MLTP9LVH-B0B85039' AND data_type='groups';
```

LE and Central GETs should already match (the read-side proxy is in place). If they don't, do not deploy this patch — there is a separate bug in the read path.

### 3.2 Write a sentinel through Central

```bash
TS=$(date +%s)
SENTINEL_ID="split-brain-test-${TS}"

curl -s -X POST https://greenreachgreens.com/data/groups.json \
  -H "Authorization: Bearer ${FARM_JWT}" \
  -H "x-farm-id: FARM-MLTP9LVH-B0B85039" \
  -H "Content-Type: application/json" \
  -d "{
    \"groups\": [
      $(curl -s https://greenreachgreens.com/data/groups.json | jq -c '.groups[]' | paste -sd,),
      {
        \"id\": \"${SENTINEL_ID}\",
        \"name\": \"split-brain test ${TS}\",
        \"room\": \"Room 1\",
        \"zone\": \"Zone 1\",
        \"crop\": null,
        \"plan\": null,
        \"status\": \"active\",
        \"lights\": [],
        \"lastModified\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
      }
    ]
  }"
```

### 3.3 Verify the sentinel landed in LE (the canonical store)

```bash
# Direct LE — this is the test of record
curl -s https://light-engine-1029387937866.us-east1.run.app/data/groups.json \
  | jq ".groups[] | select(.id == \"${SENTINEL_ID}\")"
```

Expected: prints the sentinel object.
Failure mode if patch incomplete: empty output (write was captured by farmDataWriteMiddleware, never reached LE).

### 3.4 Verify Central's GET also returns it (proxy round-trip)

```bash
curl -s https://greenreachgreens.com/data/groups.json \
  | jq ".groups[] | select(.id == \"${SENTINEL_ID}\")"
```

Expected: prints the sentinel object (because GET proxies to LE, which now has it).

### 3.5 Verify Postgres `farm_data` did NOT receive the write

```bash
# psql against AlloyDB — `data` is a bare JSON array (see 3.1 note); query it
# directly rather than `data->'groups'`.
SELECT updated_at,
       CASE WHEN jsonb_typeof(data) = 'array'
            THEN data       @> ('[{"id":"' || :sentinel || '"}]')::jsonb
            ELSE data->'groups' @> ('[{"id":"' || :sentinel || '"}]')::jsonb
       END AS has_sentinel
  FROM farm_data
 WHERE farm_id='FARM-MLTP9LVH-B0B85039' AND data_type='groups';
```

Expected: `has_sentinel = false`. The whole point of this fix is that `farm_data` no longer receives groups writes.
If `has_sentinel = true`: middleware ordering is still wrong. Re-check the patch.

### 3.6 Repeat 3.2–3.5 with `/data/rooms.json` and a sentinel room id

Use the same pattern. The new POST proxy added by this patch should make rooms behave identically to groups.

### 3.7 Cleanup

Delete the sentinel via the same path (re-POST without it). Confirm via 3.3 that LE no longer contains it.

---

## 4. What this patch does NOT close

This is a narrow, surgical fix. It closes one leak. The following remain risk surfaces for future "saved and reverted" or drift reports:

| Surface | Where | Mechanism | Status |
|---------|-------|-----------|--------|
| E.V.I.E. group / room edits | `greenreach-central/routes/farm-ops-agent.js:1965, 1988, 2254, 2300` (and surrounding handlers) | Dual-write: `farmStore.set(farm_id, 'groups'\|'rooms', ...)` followed by `await postToLE('groups.json'\|'rooms.json', ...)`. The LE call IS made, but on failure only a `console.warn` is logged — Central state advances while LE does not, producing silent drift. Some sibling handlers also `writeJSON('groups.json'\|'rooms.json', ...)` to Central's local fs (see e.g. lines 1530, 1569, 2958-3024), which is independent of the proxy path. | **OPEN** (drift on LE failure, not bypass) |
| Assistant chat write tools | `greenreach-central/routes/assistant-chat.js:4187, 4229, 4598, 5064` | Same dual-write shape: `farmStore.set(...)` then `await writeToLE('rooms.json'\|'groups.json', ...)`. LE failure is surfaced in the response message but Central's write is not rolled back. | **OPEN** (drift on LE failure) |
| `POST /data/iot-devices.json` | `greenreach-central/server.js:719-725` | Pure proxy to LE (`proxyToLE(req, res, '/data/iot-devices.json')`); no farmStore write. The Apr 24 audit's prescribed cleanup is already implemented. | **CLOSED** |
| `/api/sync/rooms` and `/api/sync/groups` | `greenreach-central/routes/sync.js:363, 417` (Central write handlers); `sync.js:1186, 1236` (Central read handlers); `lib/sync-service.js:593, 628` (LE pusher) | LE periodically pushes rooms+groups to Central, which writes to `farm_data`. The `GET /api/sync/:farmId/rooms` and `/groups` endpoints DO read those rows — they are not dead writes. They are still a re-regression vector because they reintroduce a second authoritative copy that can diverge from LE. | **OPEN** |
| `lib/sync-service.js:55-69` `authoritative` toggle | LE | `restoreFromCloud()` is bypassed only because `edge-config.authoritative === true`. The comment now states this is permanent (not a temporary workaround), but if the flag is ever unset, LE downloads Central state and overwrites itself. | **OPEN** |
| `reconcileGroupsFromRooms()` orphan-drop | `server-foxtrot.js:7927` (function), `8016-8025` (drop logic) | Drops groups for rooms not present in the save-rooms payload. Relies on a UI invariant for data integrity (the page must always send the full rooms list). | **OPEN** |

Each of these warrants its own focused fix and validation. They should not be bundled into this patch.

---

## 5. Recommended commit message

```
fix(central): proxy POST /data/{rooms,groups}.json to Light Engine

Previously the read path was correctly proxied to LE
(see commit 9a20a4bd / Apr 24 split-brain fix), but the write path
was not symmetric:

- POST /data/groups.json was registered AFTER farmDataWriteMiddleware
  and therefore never executed; writes silently landed in Postgres
  farm_data instead of LE's GCS-backed groups.json.
- POST /data/rooms.json had no proxy registered at all and behaved
  the same way.

This caused the user-visible "save then revert" pattern on the Grow
Management page: groups-v2.js POSTs went to farm_data, the next GET
proxied to LE and returned LE's older snapshot.

Fix: register both POST proxies BEFORE farmDataWriteMiddleware and
remove the dead L465 handler.

Validated via the round-trip in
docs/audits/SPLIT_BRAIN_WRITE_PATH_FIX_2026-04-25.md sections 3.2-3.5.

Does NOT close: E.V.I.E./farm-ops-agent + assistant-chat dual-write
drift on LE failure, /api/sync/{rooms,groups} second-authoritative-copy,
sync-service `authoritative` toggle, or reconcileGroupsFromRooms
orphan-drop semantics. See the same doc, section 4.
```

---

## 6. Deploy notes

- This is a Central-only change. LE does not need to be redeployed.
- Cloud Run env-var changes are not needed.
- Per `.github/CLOUD_ARCHITECTURE.md` deploy procedure: build Central from the pushed branch, resolve the digest from Artifact Registry, deploy by digest.
- The validation in section 3 must be run against the new revision before traffic is shifted.
- Branch reconciliation per the README warning: confirm no in-flight Central work on side branches before deploying.

---

## 7. Followup items (separate PRs)

In order of marginal value:

1. **Harden the E.V.I.E. / farm-ops-agent and assistant-chat dual-writes against LE failure.** Today `farmStore.set(...)` runs first and is not rolled back if the subsequent `postToLE`/`writeToLE` fails — only `console.warn` is logged. Either (a) flip the order so LE is the first writer and `farmStore` only updates after LE acks, (b) add a retry queue / reconciliation job, or (c) drop the `farmStore` write entirely and let GET reads continue to proxy through to LE. Highest closure value because it removes drift on every AI-assisted edit when LE is briefly unreachable.
2. **Decide the fate of `/api/sync/{rooms,groups}`.** The push from `lib/sync-service.js:593, 628` writes Central's `farm_data`, and `GET /api/sync/:farmId/rooms`/`/groups` (sync.js:1186, 1236) read it — so the rows are not dead, but they form a second authoritative copy that can diverge from LE. Either delete the pusher + the read handlers and route consumers to LE directly, or document the contract (what reads from sync vs from `/data/*.json`).
3. **Resolve the `authoritative` toggle** in `lib/sync-service.js:55-69`. Either commit (delete `restoreFromCloud()` and the toggle) or define cutover criteria.
4. **Server-side guard against sparse `save-rooms` payloads.** Either reject payloads that lack any existing-room id, or merge missing rooms from the persisted file before reconciling groups (`server-foxtrot.js:7927+`).
