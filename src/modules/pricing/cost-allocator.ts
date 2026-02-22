import { round } from "../../shared/utils/helpers.js";

/**
 * Cost allocator: distributes route cost across stops.
 *
 * share_i = w1·(km_i / Σkm) + w2·(min_i / Σmin) + w3·(vol_i / Σvol) + w4·(1/STOPS)
 *
 * Fee_i = max(Floor_i, share_i · C_route) · (1 + Margin) + Surcharges_i
 */

export interface AllocationWeights {
  wKm: number;    // default 0.45
  wMin: number;   // default 0.35
  wVol: number;   // default 0.15
  wEqual: number; // default 0.05
}

export interface StopAllocationInput {
  stopId: string;
  orderId: string;
  marginalKm: number;
  marginalMin: number;
  volumeShare: number;   // already as fraction of total volume
  floorFee: number;      // minimum per-stop floor
}

export interface StopAllocationResult {
  stopId: string;
  orderId: string;
  share: number;         // 0..1 fraction of route cost
  allocatedCost: number;
  margin: number;
  surcharges: number;
  deliveryFee: number;
}

export function allocateCost(
  routeCost: number,
  stops: StopAllocationInput[],
  weights: AllocationWeights,
  margin: number,
  surchargesByStop: Map<string, number>,
): StopAllocationResult[] {
  const totalKm = stops.reduce((s, st) => s + st.marginalKm, 0);
  const totalMin = stops.reduce((s, st) => s + st.marginalMin, 0);
  const stopCount = stops.length;

  return stops.map((stop) => {
    const kmShare = totalKm > 0 ? stop.marginalKm / totalKm : 0;
    const minShare = totalMin > 0 ? stop.marginalMin / totalMin : 0;
    const volShare = stop.volumeShare; // already a fraction
    const equalShare = 1 / stopCount;

    const share =
      weights.wKm * kmShare +
      weights.wMin * minShare +
      weights.wVol * volShare +
      weights.wEqual * equalShare;

    const allocatedCost = round(share * routeCost);
    const surcharges = surchargesByStop.get(stop.stopId) ?? 0;
    const feeBeforeMargin = Math.max(stop.floorFee, allocatedCost);
    const deliveryFee = round(feeBeforeMargin * (1 + margin) + surcharges);

    return {
      stopId: stop.stopId,
      orderId: stop.orderId,
      share: round(share, 4),
      allocatedCost,
      margin: round(margin, 4),
      surcharges: round(surcharges),
      deliveryFee,
    };
  });
}

/**
 * Simple "menu" pricing for MVP:
 *   Fee = Base + (KM_farm→cust · r_km) + (Totes · r_tote) + (WindowTightness · r_tw)
 */
export interface SimpleRates {
  base: number;
  ratePerKm: number;
  ratePerTote: number;
  ratePerTwHour: number;   // per hour of tightness
}

export function computeSimpleFee(
  kmFromFarm: number,
  toteCount: number,
  windowTightnessHours: number,
  rates: SimpleRates,
): number {
  return round(
    rates.base +
    kmFromFarm * rates.ratePerKm +
    toteCount * rates.ratePerTote +
    Math.max(0, 4 - windowTightnessHours) * rates.ratePerTwHour, // penalty for < 4h windows
  );
}
