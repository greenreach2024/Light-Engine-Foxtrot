# Architecture Master Plan for Review

Date: 2026-02-26  
Project: Light Engine Foxtrot + GreenReach Central  
Branch baseline: recovery/feb11-clean

---

## 1) Executive Objective

Deliver a production-safe wholesale platform by closing security, transport, persistence, payment, and operability shortfalls in a controlled multi-phase rollout.

Primary outcomes:
- No hardcoded production credentials or insecure auth fallbacks.
- Encrypted service-to-service and user traffic for authenticated APIs.
- Durable state for all operational wholesale domains.
- Safe payment progression from demo to real capture.
- Reliable health signals, recovery behavior, and deployment gates.

---

## 2) Architecture Principles (Enforced)

- Security-first fail-closed policy in production.
- No production fallbacks for secrets.
- Data durability over convenience: business state must survive restarts.
- Incremental cutovers with dual-write and shadow-read validation.
- Strict deployment governance: proposal, review, architecture signoff, explicit deployment approval.
- Preserve canonical data formats and schema standards.

---

## 3) Delivery Model and Governance

Every phase follows this lifecycle:
1. Implementation delta proposal (exact files + behavior changes).
2. Review Agent validation.
3. Architecture approval confirmation.
4. User deployment approval phrase.
5. Deploy and execute phase verification matrix.
6. Capture evidence and update readiness status.

No phase can start unless prior phase exit criteria are met or explicitly waived by architecture decision.

---

## 4) Complete Phase Plan

## Phase 0: Preconditions and Safety Guardrails

Purpose: establish a safe baseline before changing core logic.

Scope:
- Add startup preflight for required production environment variables.
- Enforce no-production-fallback policy for critical secrets.
- Add schema validation to build/deploy path.
- Create rollback playbook per phase.
- Capture baseline smoke-test evidence before implementation begins.

Required production variables:
- JWT_SECRET
- WHOLESALE_JWT_SECRET
- WEBHOOK_SECRET
- RDS_HOSTNAME
- RDS_PASSWORD
- FOXTROT_API_URL

Entry criteria:
- None.

Exit criteria:
- Service startup fails in production when required secrets are missing.
- Known hardcoded secrets and default secret fallbacks removed from production paths.
- Baseline smoke-test results captured.

Rollback:
- Revert to prior release artifact.
- Temporary local-only demo fallback allowed only for non-production environment.

Estimated effort: 0.5 day

---

## Phase 1: Trust Boundary Hardening

Purpose: close direct security exposure and unauthorized access paths.

Scope:
- Remove hardcoded DB credential fallback values.
- Remove or strictly gate demo credential bypass behind demo mode.
- Remove default JWT secret fallback behavior.
- Remove default admin password fallback behavior in both auth stacks.
- Add authentication middleware to wholesale mutation routes.
- Add authentication to farm-private sync read endpoints.
- Replace sync API key format-only check with ownership validation.
- Remove sensitive token and payload logging from auth middleware.

Entry criteria:
- Phase 0 completed.

Exit criteria:
- Unauthorized mutation and private read calls return 401 or 403.
- Random 64-char key no longer authenticates sync routes.
- No token payload data written to logs.
- Secret exposure grep checks return clean.

Rollback:
- Route-level auth feature toggles for emergency rollback.
- Immediate restore of previous middleware chain if lockout occurs.

Estimated effort: 1 day

---

## Phase 2: Transport Security and Service Connectivity

Purpose: ensure authenticated traffic and inter-service communication are encrypted and production-correct.

Scope:
- Enable HTTPS for Foxtrot endpoint used by Central.
- Update Central service URL usage to HTTPS endpoint.
- Remove localhost assumptions in production checkout flow.
- Enforce webhook signature requirement in production mode (fail closed).
- Update allowlists for new HTTPS endpoint and expected origins.

Entry criteria:
- Phase 1 completed.

Exit criteria:
- Central-to-Foxtrot authenticated calls use HTTPS only.
- Webhook requests without valid signature rejected in production.
- No production auth call references localhost endpoint.

Rollback:
- DNS or endpoint reversion to prior stable route.
- Temporary dual-endpoint routing with strict allowlist.

Estimated effort: 1 day

---

## Phase 3: Durable State Migration (Map to Persistent Store)

Purpose: eliminate restart data loss for operational domains.

Mandatory migration method per domain:
1) Dual-write enabled.
2) Shadow-read compare enabled.
3) Read-source flip behind feature flag.
4) Legacy in-memory retirement after stability window.

Domains in scope:
- Checkout order lookup cache.
- Refund and broker-fee records.
- Reservations and expiration state.
- Fulfillment and invoice records.
- SLA rules, substitution policies, buyer preferences, violations.
- OAuth states and token records.
- Payment webhook record state.
- Activity hub order and sub-order in-memory state.
- Central wholesale memory-primary read behavior where DB persistence exists.

Entry criteria:
- Phase 1 complete.
- Phase 2 at least partially complete for secure service interactions.

Exit criteria:
- Restart tests pass for all migrated domains.
- Shadow-read mismatch within agreed threshold.
- No critical operational path depends only on in-memory state.

Rollback:
- Revert read flag to legacy path while preserving persistent writes.
- Keep dual-write for one release window after read flip.

Estimated effort: 4 days

---

## Phase 4: Payment Progression and Financial Safety

