/**
 * Room Layout Solver (ESM, server-side / test suite)
 * --------------------------------------------------
 *
 * Given a zone rectangle (lengthM x widthM) and a grow-system template's
 * `spatialContract`, compute:
 *
 *   - maxUnits            — the maximum number of unit instances that fit
 *   - rows / unitsPerRow  — packing layout along the zone's long edge
 *   - mainWalkwayM        — recommended main serving walkway width
 *   - plumbingSide        — which edge should host the plumbing header
 *   - placements(n)       — per-unit placement rects (for 3D rendering + overlap check)
 *
 * Units align their length axis to the zone's long axis (a 2.4 m NFT rack
 * sits along the long wall, not across a narrow zone).
 *
 * Orientation rules:
 *   - butt_end_to_end: units abut end-to-end; one front aisle per row; a
 *     main walkway is reserved between facing rows when rowsMax >= 2.
 *   - double_sided: full front+back clearance on both long sides of the rack.
 *   - single_sided: free-standing tiles with clearance on all sides.
 *
 * The browser build lives in public/lib/room-layout-solver.js and mirrors
 * this logic, exposing `window.RoomLayoutSolver`.
 */

export const DEFAULT_MAIN_WALKWAY_M = 1.2;
const MIN_SPLIT_UNITS = 12;

const round2 = (n) => Number(Number(n).toFixed(2));
const round3 = (n) => Number(Number(n).toFixed(3));

export function normalizeZoneRect(zone) {
  if (!zone) return null;
  const dims = zone.dimensions || zone.dims || zone;
  const l = Number(
    zone.lengthM ?? zone.length ?? dims.lengthM ?? dims.length ?? dims.length_m ?? 0
  );
  const w = Number(
    zone.widthM ?? zone.width ?? dims.widthM ?? dims.width ?? dims.width_m ?? 0
  );
  if (!(l > 0) || !(w > 0)) return null;
  return {
    lengthM: l,
    widthM: w,
    longM: Math.max(l, w),
    shortM: Math.min(l, w),
    areaM2: l * w
  };
}

function readContract(template) {
  const sc = template && template.spatialContract;
  if (!sc) return null;
  const u = sc.unitFootprintM || {};
  const c = sc.workspaceClearanceM || {};
  return {
    unitL: Number(u.length) || 0,
    unitW: Number(u.width) || 0,
    unitH: Number(u.height) || 0,
    front: Number(c.front) || 0,
    back: Number(c.back) || 0,
    ends: Number(c.ends) || 0,
    orientation: sc.orientation || 'butt_end_to_end',
    plumbingSide: sc.plumbingSide || 'any'
  };
}

function placementsFor(rect, c, unitsPerRow, rowsMax, n, mainWalkwayM) {
  if (!n || n <= 0 || unitsPerRow <= 0 || rowsMax <= 0) return [];
  const placements = [];
  const longM = rect.longM;
  const shortM = rect.shortM;
  const rowDepth = c.unitW + c.front + c.back;
  const onAxisStride = c.orientation === 'butt_end_to_end'
    ? c.unitL
    : c.unitL + 2 * c.ends;

  let placed = 0;
  for (let r = 0; r < rowsMax && placed < n; r++) {
    let y;
    if (c.orientation === 'butt_end_to_end' && rowsMax >= 2) {
      y = r === 0
        ? c.back
        : c.back + rowDepth + mainWalkwayM + (r - 1) * rowDepth;
    } else {
      y = r * rowDepth + c.back;
    }
    for (let u = 0; u < unitsPerRow && placed < n; u++) {
      const x = c.orientation === 'butt_end_to_end'
        ? u * onAxisStride
        : u * onAxisStride + c.ends;
      const envX = c.orientation === 'butt_end_to_end' ? x : x - c.ends;
      const envLen = c.orientation === 'butt_end_to_end'
        ? c.unitL
        : c.unitL + 2 * c.ends;
      placements.push({
        index: placed,
        row: r,
        col: u,
        x: round3(x),
        y: round3(y),
        lengthM: c.unitL,
        widthM: c.unitW,
        heightM: c.unitH,
        clearance: { front: c.front, back: c.back, ends: c.ends },
        envelope: {
          x: round3(envX),
          y: round3(y - c.back),
          lengthM: round3(envLen),
          widthM: round3(rowDepth)
        },
        fitsInZone:
          (x + c.unitL) <= longM + 1e-6 && (y + c.unitW) <= shortM + 1e-6
      });
      placed++;
    }
  }
  return placements;
}

