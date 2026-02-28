# Review Agent Handoff Packet

Date: 2026-02-26  
Project: Light Engine Foxtrot + GreenReach Central  
Prepared for: Review Agent validation prior to implementation

---

## 0) Phase 3A Status Update (2026-02-28)

This packet is now supplemented with completed Phase 3A implementation evidence.

Current verified state:
- ✅ Phase 3A committed: `3cef5a2` (`5 files`, `+849` / `-267`)
- ✅ Added persistent stores:
	- `lib/wholesale/oauth-store.js`
	- `lib/wholesale/reservation-store.js`
- ✅ Integrated dual-write paths:
	- `routes/wholesale/square-oauth.js`
	- `routes/wholesale-reservations.js`
	- `routes/wholesale-sync.js`
- ✅ Runtime follow-up correction applied:
	- `server-foxtrot.js` reservation cleanup scheduler now awaits async cleanup results and handles interval errors safely.

Deployment and health context:
- AWS recovery phase completed after Phase 3A work; current production environments are healthy.
- Most recent recovery commit: `a1ec145`.

Decision gate recommendation:
- **Approved with conditions satisfied for Phase 3A closure**.
- Proceed to Phase 3B planning and implementation scope.

---

## 0b) Phase 3B Functional Validation Update (2026-02-28)

This packet is now supplemented with Phase 3B runtime validation evidence.

Evidence document:
- `PHASE_3B_FUNCTIONAL_VALIDATION_2026-02-28.md`

Current verified state:
- ✅ Refund persistence read/list behavior validated via runtime API checks.
- ✅ Payment webhook replay idempotency validated (`updated` then `duplicate_ignored`).
- ✅ Payment records remain durable with single-event count after replay.

Known environment constraint:
- ⏸️ Refund create-path provider authorization is deferred for real/sandbox Square environment validation.
- Local runtime currently lacks valid Square credentials required for provider-authorized refund creation.

Decision gate recommendation:
- **Approved with conditions for Phase 3B closure in local scope** (persistence + idempotency).
- **Deferred test item**: Execute end-to-end provider-authorized refund create test when real Square environment credentials are available.

---

## 0c) Phase 3C Delta Proposal Ready (2026-02-28)

Phase 3C implementation delta has been prepared for review:
- `PHASE_3C_IMPLEMENTATION_DELTA_2026-02-28.md`

Summary:
- Targets migration of SLA/substitution state from volatile Maps to persistent NeDB stores.
- Preserves existing endpoint contracts in `routes/wholesale/sla-policies.js`.
- Includes route-by-route migration mapping, validation matrix, and rollback plan.

Decision gate recommendation:
- **Ready for Review Agent validation** before implementation.

---

## 1) Review Scope

Validate the architecture implementation plan for production readiness remediation across all phases.

Primary documents:
- ARCHITECTURE_COMPLETE_PHASE_PLAN_FOR_REVIEW_2026-02-26.md
- IMPLEMENTATION_PLAN_READINESS_FIXES_V2_2026-02-26.md
- END_TO_END_READINESS_REPORT_2026-02-26.md
- .github/AGENT_SKILLS_FRAMEWORK.md
- DATA_FORMAT_STANDARDS.md

---

## 2) Requested Review Outcomes

Review Agent must return:
1. Overall verdict: Approved / Approved with Conditions / Not Approved.
2. Phase-by-phase verdict (Phase 0–7).
3. Required corrections (blocking vs non-blocking).
4. Sequencing confirmation (or corrected order).
5. Validation gaps in tests/evidence.
6. Deployment gate compliance status.

---

## 3) Architecture Summary (For Reviewer)

- Plan enforces fail-fast production secrets policy.
- Auth boundaries tightened for wholesale mutations and farm-private sync reads.
- Persistence migration uses dual-write + shadow-read + read flip + retirement sequence.
- Payment progression controlled via demo → sandbox → production modes.
- Reliability includes liveness/readiness split, fatal exception policy, DB recovery behavior, and CI gates.

---

## 4) Phase-by-Phase Review Checklist

## Phase 0 — Preconditions and Guardrails

Reviewer checks:
- Required production env vars are explicitly defined.
- Startup preflight fails when secrets are missing in production mode.
- Schema validation gate is included in CI/build path.
- Baseline smoke evidence is required before code changes.

Approval questions:
1. Does the plan remove all production secret fallbacks?
2. Is baseline evidence mandatory and auditable?
3. Are rollback commands defined before implementation starts?

Evidence required:
- Env preflight spec
- CI gate step list
- Baseline smoke output bundle

