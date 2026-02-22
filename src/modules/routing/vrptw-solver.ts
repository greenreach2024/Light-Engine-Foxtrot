/**
 * VRPTW Solver — Vehicle Routing Problem with Time Windows
 *
 * MVP implementation using nearest-neighbor heuristic + 2-opt local search.
 * For production, integrate OR-Tools, Google Route Optimization, or Vroom.
 *
 * Objective:
 *   min(C_km·KM + C_time·MIN + C_late·LATE + C_unused·UNUSED_CAP + C_split·SPLIT_ORDERS)
 */

import { haversineKm, round } from "../../shared/utils/helpers.js";
import { env } from "../../config/env.js";

// ─── Input types ─────────────────────────────────────────────

export interface VrpStop {
  id: string;           // order id
  locationId: string;
  lat: number;
  lng: number;
  windowOpen: Date;
  windowClose: Date;
  serviceTimeMin: number;
  weightKg: number;
  volumeL: number;
  toteCount: number;
  tempClass: string;
}

export interface VrpDepot {
  lat: number;
  lng: number;
}

export interface VrpVehicle {
  maxStops: number;
  maxDurationMin: number;
  maxWeightKg: number;
  maxVolumeL: number;
  coldChainMaxMin: number;
}

export interface VrpConfig {
  depot: VrpDepot;
  stops: VrpStop[];
  vehicle: VrpVehicle;
  avgSpeedKmh: number;
}

// ─── Output types ────────────────────────────────────────────

export interface VrpRouteResult {
  stops: VrpStopResult[];
  totalKm: number;
  totalDurationMin: number;
  totalWaitMin: number;
  totalWeightKg: number;
  totalVolumeL: number;
}

export interface VrpStopResult {
  stop: VrpStop;
  sequence: number;
  arrivalMin: number;      // minutes from depot departure
  departureMin: number;
  waitMin: number;
  marginalKm: number;      // km contribution of this stop
  marginalMin: number;      // time contribution
  isLate: boolean;
  lateMin: number;
}

// ─── Solver ──────────────────────────────────────────────────

export function solveVrptw(config: VrpConfig): VrpRouteResult[] {
  const { depot, stops, vehicle, avgSpeedKmh } = config;
  const unassigned = [...stops];
  const routes: VrpRouteResult[] = [];

  // Sort by window_open to process earliest-deadline-first
  unassigned.sort((a, b) => a.windowOpen.getTime() - b.windowOpen.getTime());

  while (unassigned.length > 0) {
    const route = buildRoute(depot, unassigned, vehicle, avgSpeedKmh);
    if (route.stops.length === 0) {
      // Can't fit remaining stops — force one per route
      const stop = unassigned.shift()!;
      const dist = haversineKm(depot.lat, depot.lng, stop.lat, stop.lng);
      const travelMin = (dist / avgSpeedKmh) * 60;
      routes.push({
        stops: [{
          stop,
          sequence: 1,
          arrivalMin: travelMin,
          departureMin: travelMin + stop.serviceTimeMin,
          waitMin: 0,
          marginalKm: dist * 2, // round trip
          marginalMin: travelMin + stop.serviceTimeMin,
          isLate: false,
          lateMin: 0,
        }],
        totalKm: dist * 2,
        totalDurationMin: travelMin * 2 + stop.serviceTimeMin,
        totalWaitMin: 0,
        totalWeightKg: stop.weightKg,
        totalVolumeL: stop.volumeL,
      });
    } else {
      routes.push(route);
    }
  }

  // Apply 2-opt improvement to each route
  return routes.map((r) => improve2Opt(r, depot, avgSpeedKmh));
}