export function solveLayout(template, zone, opts = {}) {
  const rect = normalizeZoneRect(zone);
  const c = readContract(template);
  if (!rect || !c || !(c.unitL > 0) || !(c.unitW > 0)) {
    return {
      ok: false,
      reason: !rect ? 'zone-missing' : 'template-missing-spatial-contract',
      maxUnits: 0,
      unitsPerRow: 0,
      rowsMax: 0,
      placements: () => [],
      fits: () => false
    };
  }
  const mainWalkwayM = Number.isFinite(opts.mainWalkwayM)
    ? opts.mainWalkwayM
    : DEFAULT_MAIN_WALKWAY_M;

  const longM = rect.longM;
  const shortM = rect.shortM;

  let rowDepth;
  let rowUnitLength;
  let unitsPerRow;
  let rowsMax;
  let effectiveTileAreaM2;

  if (c.orientation === 'single_sided') {
    rowDepth = c.unitW + c.front + c.back;
    rowUnitLength = c.unitL + 2 * c.ends;
    unitsPerRow = Math.floor(longM / rowUnitLength);
    rowsMax = Math.floor(shortM / rowDepth);
    effectiveTileAreaM2 = rowDepth * rowUnitLength;
  } else if (c.orientation === 'double_sided') {
    rowDepth = c.unitW + c.front + c.back;
    rowUnitLength = c.unitL + 2 * c.ends;
    unitsPerRow = Math.floor(longM / rowUnitLength);
    rowsMax = Math.floor(shortM / rowDepth);
    effectiveTileAreaM2 = rowDepth * rowUnitLength;
  } else {
    rowDepth = c.unitW + c.front + c.back;
    rowUnitLength = c.unitL;
    unitsPerRow = Math.floor(longM / rowUnitLength);
    rowsMax = Math.floor(shortM / rowDepth);
    if (rowsMax >= 2 && (rowsMax * rowDepth + mainWalkwayM) > shortM) {
      rowsMax = Math.floor((shortM - mainWalkwayM) / rowDepth);
      if (rowsMax < 0) rowsMax = 0;
    }
    effectiveTileAreaM2 = rowDepth * rowUnitLength;
  }

  if (unitsPerRow < 0) unitsPerRow = 0;
  if (rowsMax < 0) rowsMax = 0;
  const maxUnits = Math.max(0, unitsPerRow * rowsMax);

  return {
    ok: true,
    template: template.id,
    zone: {
      id: (zone && (zone.id || zone.zoneId)) || null,
      name: (zone && zone.name) || null,
      lengthM: rect.lengthM,
      widthM: rect.widthM,
      areaM2: rect.areaM2
    },
    orientation: c.orientation,
    plumbingSide: c.plumbingSide,
    unit: { lengthM: c.unitL, widthM: c.unitW, heightM: c.unitH },
    clearance: { front: c.front, back: c.back, ends: c.ends },
    rowDepthM: round3(rowDepth),
    rowUnitLengthM: round3(rowUnitLength),
    unitsPerRow,
    rowsMax,
    maxUnits,
    effectiveTileAreaM2: round3(effectiveTileAreaM2),
    occupiedAreaM2: round2(effectiveTileAreaM2 * maxUnits),
    mainWalkwayM,
    fits(n) { return n <= maxUnits; },
    placements(n) { return placementsFor(rect, c, unitsPerRow, rowsMax, n, mainWalkwayM); }
  };
}

