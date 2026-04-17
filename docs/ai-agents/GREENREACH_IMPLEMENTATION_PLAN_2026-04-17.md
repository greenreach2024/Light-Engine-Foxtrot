# GreenReach Implementation Plan

Status update (2026-04-17): `AGENT_HANDOFF_PROTOCOL.md` and `OUTCOME_TAXONOMY.md` are now present, and the farm admin dashboard exposes an `AI Signals` section backed by harvest readiness, loss prediction, learning correlations, experiment stats, crop benchmarks, and EVIE recommendation routes.

**Date:** 2026-04-17
**Source Review:** `docs/ai-agents/GREENREACH_REVIEW_2026-04-17.md`
**Purpose:** Convert the April 17 AI/automation review into an execution-ready implementation roadmap tied to the current repo structure.

---

## 1. Implementation goals

This plan translates the review into concrete work that can be executed in phases without destabilizing production.

Primary goals:

1. Expose already-shipped AI capability through grower-facing UI.
2. Close the agent-to-infrastructure gap with a unified tool surface.
3. Raise the trust floor by fixing durability, ML job reliability, and auditability gaps.
4. Formalize the research-to-operations pipeline across GWEN, EVIE, and FAYE.

---

## 2. Priority order

### Phase A — Trust floor and visible value

Target outcome: make existing intelligence visible and reduce operational fragility.

Work items:

1. Wire dashboard AI cards to live data.
2. Verify and harden ML job execution cadence.
3. Expand durability for volatile/in-memory operational state.
4. Add implementation docs for agent handoff, outcome taxonomy, and durability runbooks.

Likely code areas:

- `greenreach-central/public/farm-admin.js`
- `greenreach-central/public/LE-farm-admin.html`
- `public/farm-admin.js`
- `public/LE-farm-admin.html`
- `services/ml-gateway.js`
- `scripts/ml-anomaly-cron.py`
- `scripts/effects-learner.py`
- `greenreach-central/routes/admin-ai-monitoring.js`
- backup / sync scripts and Central backup routes

### Phase B — Highest-ROI UX surface

Target outcome: expose the strongest existing backend intelligence to growers and admins.

Work items:

1. Recipe modifier management UI.
2. Harvest readiness and loss risk cards.
3. Learning correlations widget.
4. Experiment record viewer and summary pages.

Likely code areas:

- `greenreach-central/public/farm-admin.js`
- `greenreach-central/public/views/tray-inventory.html`
- `public/farm-admin.js`
- `public/views/tray-inventory.html`
- recipe modifier / experiment / prediction routes under `greenreach-central/routes/`

### Phase C — Unified agent execution surface

Target outcome: consolidate fragmented agent plumbing into a shared, auditable action surface.

Work items:

1. Create a shared tool registry / gateway layer.
2. Add a shared outcome ledger for EVIE, FAYE, and GWEN.
3. Introduce a formal handoff protocol.
4. Standardize outcome classes and explainability payloads.

Likely code areas:

- `services/ai-agent.js`
- `greenreach-central/routes/assistant-chat.js`
- `greenreach-central/routes/farm-ops-agent.js`
- `greenreach-central/routes/admin-ops-agent.js`
- `greenreach-central/routes/gwen-research-agent.js`
- database migration code in `greenreach-central/config/database.js`

### Phase D — Scientific-instrument identity

Target outcome: formalize experiment design, evidence capture, and promotion to production.

Work items:

1. Publish `GWEN_VISION.md`.
2. Add hypothesis pre-registration and power analysis.
3. Add negative-result visibility.
4. Define research-to-production recipe promotion path.

Likely code areas:

- `greenreach-central/routes/gwen-research-agent.js`
- `greenreach-central/routes/research-*.js`
- AI / research docs under `docs/ai-agents/`

---

## 3. Immediate backlog

These items should be treated as the current execution backlog derived from the review.

### A1. Dashboard AI card activation

Objective: connect existing dashboard cards to real endpoints instead of placeholder or static values.

Definition of done:

- Farm dashboard shows live harvest readiness, loss risk, learning correlation, farm value, and alert signals.
- LE and Central copies stay in sync where the same UI is served from both locations.
- Empty states and confidence labels are explicit.

### A2. ML reliability audit and stale-job detection

Objective: ensure anomaly, learning, and retraining jobs are actually running and observable.

Definition of done:

- Each ML job has a last-run timestamp and stale threshold.
- Admin monitoring UI shows healthy / stale / failed state.
- SARIMAX stub status is explicitly labeled until replaced.

### A3. Volatile state persistence inventory

Objective: remove reliance on process memory for critical operational state.

Definition of done:

- A repo-tracked inventory exists for every volatile store.
- Top-priority stores are migrated to durable storage or clearly marked as non-critical.
- Recovery behavior after restart is documented.

### A4. Agent governance documentation set

Objective: make the new review actionable as a system contract.

Definition of done:

- `AGENT_HANDOFF_PROTOCOL.md` published.
- `OUTCOME_TAXONOMY.md` published.
- `DATA_DURABILITY_RUNBOOK.md` published.
- This implementation plan remains the execution anchor.

---

## 4. Proposed companion documents

The April 17 review identifies missing documents that should be created in this repo.

Recommended additions:

1. `docs/ai-agents/GWEN_VISION.md`
2. `docs/ai-agents/AGENT_HANDOFF_PROTOCOL.md`
3. `docs/ai-agents/OUTCOME_TAXONOMY.md`
4. `docs/ai-agents/EXPERIMENT_LIFECYCLE.md`
5. `docs/operations/DATA_DURABILITY_RUNBOOK.md`
6. `docs/architecture/AUTOMATION_DRIVER_SPEC.md`

Suggested order:

1. Handoff protocol
2. Outcome taxonomy
3. Data durability runbook
4. GWEN vision
5. Experiment lifecycle
6. Automation driver spec

---

## 5. Recommended execution strategy

To keep changes safe in production, use this order for implementation work:

1. Documentation contracts first.
2. Monitoring and visibility second.
3. UI exposure of already-existing backend logic third.
4. Shared tool-gateway refactors only after the current surfaces are documented and monitored.

Rationale:

- The repo already contains mature backend logic.
- The highest immediate return is exposing and governing what already exists.
- Large agent-surface refactors should not happen before audit, taxonomy, and handoff contracts are explicit.

---

## 6. Acceptance criteria for this review package

The April 17 review should be considered integrated into repo planning when all of the following are true:

1. The review document exists in the repo.
2. This implementation plan exists in the repo.
3. Follow-on contract docs are created from the "missing documents" list.
4. At least one Phase A work item is implemented against production code.

---

## 7. Next recommended implementation step

If work continues immediately after this document is added, the next best task is:

**Create `AGENT_HANDOFF_PROTOCOL.md` and `OUTCOME_TAXONOMY.md` as the first two contract documents, then begin Phase A1 dashboard AI card activation.**