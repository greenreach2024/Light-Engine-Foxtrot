# UX Dashboard Enhancement Implementation Plan

**Version**: 1.1.0  
**Date**: February 23, 2026  
**Status**: REVISED — Post-Review Corrections Applied  
**Base Document**: `UX_ACTION_PLAN.md` (v2026-02-23)  
**Scope**: AI-driven grower dashboard UX, development workflow standards, cloud service alignment, and "wow factor" features with strict MVP gating.

### Related Documents

| Document | Version | Relevance |
|----------|---------|-----------|
| `UX_ACTION_PLAN.md` | v2026-02-23 | Base sprint plan (A/B/C/D) this document augments |
| `LE_DASHBOARD_READINESS_REPORT.md` | 2026-01-20 | CRITICAL: dashboard data-source blocker (Phase P0 prerequisite) |
| `PROPOSAL_FARM_VITALITY_MULTI_VIEW_DASHBOARD.md` | Conditionally approved | 3 visualization views — disposition addressed in §4.2 |
| `PROPOSAL_FARM_OPS_AGENT_2026-02-23.md` | v1.0.1 | NL agent + voice architecture — owns voice implementation |
| `DELIVERY_SERVICE_IMPLEMENTATION_PLAN.md` | v2.1.0 | Delivery features (9–14 days) — competes for sprint capacity |
| `PROPOSAL_INTEGRATION_ASSISTANT_2026-02-22.md` | R3 | Device onboarding — may affect dashboard data model |

---

## 1) Review of Current Drafts

### 1.1 What is strong already

The current draft (`UX_ACTION_PLAN.md`) is implementation-oriented and unusually concrete:

- Maps UI work to real files and approximate insertion points.
- Uses existing APIs and avoids large backend reinvention.
- Emphasizes actionable status cards and confidence/risk labeling.
- Splits work into digestible sprint blocks with rough effort.
- Prioritizes intelligence surfacing instead of adding new "AI" branding.

### 1.2 Gaps to close before execution

The current draft is technically strong but needs UX-governance additions:

1. **User research gate is missing** before final layout lock.
2. **Information hierarchy rules** are implied, not explicit and testable.
3. **Customization requirements** (hide/reorder/collapse/saved views) are not first-class acceptance criteria.
4. **Visual simplicity constraints** are not codified (easy to drift into overloaded UI).
5. **Feature novelty risk** (AR, gamification, voice complexity) needs phased containment to protect MVP clarity.
6. **Developer workflow baseline** (formatter/linter/API test discipline) is not formalized as delivery gates.
7. **Dashboard loads demo data** — `LE_DASHBOARD_READINESS_REPORT.md` documented that `LE-dashboard.html` fetched from static `/data/rooms.json` (812 lines of fake data). **Verified 2026-02-23: this was already fixed in prior commits.** The remaining issue (`wizardStatesDB` not on `app.locals`) has been corrected — see Phase P0.

This plan addresses those seven gaps while preserving the existing sprint architecture.

---

## 2) Guiding Product Principles (Mandatory)

1. **Grower-first workflow**: morning priorities, harvest readiness, order risk, and urgent anomalies appear first.
2. **Clarity over novelty**: no complex graphics where a line/bar/area chart is clearer.
3. **Signal over noise**: color highlights urgency/status only; avoid decorative color use.
4. **Progressive disclosure**: default view is concise; advanced details are expandable.
5. **Customization by default**: users can hide, collapse, and reorder non-critical modules.
6. **Explainability visible**: confidence + sample size + rationale appear on AI recommendation cards.
7. **Fast on iPad**: payload/DOM/animation budget respected to keep touch UX responsive.

---

## 3) Implementation Scope

### 3.1 In scope (this plan)

- UX governance and acceptance criteria layered onto `UX_ACTION_PLAN.md`.
- Dashboard information hierarchy and layout constraints.
- Customization framework (hide/show/reorder/collapse/presets).
- Visualization standards and accessibility checks.
- VS Code extension baseline and team conventions.
- AWS service adoption roadmap by phase (evaluate vs implement).
- "Wow factor" features with staged rollout gates.

