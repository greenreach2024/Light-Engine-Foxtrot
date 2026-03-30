# Phase 3: Data Persistence Migration - Implementation Proposal

**Date**: 2026-02-28  
**Status**: PHASE 3A COMPLETE, PHASE 3B AWAITING REVIEW VALIDATION  
**Estimated Effort**: 4-5 days  
**Risk**: MEDIUM (touches order flow, requires dual-write validation)

---

## Phase 3A Completion Snapshot (2026-02-28)

Completed and verified:
- Commit: `3cef5a2` (`Phase 3A: Add persistent OAuth and reservation stores with dual-write pattern`)
- Files changed: `5` (`+849` / `-267`)
- Implemented stores:
  - `lib/wholesale/oauth-store.js`
  - `lib/wholesale/reservation-store.js`
- Dual-write route integrations:
  - `routes/wholesale/square-oauth.js`
  - `routes/wholesale-reservations.js`
  - `routes/wholesale-sync.js`

Post-review correction applied:
- Fixed async reservation cleanup handling in `server-foxtrot.js` to await `cleanupExpiredReservations()` in startup + interval execution paths.

Phase 3A close status:
- ✅ OAuth state/token persistence path in place
- ✅ Reservation persistence + TTL cleanup path in place
- ✅ Dual-write compatibility maintained for staged cutover
- ✅ Ready to begin Phase 3B (refund/payment persistence)

---

## Executive Summary

**Problem**: 10+ in-memory Maps across wholesale routes lose all data on server restart. This creates critical operational gaps:
- OAuth mid-flow failures (Square authorization tokens lost)
- Inventory reservation race conditions (setTimeout timers lost)
- Refund history invisible after restart
- SLA policies reset to defaults
- Payment webhook deduplication broken

**Solution**: Migrate all volatile Maps to NeDB-backed persistent stores using proven dual-write pattern from `order-store.js`.

**Timeline**: Phase 2 AWS dependency is parallel work (does not block Phase 3). This can proceed immediately.

---

## Investigation Results

### Files Requiring Migration (11 Maps Identified)

| File | Maps | Risk Level | Priority |
|------|------|------------|----------|
| `routes/wholesale/square-oauth.js` | `farmOAuthStates` (2 fields)<br>`farmTokens` (6 fields) | **CRITICAL** | 1 |
| `routes/wholesale-reservations.js` | `reservations` (9 fields + setTimeout) | **CRITICAL** | 1 |
| `routes/wholesale/refunds.js` | `refundRecords` (12 fields)<br>`brokerFeeRecords` (8 fields) | **HIGH** | 2 |
| `routes/wholesale/webhooks.js` | `paymentRecords` (8 fields) | **HIGH** | 2 |
| `routes/wholesale/sla-policies.js` | `slaRules` (9 fields)<br>`substitutionPolicies` (7 fields)<br>`buyerPreferences` (8 fields)<br>`slaViolations` (10 fields)<br>`global.substitutionApprovals` (5 fields) | **MEDIUM** | 3 |
| `routes/wholesale/checkout.js` | `orders` (Map) | **LOW** | 4 |

**Note**: `checkout.js` orders Map already has NeDB backup via `order-store.js`. Only read path needs fixing (GET endpoint should fall through to NeDB on Map miss).

---

## Proposed Architecture

### Pattern: Dual-Write with Shadow-Read Validation

```javascript
// Phase 1: Dual-write (Map + NeDB simultaneously)
async function createReservation(data) {
  // Write to Map (existing behavior)
  reservations.set(data.id, data);
  
  // Write to NeDB (new behavior)
  await reservationsDB.insert(data);
}

// Phase 2: Shadow-read (compare Map vs NeDB, log mismatches)
async function getReservation(id) {
  const mapValue = reservations.get(id);
  const dbValue = await reservationsDB.findOne({ reservation_id: id });
  
  if (mapValue && !dbValue) {
    console.warn(`[Shadow-Read] Mismatch: ${id} in Map but not DB`);
  }
  
  return mapValue; // Still trust Map for reads
}

// Phase 3: Flip read source (feature flag)
const READ_FROM_DB = process.env.WHOLESALE_READ_FROM_DB === 'true';

async function getReservation(id) {
  if (READ_FROM_DB) {
    return reservationsDB.findOne({ reservation_id: id });
  }
  return reservations.get(id);
}

// Phase 4: Retire Map (after stability window)
async function getReservation(id) {
  return reservationsDB.findOne({ reservation_id: id });
}
```

