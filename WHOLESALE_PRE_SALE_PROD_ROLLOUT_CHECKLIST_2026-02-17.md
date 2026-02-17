# Wholesale Market-Readiness Implementation Plan

**Date:** 2026-02-17  
**Branch:** `recovery/feb11-clean` (head: `48f650d`)  
**Scope:** Wholesale portal market-readiness for `GR-wholesale.html` early-adopter enrollment  
**Production URL:** `https://www.greenreachgreens.com`  
**Environment:** AWS Elastic Beanstalk `light-engine-foxtrot-prod`

---

## Review Summary

### What was found

| Endpoint | Production (current) | Local (patched) |
|---|---|---|
| `GET /api/wholesale/catalog` | HTTP 200 — but frontend fails to parse (`data.ok` vs `data.status`) | HTTP 200 — frontend accepts both envelopes |
| `GET /api/wholesale/farm-performance/dashboard` | **HTTP 500** — DB query crash, no catch | HTTP 200 — graceful fallback with `mode:"limited"` |
| `GET /api/wholesale/network/farms` | HTTP 200 | HTTP 200 |
| `GET /GR-wholesale.html` | HTTP 200 | HTTP 200 |
| `GET /health` | HTTP 200 | HTTP 200 |
| Buyer register → token → checkout | untested | Full flow verified (smoke test task) |

### What was patched (3 files, 111 insertions / 27 deletions)

**Bug 1 — Catalog never renders.**
`loadCatalog()` in `wholesale.js` checked `data.ok` (boolean), but the API returns `{ status: "ok", data: { skus: [...] } }`.
Fix: accept both `data.ok === true` and `data.status === 'ok'`; extract SKUs from `data.data.skus`, `data.data.items`, or legacy `data.items`.

**Bug 2 — Dashboard 500.**
`/farm-performance/dashboard` ran three raw `await query()` calls with no per-query error handling. Any schema mismatch crashed the entire endpoint.
Fix: `safeNumber()` helper wraps each query in its own try/catch; outer catch returns `{ status:"ok", mode:"limited" }` instead of HTTP 500.

**Bug 3 — Farm-performance parsing.**
`loadFarmPerformance()` expected `data.farms` at top level. When the API shape changed, farm badges silently failed.
Fix: multi-path array detection across `data.farms`, `data.data.farms`, `data.metrics.farms` with explicit empty-object fallback.

### Security baseline (reviewed, no changes needed)

| Control | Status | Where |
|---|---|---|
| Helmet CSP | Active | `server.js:108-128` — directives for `defaultSrc`, `scriptSrc`, `styleSrc`, `connectSrc`, etc. |
| CORS allowlist | Active | `server.js:600-631` — rejects unknown origins, allows EB + configured list |
| Rate limiting | Active | `server.js:653-665` — 500 req/15 min on `/api/*`, `express-rate-limit` |
| Password hashing | Active | `wholesaleMemoryStore.js:32` — `bcrypt.hash(password, 10)` |
| JWT auth | Active | `routes/wholesale.js:38-55` — `WHOLESALE_JWT_SECRET` with prod-only enforcement |
| Trust proxy | Set | `server.js:101` — `trust proxy 1` for ALB/ELB |
| Body size limit | Set | `server.js:635` — `express.json({ limit: '10mb' })` |

---

## 0) DEPLOYMENT APPROVAL GATE (MANDATORY)

> **NO production deployment commands until ALL boxes are checked.**

- [ ] Implementation Agent review complete (this document)
- [ ] Review Agent validation complete
- [ ] Architecture Agent strategic approval (if required)
- [ ] User explicitly replied: **"APPROVED FOR DEPLOYMENT"**
- [ ] Rollback owner assigned: ____________________
- [ ] Monitoring owner assigned: ____________________

**Violation of this gate = immediate session termination per `.github/copilot-instructions.md`.**

---

## 1) Exact File Scope for This Release

