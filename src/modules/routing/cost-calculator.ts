import { round } from "../../shared/utils/helpers.js";
import type { VrpRouteResult } from "./vrptw-solver.js";

/**
 * Route cost calculator.
 *
 * C_route = (KM·c_km) + (MIN·c_min) + (STOPS·c_stop) + (WAIT·c_wait) + C_tolls + C_cold
 */
export interface CostRates {
  costPerKm: number;
  costPerMin: number;
  costPerStop: number;
  costPerWaitMin: number;
  tollsCost?: number;
  coldChainCost?: number;
}

export interface RouteCostResult {
  kmCost: number;
  timeCost: number;
  stopCost: number;
  waitCost: number;
  tollsCost: number;
  coldChainCost: number;
  totalCost: number;
}

export function computeRouteCost(route: VrpRouteResult, rates: CostRates): RouteCostResult {
  const kmCost = round(route.totalKm * rates.costPerKm);
  const timeCost = round(route.totalDurationMin * rates.costPerMin);
  const stopCost = round(route.stops.length * rates.costPerStop);
  const waitCost = round(route.totalWaitMin * rates.costPerWaitMin);
  const tollsCost = round(rates.tollsCost ?? 0);
  const coldChainCost = round(rates.coldChainCost ?? 0);

  return {
    kmCost,
    timeCost,
    stopCost,
    waitCost,
    tollsCost,
    coldChainCost,
    totalCost: round(kmCost + timeCost + stopCost + waitCost + tollsCost + coldChainCost),
  };
}