Purpose: transition safely from demo payments to real processing.

Scope:
- Externalize provider credentials and merchant configuration.
- Make broker fee configurable via environment or policy config.
- Add idempotency control to payment webhook processing.
- Add reconciliation checks and operational report.
- Implement per-farm payment mode flags:
  - demo
  - sandbox
  - production
- Enforce sandbox validation before production capture enablement.

Entry criteria:
- Phases 1 to 3 completed.

Exit criteria:
- Sandbox charge/refund flow passes with expected ledger results.
- Duplicate webhook replay is processed as no-op.
- Reconciliation report has no unresolved critical discrepancies.

Rollback:
- Force payment mode back to demo.
- Pause production capture while preserving order flow continuity.

Estimated effort: 2 days

---

## Phase 5: Reliability and Runtime Resilience

Purpose: improve uptime behavior, failure handling, and health signal quality.

Scope:
- Add base liveness endpoint for Foxtrot API health path.
- Guard optional health dependencies so health route does not fail hard.
- Add fatal exception policy: log, drain, and exit non-zero.
- Add Central DB liveness probe and retry strategy.
- Re-enable DB close on graceful shutdown path.

Entry criteria:
- Phases 1 to 4 complete.

Exit criteria:
- Liveness/readiness health checks stable.
- Controlled DB failure and recovery test passes.
- Process exits cleanly on unrecoverable exceptions.

Rollback:
- Feature flag health behavior to minimal response mode.
- Revert retry logic if reconnection loops create instability.

Estimated effort: 1.5 days

---

## Phase 6: CI/CD and Operational Maturity

Purpose: prevent regressions and harden deployment workflow.

Scope:
- Add schema validation gate to build pipeline.
- Add lightweight smoke tests in CI for critical endpoints.
- Ensure build fails on failing schema or smoke checks.
- Document rollback commands and response paths.
- Remove broken legacy EB environment from active inventory.
- Plan and execute platform version update in maintenance window.

Entry criteria:
- Phase 5 complete.

Exit criteria:
- CI blocks unsafe builds consistently.
- Broken legacy environment cleaned up.
- Platform alerts for outdated runtime resolved.

Rollback:
- Keep emergency bypass pipeline for hotfix branch only, with approval requirement.

Estimated effort: 1 day

---

## Phase 7: Revenue Readiness Certification

Purpose: certify system readiness for paid transactions.

Scope:
- Run full end-to-end certification matrix.
- Validate payment, refund, webhook replay, and reconciliation outcomes.
- Validate auth, data durability, and health SLO checks.
- Conduct go-live review with evidence package.

Entry criteria:
- Phases 0 to 6 complete.

Exit criteria:
- Certification matrix passes.
- Review and Architecture approvals captured.
- Explicit user deployment approval provided.

Rollback:
- Revert payment mode to sandbox or demo.
- Rollback to prior known-good release if production anomalies emerge.

Estimated effort: 0.5 day

---

## 5) Dependency Graph

- Phase 0 -> Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7
- Phase 3 can begin after Phase 1 and run partially parallel with Phase 2 for non-networked domains.
- Phase 4 is blocked until Phase 3 durability controls are validated.

---

## 6) Verification Matrix (By Phase)

Phase 0:
- Startup preflight negative test (missing secret) fails as expected.
- Schema validation command passes.
- Baseline smoke tests saved.

Phase 1:
- Unauthorized route tests return expected 401 or 403.
- Sync key ownership validation rejects random key.
- Sensitive token logging check is clean.

Phase 2:
- HTTPS endpoint checks return valid status.
- Central checkout references production Foxtrot URL over HTTPS.
- Webhook signature enforcement test passes in production mode.

Phase 3:
- For each migrated domain: create, restart, read-back test passes.
- Shadow-read mismatch report below threshold.

Phase 4:
- Sandbox payment lifecycle test passes.
- Duplicate webhook replay returns already-processed behavior.
- Reconciliation report clean.

Phase 5:
- Liveness and readiness endpoints stable.
- Forced failure test confirms process exit and restart behavior.
- DB outage simulation recovers successfully.

Phase 6:
- CI run fails when schema or smoke tests fail.
- Environment cleanup confirmed.

Phase 7:
- Full revenue-readiness checklist pass.
- Final signoff artifacts attached.

---

## 7) Risk Register (Top)

1. Auth lockout after boundary hardening.  
Mitigation: staged route rollout, emergency break-glass path.

2. TLS misconfiguration breaks inter-service traffic.  
Mitigation: canary endpoint validation before DNS switch.

3. Data drift during migration period.  
Mitigation: dual-write and shadow-read compare with drift alarm.

4. Duplicate payment processing from webhook replay.  
Mitigation: idempotency key persistence and replay tests.

5. False-positive alerts during observability rollout.  
Mitigation: burn-in period and threshold tuning.

---

## 8) Review Package Required

For review, include:
- This architecture phase plan.
- File-by-file change list per phase.
- Test evidence per phase exit criteria.
- Rollback commands tested in staging.
- Deployment request formatted with explicit approval gate.

---

## 9) Final Recommendation

Proceed with Phase 0 immediately under review workflow.
Do not execute paid transaction enablement until Phases 0 through 4 are complete and Phase 7 certification is signed.

This plan is complete and ready for Review Agent validation and implementation sequencing approval.