### New NeDB Stores (Following order-store.js Pattern)

| Store | File | Purpose |
|-------|------|---------|
| **oauthStatesDB** | `data/wholesale-oauth-states.db` | OAuth CSRF tokens (10 min TTL) |
| **oauthTokensDB** | `data/wholesale-oauth-tokens.db` | Encrypted farm Square tokens |
| **reservationsDB** | `data/wholesale-reservations.db` | Inventory holds (15 min TTL default) |
| **refundsDB** | `data/wholesale-refunds.db` | Refund transaction records |
| **brokerFeesDB** | `data/wholesale-broker-fees.db` | Broker fee reversal records |
| **paymentRecordsDB** | `data/wholesale-payment-records.db` | Payment webhook deduplication |
| **slaPoliciesDB** | `data/wholesale-sla-policies.db` | SLA rules + substitution policies |
| **buyerPreferencesDB** | `data/wholesale-buyer-preferences.db` | Per-buyer SLA/substitution prefs |
| **slaViolationsDB** | `data/wholesale-sla-violations.db` | SLA breach audit log |

---

## Implementation Plan

### ✅ Pre-Conditions Met

Validated from investigation:
- ✅ NeDB pattern proven working in `order-store.js` (600s autocompaction)
- ✅ Unique indexes support exists (`ensureIndex({ fieldName: 'id', unique: true })`)
- ✅ Query operators support exists (`$lt`, `$gte`, `$ne` for TTL cleanup)
- ✅ No schema migrations required (NeDB is schemaless)

### Phase 3A: Critical Infrastructure (Priority 1 - 2 days)

**1. OAuth Token Store** (`lib/wholesale/oauth-store.js`)
- Create NeDB stores for `oauthStatesDB`, `oauthTokensDB`
- Add encryption layer (reuse existing AES-256-GCM from square-oauth.js)
- Implement CRUD: `saveState`, `getState`, `saveTokens`, `getTokens`, `refreshTokens`
- Add TTL cleanup for expired OAuth states (10 min)

**2. Inventory Reservation Store** (`lib/wholesale/reservation-store.js`)
- Create NeDB store for `reservationsDB`
- Replace `setTimeout` with periodic cleanup job (run every 60s, query for `expires_at < NOW()`)  
- Implement CRUD: `createReservation`, `getReservation`, `releaseReservation`, `commitReservation`
- Fix real inventory lookup (replace `available = 100` mock with actual fetch from `public/data/wholesale-products.json`)

**3. Modify Routes to Use Stores**
- `routes/wholesale/square-oauth.js`: Import oauth-store, dual-write to Map + NeDB
- `routes/wholesale-reservations.js`: Import reservation-store, dual-write to Map + NeDB

**Testing**:
- ✅ OAuth flow: Start → Restart server → Complete (must succeed)
- ✅ Reservation: Create → Restart → Read (must persist)
- ✅ Reservation TTL: Create with 1 min expiry → Wait 61s → Verify auto-released

---

### Phase 3B: Financial Records (Priority 2 - 1 day)

**1. Refund Store** (`lib/wholesale/refund-store.js`)
- Create NeDB stores for `refundsDB`, `brokerFeesDB`
- Implement CRUD: `saveRefund`, `getRefund`, `listRefunds`, `saveBrokerFee`, `getBrokerFee`

**2. Payment Webhook Store** (`lib/wholesale/payment-store.js`)
- Create NeDB store for `paymentRecordsDB`
- Add idempotency check: `hasProcessedWebhook(webhookId)` (prevents duplicate charges)
- Implement CRUD: `recordPayment`, `getPayment`, `listPayments`