---

## Phase 1 — Trust Boundary Hardening

Reviewer checks:
- Hardcoded credential removal scope is complete.
- Demo bypass is removed or strictly demo-mode gated.
- Default admin password fallback removal is included in both auth stacks.
- Wholesale mutation routes require auth.
- Sync farm-private read routes require auth.
- API key ownership validation replaces format-only validation.
- Sensitive auth logging removal is explicit.

Approval questions:
1. Are any auth-sensitive routes still public by design without rationale?
2. Is lockout risk mitigated with controlled rollout?
3. Are all credential exposure vectors covered?

Evidence required:
- Route auth matrix before/after
- Security grep report
- Negative auth test results (401/403)

---

## Phase 2 — Transport Security and Connectivity

Reviewer checks:
- HTTPS enablement for Foxtrot is mandatory before payment progression.
- Central service calls use FOXTROT_API_URL over HTTPS.
- Production webhook verification fails closed when signature/secret missing.
- CORS/allowlists updated for new endpoint paths.

Approval questions:
1. Is there any remaining authenticated HTTP traffic?
2. Is webhook authentication impossible to bypass in production mode?
3. Is there a tested rollback path for endpoint/DNS changes?

Evidence required:
- HTTPS endpoint checks
- Central-to-Foxtrot call traces
- Webhook negative test (invalid signature rejected)

---

## Phase 3 — Durable State Migration

Reviewer checks:
- Migration pattern includes dual-write and shadow-read for every domain.
- All volatile operational domains are in scope (including Activity Hub and central memory-primary reads).
- Restart durability test is required per domain.
- Read-source flip is feature-flagged with rollback.

Approval questions:
1. Are any critical business records still Map-only after phase completion?
2. Is data drift detection objective and thresholded?
3. Is migration rollback safe without data loss?

Evidence required:
- Domain migration tracker
- Shadow-read mismatch report
- Restart persistence test results

---

## Phase 4 — Payment Progression

Reviewer checks:
- Payment credentials are externalized (no hardcoded merchant values).
- Broker fee config is externalized.
- Webhook idempotency and replay handling are explicit.
- Reconciliation checks are mandatory before production mode.
- Per-farm payment mode flags are defined.

Approval questions:
1. Can duplicate webhook deliveries cause double-processing?
2. Are sandbox pass criteria measurable and enforced?
3. Can production capture be disabled instantly per farm?

Evidence required:
- Sandbox E2E test logs (charge/refund/replay)
- Idempotency replay proof
- Reconciliation report template + sample

---

## Phase 5 — Reliability and Runtime Resilience

Reviewer checks:
- Foxtrot liveness endpoint exists and is dependency-safe.
- Optional health modules cannot crash base health route.
- Fatal exception policy exits non-zero after logging/drain.
- Central DB liveness/retry strategy is defined.
- Graceful shutdown closes DB connections.

Approval questions:
1. Can health route still return valid liveness under partial dependency failure?
2. Is process behavior on fatal faults deterministic?
3. Is DB outage and recovery behavior testable and tested?

Evidence required:
- Health endpoint load/stability checks
- Fault injection test outputs
- DB outage recovery test outputs

---

## Phase 6 — CI/CD and Operational Maturity

Reviewer checks:
- Schema + smoke checks block unsafe builds.
- Broken legacy EB environment cleanup included with safe sequence.
- Platform update plan includes maintenance window and rollback.

Approval questions:
1. Do CI checks prevent recurrence of known failure classes?
2. Is emergency bypass tightly controlled?
3. Are post-deploy checks mandatory and recorded?

Evidence required:
- Pipeline config diff
- Intentional-failure CI proof
- Environment inventory before/after cleanup

---

## Phase 7 — Revenue Readiness Certification

Reviewer checks:
- Full certification matrix includes auth, durability, payment, webhook replay, reconciliation, and health.
- Final go-live criteria are objective and binary.
- Governance steps require explicit deployment approval message.

Approval questions:
1. Is there any unresolved blocker for paid traffic?
2. Are all phase exit artifacts present and signed?
3. Is rollback to non-revenue mode immediate and tested?

Evidence required:
- Certification matrix results
- Final signoff bundle
- Rollback drill evidence

---

## 5) Blocking Issue Tracker Template (for Review Agent)

Use this table in the review output:

| ID | Phase | Severity | Finding | Required change | Owner | Due before |
|----|-------|----------|---------|-----------------|-------|------------|
| B-01 | P1 | Critical | | | | Deploy |
| B-02 | P2 | High | | | | Deploy |
| B-03 | P3 | High | | | | Read flip |

