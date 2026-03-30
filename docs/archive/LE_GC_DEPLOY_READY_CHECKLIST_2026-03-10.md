# LE ↔ GC Deploy-Ready Checklist (2026-03-10)

## Scope
- Validate production readiness for LE↔GC contract alignment changes:
  - Sync API compatibility (`heartbeat`, `health` alias, config pull)
  - Wholesale compatibility callbacks (`catalog/pricing sync`, `fulfill`, `cancel-by-farm`)
  - Farm-settings auth hardening

## Production Smoke Evidence (app.greenreachgreens.com)

### Healthy / Auth-Gated (expected)
- `GET /health` → `200`
- `POST /api/sync/heartbeat` → `401` (`API key required`) ✅ route exists + auth enforced
- `GET /api/farm-settings/:farmId/pending` → `401` (`API key required`) ✅ route exists + auth enforced

### Missing in Deployed Runtime (unexpected)
- `POST /api/sync/health` → `404` (`Route ... not found`)
- `GET /api/sync/:farmId/config` → `404` (`Route ... not found`)
- `POST /api/wholesale/catalog/sync` → `404` (`Route ... not found`)
- `POST /api/wholesale/pricing/sync` → `404` (`Route ... not found`)
- `POST /api/wholesale/orders/:orderId/cancel-by-farm` → `404` (`Route ... not found`)

## Readiness Verdict
- **Current state: NOT deploy-ready for full LE↔GC compatibility contract.**
- Reason: source code contains required compatibility routes, but production runtime does not expose several of them.

## Likely Root Cause
- Production environment is running an older `greenreach-central` artifact than current repository HEAD (route-mount evidence exists in source, but route-level 404s remain in production).

## Deploy Gate Checklist

1. **GreenReach Central redeploy from current HEAD**
   - Confirm deploy root is `Light-Engine-Foxtrot/greenreach-central`.
   - Ensure `.elasticbeanstalk/config.yml` in that root targets `greenreach-central-prod-v4`.

2. **Post-deploy route verification (required)**
   - `POST /api/sync/heartbeat` expects `401/403` without valid key.
   - `POST /api/sync/health` expects `401/403` without valid key (not `404`).
   - `GET /api/sync/:farmId/config` expects `401/403` without valid key (not `404`).
   - `POST /api/wholesale/catalog/sync` expects `401/403` without valid key (not `404`).
   - `POST /api/wholesale/pricing/sync` expects `401/403` without valid key (not `404`).
   - `POST /api/wholesale/orders/:orderId/fulfill` expects `401/403` without valid key (not `404`).
   - `POST /api/wholesale/orders/:orderId/cancel-by-farm` expects `401/403` without valid key (not `404`).

3. **Authenticated contract check (required)**
   - Run with valid `X-API-Key` + `X-Farm-ID`:
     - `POST /api/sync/heartbeat` returns `200`.
     - `GET /api/sync/:farmId/config` returns `200` with config payload.
     - `POST /api/wholesale/catalog/sync` returns `200` with `synced` count.
     - `POST /api/wholesale/orders/:id/cancel-by-farm` returns `200` + status change.

4. **Regression checks**
   - LE sync client retries queue without error storms.
   - Farm-settings pending/ack continue to work with hardened auth.
   - Wholesale buyer workflows unaffected.

## Quick Verification Commands

```bash
BASE="https://app.greenreachgreens.com"
curl -i -X POST "$BASE/api/sync/heartbeat" -H 'Content-Type: application/json' -d '{}'
curl -i -X POST "$BASE/api/sync/health" -H 'Content-Type: application/json' -d '{}'
curl -i "$BASE/api/sync/FARM-MKLOMAT3-A9D8/config"
curl -i -X POST "$BASE/api/wholesale/catalog/sync" -H 'Content-Type: application/json' -d '{}'
curl -i -X POST "$BASE/api/wholesale/orders/test-order/cancel-by-farm" -H 'Content-Type: application/json' -d '{}'
```

---

**Gate condition to proceed:** all compatibility endpoints return auth errors (`401/403`) when unauthenticated, and success (`200`) with valid credentials.