### 3.2 Out of scope (for this phase)

- Full AR implementation.
- Production migration to new cloud architecture (e.g., full Amplify/AppSync switch).
- Broad design-system rewrite.
- Multi-month gamification program.

---

## 4) UX Governance Layer Added to Existing Sprint Plan

This section augments (not replaces) the existing Sprint A/B/C/D structure in `UX_ACTION_PLAN.md`.

### 4.0 Phase P0 — Dashboard Data-Source Fix (0.5 day, mandatory prerequisite)

**Objective**: Eliminate the demo-data blocker identified in `LE_DASHBOARD_READINESS_REPORT.md` so that Sprint A widgets render against real user data.

**Status**: MOSTLY RESOLVED — Code audit on 2026-02-23 found that most fixes were already applied in prior commits. One remaining fix applied below.

#### What was already done (verified 2026-02-23)

1. `/api/setup/data` endpoint **already exists** in `routes/setup.js` (L700–791). Supports both NeDB (edge) and PostgreSQL (cloud) paths.
2. `loadRoomsFromBackend()` in `app.foxtrot.js` (L5124–5199) **already uses a 3-tier strategy**: `/api/setup/rooms` → `/api/setup/data` → static `/data/rooms.json` fallback (with auth).
3. Auth endpoint in `LE-dashboard.html` **already correct**: uses `/api/auth/change-password` (L2545).
4. `public/data/rooms.json` now contains **real user data** (74 lines, "Main Grow Room" from setup wizard), not the 812-line demo file the readiness report described.
5. Demo-mode comments cited in the readiness report (lines 19, 2373, 2558, 2839) **do not exist** in the current codebase. The `loadDemoFarmSnapshot()` function only fires when `DEMO_MODE=true` env var is set.

#### Remaining fix applied (2026-02-23)

**Bug**: `wizardStatesDB` was declared as a module-level `const` at `server-foxtrot.js:26409` but **never exposed on `app.locals`**. Both `/api/setup/data` and `/api/setup/rooms` read `req.app.locals?.wizardStatesDB` which returned `undefined` on edge devices, causing the NeDB path to fail.

**Fix**: Added `app.locals.wizardStatesDB = wizardStatesDB;` immediately after the NeDB initialization at `server-foxtrot.js:26414`.

#### Exit Criteria

- ~~Dashboard loads room data from NeDB setup wizard config, not static file.~~ ✅ Already done via 3-tier fallback.
- ~~No references to `/data/rooms.json` remain in frontend fetch calls.~~ N/A — static fallback is intentional and now serves real data.
- ~~Password-change endpoint uses `/api/auth/change-password`.~~ ✅ Already correct.
- ~~Console shows no demo-mode warnings.~~ ✅ Demo code only fires when `DEMO_MODE=true`.
- **NEW**: `req.app.locals.wizardStatesDB` is defined in edge mode. ✅ Fixed.

> **Gate**: Sprint A may proceed — P0 is now complete.

---

### 4.1 Phase U0 — Research & Validation Gate (3–5 days, required)

**Objective**: Validate dashboard priorities with real user workflows before UI lock.

### Activities

> **Assumption**: Participants are pre-recruited and a clickable prototype already exists before the clock starts. If not, add 2 days for recruitment and prototype assembly.

- 6–10 short interviews (growers, admin staff, tour guides).
- 1 card-sorting exercise to rank task/value importance.
- 1 remote clickable prototype test with 5 users.
- Review existing usage analytics (where available): high-traffic pages, abandoned flows, common refresh patterns.
- **Capture baseline metrics** for time-to-first-action, AI card engagement rate, and session abandonment rate (needed to measure improvement in §10).

### Deliverables

- Ranked KPI list by role (Grower/Admin/Tour Guide).
- "Must see in 10 seconds" dashboard strip definition.
- Approved hierarchy map for upper-left priority zone.
- Top 5 confusion points to eliminate before Sprint A build.

### Exit Criteria

- Stakeholder sign-off on KPI priority order.
- Signed "UI clutter budget" (max cards visible by default).
- Confirmed first-load dashboard sequence for each role.
- Baseline measurements recorded for §10 success metrics.

