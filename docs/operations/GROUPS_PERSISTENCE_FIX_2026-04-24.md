# Groups + Rooms Persistence Fix (Cloud Run)

**Date:** 2026-04-24
**Farm affected:** FARM-MLTP9LVH-B0B85039 (GreenReach Greens)
**Severity:** P1 — operator edits silently reverted after container recycles.

## Symptom

Operators on the Light Engine (LE) service reported:

- Grow units deleted from the Grow Management page disappeared from both
  Grow Management and the 3D Farm Viewer.
- After a hard refresh (or a period of inactivity that caused Cloud Run to
  cycle the container), the deleted grow units reappeared.
- Room dimensions saved from Grow Management persisted correctly; zone
  geometry edits appeared to save but sometimes reverted.

## Root Cause

`server-foxtrot.js` declares:

```js
const DATA_DIR = path.resolve("./public/data");
```

On Cloud Run this resolves to `/app/public/data/`, which lives on the
**ephemeral container filesystem**, not on the `/app/data` mount backed by
the `greenreach-storage` GCS bucket. Every write performed by
`loadGroupsFile` / `saveGroupsFile`, `writeJsonQueued(...)`, and
`writeJSON(...)` landed in the ephemeral layer. When Cloud Run recycled the
instance (idle scale-down, revision deploy, traffic routed to a different
instance), the new container booted with whatever was baked into the
Docker image — typically the stub defaults written by `seedRuntimeDataFiles`
— and the operator's edits were lost.

`gs://greenreach-storage/groups.json` at the bucket root contains a stale
snapshot from a previous deployment topology and was not being read or
updated by LE (LE uses the `le/` prefix via `services/gcs-storage.js`).

## Fix

Added a narrow GCS mirror layer in `server-foxtrot.js` that applies only to
operator-authored files listed in `__GCS_MIRRORED_FILES`:

- `groups.json`
- `rooms.json`
- `room-map.json`
- `plans.json`
- `recipes.json`
- `schedules.json`
- `farm.json`
- `iot-devices.json`

### Write path

Every write helper now mirrors the payload to GCS under `le/<relative path>`:

- `writeJsonQueued(fullPath, jsonString)` — queued writer used by
  `/api/setup/save-rooms` and other handlers.
- `saveGroupsFile(groups)` — Groups V2 persistence helper used by the
  POST `/data/groups.json` endpoint and `withGroupsLock` callers.
- `writeJSON(fileName, value)` — generic env/farm writer.

The mirror is a no-op when `process.env.K_SERVICE` is unset (local dev),
so the local filesystem remains authoritative during development.

### Read path (hydrate on boot)

`startOperationalServices` now calls `await hydrateCriticalDataFromGCS()`
**before** `seedRuntimeDataFiles()`. For each mirrored file, the boot
hydrator pulls the latest GCS copy and writes it into `DATA_DIR` so
subsequent reads (`readJsonSafe`, `loadGroupsFile`, etc.) see the durable
state. The seed step remains in place for first-ever boots where GCS also
has no copy.

## Why not change `DATA_DIR` to `/app/data`?

`public/data/` is also served as static files by Express. Repointing
`DATA_DIR` would have required also moving static-file resolution and
updating every absolute-path consumer. The mirror approach changes only
the write and boot paths while preserving every existing read path and
the static file contract.

## Bidirectional Sync (Grow Management <-> 3D Viewer)

The `DataFlowBus` wiring on both sides is already correct:

- `public/views/grow-management.html` emits `rooms`/`zones` on dimension
  saves (L1476-1477) and zone-count stepper (L2105-2107).
- `public/views/3d-farm-viewer.html` subscribes to `rooms`/`zones`/`groups`
  (L5440-5446) and calls `loadAllData({ skipRebuildIfUnchanged: false })`
  which forces a full rebuild — no cache short-circuit.
- The 3D viewer's Zone Editor emits `rooms`+`zones` on save (L5608-5610).

Cross-iframe / cross-tab propagation rides on the `localStorage` event
that `DataFlowBus.emit` writes, which fires across every same-origin
iframe and tab.

Until the persistence bug was fixed, **the sync layer looked broken**
because the underlying data was reverting. Operators saw:

1. Emit fires, every subscriber refetches `/data/rooms.json`.
2. `/data/rooms.json` is served from ephemeral `DATA_DIR` on the instance
   that handled the save — returns the new data.
3. Next refresh lands on a recycled instance that never saw the write —
   returns the stub baseline.

This manifested as "the 3D viewer doesn't update" when it was actually
"the save didn't survive". With the GCS mirror in place, every instance
hydrates the latest payload on boot and the sync layer behaves as
designed.

## Shadowed BSG Panel (Central)

Phase 1 of the group-first ops refactor added the optional BSG group-first
configuration fieldset to `public/views/grow-management.html` but not to
`greenreach-central/public/views/grow-management.html`. Because
`server-foxtrot.js` serves the Central `public/` directory first (Central
wins for any duplicated file), the LE copy was shadowed and operators
never saw the panel. The fieldset has been copied into the Central copy
at the matching structural location (between `bsgGroupIdPrefix` and
`bsgPreview`).

## Deployment

- Rebuild LE (`light-engine:latest`) and Central (`greenreach-central:latest`).
- Deploy both by exact `@sha256:` digest via `gcloud run services update`.
- Verify: on LE, delete a growing unit, force a revision cold start
  (`gcloud run services update light-engine --region=us-east1 --update-env-vars=FORCE_COLD=$(date +%s)`),
  refresh, unit should remain deleted.

## Files Touched

- `server-foxtrot.js` — GCS mirror + hydrate helpers, `writeJsonQueued`,
  `saveGroupsFile`, `writeJSON`, `startOperationalServices`.
- `greenreach-central/public/views/grow-management.html` — BSG fieldset
  parity with LE copy.
- `docs/operations/GROUPS_PERSISTENCE_FIX_2026-04-24.md` — this document.