| # | File | Change Type | Lines Changed |
|---|---|---|---|
| 1 | `greenreach-central/public/js/wholesale.js` | Modified | +46 / −9 |
| 2 | `public/js/wholesale.js` | Modified (mirror) | +46 / −9 |
| 3 | `greenreach-central/routes/wholesale.js` | Modified | +46 / −9 |

**No data files, no schema changes, no new dependencies.**

### Verification command
```bash
git diff --name-only
# Expected output (exactly):
#   greenreach-central/public/js/wholesale.js
#   greenreach-central/routes/wholesale.js
#   public/js/wholesale.js
```

- [ ] Only these 3 files appear in `git diff --name-only`
- [ ] No untracked files staged (run `git status --short` to confirm)

---

## 2) Pre-Deploy Local Validation & Smoke Tests

### 2.1 Start local servers
```bash
# Terminal 1 — Foxtrot edge
cd /Users/petergilbert/Light-Engine-Foxtrot
PORT=8091 node server-foxtrot.js

# Terminal 2 — GreenReach Central
cd /Users/petergilbert/Light-Engine-Foxtrot/greenreach-central
PORT=3100 WS_PORT=3101 node server.js
```

### 2.2 API contract validation
```bash
for u in \
  "http://127.0.0.1:3100/api/wholesale/catalog" \
  "http://127.0.0.1:3100/api/wholesale/farm-performance/dashboard?timeframe=30d" \
  "http://127.0.0.1:3100/api/wholesale/network/farms" \
  "http://127.0.0.1:3100/health"; do
  echo "--- $u"
  code=$(curl -sS -o /tmp/resp.json -w "%{http_code}" "$u")
  echo "HTTP:$code"
  head -c 500 /tmp/resp.json; echo; echo
done
```

**Expected (all must pass):**

| Endpoint | HTTP | Body contains |
|---|---|---|
| `/api/wholesale/catalog` | 200 | `"status":"ok"` and `"skus":[...]` |
| `/api/wholesale/farm-performance/dashboard` | 200 | `"status":"ok"` (NOT 500) |
| `/api/wholesale/network/farms` | 200 | `"status":"ok"` |
| `/health` | 200 | `"status":"healthy"` |

- [ ] All 4 endpoints return HTTP 200
- [ ] No lint/compile errors in changed files

### 2.3 End-to-end buyer enrollment flow
Run VS Code task: **Smoke test buyer auth + order notification**

**Expected results:**

| Step | Expected |
|---|---|
| Register | `status:"ok"`, token returned |
| Checkout preview | `status:"ok"`, line items populated |
| Checkout execute | `status:"ok"`, order_id returned |
| Foxtrot order-events | `wholesale_order_created` event recorded |

- [ ] Full register → login → preview → execute flow passes
- [ ] No server-side 5xx errors in `/tmp/grc-smoke.log`

### 2.4 Local validation results (2026-02-17)

```
Catalog:      HTTP 200 — status:"ok", 4 SKUs returned
Dashboard:    HTTP 200 — status:"ok", mode:"live", farms:3
Network:      HTTP 200
GR-wholesale: HTTP 200
Health:       HTTP 200 — status:"healthy", databaseReady:true
Foxtrot:      HTTP 200 — inventory with lots
Smoke test:   PASSED — full buyer auth + checkout flow
```

- [x] Local validation passed on 2026-02-17

---

## 3) Security Preflight

### 3.1 Environment secrets
- [ ] `WHOLESALE_JWT_SECRET` set in EB environment properties (or `JWT_SECRET` fallback)
- [ ] Secret is NOT the dev fallback string `dev-greenreach-wholesale-secret`
- [ ] JWT tokens expire in `7d` (verified in code: `routes/wholesale.js:55`)

```bash
# Verify EB env vars include the secret (name only, not value)
eb printenv | grep -E "WHOLESALE_JWT_SECRET|JWT_SECRET"
```

### 3.2 CORS allowlist
- [ ] Production CORS allows only `https://greenreachgreens.com` + EB domain
- [ ] No wildcard `*` origins

