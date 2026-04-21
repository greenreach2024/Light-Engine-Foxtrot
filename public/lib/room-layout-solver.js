/**
 * Room Layout Solver — browser build (exposes window.RoomLayoutSolver).
 *
 * Mirrors lib/room-layout-solver.js (ESM) for page-level consumption by
 *   - views/grow-management-room-build-plan.js
 *   - views/3d-farm-viewer.html
 *
 * Keep the two files in sync. See the ESM file for full design notes on
 * orientation rules, plumbing walls, and placement coordinates.
 */
(function (root) {
  'use strict';

  var DEFAULT_MAIN_WALKWAY_M = 1.2;
  var MIN_SPLIT_UNITS = 12;

  function round2(n) { return Number(Number(n).toFixed(2)); }
  function round3(n) { return Number(Number(n).toFixed(3)); }

  function normalizeZoneRect(zone) {
    if (!zone) return null;
    var dims = zone.dimensions || zone.dims || zone;
    var l = Number(
      (zone.lengthM != null ? zone.lengthM
        : zone.length != null ? zone.length
        : dims.lengthM != null ? dims.lengthM
        : dims.length != null ? dims.length
        : dims.length_m != null ? dims.length_m
        : 0)
    );
    var w = Number(
      (zone.widthM != null ? zone.widthM
        : zone.width != null ? zone.width
        : dims.widthM != null ? dims.widthM
        : dims.width != null ? dims.width
        : dims.width_m != null ? dims.width_m
        : 0)
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
    var sc = template && template.spatialContract;
    if (!sc) return null;
    var u = sc.unitFootprintM || {};
    var c = sc.workspaceClearanceM || {};
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
    var placements = [];
    var longM = rect.longM;
    var shortM = rect.shortM;
    var rowDepth = c.unitW + c.front + c.back;
    var onAxisStride = c.orientation === 'butt_end_to_end'
      ? c.unitL
      : c.unitL + 2 * c.ends;

    var placed = 0;
    for (var r = 0; r < rowsMax && placed < n; r++) {
      var y;
      if (c.orientation === 'butt_end_to_end' && rowsMax >= 2) {
        y = r === 0
          ? c.back
          : c.back + rowDepth + mainWalkwayM + (r - 1) * rowDepth;
      } else {
        y = r * rowDepth + c.back;
      }
      for (var u = 0; u < unitsPerRow && placed < n; u++) {
        var x = c.orientation === 'butt_end_to_end'
          ? u * onAxisStride
          : u * onAxisStride + c.ends;
        var envX = c.orientation === 'butt_end_to_end' ? x : x - c.ends;
        var envLen = c.orientation === 'butt_end_to_end'
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

  function solveLayout(template, zone, opts) {
    opts = opts || {};
    var rect = normalizeZoneRect(zone);
    var c = readContract(template);
    if (!rect || !c || !(c.unitL > 0) || !(c.unitW > 0)) {
      return {
        ok: false,
        reason: !rect ? 'zone-missing' : 'template-missing-spatial-contract',
        maxUnits: 0,
        unitsPerRow: 0,
        rowsMax: 0,
        placements: function () { return []; },
        fits: function () { return false; }
      };
    }
    var mainWalkwayM = Number.isFinite(opts.mainWalkwayM)
      ? opts.mainWalkwayM
      : DEFAULT_MAIN_WALKWAY_M;

    var longM = rect.longM;
    var shortM = rect.shortM;
    var rowDepth, rowUnitLength, unitsPerRow, rowsMax, effectiveTileAreaM2;

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
    var maxUnits = Math.max(0, unitsPerRow * rowsMax);

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
      unitsPerRow: unitsPerRow,
      rowsMax: rowsMax,
      maxUnits: maxUnits,
      effectiveTileAreaM2: round3(effectiveTileAreaM2),
      occupiedAreaM2: round2(effectiveTileAreaM2 * maxUnits),
      mainWalkwayM: mainWalkwayM,
      fits: function (n) { return n <= maxUnits; },
      placements: function (n) { return placementsFor(rect, c, unitsPerRow, rowsMax, n, mainWalkwayM); }
    };
  }

  function detectViolations(placements, rect) {
    var out = { overlaps: [], overflows: [] };
    if (!Array.isArray(placements) || !rect) return out;
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      if (!p.fitsInZone) out.overflows.push(i);
      for (var j = i + 1; j < placements.length; j++) {
        var q = placements[j];
        var overlap =
          p.x < q.x + q.lengthM && p.x + p.lengthM > q.x &&
          p.y < q.y + q.widthM  && p.y + p.widthM  > q.y;
        if (overlap) out.overlaps.push([i, j]);
      }
    }
    return out;
  }

  function recommendZones(desiredUnits, zoneRects, template) {
    var zones = Array.isArray(zoneRects) ? zoneRects : [];
    var perZone = zones.map(function (zr) { return solveLayout(template, zr); });
    var totalMax = perZone.reduce(function (a, z) { return a + ((z && z.maxUnits) || 0); }, 0);

    if (!desiredUnits || desiredUnits <= 0) {
      return {
        recommendedZones: 1,
        perZone: perZone,
        shortfall: 0,
        totalCapacity: totalMax,
        rationale: 'Pick a grow-unit count to see a zone recommendation. Zones let you separate photoperiods, stage cleaning cycles, and run distinct environment recipes inside one room.'
      };
    }

    var firstZone = perZone[0];
    if (firstZone && firstZone.maxUnits >= desiredUnits) {
      if (desiredUnits >= MIN_SPLIT_UNITS && zones.length > 1) {
        return {
          recommendedZones: 2,
          perZone: perZone,
          shortfall: 0,
          totalCapacity: totalMax,
          rationale: 'Zone 1 alone fits ' + firstZone.maxUnits + ' units, but at ' + desiredUnits + ' racks Evie recommends splitting across 2 zones so you can stagger photoperiods, rotate cleaning days, and hold separate environment recipes (e.g. propagation vs finishing).'
        };
      }
      return {
        recommendedZones: 1,
        perZone: perZone,
        shortfall: 0,
        totalCapacity: totalMax,
        rationale: 'Zone 1 fits ' + desiredUnits + ' units with ' + (firstZone.maxUnits - desiredUnits) + ' slots to spare. One zone is sufficient; a second zone becomes useful once you want to separate planting schedules or hold an independent climate recipe.'
      };
    }

    var remaining = desiredUnits;
    var usedZones = [];
    for (var i = 0; i < perZone.length; i++) {
      if (remaining <= 0) break;
      var z = perZone[i];
      if (!z || !z.maxUnits) continue;
      var take = Math.min(z.maxUnits, remaining);
      usedZones.push({
        zoneId: (z.zone && z.zone.id) || null,
        zoneName: (z.zone && z.zone.name) || ('Zone ' + (i + 1)),
        units: take,
        capacity: z.maxUnits
      });
      remaining -= take;
    }

    var shortfall = Math.max(0, remaining);
    if (shortfall === 0) {
      return {
        recommendedZones: usedZones.length,
        perZone: perZone,
        shortfall: 0,
        totalCapacity: totalMax,
        usedZones: usedZones,
        rationale: desiredUnits + ' units will not fit in Zone 1 (cap ' + ((firstZone && firstZone.maxUnits) || 0) + '). Evie recommends using ' + usedZones.length + ' zones: ' + usedZones.map(function (u) { return u.units + ' in ' + u.zoneName; }).join(', ') + '. Zones let you separate photoperiods and rotate cleaning cycles per bank.'
      };
    }
    return {
      recommendedZones: usedZones.length,
      perZone: perZone,
      shortfall: shortfall,
      totalCapacity: totalMax,
      usedZones: usedZones,
      rationale: 'Only ' + (desiredUnits - shortfall) + ' of ' + desiredUnits + ' units fit across the current zones; ' + shortfall + ' will not fit. Options: (a) enlarge a zone, (b) reduce unit count, or (c) add another zone or room.'
    };
  }

  root.RoomLayoutSolver = {
    normalizeZoneRect: normalizeZoneRect,
    solveLayout: solveLayout,
    detectViolations: detectViolations,
    recommendZones: recommendZones,
    DEFAULT_MAIN_WALKWAY_M: DEFAULT_MAIN_WALKWAY_M
  };
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this)));
