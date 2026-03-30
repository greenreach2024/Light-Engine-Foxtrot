# Delivery Service Implementation Plan v2.0.0 — Review Agent Assessment

**Date:** February 23, 2026  
**Reviewed Document:** `DELIVERY_SERVICE_IMPLEMENTATION_PLAN.md` v2.0.0 (840 lines)  
**Cross-Referenced:** `DELIVERY_SERVICE_ARCHITECTURE_PLAN.md` v1.1.0 (239 lines), `DELIVERY_SERVICE_AUDIT_REPORT_2026-02-22.md` (339 lines), `DELIVERY_SERVICE_IMPLEMENTATION_TASK_LIST.md` (107 lines), live codebase  
**Review Scope:** Factual accuracy, architecture alignment, completeness, implementability

---

## Verdict: APPROVED WITH CORRECTIONS

The v2.0.0 plan is a substantial improvement over v1.0.0. It correctly restructures the implementation around the audit findings, removes PostGIS from MVP, adds regulatory awareness, and introduces a mandatory test gate. The Phase 0 blocking remediation is the right decision.

**However, 3 factual errors and 7 structural concerns must be addressed before implementation begins.**

---

## What the Plan Gets Right

| Strength | Detail |
|----------|--------|
| Phase 0 as blocking prerequisite | Correct sequencing — compliance and persistence before customer-facing work |
| PostGIS removed from MVP | Aligned with Architecture Plan AD-02. `postal_prefix` LIKE matching is appropriate for MVP |
| Effort reconciled | 11–16 days is realistic and honest about the Phase 0 delta vs Architecture Plan's 6–9 days |
| Mandatory test gate | Three concrete suites (isolation, auth matrix, quote determinism) with verifiable assertions |
| Regulatory sections (RC-1, RC-2, RC-3) | Well-researched. DPWRA and CRA T4A are real obligations. Correct to flag as pre-scaling gates |
| Document reconciliation table | Directly resolves all F-6 contradictions in one place |
| "Files NOT to create" list | Prevents scope creep. Good boundary enforcement |
| Open Decision Points | DP-1, DP-2, DP-3 are the right questions at the right time |
| Canonical fee model selection | `max(base_fee, zone_fee)` is the measurable choice for MVP. Logging km/min for future transition is smart |
| Upsert patterns | `INSERT ... ON CONFLICT DO UPDATE` for idempotency is correct for EB deployments where restarts are frequent |

---

## Factual Errors (Must Fix)

### FE-1: `delivery-platform.html` Does Not Exist on Any Active Branch

**Severity:** Plan references a file that cannot be modified

Phase 0.1 dedicates 4 action items to modifying `delivery-platform.html`. The "Current State Analysis" table (line 50) lists it as 1,076 lines.

**Actual state:**
- The file exists **only** on `origin/archive/b2b-delivery-platform` (tag: `backup-main-20260222-131558`)
- It does **not** exist on `main` (current working branch) or `main`
- It was never merged into the current branch — it was archived

**Impact:** Phase 0.1 action items 0.1.1–0.1.4 target a file that isn't in the active codebase. If production was deployed from the current branch (commit `b235d7e`), the landing page is already offline.

**Correction required:**
1. Confirm whether `delivery-platform.html` is currently served in production (check EB deployment)
2. If it's already gone from production → mark Phase 0.1 as **RESOLVED** (file archived, not deployed)
3. If it's somehow still deployed → the remediation actions are correct but must reference the archive branch
4. Either way, remove it from the "Files to Modify" table (line 716) since it's not on the working branch

### FE-2: `cost-allocator.ts` Does Not Exist on Disk

**Severity:** Plan actions target a file that is already gone

Phase 0.5.1 says: "Move to `src/modules/pricing/_archived/cost-allocator.ts` or delete."  
The "Files to Remove or Archive" table (line 730) lists it for archival.

**Actual state:** `src/modules/pricing/cost-allocator.ts` does not exist anywhere in the workspace. No file at that path on disk and no directory `src/modules/pricing/` exists.

**Correction required:**
1. Mark Phase 0.5.1 as **ALREADY RESOLVED** — file doesn't exist
2. Remove from "Files to Remove or Archive" table
3. Phase 0.5.2 (remove advertised formula) is contingent on FE-1 — if `delivery-platform.html` is also gone, this is also resolved
4. Phase 0.5.3 (document canonical model) and 0.5.4 (log km/min) remain valid