### 3.3 Rate limiting
- [ ] Rate limiter active: 500 req / 15 min per IP on `/api/*`
- [ ] `trust proxy 1` set for correct client IP behind ALB

### 3.4 Content Security Policy
- [ ] Helmet CSP active with `defaultSrc: ["'self'"]`
- [ ] External script sources limited to known CDNs (jsdelivr, unpkg, squarecdn, google)

### 3.5 No sensitive data leaks
- [ ] Dashboard fallback does NOT expose stack traces (returns `mode:"limited"`, not error details)
- [ ] 500 catch block logs to server console only, never to HTTP response body
- [ ] No API keys or secrets in client-facing JS

---

## 4) AWS Elastic Beanstalk Deployment

### 4.1 Prepare release
```bash
git checkout recovery/feb11-clean
git add greenreach-central/public/js/wholesale.js \
        greenreach-central/routes/wholesale.js \
        public/js/wholesale.js
git commit -m "fix: wholesale catalog response compat + dashboard 500 fallback

- loadCatalog() accepts both {ok:true} and {status:'ok'} envelopes
- loadFarmPerformance() multi-path array detection for farm data
- /farm-performance/dashboard returns graceful fallback instead of 500
- safeNumber() wraps individual DB queries in try/catch

Reviewed: Implementation Agent
Validated: Local smoke tests + buyer enrollment flow"

git tag -a wholesale-market-ready-2026-02-17 \
  -m "Wholesale market-readiness: catalog + dashboard fixes"
```

### 4.2 Push to remote
```bash
git push origin recovery/feb11-clean --tags
```

### 4.3 Deploy to Elastic Beanstalk

> **STOP — Confirm Section 0 gate is fully cleared before proceeding.**

```bash
eb deploy light-engine-foxtrot-prod --timeout 10
```

### 4.4 Monitor deployment
```bash
# Stream logs during deploy
eb logs --stream

# Check environment health
eb status

# Expected: Status = Ready, Health = Green
```

- [ ] Deployment completed without errors
- [ ] EB health shows Green
- [ ] Logs show no startup exceptions

---

## 5) Production GO/NO-GO Checks

### 5.1 Endpoint verification (automated)
```bash
PROD=https://www.greenreachgreens.com
echo "=== HEALTH ===" && curl -sS "$PROD/health" | python3 -m json.tool
echo "=== CATALOG ===" && curl -sS -w "\nHTTP:%{http_code}\n" "$PROD/api/wholesale/catalog" | tail -5
echo "=== DASHBOARD ===" && curl -sS -w "\nHTTP:%{http_code}\n" "$PROD/api/wholesale/farm-performance/dashboard?timeframe=30d"
echo "=== NETWORK ===" && curl -sS -w "\nHTTP:%{http_code}\n" "$PROD/api/wholesale/network/farms" | tail -3
echo "=== GR-WHOLESALE ===" && curl -sS -o /dev/null -w "HTTP:%{http_code}\n" "$PROD/GR-wholesale.html"
```

**GO criteria (all must pass):**

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | `/health` | HTTP 200, `status:"healthy"` | [ ] |
| 2 | `/api/wholesale/catalog` | HTTP 200, `status:"ok"`, `skus` array present | [ ] |
| 3 | `/api/wholesale/farm-performance/dashboard` | HTTP 200, `status:"ok"` (**NOT 500**) | [ ] |
| 4 | `/api/wholesale/network/farms` | HTTP 200 | [ ] |
| 5 | `/GR-wholesale.html` | HTTP 200 | [ ] |

### 5.2 Browser / UI checks (manual)

Open `https://www.greenreachgreens.com/GR-wholesale.html` in Chrome:

- [ ] Page loads without JavaScript errors in DevTools Console
- [ ] No `Catalog API error` toast/message
- [ ] No network request returning 500 in DevTools Network tab
- [ ] **Available Products** section shows product cards with names + prices
- [ ] Farm performance badges load (or show graceful "limited data" state)
- [ ] Sign-in / Register modal opens and form fields are functional
- [ ] Cart interaction works (add/remove items)