Severity guidance:
- Critical: blocks implementation start
- High: blocks phase deployment
- Medium: fix in same phase before exit
- Low: can defer with explicit approval

---

## 6) Decision Log Template

| Decision | Options considered | Selected | Reason | Risk accepted | Reviewer |
|----------|--------------------|----------|--------|---------------|----------|
| Auth model for wholesale mutations | | | | | |
| State store cutover order | | | | | |
| Payment mode progression gates | | | | | |
| Health endpoint contract | | | | | |

---

## 7) Review Submission Prompt (Copy/Paste)

Review this package and return final verdict with required corrections:
- ARCHITECTURE_COMPLETE_PHASE_PLAN_FOR_REVIEW_2026-02-26.md
- IMPLEMENTATION_PLAN_READINESS_FIXES_V2_2026-02-26.md
- END_TO_END_READINESS_REPORT_2026-02-26.md

Required output:
1) Executive verdict
2) Phase 0–7 verdict table
3) Blocking findings list
4) Required corrections before implementation
5) Revised sequencing (if any)
6) Verification gaps
7) Final approval status

---

## 8) Expected Final Reviewer Output Format

- Executive Verdict
- Phase Verdict Table (P0–P7)
- Blocking Findings (Critical/High)
- Non-Blocking Findings (Medium/Low)
- Required Corrections for Approval
- Final Status: Approved / Approved with Conditions / Not Approved

---

## 9) Handoff Status

This packet is complete and ready to send to Review Agent.

---

## 10) Review Agent Addendum — Checkout Preview Empty Cart (2026-02-27)

### Executive Verdict

**Approved with Conditions** for remediation of the known checkout preview issue:
- Symptom: checkout preview returns empty allocation / null subtotal.
- Root cause: network farms lack persisted `api_url` in `farms` table and are skipped by network aggregator.
- Scope classification: **Operational data + persistence gap**, not a Phase 2 transport security regression.

### Evidence Snapshot (Code Paths)

- Checkout preview uses network aggregation path:
	- `greenreach-central/routes/wholesale.js` (`/checkout/preview`)
- Network aggregator requires `farm.api_url || farm.url` to fetch inventory:
	- `greenreach-central/services/wholesaleNetworkAggregator.js`
- Network store re-seeds from DB and prefers `farms.api_url`:
	- `greenreach-central/services/networkFarmsStore.js`
- Wholesale network farm admin route currently updates in-memory store only:
	- `greenreach-central/routes/wholesale.js` (`POST /network/farms`)

### Blocking Findings

| ID | Phase | Severity | Finding | Required change | Owner | Due before |
|----|-------|----------|---------|-----------------|-------|------------|
| B-01 | P2/P3 | High | `POST /network/farms` does not persist `api_url` to `farms` DB, causing restart drift | Add DB upsert/update for `api_url` + metadata when DB available | Implementation | Deploy |
| B-02 | P2/P5 | High | Aggregator silently drops farms with missing URL | Add explicit diagnostics (missing URL list, fetch errors) in logs and admin/network API response | Implementation | Deploy |
| B-03 | P2 UX | Medium | Checkout preview returns generic allocation failure for config issues | Add config-specific error path when no reachable farms / no inventory sources | Implementation | Phase exit |

### Required Corrections for Approval

1. **Persistence fix**
	 - Ensure network farm registration path persists to DB (`farms.api_url`) and remains restart-safe.
2. **Operational visibility**
	 - Expose skipped farms and causes in aggregate diagnostics (`missing_api_url`, `fetch_failed`).
3. **Buyer-facing resiliency**
	 - Return actionable error for config-state failure (no reachable farm endpoints).
4. **Data backfill**
	 - One-time backfill for active production farms with null/empty `api_url`.

### Revised Sequencing (Approved)

1. Run pre-change audit query for active farms missing `api_url`.
2. Backfill `farms.api_url` for known active farm records.
3. Implement persistence fix in network farm upsert path.
4. Add diagnostics and checkout error hardening.
5. Validate with restart test + checkout preview smoke test.

### Validation Gaps (Must Close)

- Missing proof that `api_url` survives Central restart and re-seed.
- Missing proof that aggregate catalog includes SKUs after backfill.
- Missing proof that checkout preview returns non-null subtotal and line items after fix.
- Missing deploy gate that enforces zero active farms with empty `api_url`.

### Final Status

**Approved with Conditions** — implementation may proceed only with B-01 and B-02 resolved before deployment.