### FE-3: Self-Fetch Line Number

**Severity:** Minor — incorrect line reference

Phase 0.6 references line 411 for the self-fetch anti-pattern. The audit report also says line 411.

**Actual state:** The `fetch('http://localhost:8091/...')` call is at **line 403** in `routes/farm-sales/delivery.js`.

**Correction required:** Update line reference from 411 to 403.

---

## Structural Concerns (Should Fix)

### SC-1: Task List Not Reconciled

The existing `DELIVERY_SERVICE_IMPLEMENTATION_TASK_LIST.md` marks Slices 1–4 as complete (checked boxes). But those completions were done with **in-memory storage** — the exact problem Phase 0.3 fixes. After Phase 0.3 applies the migration, Slices 2 and 3 (settings API, quote endpoint) will need **rework** to switch from `Map` to PostgreSQL.

**Recommendation:** Either:
- Update the task list to uncheck Slices 2–3 and add notes that they need DB migration rework, or
- Add a note in Phase 2 of the implementation plan stating: "Slice 2–3 endpoints exist but must be refactored from in-memory to database-backed. This is the primary work of this phase."

### SC-2: Phase Numbering Collision with Architecture Plan

The Architecture Plan uses "Phase 2" to mean **future PostGIS/geo work** (AD-02). The Implementation Plan uses "Phase 2" to mean **Delivery Settings Persistence + Zone Configuration** (current MVP work). Both documents also use "Phase 2+" to mean different things.

When someone says "Phase 2 requires PostGIS" vs "Phase 2 is zone config," confusion is inevitable.

**Recommendation:** Rename Implementation Plan phases to avoid collision:
- Keep "Phase 0" (unique, no conflict)
- Use "MVP-1" through "MVP-6" for in-scope phases, or
- Reference Architecture Plan workstreams (A–E) in parentheses alongside phase numbers

### SC-3: `radius_km` Zone Mode — Untested and Undefined

The migration's CHECK constraint allows `zone_mode IN ('postal_prefix', 'radius_km')`. The zone matching function (Phase 2.2) only implements `postal_prefix` logic. There is no `radius_km` matching function anywhere in the plan.

Test Suite 3 (Quote Determinism) only tests `postal_prefix` scenarios.

**Recommendation:** Either:
- Remove `radius_km` from the MVP CHECK constraint and add it via migration in Phase 2+, or
- Define the `radius_km` matching logic (requires lat/lng distance calculation, which approaches the geo complexity the plan defers)
- Add at least one `radius_km` test case to Suite 3

### SC-4: No Rollback Plan

The plan adds a database migration (3 tables) but doesn't document a rollback path. If the migration causes issues or Phase 0 remediation introduces regressions:
- What happens to the tables?
- Is there a `DROP TABLE IF EXISTS` rollback migration?
- Can EB roll back to pre-delivery code while tables exist?

**Recommendation:** Add a "Rollback Strategy" section or paragraph addressing:
1. Migration rollback (down migration script)
2. Feature flag for disabling delivery without schema rollback
3. EB deployment rollback compatibility

### SC-5: Feature Flag Not Specified

Architecture Plan §9 mandates "Keep feature flag for rapid rollback." The implementation plan doesn't define the flag mechanism.

**Recommendation:** Add to Phase 0 or Phase 1:
- Flag storage location (database row? environment variable? `farm_delivery_settings.enabled` is per-farm but no global kill switch)
- Global kill switch separate from per-farm `enabled` flag
- Behavior when flag is off (hide UI? return eligible:false from quote? both?)

### SC-6: `greenreach-central/config/database.js` as Migration Target

The "Files to Modify" table (line 723) lists `greenreach-central/config/database.js` with change "Run delivery migration." This implies the migration is executed by modifying the config file, which is fragile.

**Recommendation:** Clarify migration execution strategy:
- Is there an existing migration runner? (check for `knex`, `node-pg-migrate`, or custom runner)
- If not, document how `001_delivery_mvp_tables.sql` gets executed (manual `psql`? startup auto-run? CI step?)
- Don't embed migration execution in a config file

### SC-7: Admin Endpoints Auth Pattern Needs Specificity

