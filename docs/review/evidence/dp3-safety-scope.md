# DP-3 Evidence — Safety Scope (CO₂ / Lighting)

## Decision
Include CO₂ interlock in T-1 scope; defer lighting interlocks to Phase 2.

## Owner
Controls/Safety Lead

## Review Date
2026-02-23

## Required Proof
- Safety boundary matrix for all control paths
- CO₂ fail-closed behavior traces
- Audit event samples for blocked actions
- Deferred-lighting rationale + timeline

## Linked Criteria
- S-1
- S-2
- S-3
- S-4
- S-5
- S-6

## Status
Implemented (Phase 1 scope)

## Implementation Scope (Phase 1)
- Enforced fail-closed safety boundary on actuator command chokepoints currently used by automation/scheduling:
	- `POST /api/switchbot/devices/:deviceId/commands`
	- `POST /api/kasa/device/:host/power`
	- `POST /api/device/:deviceId/power`
- Additional route-coverage hardening pass (2026-02-22):
	- `POST /api/kasa/devices/:deviceId/control`
	- `POST /api/device/:deviceId/spectrum` (primary route)
	- Legacy fallback control routes near file tail:
		- `POST /api/device/:deviceId/power`
		- `POST /api/device/:deviceId/spectrum`
		- `POST /api/device/:deviceId/dimming`
- Scope in this tranche remains aligned to DP-3 decision:
	- High-risk (`actuator-high`) commands fail closed on unknown/stale safety state.
	- Low-risk commands proceed with audit logging.
	- Lighting interlock expansion remains deferred to Phase 2.

## Code Evidence
- Added mandatory safety gateway module:
	- `lib/device-safety-envelope.js`
		- Persistent state store: `data/safety-envelope-state.db`
		- Persistent audit log: `data/safety-audit-log.db`
		- Fail-closed checks for actuator-high on missing/stale state
		- Confirmation validation for actuator-high activation
		- Decision + execution audit records for every command path
- Integrated gateway into live control endpoints:
	- `server-foxtrot.js`
- Added source context propagation so automation decisions are auditable by origin:
	- `lib/automation-engine.js` (`source: automation`)
	- `lib/schedule-executor.js` (`source: schedule-executor`)

## Smoke Test Excerpts (2026-02-23)
Command run (local):
- `node --input-type=module -e "...executeSafetyEnvelope..."`

Observed results:
- Low-risk allow path:
	- `test-low-1` + `turnOn` → `allowed: true`, `auditId: SAF-1771806830533-099B01`
- High-risk fail-closed (no state):
	- `test-high-1` + `turnOn` → `allowed: false`
	- reason: `No safety state on record for actuator-high command. Run health check first.`
	- `auditId: SAF-1771806830553-90081E`
- High-risk allowed after state + confirmation:
	- seed state via `turnOff` on `test-high-2` → allowed
	- `turnOn` with confirmation payload → allowed
	- `auditId: SAF-1771806830554-915A80`
- Audit tail includes both `allowed` and `denied` decisions with reasons.

## Acceptance Mapping
- S-1 (fail-closed on unknown state): ✅ enforced for `actuator-high`
- S-2 (stale-state protection): ✅ enforced with default 2h threshold (`SAFETY_STALE_THRESHOLD_MS` override)
- S-3 (auditable decisions): ✅ every evaluation persisted with `auditId`
- S-4 (mandatory gateway on active command paths): ✅ integrated on current automation/scheduler chokepoints
- S-5 (source attribution): ✅ `source`, `userId`, `sessionId` recorded
- S-6 (deferred lighting interlocks rationale): ✅ explicitly deferred to Phase 2 per DP-3 decision
