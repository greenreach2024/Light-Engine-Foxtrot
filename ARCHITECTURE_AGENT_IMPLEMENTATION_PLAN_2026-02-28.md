# Architecture Agent Review + Implementation Plan

**Date:** 2026-02-28  
**Scope:** Light Engine Foxtrot + GreenReach Central  
**Prepared by:** Architecture Agent

---

## 1) Architecture Review Verdict

### Current state (high-level)
- **Platform status:** Operational for controlled pilot workflows.
- **Revenue readiness:** **Not yet approved** due to security/auth hardening gaps, stubbed Central business routes, and release hygiene risk in local working state.
- **AI maturity:** Strong backend capability; operator-facing and admin-facing UX integration is still lagging in key areas.

### Review conclusion
- **Decision:** Proceed with a **gated implementation program** (below), not ad-hoc changes.
- **Constraint:** No production deployment steps without explicit user approval phrase: **APPROVED FOR DEPLOYMENT**.

---

## 2) Strategic Objectives

1. Establish a release-safe baseline and reduce deployment risk.
2. Close security/authentication and admin control-plane hard blockers.
3. Complete Central admin operational pathways (replace critical stubs).
4. Convert AI Vision backend strength into operator-visible outcomes.
5. Certify a revenue-grade readiness envelope with evidence.

---

## 3) Implementation Program (Phased)

## Phase A — Release Hygiene + Baseline Control (P0)

**Goal:** Ensure every deployment candidate is deterministic and auditable.

### Work items
1. Build a clean release candidate workflow from committed, scoped changes only.
2. Separate runtime/generated artifacts (`public/data/*.json`, temp files, local scripts) from deployable source.
3. Add mandatory pre-deploy checklist:
   - schema validation
   - endpoint smoke tests
   - auth regression checks
4. Lock deployment runbook to clean worktree/tagged commit path.

### Exit criteria
- Deployment candidate can be produced from a clean tree with zero unrelated diffs.
- Smoke suite passes consistently on candidate artifact.

**Effort:** 0.5–1 day  
**Risk:** Low

---

## Phase B — Admin Security Hardening (P0)

**Goal:** Make Central admin access production-safe and non-bypassable.

### Work items
1. Remove or strictly gate fallback admin credentials in cloud production mode.
2. Enforce DB-backed admin auth session validation for production paths.
3. Ensure admin schema availability (`admin_users`, `admin_sessions`, `admin_audit_log`) via migration/bootstrap path.
4. Validate role model consistency (`admin` / `operations` / `support` / `viewer`) across token creation + route guards.
5. Confirm logout/session revocation reliability.

### Exit criteria
- No production fallback credential path active.
- Admin login/verify/logout flow passes end-to-end.
- Privilege boundary tests pass (viewer cannot execute admin mutations).

**Effort:** 1–2 days  
**Risk:** Medium

---

## Phase C — Central Admin Functional Completion (P1)

**Goal:** Replace critical stubs in Central admin business workflows.

### Work items
1. Prioritize and replace high-impact stubs:
   - `greenreach-central/routes/orders.js`
   - `greenreach-central/routes/reports.js`
   - `greenreach-central/routes/billing.js`
   - key `farm-sales` QuickBooks + operations pathways
2. Restore or intentionally redesign experiment admin route surface to match orchestrator job capabilities.
3. Remove/replace “coming soon” UI blockers in central admin for core operations.

### Exit criteria
- Core admin views return real, data-backed responses (not placeholders).
- Experiment operations available from API and admin UX path.
- No P1 admin pages blocked by stub responses.

**Effort:** 3–5 days  
**Risk:** Medium

---

## Phase D — AI Vision Productization (P1)

**Goal:** Convert deployed AI backend into measurable operator/admin value.

### Work items
1. Implement highest-value UX closures from AI Vision gap list:
   - harvest readiness cards
   - loss prediction alerts
   - learning correlations panel
   - experiment record visibility
2. Wire Central/network intelligence outputs into admin + buyer-facing decision points where already available.
3. Add telemetry for feature adoption (view, acknowledge, accept/dismiss).

### Exit criteria
- Top AI recommendation surfaces are visible and actionable in UI.
- AI-to-action path is measurable (events logged).
- AI completeness score increases on both backend and UX dimensions.

**Effort:** 3–4 days  
**Risk:** Medium

---

## Phase E — Revenue Readiness Certification (P0 Gate)

**Goal:** Certify the environment for paid/financially sensitive operations.

### Work items
1. Run full verification matrix:
   - auth boundaries
   - persistence and restart durability
   - payment and webhook idempotency
   - operational health endpoints
2. Publish evidence package and rollback instructions.
3. Submit final architecture signoff recommendation.

### Exit criteria
- All blocking checks pass with evidence.
- No unresolved critical security or data durability issues.
- Explicit user deployment approval received before any prod rollout.

**Effort:** 1 day  
**Risk:** Medium

---

## 4) Execution Order and Dependencies

1. **Phase A** must complete first.
2. **Phase B** starts immediately after A.
3. **Phase C** and **Phase D** can run in parallel after B (shared review checkpoints).
4. **Phase E** begins only after C and D exit criteria are met.

---

## 5) Governance and Review Gates

For each phase:
1. Implementation delta proposal (files, behavior, tests)
2. Review validation
3. Architecture checkpoint approval
4. User deployment approval (**APPROVED FOR DEPLOYMENT**)
5. Deploy + verify + evidence capture

---

## 6) Risk Register (Active)

1. **Dirty working state contamination**  
   Mitigation: clean-tree release artifact workflow (Phase A).

2. **Admin auth bypass or schema drift**  
   Mitigation: enforce production DB-backed auth + migration checks (Phase B).

3. **Stubbed business endpoints breaking operations**  
   Mitigation: prioritize stub replacement by operational impact (Phase C).

4. **AI backend/UI mismatch reducing value realization**  
   Mitigation: targeted UX closure sprint with measurable adoption (Phase D).

---

## 7) Success Metrics

- Release hygiene: clean deploy candidate generation success = 100%.
- Admin security: 0 production fallback auth paths.
- Central admin completion: critical stub endpoints reduced to 0.
- AI productization: top-priority AI UX gaps closed and instrumented.
- Revenue readiness: certification matrix pass with no critical blockers.

---

## 8) Immediate Next Action

Start **Phase A** with a scoped release-baseline PR and checklist enforcement, then proceed directly into **Phase B** hardening.