**3. Modify Routes**
- `routes/wholesale/refunds.js`: Import refund-store, dual-write
- `routes/wholesale/webhooks.js`: Import payment-store, add idempotency gate

**Testing**:
- ✅ Refund: Create → Restart → Read (must persist)
- ✅ Webhook: Send duplicate → Verify second call returns 200 but doesn't reprocess

---

### Phase 3C: SLA & Policies (Priority 3 - 1 day)

**1. SLA Store** (`lib/wholesale/sla-store.js`)
- Create NeDB stores for `slaPoliciesDB`, `buyerPreferencesDB`, `slaViolationsDB`
- Seed default SLA rules on first boot (if DB empty)
- Implement CRUD: `getSlaRule`, `saveSlaRule`, `getBuyerPreferences`, `saveBuyerPreferences`, `recordViolation`

**2. Modify Routes**
- `routes/wholesale/sla-policies.js`: Import sla-store, dual-write
- Remove `global.substitutionApprovals` → migrate to `slaPoliciesDB` with `type: 'approval'`

**Testing**:
- ✅ SLA rule: Create custom rule → Restart → Verify rule persists
- ✅ Default rules: Fresh DB → Verify 3 default SLA rules auto-seeded

---

### Phase 3D: Checkout Read Fix (Priority 4 - 2 hours)

**Scope**: Fix `routes/wholesale/checkout.js` GET endpoint to read from NeDB on Map miss

**Change**:
```javascript
// OLD (lines 340-350 in checkout.js)
router.get('/:orderId', async (req, res) => {
  const order = orders.get(req.params.orderId); // Map only
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
  res.json({ ok: true, order });
});

// NEW
router.get('/:orderId', async (req, res) => {
  let order = orders.get(req.params.orderId);
  
  // Fallback to NeDB if not in Map
  if (!order) {
    order = await getOrder(req.params.orderId); // Already imported from order-store.js
  }
  
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
  res.json({ ok: true, order });
});
```

**Testing**:
- ✅ Order: Execute checkout → Restart → GET order (must return data from NeDB)

---

## Deployment Strategy

### Feature Flag Approach

```bash
# Phase 3A-C: Dual-write mode (default)
WHOLESALE_READ_FROM_DB=false  # Reads from Map, writes to both

# Phase 3D: Flip read source (after 48h stability window)
WHOLESALE_READ_FROM_DB=true   # Reads from DB, writes to both

# Phase 3E: Retire Maps (after 7 day stability window)
# Remove Map declarations, Map.set/get calls from code
```

### Rollback Plan

**If DB writes fail**:
1. Set `WHOLESALE_READ_FROM_DB=false` (revert to Map reads)
2. Existing Map writes continue working (no data loss)
3. Investigate DB write errors, fix, redeploy
4. Retry with dual-write

**If DB reads return stale data**:
1. Shadow-read logs will show Map vs DB mismatches
2. Root cause analysis (race condition? NeDB compaction issue?)
3. Fix identified issue in store module
4. Keep Map as read source until fixed

### Verification Checklist

**Pre-Deploy**:
- [ ] All 9 store modules created and syntax-validated
- [ ] Unit tests pass for each store (basic CRUD)
- [ ] Integration tests pass (OAuth flow, reservation flow, refund flow)
- [ ] `npm run validate-schemas` passes (no data format violations)

**Post-Deploy (Day 1)**:
- [ ] Monitor shadow-read mismatch logs (expect 0 mismatches)
- [ ] Monitor NeDB file sizes (should grow, not shrink)
- [ ] Restart test: Create data → Restart server → Read data (must succeed)
- [ ] TTL cleanup running (reservationsDB, oauthStatesDB)

**Post-Deploy (Day 2)**:
- [ ] Zero Map vs DB mismatches in logs
- [ ] No "Order not found" errors after restart
- [ ] OAuth flows completing successfully after restarts
- [ ] Reservation expiry cleanup working (check every 60s)