Phase 0.2.2 says "Add admin JWT + role verification middleware." The code example shows importing `requireAdmin` from `../middleware/auth.js`. But the audit found that `admin-delivery.js` currently has **no auth at all**.

**Question:** Does `greenreach-central/middleware/auth.js` export a `requireAdmin` function today? If not, Phase 0.2 has a hidden dependency on creating that middleware.

---

## Minor Observations

| # | Observation | Severity |
|---|-------------|----------|
| M-1 | Plan references `LE-farm-admin.html` and `farm-admin.html` as if they're the same. Both files exist separately in `public/` and `greenreach-central/public/`. Clarify which is the delivery settings host for Phase 4 | Low |
| M-2 | Phase 5.2 inline SQL query references `farms(farm_id)` table. Verify this table exists with that exact schema | Low |
| M-3 | Banner component (Phase 1.1) uses innerHTML-style template literals with string interpolation. If `title` or `description` ever come from user input, this is an XSS vector. Consider DOM API or sanitization | Low |
| M-4 | The "Current State Analysis" table claims POS delivery tab is "Stub only" and farm-sales D2C is "Complete" — these weren't verified in the audit report. Add verification note or mark as "unverified" | Low |
| M-5 | Phase 3.2 says "Backward compatibility: Existing checkout execute path remains unchanged when delivery is disabled (Architecture Plan AD-03)" — the Architecture Plan's AD-03 says "All changes must be additive; no existing payload keys removed." These are related but not the same statement | Low |

---

## Architecture Plan Conditions of Approval — Alignment Check

| # | Condition | v2.0.0 Status |
|---|-----------|---------------|
| 1 | Implement MVP scope only | **MET** — Phase 2+ scope explicitly excluded with reasoning |
| 2 | No polygon/PostGIS until Phase 2 ADR | **MET** — `ST_Contains` removed, `postal_prefix` LIKE used, CHECK constraint allows `postal_prefix` and `radius_km` only |
| 3 | Auth + tenant middleware on all delivery writes | **PLANNED** — Phase 0.2 + 0.4 address this. Must be verified post-implementation |
| 4 | Backward compatibility for wholesale checkout | **STATED** — Phase 3.2 claims compatibility but no regression test specified. Add to Suite 3 |
| 5 | Validation artifacts in PR notes | **PLANNED** — Test gate + pre-deployment checklist require evidence |

---

## Recommended Corrections Summary

### Must Fix Before Implementation

| # | Item | Action | Reference |
|---|------|--------|-----------|
| 1 | `delivery-platform.html` status | Confirm production state, update Phase 0.1 accordingly | FE-1 |
| 2 | `cost-allocator.ts` already gone | Mark Phase 0.5.1 resolved, remove from files table | FE-2 |
| 3 | Self-fetch line number | Change 411 → 403 | FE-3 |

### Should Fix Before Implementation

| # | Item | Action | Reference |
|---|------|--------|-----------|
| 4 | Task list reconciliation | Uncheck Slices 2-3 or add migration rework note | SC-1 |
| 5 | `radius_km` undefined | Remove from MVP CHECK or define matching logic | SC-3 |
| 6 | Add rollback plan | Down migration + feature flag rollback path | SC-4 |
| 7 | Define feature flag | Global kill switch + per-farm toggle | SC-5 |
| 8 | Migration execution strategy | Clarify how SQL runs, don't embed in config | SC-6 |
| 9 | Verify `requireAdmin` exists | Confirm middleware dependency | SC-7 |

### Nice to Fix

| # | Item | Action | Reference |
|---|------|--------|-----------|
| 10 | Phase numbering collision | Rename to avoid confusion with Architecture Plan | SC-2 |
| 11 | Add checkout regression test | Suite 3: verify existing checkout still works when delivery disabled | Condition 4 |
| 12 | Clarify `LE-farm-admin.html` vs `farm-admin.html` | Specify the canonical target for Phase 4 | M-1 |

---

## Decision Required Before Proceeding

1. **Is `delivery-platform.html` currently live in production?** If not, Phase 0.1 effort drops to ~0.
2. **Should `radius_km` be in MVP?** If not, remove from CHECK constraint and defer.
3. **Answer DP-1, DP-2, DP-3** from the plan before Phase 2 work begins.

---

*Review complete. Plan is solid with corrections. Ready for implementation after the 3 factual errors are resolved.*
