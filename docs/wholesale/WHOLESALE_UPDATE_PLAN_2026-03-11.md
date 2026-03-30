# Wholesale System Update Plan

**Date:** 2026-03-11  
**Based on:** WHOLESALE_READINESS_INVESTIGATION_2026-03-11.md  
**Goal:** Move wholesale readiness from 5.4/10 → 8+/10 through targeted, verifiable patches.

---

## Wave 1 — Stabilize Ingestion & Catalog (P0)

Everything in Wave 1 must land before any buyer-facing confidence claim.

### 1.1 Populate farm registry credentials in GC database

**Problem:** All 3 registered farms in the `farms` table have `auth_farm_id=null` and `api_key=null` inside their `metadata` JSONB column. The `wholesaleNetworkAggregator` sends no auth headers → farm inventory fetches fail → catalog is empty except for fallback.

**Fix:** SQL migration to populate `metadata` with correct auth credentials for each registered farm. The credentials must match what LE has in `public/data/farm-api-keys.json`.

**File(s):**
- `greenreach-central/config/database.js` — add migration step, or
- One-time SQL via `psql` or admin endpoint

**Action:**
```sql
-- For each farm, update metadata to include auth_farm_id and api_key
-- Values must match LE's farm-api-keys.json entries
UPDATE farms
SET metadata = COALESCE(metadata, '{}'::jsonb) 
  || jsonb_build_object(
    'auth_farm_id', 'FARM_ID_FROM_LE_KEYS',
    'api_key', 'API_KEY_FROM_LE_KEYS'
  )
WHERE farm_id = 'TARGET_FARM_ID';
```

**Prerequisite:** Confirm the `farm_id` values in GC's `farms` table match (or map to) LE's `farm-api-keys.json` entries (`light-engine-demo`, `FARM-MLTP9LVH-B0B85039`).

