# Implementation Plan v2: Production Readiness Shortfall Corrections

**Date:** 2026-02-26  
**Branch:** recovery/feb11-clean  
**Basis:** Architecture review of readiness findings and prior plan  
**Status:** Architecture Conditional Approval (execution allowed with phase gates)

---

## Architecture Verdict

The previous plan covered the right problem set but required sequencing and gate corrections.
This v2 plan is implementation-ready with:
- fail-fast security posture,
- explicit auth boundaries,
- dependency-safe migration sequencing,
- staged payment cutover,
- rollback criteria per phase.

---

## Target Architecture Decisions

- **Secrets policy:** no production fallback secrets. Missing critical secrets must fail startup.
- **Auth boundaries:** farm-private reads and all mutations require authenticated farm identity with ownership checks.
- **Persistence migration:** Map-to-persistent cutover must use dual-write then dual-read validation before read flip.
- **Payments:** three-stage progression demo → sandbox → production, with idempotent webhook and reconciliation prerequisites.
- **Observability:** split liveness/readiness health checks; structured logs + alert thresholds.

---

## Phase 0 — Preconditions and Guardrails (NEW)

**Goal:** Establish safe execution baseline before touching business logic.

### Scope
1. Secret/env preflight check in startup path (fail-fast when prod critical env vars missing).
2. CI/pipeline preflight gate includes schema validation.
3. Rollback runbook finalized for each phase.
4. Baseline smoke evidence captured before any implementation work.

### Critical variables (must exist in prod)
- JWT_SECRET
- WHOLESALE_JWT_SECRET
- WEBHOOK_SECRET
- RDS_HOSTNAME / RDS_PASSWORD
- FOXTROT_API_URL (Central side)

### Entry Gate
- None.

### Exit Gate
- Startup fails if critical prod secrets are missing.
- No hardcoded fallback secrets remain for production paths.
- Baseline smoke tests captured and saved.

---

## Phase 1 — Trust Boundary Hardening

**Goal:** Remove credential exposure and enforce endpoint auth correctly.

### Scope
1. Remove hardcoded DB password and host fallbacks from routes/auth.js.
2. Remove/gate demo credential bypass to DEMO_MODE only.
3. Remove default JWT secret fallback in Central auth.
4. Remove insecure default admin password fallback in both auth stacks.
5. Add auth middleware to wholesale mutation endpoints.
6. Protect Central farm-private GET sync endpoints.
7. Replace sync key format-only validation with farm ownership validation.
8. Remove/guard verbose auth token payload logs.

### Primary files
- routes/auth.js
- greenreach-central/routes/auth.js
- routes/wholesale-orders.js
- greenreach-central/routes/sync.js
- greenreach-central/middleware/adminAuth.js

### Entry Gate
- Phase 0 exit complete.

### Exit Gate
- Unauthorized reads/mutations return 401/403.
- No sensitive token/payload logs emitted.
- Grep checks show no hardcoded known-secret fallbacks.

### Rollback
- Route-level auth feature flags for temporary fallback (non-prod only).
- Restore previous middleware wiring if lockout appears.

---

## Phase 2 — Transport Security and Service Connectivity

**Goal:** Ensure authenticated traffic is encrypted and service links are production-correct.

### Scope
1. Enable HTTPS for Foxtrot endpoint used by Central.
2. Update Central FOXTROT_API_URL to HTTPS and remove localhost assumptions.
3. Enforce webhook signature requirement in production (fail closed when missing secret/signature).
4. Confirm CORS allowlists include new HTTPS endpoint.

### Primary files/config
- routes/wholesale/checkout.js
- routes/wholesale/fulfillment-webhooks.js
- server/middleware/cors.js
- EB/CloudFront/ALB environment config

### Entry Gate
- Phase 1 exit complete.

### Exit Gate
- Central-to-Foxtrot authenticated traffic runs over HTTPS only.
- Production webhook calls without valid signature fail.

### Rollback
- DNS/cname rollback to previous endpoint.
- Temporary dual endpoint support with strict allowlist.

---

## Phase 3 — Persistence Cutover (Map → Durable Store)

**Goal:** Eliminate restart data loss with controlled migration.

### Migration pattern (mandatory per domain)
1. Add durable store and **dual-write**.
2. Enable **shadow-read compare** against old Map.
3. Flip reads to durable store behind flag.
4. Retire Map path after drift stability window.

### Scope by domain
1. Checkout order lookup cache.
2. Refund and broker-fee records.
3. Reservations and expiration state.
4. Fulfillment/invoice records.
5. SLA/substitution/preference/violation state.
6. Square OAuth state + tokens.
7. Payment webhook record state.
8. Activity hub order/sub-order in-memory state.
9. Central wholesale memory-primary read paths (make DB-backed primary where possible).