/** Build a single route using nearest-neighbor insertion with feasibility checks */
function buildRoute(
  depot: VrpDepot,
  unassigned: VrpStop[],
  vehicle: VrpVehicle,
  avgSpeedKmh: number,
): VrpRouteResult {
  const assigned: VrpStopResult[] = [];
  let currentLat = depot.lat;
  let currentLng = depot.lng;

  // Estimate depot departure: earliest window_open minus travel to nearest stop
  const earliestOpen = Math.min(...unassigned.map((s) => minutesFromMidnight(s.windowOpen)));
  const nearestDist = Math.min(...unassigned.map((s) => haversineKm(depot.lat, depot.lng, s.lat, s.lng)));
  const travelToFirst = (nearestDist / avgSpeedKmh) * 60;
  const depotDepartureMin = Math.max(0, earliestOpen - travelToFirst - 5); // leave 5-min buffer

  let currentTimeMin = depotDepartureMin;
  let totalKm = 0;
  let totalWeight = 0;
  let totalVolume = 0;
  let totalWait = 0;

  while (assigned.length < vehicle.maxStops) {
    // Find nearest feasible unassigned stop
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < unassigned.length; i++) {
      const stop = unassigned[i];

      // Capacity check
      if (totalWeight + stop.weightKg > vehicle.maxWeightKg) continue;
      if (totalVolume + stop.volumeL > vehicle.maxVolumeL) continue;

      const dist = haversineKm(currentLat, currentLng, stop.lat, stop.lng);
      const travelMin = (dist / avgSpeedKmh) * 60;
      const arrivalMin = currentTimeMin + travelMin;

      // Time window feasibility: can we arrive before close?
      const windowCloseMin = minutesFromMidnight(stop.windowClose);
      if (arrivalMin > windowCloseMin + 30) continue; // 30 min grace

      // Duration constraint (relative to depot departure, not midnight)
      const returnDist = haversineKm(stop.lat, stop.lng, depot.lat, depot.lng);
      const returnMin = (returnDist / avgSpeedKmh) * 60;
      const routeDuration = (arrivalMin + stop.serviceTimeMin + returnMin) - depotDepartureMin;
      if (routeDuration > vehicle.maxDurationMin) continue;

      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break; // no feasible stop

    const stop = unassigned.splice(bestIdx, 1)[0];
    const dist = haversineKm(currentLat, currentLng, stop.lat, stop.lng);
    const travelMin = (dist / avgSpeedKmh) * 60;
    const rawArrival = currentTimeMin + travelMin;

    // Wait if we arrive early
    const windowOpenMin = minutesFromMidnight(stop.windowOpen);
    const waitMin = Math.max(0, windowOpenMin - rawArrival);
    const arrivalMin = rawArrival + waitMin;
    const departureMin = arrivalMin + stop.serviceTimeMin;

    const windowCloseMin = minutesFromMidnight(stop.windowClose);
    const isLate = arrivalMin > windowCloseMin;
    const lateMin = isLate ? arrivalMin - windowCloseMin : 0;

    assigned.push({
      stop,
      sequence: assigned.length + 1,
      arrivalMin: round(arrivalMin),
      departureMin: round(departureMin),
      waitMin: round(waitMin),
      marginalKm: round(dist),
      marginalMin: round(travelMin + stop.serviceTimeMin + waitMin),
      isLate,
      lateMin: round(lateMin),
    });

    totalKm += dist;
    totalWeight += stop.weightKg;
    totalVolume += stop.volumeL;
    totalWait += waitMin;
    currentLat = stop.lat;
    currentLng = stop.lng;
    currentTimeMin = departureMin;
  }

  // Return leg
  if (assigned.length > 0) {
    const last = assigned[assigned.length - 1].stop;
    totalKm += haversineKm(last.lat, last.lng, depot.lat, depot.lng);
  }

  return {
    stops: assigned,
    totalKm: round(totalKm),
    totalDurationMin: round(
      assigned.length > 0
        ? (assigned[assigned.length - 1].departureMin + (haversineKm(
            assigned[assigned.length - 1].stop.lat,
            assigned[assigned.length - 1].stop.lng,
            depot.lat, depot.lng,
          ) / avgSpeedKmh) * 60) - depotDepartureMin
        : 0,
    ),
    totalWaitMin: round(totalWait),
    totalWeightKg: round(totalWeight),
    totalVolumeL: round(totalVolume),
  };
}