**Post-Deploy (Week 1)**:
- [ ] Flip `WHOLESALE_READ_FROM_DB=true` (reads from DB)
- [ ] Monitor for 48h (no errors, no performance degradation)
- [ ] If stable: Approve Phase 3E (retire Maps)

---

## Files to Create (9 New Store Modules)

```
lib/wholesale/
├── oauth-store.js           (OAuth states + tokens)
├── reservation-store.js     (Inventory reservations)
├── refund-store.js          (Refunds + broker fees)
├── payment-store.js         (Payment webhook records)
└── sla-store.js             (SLA rules + buyer preferences + violations)
```

## Files to Modify (5 Route Files)

```
routes/wholesale/
├── square-oauth.js          (Use oauth-store)
├── checkout.js              (Fix GET to read NeDB on Map miss)
├── refunds.js               (Use refund-store)
├── webhooks.js              (Use payment-store + idempotency)
└── sla-policies.js          (Use sla-store)

routes/
└── wholesale-reservations.js (Use reservation-store + real inventory)
```

---

## Risk Analysis

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **NeDB write latency** | Low | Medium | Async writes (don't block responses), 10min autocompaction |
| **Map vs DB race condition** | Medium | Low | Dual-write is atomic per-request (no threading in Node) |
| **TTL cleanup CPU spike** | Low | Low | Cleanup runs every 60s, limits query to 1000 records |
| **OAuth token encryption bug** | Low | High | Reuse existing AES-256-GCM code (already proven) |
| **Reservation setTimeout loss** | High (current) | High | **FIXED** - periodic cleanup query replaces setTimeout |

### Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Data loss during migration** | Low | CRITICAL | Dual-write ensures redundancy, rollback via feature flag |
| **Performance degradation** | Low | Medium | NeDB is fast (~1ms reads), existing order-store.js proves viability |
| **Disk space exhaustion** | Low | Low | Autocompaction every 10 min, monitor disk usage |

---

## Success Criteria

**Phase 3 Exit Gates**:
1. ✅ All 9 volatile Maps migrated to NeDB stores
2. ✅ Server restart tests pass (OAuth, reservations, refunds, SLA all persist)
3. ✅ Zero Map vs DB shadow-read mismatches (48h window)
4. ✅ Reservation TTL cleanup working (no orphaned active reservations)
5. ✅ OAuth flow completes after mid-flow server restart
6. ✅ Payment webhook idempotency prevents duplicate charges
7. ✅ No performance regression (response times < 100ms)

**Blockers to Phase 4 (Payments)**:
- ❌ Phase 3 must complete first (refunds/broker fees need persistence for reconciliation)
- ❌ Phase 2 AWS must complete (HTTPS required before real Square tokens)

---

## Framework Compliance

This proposal follows Agent Skills Framework v1.3.0:

✅ **Investigation-First**: Reviewed all 11 Map usages, studied order-store.js pattern  
✅ **Multi-Agent Review**: Submitting this proposal to Review Agent before implementation  
✅ **Database-Driven**: Migrating hardcoded volatile state to persistent datastore  
✅ **Data Format Standards**: No schema changes, using existing NeDB pattern  
✅ **Deployment Approval Gate**: Explicit user approval required before each phase deploy  

**Proposal Status**: AWAITING REVIEW AGENT VALIDATION

---

## Questions for Review Agent

1. **Dual-write atomicity**: Is per-request sequential write (Map then NeDB) sufficient, or should we wrap in try-catch with rollback?
2. **TTL cleanup strategy**: 60s periodic query vs on-demand lazy deletion (check expiry on read)?  
3. **OAuth token encryption**: Reuse existing AES-256-GCM code or extract to shared crypto utility?
4. **Feature flag naming**: `WHOLESALE_READ_FROM_DB` vs `WHOLESALE_USE_PERSISTENT_STORE`?
5. **Reservation real inventory**: Should we pull from `wholesale-products.json` or add NeDB inventory tracking?

---

**Prepared by**: Implementation Agent  
**Next Step**: @ReviewAgent - Please validate approach, answer questions, flag any concerns before implementation begins