### Primary files
- routes/wholesale/checkout.js
- routes/wholesale/refunds.js
- routes/wholesale-reservations.js
- routes/wholesale-fulfillment.js
- routes/wholesale/sla-policies.js
- routes/wholesale/square-oauth.js
- routes/wholesale/webhooks.js
- routes/activity-hub-orders.js
- greenreach-central/lib/wholesaleMemoryStore.js

### Entry Gate
- Phase 1 complete, Phase 2 at least partially complete for secure inter-service operations.

### Exit Gate
- Restart tests pass for all migrated domains.
- Shadow-read mismatch below defined threshold.
- No critical path depends on volatile Map state.

### Rollback
- Keep dual-read switch for one release window.
- Revert read flag to prior source while preserving writes to durable store.

---

## Phase 4 — Payment Progression and Reconciliation

**Goal:** Move safely from demo payments to real processing.

### Scope
1. Externalize provider credentials/config only (no hardcoded merchant IDs).
2. Broker fee percent moved to env/config.
3. Implement webhook idempotency for Square webhooks.
4. Implement reconciliation checks before production capture.
5. Define per-farm payment mode flags:
   - demo
   - sandbox
   - production

### Entry Gate
- Phases 1–3 exits complete.

### Exit Gate
- Sandbox charge/refund flows pass.
- Duplicate webhook replay is no-op.
- Reconciliation reports no unresolved critical mismatches.

### Rollback
- Force payment mode to demo for affected farms.
- Pause capture while preserving order creation.

---

## Phase 5 — Reliability, Health, and Ops Hardening

**Goal:** Close resilience and operability gaps.

### Scope
1. Add Foxtrot /api/health base route (lightweight liveness).
2. Guard health sub-features from optional dependency failures.
3. Add process fatal error policy (log + graceful drain + exit non-zero).
4. Add Central DB reconnection/liveness probing.
5. Re-enable closeDatabase on graceful shutdown.
6. Add CI smoke test(s) and schema checks in pipeline.
7. Clean up broken Foxtrot legacy EB environment.
8. Platform version update plan with maintenance window.

### Entry Gate
- Phases 1–4 complete or waived by explicit architecture decision.

### Exit Gate
- Liveness/readiness endpoints stable.
- DB outage-recovery test passes.
- CI blocks failing schema/smoke checks.
- Legacy broken environment removed from active inventory.

### Rollback
- Feature-flagged health route fallback.
- Revert CI gate strictness only for emergency hotfix branch.

---

## Required Verification Matrix

## Phase 0 checks
- npm run validate-schemas
- startup preflight fails when required prod env vars are missing
- baseline smoke: health, catalog, checkout preview, execute

## Phase 1 checks
- unauthorized mutation attempts rejected
- random 64-char API key rejected
- no leaked token payload logs in middleware output
- grep returns zero for known hardcoded credentials

## Phase 2 checks
- Central checkout uses HTTPS FOXTROT_API_URL
- webhook requests without valid signature rejected in production mode

## Phase 3 checks
- create/update/restart/re-read tests for each migrated domain
- dual-read mismatch report captured

## Phase 4 checks
- sandbox payment test: authorize/capture/refund
- duplicate webhook replay returns already_processed
- reconciliation report clean

## Phase 5 checks
- /health/live and /health/ready stable under load
- DB disconnect/reconnect simulation recovered automatically
- CI smoke + schema checks run in build and block failures

---

## Risk Register (Condensed)

- **Auth lockout risk (Phase 1):** mitigate with staged endpoint rollout and emergency break-glass token.
- **TLS misconfiguration risk (Phase 2):** mitigate with canary endpoint and staged DNS change.
- **Data drift during migration (Phase 3):** mitigate via dual-write + shadow compare.
- **Payment double-processing (Phase 4):** mitigate via idempotency + reconciliation.
- **False-positive alert noise (Phase 5):** mitigate with burn-in thresholds and severity tuning.

---

## Deployment Governance

For each phase:
1. Implementation proposal with exact file deltas.
2. Review Agent validation.
3. Architecture signoff.
4. User explicit approval: APPROVED FOR DEPLOYMENT.
5. Deploy and run phase verification matrix.

No phase deployment proceeds without all five steps.

---

## Final Status

This v2 plan is **implementation-ready for review** and replaces prior sequencing.
Recommended next action: begin Phase 0 with preflight + secret policy enforcement and submit that delta for Review Agent validation.