/** 2-opt local search: swap pairs of edges to reduce total distance */
function improve2Opt(
  route: VrpRouteResult,
  depot: VrpDepot,
  avgSpeedKmh: number,
): VrpRouteResult {
  if (route.stops.length <= 2) return route;

  const stops = route.stops.map((s) => s.stop);
  let improved = true;
  let iterations = 0;
  const maxIterations = 100;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < stops.length - 1; i++) {
      for (let j = i + 2; j < stops.length; j++) {
        const oldDist = segmentDist(stops, i, j, depot);
        // Reverse segment [i+1..j]
        const newStops = [...stops];
        const segment = newStops.splice(i + 1, j - i);
        segment.reverse();
        newStops.splice(i + 1, 0, ...segment);

        const newDist = segmentDist(newStops, i, j, depot);
        if (newDist < oldDist - 0.01) {
          stops.splice(0, stops.length, ...newStops);
          improved = true;
        }
      }
    }
  }

  // Rebuild route result with new ordering
  return rebuildRouteResult(stops, depot, avgSpeedKmh);
}

function segmentDist(stops: VrpStop[], i: number, j: number, depot: VrpDepot): number {
  const prev = i >= 0 ? stops[i] : null;
  const next = j < stops.length - 1 ? stops[j + 1] : null;
  const pLat = prev?.lat ?? depot.lat;
  const pLng = prev?.lng ?? depot.lng;
  const nLat = next?.lat ?? depot.lat;
  const nLng = next?.lng ?? depot.lng;

  return (
    haversineKm(pLat, pLng, stops[i + 1]?.lat ?? depot.lat, stops[i + 1]?.lng ?? depot.lng) +
    haversineKm(stops[j].lat, stops[j].lng, nLat, nLng)
  );
}

function rebuildRouteResult(
  stops: VrpStop[],
  depot: VrpDepot,
  avgSpeedKmh: number,
): VrpRouteResult {
  let currentLat = depot.lat;
  let currentLng = depot.lng;
  let currentTimeMin = 0;
  let totalKm = 0;
  let totalWeight = 0;
  let totalVolume = 0;
  let totalWait = 0;

  const results: VrpStopResult[] = stops.map((stop, idx) => {
    const dist = haversineKm(currentLat, currentLng, stop.lat, stop.lng);
    const travelMin = (dist / avgSpeedKmh) * 60;
    const rawArrival = currentTimeMin + travelMin;

    const windowOpenMin = minutesFromMidnight(stop.windowOpen);
    const waitMin = Math.max(0, windowOpenMin - rawArrival);
    const arrivalMin = rawArrival + waitMin;
    const departureMin = arrivalMin + stop.serviceTimeMin;

    const windowCloseMin = minutesFromMidnight(stop.windowClose);
    const isLate = arrivalMin > windowCloseMin;
    const lateMin = isLate ? arrivalMin - windowCloseMin : 0;

    totalKm += dist;
    totalWeight += stop.weightKg;
    totalVolume += stop.volumeL;
    totalWait += waitMin;

    currentLat = stop.lat;
    currentLng = stop.lng;
    currentTimeMin = departureMin;

    return {
      stop,
      sequence: idx + 1,
      arrivalMin: round(arrivalMin),
      departureMin: round(departureMin),
      waitMin: round(waitMin),
      marginalKm: round(dist),
      marginalMin: round(travelMin + stop.serviceTimeMin + waitMin),
      isLate,
      lateMin: round(lateMin),
    };
  });

  // Return leg
  if (stops.length > 0) {
    const last = stops[stops.length - 1];
    totalKm += haversineKm(last.lat, last.lng, depot.lat, depot.lng);
  }

  return {
    stops: results,
    totalKm: round(totalKm),
    totalDurationMin: round(
      results.length > 0
        ? results[results.length - 1].departureMin +
          (haversineKm(
            stops[stops.length - 1].lat,
            stops[stops.length - 1].lng,
            depot.lat,
            depot.lng,
          ) / avgSpeedKmh) * 60
        : 0,
    ),
    totalWaitMin: round(totalWait),
    totalWeightKg: round(totalWeight),
    totalVolumeL: round(totalVolume),
  };
}

function minutesFromMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}