**Also sync GC's local key file:**
- `greenreach-central/public/data/farm-api-keys.json` — currently only has `light-engine-demo`. Needs `FARM-MLTP9LVH-B0B85039` added (copy from LE's `public/data/farm-api-keys.json`).

**Verification:**
```bash
curl -s https://app.greenreachgreens.com/api/wholesale/network/farms | \
  python3 -c 'import sys,json; d=json.load(sys.stdin); farms=d.get("farms",d.get("data",{}).get("farms",[])); [print(f["farm_id"], "auth:", bool(f.get("auth_farm_id")), "key:", bool(f.get("api_key"))) for f in farms]'
```
**Pass criteria:** All farms show `auth: True key: True`.

---

### 1.2 Validate farm endpoint reachability from GC

**Problem:** `foxtrot.greenreachgreens.com` DNS doesn't resolve. LE EB CNAME timed out on HTTPS. `api_url` values in the farms table may point to unreachable endpoints.

**Fix:** Ensure each farm's `api_url` in the DB points to a reachable URL from GC's VPC/runtime. For Light Engine on EB, this should be the EB environment CNAME or the EB load balancer URL.

**Action:**
1. Confirm LE's reachable URL:
   ```bash
   curl -s http://light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/api/wholesale/inventory
   ```
2. Update `farms.api_url` column for each farm to the verified reachable URL
3. Optionally set up `foxtrot.greenreachgreens.com` DNS (Route53 CNAME → EB environment)

**Verification:**
```bash
curl -s https://app.greenreachgreens.com/api/wholesale/network/aggregate | \
  python3 -c 'import sys,json; d=json.load(sys.stdin); print("errors:", d.get("diagnostics",{}).get("error_count",d.get("error_count","?"))); print("farms_ok:", d.get("diagnostics",{}).get("farms_reporting",d.get("farms_ok","?")))'
```
**Pass criteria:** `errors: 0`, `farms_ok` ≥ 1.

---

### 1.3 Remove hard-coded hotfix catalog bypass

**Problem:** Line ~387 in `greenreach-central/routes/wholesale.js`:
```js
if (true || req.app?.locals?.databaseReady === false) {
```
This permanently forces the "limited" catalog mode, masking whether the DB path works.

**Fix:** Replace with proper feature-flag gating:
```js
if (process.env.WHOLESALE_CATALOG_MODE === 'network' || req.app?.locals?.databaseReady === false) {
```

**File:** `greenreach-central/routes/wholesale.js` — line ~387

**Verification:** After deploy, set env var `WHOLESALE_CATALOG_MODE=network` to keep current behavior safe, then test without it to validate DB path.

---

### 1.4 Confirm catalog breadth after fixes

**Verification (post-deploy of 1.1–1.3):**
```bash
curl -s https://app.greenreachgreens.com/api/wholesale/catalog | \
  python3 -c 'import sys,json; d=json.load(sys.stdin); items=d.get("data",{}).get("skus",d.get("items",[])); print("sku_count:", len(items)); [print(s.get("sku_id","?"), "qty:", s.get("total_qty_available","?"), "farms:", len(s.get("farms",[]))) for s in items[:10]]'
```
**Pass criteria:** `sku_count` > 1, at least 1 farm per SKU, quantities reflect actual crop data (not fallback).

---

## Wave 2 — Order Integrity & Auth Hardening (P0/P1)

### 2.1 Convert checkout execute to synchronous reserve-before-respond

**Problem:** Lines 1296–1436 in `greenreach-central/routes/wholesale.js` — the notify/reserve/confirm calls to farms run inside an unlinked `(async () => { ... })()` IIFE after the HTTP response is already sent. If reservation fails, the buyer already has a confirmed order.

**Fix:** Move reserve calls *before* the response. Keep notify as best-effort.

**File:** `greenreach-central/routes/wholesale.js` — checkout/execute handler (~line 1190–1440)

**Approach:**
```
1. Allocate cart (existing)
2. Reserve inventory at each farm (NEW: synchronous, with rollback on failure)
3. Process payment (existing)
4. If payment succeeds → confirm inventory (synchronous)
5. If payment fails → release reservations (synchronous)
6. Return response
7. Notify farms + email (keep async/best-effort)
```

**Key change:** Extract `reserve()`, `confirm()`, `release()` helper functions from the IIFE and call them inline before `res.json()`. Wrap in try/catch with compensating rollback.

**Verification:** Place a test order (staging), verify LE reservation store shows entry *before* checkout response.

---

### 2.2 Timing-safe API key comparison on LE

**Problem:** `lib/wholesale-auth.js` line ~163: `farmData.api_key !== apiKey` — direct string comparison, vulnerable to timing attacks.

**Fix:**
```js
import { timingSafeEqual } from 'crypto';

// Replace direct comparison with:
const keyBuffer = Buffer.from(farmData.api_key, 'utf8');
const inputBuffer = Buffer.from(apiKey, 'utf8');
if (keyBuffer.length !== inputBuffer.length || !timingSafeEqual(keyBuffer, inputBuffer)) {
  // invalid
}
```

**File:** `lib/wholesale-auth.js` — `verifyApiKey()` function (~line 155)

**Also apply to GC:** `greenreach-central/routes/wholesale.js` — `requireFarmApiKey` middleware (~line 130) uses same pattern.

**Verification:** Existing smoke tests should still pass after change.

---

### 2.3 Replace demo `farm_id` in schedule/pricing endpoints

**Problem:** `routes/wholesale-sync.js` lines 772 and 848 return hard-coded `farm_id: 'demo-farm-1'` with static pickup windows and pricing tiers.

**Fix:** Read actual farm identity from config/environment:
```js
const farmId = process.env.FARM_ID || farmInfo?.farmId || 'light-engine-demo';
```
Replace static pickup windows with configurable schedule from `public/data/` or environment.

**File:** `routes/wholesale-sync.js` — `GET /schedule` (~line 768) and `GET /pricing` (~line 836)

**Verification:**
```bash
curl -s http://localhost:PORT/api/wholesale/schedule | python3 -c 'import sys,json; print(json.load(sys.stdin).get("farm_id"))'
# Should return actual farm ID, not "demo-farm-1"
```

---

## Wave 3 — Fulfillment Consolidation & Testing (P1/P2)

### 3.1 Deduplicate or scope fulfillment route surfaces

**Problem:** Two routers serve fulfillment endpoints under the same `/api/wholesale` base:
- `greenreach-central/routes/wholesale.js` — lines 1859+ (`/orders/:orderId/fulfill`, `/orders/:orderId/cancel-by-farm`, `/admin/orders/:orderId/farms/:farmId/tracking`)
- `greenreach-central/routes/wholesale-fulfillment.js` — (`/order-statuses`, `/tracking-numbers`, `/order-tracking`, `/orders/farm-verify`, `/orders/:orderId/verify`, `/orders/pending`)

**Fix options (choose one):**
- **Option A:** Consolidate all fulfillment routes into `wholesale-fulfillment.js`, remove duplicates from main router
- **Option B:** Scope fulfillment router under a distinct prefix (e.g., `/api/wholesale/fulfillment/...`) to avoid ambiguity
- **Option C:** Keep both but add integration test asserting no route collisions and document the boundary

**Recommendation:** Option A — move farm-callback fulfillment endpoints (`fulfill`, `cancel-by-farm`, tracking) to `wholesale-fulfillment.js` and remove from main router.

**Files:**
- `greenreach-central/routes/wholesale.js` — remove fulfillment handlers (~lines 1859–1950)
- `greenreach-central/routes/wholesale-fulfillment.js` — add consolidated handlers
- `greenreach-central/server.js` — verify mount points

---

### 3.2 Canonical order state machine

**Problem:** Order status transitions are set ad-hoc across multiple handlers (`fulfillment_status = 'fulfilled'`, `status = 'cancelled'`, etc.) with no single enforced state machine.

**Fix:** Create `greenreach-central/services/orderStateMachine.js`:
```js
const TRANSITIONS = {
  'pending':    ['confirmed', 'cancelled'],
  'confirmed':  ['processing', 'cancelled'],
  'processing': ['shipped', 'cancelled'],
  'shipped':    ['delivered', 'returned'],
  'delivered':  [],
  'cancelled':  [],
  'returned':   []
};

export function transitionOrder(order, newStatus) {
  const current = order.status || 'pending';
  if (!TRANSITIONS[current]?.includes(newStatus)) {
    throw new Error(`Invalid transition: ${current} → ${newStatus}`);
  }
  order.status = newStatus;
  order.status_updated_at = new Date().toISOString();
  return order;
}
```

**Apply to:** All handlers that mutate order status in `wholesale.js` and `wholesale-fulfillment.js`.

---

### 3.3 Gate deploys with wholesale smoke tests

**Problem:** `scripts/ci/run-wholesale-smokes.sh` exists and covers buyer auth, checkout preview, inventory reservation, and delivery quote — but it's not required before deploy.

**Fix:** Add smoke gate to deploy workflow:
1. In CI/CD pipeline (or local deploy script), run smokes before `eb deploy`
2. Add pass/fail exit code check

**Approach:**
```bash
# Pre-deploy gate
bash scripts/ci/run-wholesale-smokes.sh || { echo "Smoke tests failed — aborting deploy"; exit 1; }
eb deploy greenreach-central-prod-v4 --staged
```

**Enhancement:** Add network aggregate test to smoke script:
```bash
# Test: catalog returns >0 SKUs from real farms
CATALOG=$(curl -fsS "$CENTRAL_BASE/api/wholesale/catalog")
assert_json_field "$CATALOG" "payload.data?.skus?.length > 0 || payload.items?.length > 0" \
  "Catalog should have at least 1 SKU"
```

---

## Execution Sequence & Dependencies

```
Wave 1 (can be done in one session):
  1.1 Farm credentials ──┐
  1.2 Farm URL fix ───────┤──→ 1.4 Verify catalog breadth
  1.3 Remove hotfix ──────┘
  
Wave 2 (after Wave 1 verified):
  2.1 Synchronous checkout ──→ test with staging order
  2.2 Timing-safe auth (independent)
  2.3 Demo ID cleanup (independent)

Wave 3 (after Wave 2 stable):
  3.1 Fulfillment consolidation
  3.2 State machine
  3.3 Smoke gate
```

---

## Risk Assessment per Wave

| Wave | Risk if skipped | Effort | Impact |
|------|----------------|--------|---------|
| 1 | Catalog stays at 1 fallback SKU; system unusable for real orders | 2–4 hrs | Critical — unlocks everything |
| 2 | Orders accepted without inventory guarantee; auth timing leak | 4–8 hrs | High — order reliability |
| 3 | State drift under failure; regression risk on deploy | 4–6 hrs | Medium — operational quality |

---

## Verification Checklist (End State)

- [ ] `/api/wholesale/network/farms` — all farms have `auth_farm_id` and `api_key`
- [ ] `/api/wholesale/network/aggregate` — `error_count: 0`
- [ ] `/api/wholesale/catalog` — `sku_count > 1`, no `(fallback)` in names
- [ ] Checkout execute reserves inventory *before* returning 200
- [ ] `verifyApiKey()` uses `timingSafeEqual`
- [ ] `/api/wholesale/schedule` returns actual farm ID
- [ ] Smoke tests pass end-to-end before deploy
- [ ] No duplicate fulfillment route paths