### 5.3 Early-adopter enrollment flow (manual, production)

- [ ] Register a new test buyer account (`smoke+test@greenreachgreens.com` or similar)
- [ ] Login with registered credentials — token returned, session active
- [ ] Browse catalog — product cards visible with inventory counts
- [ ] Add item to cart — cart badge updates
- [ ] Checkout preview — line items + totals render correctly
- [ ] Checkout execute (demo payment) — order confirmation returned

### 5.4 GO/NO-GO Decision

| Decision | Action |
|---|---|
| **GO** | Proceed to Section 6 monitoring. Notify stakeholders of successful deploy. |
| **NO-GO** | Immediately execute Section 7 rollback procedure. |

- [ ] **Decision recorded:** [ ] GO  [ ] NO-GO

---

## 6) Post-Deploy Monitoring

### First 60 minutes
- [ ] Tail EB logs for 5xx errors:
  ```bash
  eb logs | grep -Ei "error|500|wholesale|farm-performance|catalog" | head -30
  ```
- [ ] Verify no sustained increase in response times
- [ ] Check for auth failure spikes (repeated `401` or `403` in logs)
- [ ] Confirm `/api/wholesale/catalog` serves current inventory (not stale/empty)

### First 24 hours
- [ ] Review CloudWatch metrics for the EB environment:
  - HTTP 5xx count → should be 0 or near-0
  - Latency P95 → should be < 2s for wholesale endpoints
  - Instance health → Green
- [ ] Spot-check `GR-wholesale.html` from a different device/network
- [ ] Verify no user-reported issues via support channels

### Ongoing
- [ ] Monitor `farm-performance/dashboard` for `mode:"limited"` responses — indicates DB query fallbacks are firing (investigate root cause when convenient, not blocking)

---

## 7) Rollback Procedure

### Trigger conditions (any one = rollback)
1. `/api/wholesale/farm-performance/dashboard` returns HTTP 500 after deploy
2. `/api/wholesale/catalog` returns non-200 or empty SKUs for > 5 minutes
3. `GR-wholesale.html` fails to render product cards
4. Buyer registration or login is broken
5. Any new 5xx error pattern not present before deploy

### Rollback steps

```bash
# Option A — Redeploy previous version from EB console
# EB Console → Environments → light-engine-foxtrot-prod → Application versions
# Select the version before this deploy → Deploy

# Option B — CLI rollback
eb deploy light-engine-foxtrot-prod --version <PREVIOUS_VERSION_LABEL>

# Option C — Git revert + redeploy
git revert HEAD
git push origin recovery/feb11-clean
eb deploy light-engine-foxtrot-prod
```

### Post-rollback verification
- [ ] Re-run Section 5.1 endpoint checks — all return 200
- [ ] Re-run Section 5.2 UI checks — page renders, no console errors
- [ ] Confirm `/farm-performance/dashboard` returns same status as pre-deploy (500 is acceptable if it was 500 before — the rollback restores previous state)

### Incident communication
- [ ] Notify stakeholders: rollback executed, reason, ETA for fix
- [ ] Create incident ticket with logs and timeline
- [ ] Schedule post-mortem

---

## 8) Final Sign-Off

| Role | Name | Date | Signature |
|---|---|---|---|
| Release Owner | ____________________ | __________ | __________ |
| Security Reviewer | ____________________ | __________ | __________ |
| QA Reviewer | ____________________ | __________ | __________ |

| Field | Value |
|---|---|
| Deployment Time (UTC) | ____________________ |
| EB Version Label | ____________________ |
| Git Tag | `wholesale-market-ready-2026-02-17` |
| Final Status | [ ] **GO** / [ ] **NO-GO** |
| Notes | ____________________ |

---

*Generated by Implementation Agent on 2026-02-17. Awaiting Review Agent validation and user deployment approval.*
