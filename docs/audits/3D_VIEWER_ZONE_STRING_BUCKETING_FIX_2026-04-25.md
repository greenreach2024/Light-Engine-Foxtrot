# 3D Viewer Zone Bucketing Fix — Groups Pile Into First Zone

**Date:** 2026-04-25
**Reporter:** Operator (via Peter)
**Symptom:** "Grow Management room shows 24 units per room and 3D viewer shows
60 grow units in one of two zones. Room dimensions and zones are correct."

## Findings

Production canonical data (LE `/data/`):

- `rooms[0].installedSystems[0].quantity = 60`
- `rooms[0].zones = ["Zone 1", "Zone 2"]` (array of **strings**, not objects)
- `groups.json` — 60 groups, evenly split: 30 with `zone:"Zone 1"`, 30 with
  `zone:"Zone 2"`. Round-robin from `reconcileGroupsFromRooms()` is correct.

So data on disk is consistent. Only the **3D rendering** is wrong.

## Root cause

`public/js/3d-farm-viewer-v2.js` → `getZoneRects(room)` treats every entry of
`room.zones` as an object:

```js
return zones.map((z, i) => ({
  id: z.id, name: z.name || z.id,   // strings: both undefined!
  x_m: i * sliceLen, ...
}));
```

For string zones, `z.id` and `z.name` are `undefined`. Every produced rect
ends up with `name: undefined`. Then in `buildScene()`:

```js
zoneFloors.set(zr.name, zr); zoneFloors.set(zr.id, zr); // both undefined keys
...
buckets.forEach((groupsArr, zoneKey) => {
  const zr = zoneFloors.get(zoneKey) || zoneRects[0]; // zoneKey="Zone 1"/"Zone 2"
                                                     // not in map -> fallback
  placeGroupsInZone(roomGroup, zr, groupsArr, room);  // ALL into zoneRects[0]
});
```

`zoneFloors` only has one usable entry (the second `set(undefined, …)`
overwrites the first), and lookups by `"Zone 1"` / `"Zone 2"` miss, so both
buckets fall through to `zoneRects[0]` and all 60 towers render in Zone 1.

The "24 units per room" the operator saw is a separate cosmetic figure — the
Room Build Plan draft (`state.desiredUnits`) or Selection Summary sidebar's
"Draft units" — not the canonical count. Canonical is 60 (`installedSystems`
& `groups.json` agree).

## Fix

Normalize `room.zones` entries before mapping. String entries become
`{ id: "Zone 1", name: "Zone 1" }`, keeping the slice-fallback and `haveGeom`
branches working with object semantics.

Applied to both copies of the viewer:

- `public/js/3d-farm-viewer-v2.js`
- `greenreach-central/public/js/3d-farm-viewer-v2.js`

## Verification

Reload the 3D scene; with `rooms[0].zones = ["Zone 1","Zone 2"]` and 60
groups split 30/30, the viewer should now render two distinct zone floors and
place ~30 towers in each, instead of piling 60 into Zone 1.