---

### 4.2 Phase U1 — Information Hierarchy & Visual Clarity (1–2 days)

**Objective**: Make scanning effortless for busy growers.

### Rules

- Upper-left quadrant reserved for: Harvest Readiness + Loss Alerts.
- Primary KPI cards are largest; secondary insights smaller and collapsible.
- Use F-pattern layout for dashboard scan flow.
- Keep card titles action-oriented, not model-oriented.

### Visualization standards

- Trend charts: line/area only unless categorical comparison requires bars.
- Avoid 3D charts and overloaded pie slices.
- Confidence and risk use existing green/yellow/red semantics.
- Every chart includes plain-language summary sentence.

#### Farm Vitality multi-view disposition

`PROPOSAL_FARM_VITALITY_MULTI_VIEW_DASHBOARD.md` (conditionally approved) defines three alternative views (Living Rings, Heartbeat, Happy Blobs) with normalized 0–100 scoring. These views are **deferred to a post-U3 evaluation**. The U1 hierarchy rules above take precedence for the core grower dashboard. If the vitality views pass agronomist validation, they may be offered as an optional alternate dashboard tab in a future phase, subject to the visualization standards defined here.

### Acceptance Criteria

- A new user can answer in <10 seconds:
  1) What needs attention now?
  2) What is safe to defer?
  3) What should be done next?

---

### 4.3 Phase U2 — Customization MVP (2–3 days)

**Objective**: Let users tailor the dashboard without complexity.

### Required features

