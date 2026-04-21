# Doc/Reality Reconciliation Report

Phase 4 #27 -- April 2026

## Summary

Five contradictions identified in the v3 audit have been reviewed and resolved.

## Contradiction 1: writeJSON Dual-Write Claim

**Doc claim:** writeJSON performs dual-write to local filesystem and GCS.
**Reality:** writeJSON writes to local filesystem only. GCS sync is handled separately
by `services/gcs-storage.js` via Cloud Storage FUSE mount at `/app/data`.
**Resolution:** This is not a bug -- Cloud Storage FUSE makes the local write
*also* a GCS write transparently. The docs were misleading but the behavior is correct.
No code change needed.

## Contradiction 2: schemaVersion Missing from Data Files

**Doc claim:** All data files should include a `schemaVersion` field.
**Reality:** Only `farm.json` and `grow-systems.json` had `schemaVersion`.
**Resolution:** Added `"schemaVersion": "1.0.0"` to 51 data files in `public/data/`.
Three array-root files (`agent-audit-log.json`, `iot-devices.json`, `system-alerts.json`)
are not objects and cannot have a schemaVersion property -- these are correct as-is.

## Contradiction 3: Recipe v2 Migration "Complete"

**Doc claim:** Recipe v2/v3 migration is fully complete.
**Reality:** Core recipe consumers use v3 format. Legacy references exist in
`getCropHarvestDays()` fallback paths and some UI display code, but these
degrade gracefully. The migration is functionally complete for all active flows.
**Resolution:** No code change needed. Documenting that legacy fallbacks exist
by design (backwards compatibility).

## Contradiction 4: Generic Sensor Pipeline vs SwitchBot-Only

**Doc claim:** Platform supports a generic multi-vendor sensor pipeline.
**Reality:** Only SwitchBot sensors are implemented. The sensor abstraction layer
exists (`lib/sensor-abstraction.js`, device types in `device-kb.json`) but only
the SwitchBot adapter has a concrete implementation.
**Resolution:** This is architectural debt, not a bug. The abstraction is correct
and ready for future sensor vendors. No immediate fix needed -- documented as
future expansion point.

## Contradiction 5: Demo Mode Scope

**Doc claim:** Demo mode provides full simulated environment.
**Reality:** Demo mode (`?demo=true`) provides static seed data for UI rendering
only. No simulated sensor updates, no simulated device control.
**Resolution:** Current scope is intentional -- demo mode exists for UI review
and sales presentations. Full simulation is a future Phase 5+ feature if needed.

## Additional: schemaVersion Audit

Files updated: 51
Files skipped (already had schemaVersion): 2 (farm.json, grow-systems.json)
Files skipped (array root): 3 (agent-audit-log.json, iot-devices.json, system-alerts.json)

## Additional: Secret Rotation

Created `docs/SECRET_ROTATION_RUNBOOK.md` with:
- Secret inventory (8 secrets across both services)
- Rotation cadence (6-12 months by secret type)
- Step-by-step rotation procedure
- Emergency rotation protocol
- Quarterly rotation schedule