export function detectViolations(placements, rect) {
  const out = { overlaps: [], overflows: [] };
  if (!Array.isArray(placements) || !rect) return out;
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    if (!p.fitsInZone) out.overflows.push(i);
    for (let j = i + 1; j < placements.length; j++) {
      const q = placements[j];
      const overlap =
        p.x < q.x + q.lengthM && p.x + p.lengthM > q.x &&
        p.y < q.y + q.widthM  && p.y + p.widthM  > q.y;
      if (overlap) out.overlaps.push([i, j]);
    }
  }
  return out;
}

export function recommendZones(desiredUnits, zoneRects, template) {
  const zones = Array.isArray(zoneRects) ? zoneRects : [];
  const perZone = zones.map((zr) => solveLayout(template, zr));
  const totalMax = perZone.reduce((a, z) => a + ((z && z.maxUnits) || 0), 0);

  if (!desiredUnits || desiredUnits <= 0) {
    return {
      recommendedZones: 1,
      perZone,
      shortfall: 0,
      totalCapacity: totalMax,
      rationale: 'Pick a grow-unit count to see a zone recommendation. Zones let you separate photoperiods, stage cleaning cycles, and run distinct environment recipes inside one room.'
    };
  }

  const firstZone = perZone[0];
  if (firstZone && firstZone.maxUnits >= desiredUnits) {
    if (desiredUnits >= MIN_SPLIT_UNITS && zones.length > 1) {
      return {
        recommendedZones: 2,
        perZone,
        shortfall: 0,
        totalCapacity: totalMax,
        rationale: `Zone 1 alone fits ${firstZone.maxUnits} units, but at ${desiredUnits} racks Evie recommends splitting across 2 zones so you can stagger photoperiods, rotate cleaning days, and hold separate environment recipes (e.g. propagation vs finishing).`
      };
    }
    return {
      recommendedZones: 1,
      perZone,
      shortfall: 0,
      totalCapacity: totalMax,
      rationale: `Zone 1 fits ${desiredUnits} units with ${firstZone.maxUnits - desiredUnits} slots to spare. One zone is sufficient; a second zone becomes useful once you want to separate planting schedules or hold an independent climate recipe.`
    };
  }

  let remaining = desiredUnits;
  const usedZones = [];
  for (let i = 0; i < perZone.length; i++) {
    if (remaining <= 0) break;
    const z = perZone[i];
    if (!z || !z.maxUnits) continue;
    const take = Math.min(z.maxUnits, remaining);
    usedZones.push({
      zoneId: (z.zone && z.zone.id) || null,
      zoneName: (z.zone && z.zone.name) || `Zone ${i + 1}`,
      units: take,
      capacity: z.maxUnits
    });
    remaining -= take;
  }

  const shortfall = Math.max(0, remaining);
  if (shortfall === 0) {
    return {
      recommendedZones: usedZones.length,
      perZone,
      shortfall: 0,
      totalCapacity: totalMax,
      usedZones,
      rationale: `${desiredUnits} units will not fit in Zone 1 (cap ${(firstZone && firstZone.maxUnits) || 0}). Evie recommends using ${usedZones.length} zones: ${usedZones.map((u) => `${u.units} in ${u.zoneName}`).join(', ')}. Zones let you separate photoperiods and rotate cleaning cycles per bank.`
    };
  }
  return {
    recommendedZones: usedZones.length,
    perZone,
    shortfall,
    totalCapacity: totalMax,
    usedZones,
    rationale: `Only ${desiredUnits - shortfall} of ${desiredUnits} units fit across the current zones; ${shortfall} will not fit. Options: (a) enlarge a zone, (b) reduce unit count, or (c) add another zone or room.`
  };
}

export default {
  normalizeZoneRect,
  solveLayout,
  detectViolations,
  recommendZones,
  DEFAULT_MAIN_WALKWAY_M
};