- Hide/show toggle per non-critical widget.
- Collapsible sections for each major panel.
- Reorder major sections (up/down buttons for MVP; drag-and-drop deferred unless confirmed in Open Decision #2 — adds ~4 h and a touch-polyfill dependency for iPad).
- Save and restore one "My Layout" preset per user.

### Storage

- **Edge (NeDB)**: new `dashboardPrefsDB` collection keyed by `{ farmId, userId }`. Survives device resets; no backend route change needed.
- **Cloud (PostgreSQL)**: `dashboard_preferences` table with `farm_id`, `user_id`, `layout_json`, `updated_at`. Migrate via `database.js runMigrations()` pattern.
- **Fallback**: if preference load fails, render safe defaults; never block dashboard.
- Persist preferences by user + farm scope.
- Safe defaults for first-time users.
- Reset-to-default action always available.

### Acceptance Criteria

- Preferences persist across refresh and relogin.
- Hidden cards remain hidden until explicitly restored.
- Reordering does not break refresh logic or event handlers.

---

### 4.4 Phase U3 — Clean UI & Accessibility Pass (1 day)

**Objective**: Prevent visual noise and improve usability under field conditions.

### Checklist

- Consistent spacing and card rhythm.
- No gratuitous animations.
- CTA buttons visible but not dominant.
- Contrast checks pass WCAG AA for text and controls.
- Touch-target sizing suitable for tablet use.
- Empty states and error states are clear and non-blocking.

---

### 4.5 Phase U4 — Controlled "Wow Factor" Rollout (phased)

**Objective**: Add delight without harming operational clarity.

### Tier 1 (safe, high-value; allowed in near-term)

- Subtle micro-interactions:
  - refresh progress indicator,
  - success confirmation when AI update arrives,
  - gentle card state transitions.
- Storytelling snippets on recommendation cards:
  - short rationale,
  - expected gain,
  - confidence and sample size.
- Dark mode / adaptive theming toggle.

### Tier 2 (pilot-only — voice owned by Farm Ops Agent plan)

- Voice-assisted commands for read/query actions — **implementation owned by `PROPOSAL_FARM_OPS_AGENT_2026-02-23.md` Phase 2**. This plan defers to the agent plan’s NL intent routing architecture. UX work here is limited to ensuring the dashboard surface supports agent-initiated card updates.
- Narrated tour mode using text-to-speech (Lex + Polly pilot).

### Tier 3 (future research)

- AR overlays for tours/training.
- Gamification badges and milestone systems.
- Digital twin 3D growth overlays.

### Guardrail

No Tier 2/3 feature enters default grower workflow until Tier 1 usability metrics are met.

---

## 5) Updated Combined Delivery Plan

This merges existing sprint work with UX governance gates.

> **Note on parallelism**: `UX_ACTION_PLAN.md` allows Sprints A‖B and C‖D to run in parallel. The table below shows the *serial critical path*. Teams with capacity may overlap Sprint A + B and Sprint C + D to reduce the envelope to ~12–17 working days.

| Phase | Focus | Effort | Dependency |
|------|-------|:------:|------------|
| P0 | Dashboard data-source fix | 0.5d | none |
| U0 | User research + KPI prioritization + baseline capture | 3–5d | P0 complete |
| Sprint A | Grower dashboard intelligence | 2–3d | U0 sign-off |
| U1 | Hierarchy + visualization pass | 1–2d | Sprint A baseline UI |
| Sprint B | Recipe modifier UX | 2–3d | Sprint A + U1 (parallelizable with A if capacity allows) |
| Sprint C | Learning/experiment visibility | 2d | Sprint B (parallelizable with D) |
| U2 | Customization MVP | 2–3d | Sprint C data cards |
| Sprint D | Central + wholesale enhancements | 2–3d | prior phases (parallelizable with C) |
| U3 | Accessibility + clean UI hardening | 1d | all visible UI |
| U4 Tier 1 | micro-interactions + narrative cards + dark mode | 2–3d | U3 complete |
| Buffer | Contingency | 1–2d | — |

**Serial critical path**: ~18.5–28 working days (includes P0 + U0 expansion + buffer).  
**Parallel path** (A‖B, C‖D): ~12–17 working days.

---

## 6) Technical Implementation Notes

### 6.1 Frontend architecture additions

- Add a lightweight **dashboard layout manager** module responsible for:
  - section order,
  - collapsed state,
  - hide/show,
  - persisted user preference sync.
- Keep fetch/render split:
  - data adapters normalize API payloads,
  - presentational components render cards/charts.
- Introduce explicit card contracts:
  - `title`, `status`, `confidence`, `summary`, `actions`, `lastUpdated`.

### 6.2 Performance constraints (tablet-first)

- Defer non-critical panels until after first meaningful paint.
- Cap simultaneous refresh bursts; stagger background refresh.
- Avoid heavy dependencies for charting/micro-interactions.
- Track import weight for new packages (see extension stack).

### 6.3 Error-handling UX pattern

- Inline non-blocking alert for data fetch failures.
- Preserve last-known-good values with timestamp.
- Actionable retry options for critical cards.
- Do not blank entire dashboard on partial API failure.

---

## 7) VS Code Extension Baseline (Team Standard)

Recommended baseline for this implementation stream:

| Extension | Why it is in baseline | Team policy |
|-----------|-----------------------|-------------|
| Prettier | Consistent formatting, lower review noise | Required on save |
| ESLint | Catch errors and standards drift early | Required in CI + editor |
| GitLens | Fast code history/context | Recommended |
| REST Client or Thunder Client | In-editor API regression checks | Required for endpoint touch work |
| Import Cost | Prevent heavy bundle additions | Recommended (enable during optimization) |
| Error Lens | Surface issues inline | Recommended |
| Better Comments | Improve TODO/warning clarity | Optional |
| Live Server | Fast local preview iteration | Optional |
| AWS Toolkit | AWS resource visibility/workflows | Recommended for AWS-connected tasks |

Optional: Code Spell Checker, Markdown Preview Enhanced, Tailwind IntelliSense (if Tailwind active in target page).

---

## 8) AWS Services Adoption Strategy (Evaluate vs Build)

Use current architecture for MVP unless a clear bottleneck appears.

| Service | Role | Phase recommendation |
|---------|------|----------------------|
| IoT Core + Greengrass | Edge sensor ingestion + local resilience | Evaluate in Phase 2+ |
| SageMaker | Model lifecycle at scale | Evaluate when training/inference needs exceed current stack |
| Forecast | Time-series demand/harvest forecasting | Pilot with one demand workflow first |
| QuickSight | BI at scale and anomaly surfacing | Use for admin analytics before grower UI replacement |
| Amplify | App hosting + auth/data sync acceleration | Evaluate if mobile app roadmap accelerates |
| Lex + Polly | Voice assistant and narration | Pilot in tour/read-only flows first |
| Kinesis + Timestream | High-volume streaming and time-series storage | Evaluate when refresh latency/volume demands increase |
| Step Functions | Multi-step workflow orchestration | Use for complex asynchronous workflows |
| Device Farm | iPad/Safari compatibility validation | Include in release hardening |

Decision rule: adopt managed AWS service only when it replaces measurable complexity/cost in current operation.

---

## 9) "Wow Factor" Implementation Matrix

| Idea | User value | Risk | Recommended sequence |
|------|------------|------|----------------------|
| Voice commands | Hands-free operation | medium | Owned by Farm Ops Agent plan Phase 2; dashboard provides surface readiness only |
| Micro-interactions | Better feedback and engagement | low | Early (Tier 1) |
| AR overlays | Tour differentiation | high | Research/pilot only |
| Growth digital twins | Explainability + presentation | high | Future phase after core UX stability |
| Dark mode | Comfort in low-light environments | low | Early (Tier 1) |
| Data storytelling | Better comprehension/trust | low | Early (Tier 1) |
| Gamification badges | Motivation | medium | Optional future experiment |
| Smart notification timing | Lower interruption cost | medium | After behavior data matures |

---

## 10) Testing & Success Criteria

### 10.1 UX acceptance tests

- Time-to-first-action for growers decreases from U0 baseline measurement.
- Daily priority task completion starts without drill-down in most sessions.
- Users can identify top 3 priorities in <10 seconds.
- Custom layout persistence success rate >99%.

### 10.2 Product metrics

- Higher engagement with AI recommendation cards vs. U0 baseline.
- Increased acceptance rate for high-confidence recommendations.
- Reduced abandoned sessions on dashboard pages vs. U0 baseline.
- Lower support tickets for "where is X" / "what do I do first" questions.

### 10.3 Reliability/performance checks

- No full-page render blocks on partial API failures.
- Refresh and card rendering stay responsive on iPad Safari.
- Added packages stay within agreed bundle budget.

---

## 11) Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Dashboard renders against demo data | Critical | Phase P0 mandatory prerequisite |
| Dashboard overload from too many cards | High | U0 KPI prioritization + clutter budget + progressive disclosure |
| Novel features distract from grower tasks | Medium | Tiered wow-factor rollout with hard gates |
| Layout complexity increases maintenance burden | Medium | Single layout manager and strict card contracts |
| Performance regressions on tablets | High | import size checks + staged refresh + device testing |
| Research skipped due timeline pressure | High | U0 is mandatory gate before UI lock |
| Inconsistent code quality across contributors | Medium | extension baseline + lint/format policy |
| Voice work duplicated across plans | Medium | Voice owned by Farm Ops Agent plan; this plan defers |

---

## 12) Open Decisions for Review

1. Confirm target users for U0 interviews (exact counts by role).
2. Confirm whether drag-and-drop is required for MVP, or up/down reorder is sufficient. Note: drag-and-drop adds ~4 h effort and requires a touch-polyfill for iPad Safari (e.g., SortableJS, ~14 KB gzipped). Up/down buttons are trivial and have zero dependency cost.
3. ~~Confirm whether voice pilot is included in this cycle or deferred.~~ **Resolved**: Voice implementation is owned by `PROPOSAL_FARM_OPS_AGENT_2026-02-23.md` Phase 2. This plan provides dashboard surface readiness only.
4. Confirm whether dark mode is mandatory for initial release.
5. Confirm whether Device Farm testing is required before production release.

---

## 13) Final Recommendation

Proceed with the existing sprint implementation in `UX_ACTION_PLAN.md`, but first complete Phase P0 (dashboard data-source fix), then add the U0/U1/U2/U3 governance layers before broad rollout. This keeps delivery practical while materially improving clarity, adoption, and operator trust.

**Recommended execution order**: P0 → U0 → Sprint A → U1 → Sprint B → Sprint C → U2 → Sprint D → U3 → U4 Tier 1.

---

*End of plan.*
