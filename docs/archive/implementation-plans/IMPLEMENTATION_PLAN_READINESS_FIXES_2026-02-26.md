# Implementation Plan: Production Readiness Shortfall Corrections

**Date:** 2026-02-26  
**Source:** `END_TO_END_READINESS_REPORT_2026-02-26.md`  
**Branch:** `main` @ `d403a77`  
**Status:** AWAITING REVIEW

---

## Overview

21 items organized into 5 phases. Each phase is self-contained and deployable independently.
Phases 1-2 are prerequisites for any revenue-generating transaction.
Phases 3-5 improve resilience, observability, and code quality.

**Estimated total effort:** ~12-14 working days

---

## Phase 1: Security Hardening (CRITICAL — Before Any Pilot)

**Effort:** ~3 hours | **Risk:** LOW (all are config + removal changes) | **Deploy:** Yes

### 1.1 Remove Hardcoded RDS Credentials

**File:** [routes/auth.js](routes/auth.js#L16-L22)  
**Problem:** Production RDS hostname and password committed as fallback values  
**Change:**
- L17: Replace `'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com'` fallback → throw error if `RDS_HOSTNAME` not set
- L20: Replace `'LePphcacxDs35ciLLhnkhaXr7'` fallback → throw error if `RDS_PASSWORD` not set
- After deploy: Rotate the RDS password in AWS Console and update EB env vars

**Validation:** `grep -rn "LePphcacxDs35ciLLhnkhaXr7" routes/` returns 0 results

### 1.2 Remove Demo Credentials Bypass

**File:** [routes/auth.js](routes/auth.js#L182-L186)  
**Problem:** `demo-farm-001` / `admin@demo.farm` / `demo123` bypasses all auth and grants ADMIN JWT  
**Change:**
- Delete the `isDemoLogin` block entirely (L182-L196) OR gate it behind `DEMO_MODE=true` env var
- Recommended: Gate behind env var — preserves demo capability for trade shows when explicitly enabled

**Validation:** Attempt login with demo credentials → should fail unless `DEMO_MODE=true`

### 1.3 Set JWT Secrets in Production

**File:** [greenreach-central/routes/auth.js](greenreach-central/routes/auth.js#L13)  
**Problem:** `JWT_SECRET` falls back to `'greenreach-jwt-secret-2025'` — anyone can forge tokens  
**Change:**
- Replace fallback with: `throw new Error('JWT_SECRET environment variable is required')`
- Run `eb setenv JWT_SECRET=$(openssl rand -hex 32)` on Central EB environment
- Run `eb setenv JWT_SECRET=$(openssl rand -hex 32)` on Foxtrot EB environment
- Set `WEBHOOK_SECRET=$(openssl rand -hex 32)` on Foxtrot EB environment

**Validation:** `curl /health` still returns 200; create buyer account with new secret works

### 1.4 Remove Verbose Auth Debug Logging

**File:** [greenreach-central/middleware/adminAuth.js](greenreach-central/middleware/adminAuth.js)  
**Problem:** 9 `console.log` statements leak decoded JWT payloads + token prefixes to CloudWatch  
**Change:** Remove or wrap in `if (process.env.DEBUG_AUTH)` guard:
- L51: `console.log('[verifyAdminToken] Verifying token...')`
- L53: `console.log('[verifyAdminToken] Secret loaded, length:', ...)`
- **L55**: `console.log('[verifyAdminToken] Token valid, decoded:', decoded)` ← **CRITICAL: logs full payload**
- L94-95: Token length + preview logs
- **L100**: `console.log('[adminAuthMiddleware] Decoded payload:', decoded)` ← **CRITICAL: logs full payload**
- L103, L184: Status logs (low risk but noisy)

**Validation:** `grep -n "console.log" greenreach-central/middleware/adminAuth.js` shows 0 unguarded auth logs

### 1.5 Add Auth to Wholesale Order Endpoints

**File:** [routes/wholesale-orders.js](routes/wholesale-orders.js#L1-L16)  
**Problem:** No authentication middleware — any caller can create/verify/cancel orders  
**Change:**
- Import farm auth middleware (e.g., `requireFarmApiKey` from existing `edge-wholesale-webhook.js` pattern)
- Apply `router.use(requireFarmApiKey)` to mutation endpoints (POST/PUT/PATCH)
- Keep `GET` endpoints readable for Central's order status polling

**Validation:** `POST /api/wholesale/orders/farm-verify` without API key → 401

### 1.6 Add Auth to Farm Data GET Endpoints on Central

**File:** [greenreach-central/routes/sync.js](greenreach-central/routes/sync.js)  
**Problem:** GET endpoints for farm rooms/groups/inventory/devices/telemetry are fully unauthenticated  
**Lines:** L772, L822, L930, L1085, L1140, L1258  
**Change:**
- Add `authenticateFarm` middleware to all `GET /:farmId/*` routes
- OR add a lighter `requireKnownFarm` middleware that validates the `farmId` exists in the farms table

**Validation:** `GET /api/sync/FAKE-FARM/rooms` → 401 or 404

### 1.7 Fix Sync API Key Validation

**File:** [greenreach-central/routes/sync.js](greenreach-central/routes/sync.js#L110-L145)  
**Problem:** `authenticateFarm` only validates key format (`/^[a-f0-9]{64}$/`) — any matching string passes  
**Change:**
- Query `farms` table or `farm-api-keys.json` to verify the key belongs to the claimed farm
- Pattern exists in Foxtrot's `edge-wholesale-webhook.js` — reuse same approach
- L138-139 comment says `"In production, validate against database"` — do it

**Validation:** Random 64-char hex key → 401; real farm key → 200

---

## Phase 2: Payment & Checkout Fixes (CRITICAL — Before Revenue)

**Effort:** ~1 day | **Risk:** MEDIUM (touches order flow) | **Deploy:** Yes

### 2.1 Fix Catalog URL — Replace localhost Hardcode

**File:** [routes/wholesale/checkout.js](routes/wholesale/checkout.js#L74) and [L162](routes/wholesale/checkout.js#L162)  
**Problem:** `const catalogUrl = 'http://localhost:8091/api/wholesale/catalog'` — Central can't fetch Foxtrot catalog in production  
**Change:**
- Replace both occurrences with: `const catalogUrl = process.env.FOXTROT_API_URL ? \`${process.env.FOXTROT_API_URL}/api/wholesale/catalog\` : 'http://localhost:8091/api/wholesale/catalog'`
- Set `FOXTROT_API_URL` in Central's EB env vars pointing to Foxtrot's EB CNAME

**Validation:** Checkout preview from Central production fetches real Foxtrot catalog

### 2.2 Make Broker Fee Configurable

**File:** [routes/wholesale/checkout.js](routes/wholesale/checkout.js#L87) and [L176](routes/wholesale/checkout.js#L176)  
**Problem:** `broker_fee_percent: 10.0` hardcoded in both preview and execute  
**Change:**
- Add at top of file: `const BROKER_FEE_PERCENT = parseFloat(process.env.BROKER_FEE_PERCENT || '10.0')`
- Replace both `10.0` references with `BROKER_FEE_PERCENT`

**Validation:** Set `BROKER_FEE_PERCENT=12` → preview shows 12% fee

### 2.3 Fix Checkout Order GET to Read NeDB

**File:** [routes/wholesale/checkout.js](routes/wholesale/checkout.js#L44)  
**Problem:** `const orders = new Map()` — order lookup `GET /:orderId` reads from Map, not NeDB. Orders invisible after restart.  
**Change:**
- In the `GET /:orderId` handler, fall through to `orderStore.getOrder(orderId)` when Map miss
- Pattern: `const order = orders.get(orderId) || await orderStore.getOrder(orderId)`

**Validation:** Restart server → `GET /api/wholesale/checkout/{existing_order_id}` returns data

### 2.4 Configure Payment Credentials (Ops Task)

**No code change — environment configuration only**  
**Problem:** Square/Stripe credentials fall back to demo tokens  
**Change:**
- `eb setenv SQUARE_ACCESS_TOKEN=<real> SQUARE_APPLICATION_ID=<real> SQUARE_LOCATION_ID=<real> SQUARE_ENVIRONMENT=production` on relevant EB env
- Replace hardcoded `farmLocationId: 'demo-location-id'` at checkout.js with env lookup
- OR: Accept demo mode for pilot and defer real payment until Square merchant onboarding complete

**Validation:** Checkout execute with Square creates real charge (sandbox test first)

---

## Phase 3: Data Persistence — Eliminate Restart Data Loss

**Effort:** ~4 days | **Risk:** MEDIUM | **Deploy:** Yes (per-batch)

### 3.1 Migrate Refund Records to NeDB

**File:** [routes/wholesale/refunds.js](routes/wholesale/refunds.js#L15-L16)  
**Problem:** `refundRecords` and `brokerFeeRecords` Maps — all refund history lost on restart  
**Change:**
- Create NeDB store: `data/wholesale-refunds.db` + `data/wholesale-broker-fees.db`
- Replace `Map.set/get/has` with NeDB `insert/findOne/find`
- Use same `nedb-promises` pattern as `order-store.js`

**Validation:** Create refund → restart server → GET refund by ID returns data

### 3.2 Migrate Reservation Store to NeDB + Real Inventory

**File:** [routes/wholesale-reservations.js](routes/wholesale-reservations.js#L11) and [L57-L58](routes/wholesale-reservations.js#L57)  
**Problem:** (a) Reservations in-memory Map, (b) `available = 100` mock hardcode  
**Change:**
- Replace `reservations = new Map()` with NeDB `data/wholesale-reservations.db`
- Replace `available = 100` with real inventory lookup from Foxtrot's inventory system (read `public/data/wholesale-products.json` or Foxtrot inventory API)
- Replace `setTimeout` TTL with NeDB query for expired records on periodic cleanup

**Validation:** Reserve SKU → restart → reservation persists; reserve qty > available → error

### 3.3 Migrate Fulfillment Records to NeDB

**File:** [routes/wholesale-fulfillment.js](routes/wholesale-fulfillment.js#L23) and [L416](routes/wholesale-fulfillment.js#L416)  
**Problem:** `fulfillmentRecords` and `global.invoiceRecords` Maps — fulfillment tracking lost on restart  
**Change:**
- Create NeDB store: `data/wholesale-fulfillment.db`
- Replace Map operations with NeDB CRUD
- Include invoice records in same or separate collection

**Validation:** Update fulfillment status → restart → status persists

### 3.4 Migrate SLA & Substitution Policies to NeDB

**File:** [routes/wholesale/sla-policies.js](routes/wholesale/sla-policies.js#L17-L20)  
**Problem:** 4 Maps + `global.substitutionApprovals` — all SLA config lost on restart  
**Change:**
- Create NeDB store: `data/wholesale-sla.db` with `type` field discriminator (rule/policy/preference/violation)
- Replace 5 Maps with NeDB queries filtered by type
- Load initial SLA rules from seed data on first run

**Validation:** Create SLA rule → restart → rule persists

### 3.5 Migrate Square OAuth State to NeDB

**File:** [routes/wholesale/square-oauth.js](routes/wholesale/square-oauth.js#L33-L34)  
**Problem:** OAuth state tokens and farm Square tokens lost on restart — breaks mid-flow OAuth  
**Change:**
- Create NeDB store: `data/square-oauth.db`
- Replace `farmOAuthStates` and `farmTokens` Maps with NeDB
- Add TTL cleanup for expired OAuth states (10 min TTL)

**Validation:** Start OAuth flow → restart → complete OAuth flow succeeds

### 3.6 Migrate Payment Webhook Records to NeDB

**File:** [routes/wholesale/webhooks.js](routes/wholesale/webhooks.js#L14)  
**Problem:** `paymentRecords = new Map()` — payment status tracking lost on restart  
**Change:**
- Create NeDB store: `data/wholesale-payment-records.db`
- Replace Map with NeDB
- Add idempotency check (see Phase 4, item 4.2) simultaneously

**Validation:** Receive payment webhook → restart → payment record accessible

### 3.7 Uncomment `closeDatabase()` in Central Shutdown

**File:** [greenreach-central/server.js](greenreach-central/server.js#L2529)  
**Problem:** `// await closeDatabase()` commented out — DB connections leak on deploys  
**Change:**
- Uncomment: `await closeDatabase()`
- Ensure `closeDatabase()` in `config/database.js` calls `pool.end()` with timeout

**Validation:** Deploy → check RDS connection count doesn't grow over multiple deploys

---

## Phase 4: Reliability & Error Handling

**Effort:** ~3 days | **Risk:** LOW-MEDIUM | **Deploy:** Yes

### 4.1 Fix Foxtrot `/api/health` Endpoint

**File:** [routes/health.js](routes/health.js#L12-L13)  
**Problem:** Imports `broad-health-monitor.js` and `health-scorer.js` which require env sensor data not available on EB — entire router fails to mount  
**Change:**
- Wrap imports in try-catch at module level, set fallback stubs if import fails
- Add a bare `GET /` handler that returns `{ ok: true, farm_id, uptime }` without requiring sensor data
- Keep sub-paths (`/scan`, `/score`, `/insights`) guarded by availability check

**Validation:** `curl /api/health` → `{ ok: true, ... }` (not 502)

### 4.2 Add Square Webhook Idempotency

**File:** [routes/wholesale/webhooks.js](routes/wholesale/webhooks.js#L37)  
**Problem:** No deduplication — re-delivered Square webhooks are processed multiple times  
**Change:**
- Add `processedEventIds` Set (same pattern as `fulfillment-webhooks.js`)
- Check `event_id` before processing; skip if already seen
- Cap Set at 10,000 entries (same as fulfillment-webhooks pattern)
- If doing Phase 3.6 simultaneously, use NeDB for idempotency instead of in-memory Set

**Validation:** Send same webhook twice → second returns 200 with `{ already_processed: true }`

### 4.3 Fix `uncaughtException` Handler

**File:** [server-foxtrot.js](server-foxtrot.js#L2074-L2084)  
**Problem:** `uncaughtException` and `unhandledRejection` handlers log but don't exit — process can continue in corrupted state  
**Change:**
```js
process.on('uncaughtException', (error) => {
  console.error('FATAL Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  // Give time for logs to flush, then exit
  setTimeout(() => process.exit(1), 1000);
});
```
- Add same handlers to `greenreach-central/server.js` (currently has none)
- EB will auto-restart the process after exit

**Validation:** Trigger uncaught exception in dev → process exits with code 1

### 4.4 Add DB Reconnection to Central

**File:** [greenreach-central/config/database.js](greenreach-central/config/database.js)  
**Problem:** No retry/backoff on startup failure; pool error handler only logs  
**Change:**
- Add exponential backoff retry in `initDatabase()`: 3 attempts with 2s/4s/8s delay
- Add pool `error` event handler that attempts reconnection
- Change `isDatabaseAvailable()` from `return pool !== null` to actual `SELECT 1` probe

**Validation:** Kill RDS temporarily → Central logs retry attempts → reconnects when RDS returns

### 4.5 Fix `config/database.js` Stub on Foxtrot

**File:** [config/database.js](config/database.js)  
**Problem:** Returns empty rows for all queries — Activity Hub operates on phantom data  
**Change:** Two options:
- **Option A (recommended):** Make Activity Hub use `order-store.js` (NeDB) instead of PostgreSQL pool — matching the pattern established in Phase 2+3 refunds/webhooks fixes
- **Option B:** Replace stub with real PostgreSQL connection (requires RDS access from Foxtrot EB)

**Validation:** Activity Hub `GET /pending` returns real orders from NeDB/DB, not empty array

---

## Phase 5: Infrastructure & Operations

**Effort:** ~2 days | **Risk:** LOW | **Deploy:** Varies

### 5.1 Configure HTTPS for Foxtrot

**Problem:** Foxtrot EB serves HTTP only — API keys, JWTs, farm data in cleartext  
**Change:**
- Option A: Add CloudFront distribution in front of Foxtrot EB (matches Central pattern)
- Option B: Add ACM certificate + HTTPS listener on EB load balancer
- Update CORS allowlist to include new HTTPS domain
- Set `FOXTROT_API_URL` in Central env vars to HTTPS endpoint

**Validation:** `curl -I https://<foxtrot-domain>/api/wholesale/inventory` → 200

### 5.2 Clean Up Broken Foxtrot prod-v2 Environment

**Problem:** CloudFormation stack in `DELETE_FAILED` state (stuck security group)  
**Change:**
- Identify and delete the dependent ENI/resource blocking security group deletion
- `aws cloudformation delete-stack --stack-name awseb-e-bsvhjzkmn8-stack --region us-east-1`
- If stuck, use `--retain-resources AWSEBLoadBalancerSecurityGroup` to skip the SG
- Then `eb terminate light-engine-foxtrot-prod-v2`

**Validation:** `eb list` shows only `light-engine-foxtrot-prod-v3`

### 5.3 Update EB Platform Versions

**Problem:** Both environments on non-recommended platform versions  
**Change:**
- `eb platform update` for each environment during maintenance window
- Test in staging first if available

**Validation:** `eb status` shows recommended platform version; no alerts

### 5.4 Add CI Smoke Test to Build

**File:** [buildspec.yml](buildspec.yml)  
**Problem:** `buildspec.yml` installs deps and verifies files but never runs tests  
**Change:**
- Add `npm test` step after install phase
- Add `npm run validate-schemas` step
- Consider adding a lightweight smoke test that starts the server, hits `/health`, then exits

**Validation:** Intentionally break a test → CodeBuild fails before deploy

---

## Implementation Sequence

```
Phase 1 (Security)        ─── 3 hours  ──→ Deploy + rotate RDS password
  ↓
Phase 2 (Checkout/Payment) ── 1 day    ──→ Deploy
  ↓
Phase 3 (Persistence)     ─── 4 days   ──→ Deploy per batch (3.1-3.2, 3.3-3.5, 3.6-3.7)
  ↓
Phase 4 (Reliability)     ─── 3 days   ──→ Deploy
  ↓
Phase 5 (Infrastructure)  ─── 2 days   ──→ Deploy (HTTPS requires DNS/CloudFront setup)
```

Each phase produces a deployable commit. Each deploy follows the Deployment Approval Gate:
1. Implementation Agent proposes changes with line-by-line diffs
2. Review Agent validates
3. User approves with "APPROVED FOR DEPLOYMENT"
4. Deploy to EB

---

## Success Criteria

| Phase | Criteria |
|-------|---------|
| Phase 1 | Zero hardcoded credentials in source; all auth endpoints require valid tokens; verbose logs removed |
| Phase 2 | Central checkout preview fetches real Foxtrot catalog in production; orders survive restart |
| Phase 3 | All 16 in-memory Maps replaced with NeDB; server restart loses zero business data |
| Phase 4 | Foxtrot `/api/health` returns 200; Square webhooks deduplicated; process exits on fatal error |
| Phase 5 | Foxtrot serves HTTPS; broken EB environment cleaned up; CI runs tests on deploy |

**End state:** System grade moves from C- (Security) / D (Payments) → B+ across all dimensions. Ready for controlled revenue-generating pilot with real payment processing.

---

*This plan is ready for Review Agent validation. Submit to @ReviewAgent with: "Validate implementation plan for 21 production readiness fixes across 5 phases."*
