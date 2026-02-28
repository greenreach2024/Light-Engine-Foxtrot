# Phase 3C Implementation Delta (SLA & Substitution Persistence)

Date: 2026-02-28
Scope: Replace in-memory SLA/substitution state in `routes/wholesale/sla-policies.js` with persistent NeDB-backed store and retain existing API contract.
Status: Proposed (ready for Review Agent validation)

## Objectives

- Remove volatile Map-only state for SLA and substitution workflows.
- Preserve existing response shape and endpoint behavior.
- Keep Phase 3 migration pattern consistency (dual-write compatibility + safe rollback).

## Current Volatile State (to migrate)

From `routes/wholesale/sla-policies.js`:
- `slaRules` (Map)
- `substitutionPolicies` (Map)
- `buyerPreferences` (Map)
- `slaViolations` (Map)
- `global.substitutionApprovals` (Map)

## Files in This Delta

### New file
- `lib/wholesale/sla-store.js`

### Modified file
- `routes/wholesale/sla-policies.js`

### Optional docs update (post-implementation)
- `PHASE_3_DATA_PERSISTENCE_PROPOSAL_2026-02-28.md`
- `REVIEW_AGENT_HANDOFF_PACKET_2026-02-26.md`

## Store Design (`lib/wholesale/sla-store.js`)

### Datastores
- `data/wholesale-sla-rules.db`
- `data/wholesale-substitution-policies.db`
- `data/wholesale-buyer-preferences.db`
- `data/wholesale-sla-violations.db`
- `data/wholesale-substitution-approvals.db`

### Indexes
- SLA rules: `rule_id` (unique), `applies_to`, `priority`, `active`
- Substitution policies: `policy_id` (unique), `active`, `requires_buyer_approval`
- Buyer preferences: `buyer_id` (unique), `updated_at`
- Violations: `violation_id` (unique), `farm_id`, `status`, `created_at`
- Approvals: `approval_id` (unique), `buyer_id`, `status`, `expires_at`, `requested_at`

### Store API (proposed)
- `seedDefaultSlaRules(defaultRules)`
- `seedDefaultSubstitutionPolicies(defaultPolicies)`
- `saveSlaRule(rule)` / `listSlaRules(filters)` / `getSlaRule(ruleId)`
- `saveSubstitutionPolicy(policy)` / `listSubstitutionPolicies()` / `getSubstitutionPolicy(policyId)`
- `saveBuyerPreferences(prefs)` / `getBuyerPreferences(buyerId)`
- `saveSlaViolation(violation)` / `listSlaViolations(filters)`
- `saveSubstitutionApproval(approval)` / `getSubstitutionApproval(approvalId)` / `updateSubstitutionApproval(approvalId, patch)`
- `expirePendingSubstitutionApprovals(nowIso)` (cleanup helper)

## Route Migration Mapping (`routes/wholesale/sla-policies.js`)

- Boot initialization:
  - Replace Map seeding with `seedDefaultSlaRules(...)` and `seedDefaultSubstitutionPolicies(...)`.

- `POST /rules`:
  - Replace `slaRules.set(...)` with `saveSlaRule(...)`.

- `GET /rules`:
  - Replace `Array.from(slaRules.values())` with `listSlaRules({ buyer_id })`.

- `POST /violations`:
  - Replace `slaRules.get(rule_id)` + `slaViolations.set(...)` with `getSlaRule(rule_id)` + `saveSlaViolation(...)`.

- `GET /violations`:
  - Replace Map/filter logic with `listSlaViolations({ farm_id, status, from_date, to_date })`.

- `POST /policies`:
  - Replace `substitutionPolicies.set(...)` with `saveSubstitutionPolicy(...)`.

- `GET /policies`:
  - Replace `Array.from(substitutionPolicies.values())` with `listSubstitutionPolicies()`.

- `POST /find`:
  - Replace `substitutionPolicies.get(policy_id)` with `getSubstitutionPolicy(policy_id)`.

- `POST /request-approval`:
  - Replace `global.substitutionApprovals` logic with `saveSubstitutionApproval(...)`.

- `POST /respond/:approval_id`:
  - Replace `global.substitutionApprovals.get(...)` + in-memory mutation with `getSubstitutionApproval(...)` + `updateSubstitutionApproval(...)`.

- `POST /buyer/preferences`:
  - Replace `buyerPreferences.set(...)` with `saveBuyerPreferences(...)`.

- `GET /buyer/preferences/:buyer_id`:
  - Replace `buyerPreferences.get(...)` with `getBuyerPreferences(...)`.

## Data/Behavior Compatibility Notes

- Preserve all existing route response JSON keys (`status`, `data`, `message`, etc.).
- Preserve default fallback behavior for buyer preferences when no record exists.
- Preserve default SLA and policy sets functionally equivalent to current constants.
- Preserve approval-expiry semantics (`expires_at`) and response outcomes.

## Validation Matrix (Phase 3C)

1. SLA rules persistence:
- Create custom rule via `POST /rules`
- Restart server
- Verify presence via `GET /rules`

2. Substitution policies persistence:
- Create custom policy via `POST /policies`
- Restart server
- Verify via `GET /policies`

3. Buyer preferences persistence:
- Set via `POST /buyer/preferences`
- Restart server
- Verify via `GET /buyer/preferences/:buyer_id`

4. Violations persistence:
- Record violation via `POST /violations`
- Verify filters via `GET /violations?farm_id=...`

5. Approval workflow persistence:
- Create request via `POST /request-approval`
- Restart server
- Respond via `POST /respond/:approval_id`
- Verify status transitions and expiry handling

## Rollback Plan

- Revert route file to Map-based implementation in one patch.
- Keep NeDB files as non-authoritative artifacts (safe to ignore/remove later).
- No source canonical data files are modified in this phase.

## Risks & Mitigations

- Risk: subtle response shape drift.
  - Mitigation: preserve route-level payload construction unchanged; only replace backing reads/writes.

- Risk: seed duplicates for default rules/policies.
  - Mitigation: unique indexes on `rule_id` and `policy_id`, upsert semantics in store layer.

- Risk: approval-expiry logic inconsistency.
  - Mitigation: centralize expiry check in store helper used by response route.

## Exit Criteria

- No in-memory SLA/substitution Maps remain as source of truth.
- Restart persistence passes for rules, policies, preferences, violations, approvals.
- Existing endpoint contract remains backward compatible.
