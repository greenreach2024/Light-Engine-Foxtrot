import { db } from "../../db/index.js";
import { env } from "../../config/env.js";
import { NotFoundError } from "../../shared/utils/errors.js";
import {
  allocateCost,
  computeSimpleFee,
  type AllocationWeights,
  type StopAllocationInput,
  type StopAllocationResult,
  type SimpleRates,
} from "./cost-allocator.js";
import {
  computeDriverPay,
  checkRouteMargin,
  type PayRates,
  type RoutePayInput,
  type RoutePayResult,
  type MarginCheckResult,
} from "./driver-pay.service.js";
import type { Route } from "../../shared/types/index.js";

export class PricingService {
  /**
   * Quote delivery fees for all stops on a route using route-cost allocation.
   */
  async quoteRoute(routeId: string, marginOverride?: number): Promise<{
    fees: StopAllocationResult[];
    driverPay: RoutePayResult;
    margin: MarginCheckResult;
  }> {
    const route = await db("routes").where("id", routeId).first() as Route | undefined;
    if (!route) throw new NotFoundError("Route", routeId);

    const stops = await db("route_stops").where("route_id", routeId).orderBy("stop_sequence");

    // Build allocation inputs
    const allocationInputs: StopAllocationInput[] = stops.map((s: any) => ({
      stopId: s.id,
      orderId: s.order_id,
      marginalKm: s.marginal_km,
      marginalMin: s.marginal_min,
      volumeShare: s.volume_share,
      floorFee: 5.0, // minimum $5 per stop
    }));

    const weights: AllocationWeights = {
      wKm: env.ALLOC_W_KM,
      wMin: env.ALLOC_W_MIN,
      wVol: env.ALLOC_W_VOL,
      wEqual: env.ALLOC_W_EQUAL,
    };

    const margin = marginOverride ?? env.DEFAULT_MARGIN;

    // Get surcharges
    const surchargeRows = await db("stop_surcharges").whereIn(
      "stop_id",
      stops.map((s: any) => s.id),
    );
    const surchargesByStop = new Map<string, number>();
    for (const row of surchargeRows) {
      const current = surchargesByStop.get(row.stop_id) ?? 0;
      surchargesByStop.set(row.stop_id, current + Number(row.amount));
    }

    // Allocate costs
    const fees = allocateCost(
      Number(route.route_cost ?? 0),
      allocationInputs,
      weights,
      margin,
      surchargesByStop,
    );

    // Compute driver pay
    const payRates: PayRates = {
      payBase: env.PAY_BASE,
      payPerKm: env.PAY_PER_KM,
      payPerActiveMin: env.PAY_PER_ACTIVE_MIN,
      payPerStop: env.PAY_PER_STOP,
      payPerWaitMin: env.PAY_PER_WAIT_MIN,
      minEarningsRatePerMin: env.MIN_EARNINGS_RATE_PER_MIN,
      waitGraceMin: env.WAIT_GRACE_MIN,
    };

    const payInput: RoutePayInput = {
      totalKm: route.planned_km,
      activeMin: route.planned_duration_min - route.planned_wait_min,
      stops: route.planned_stops,
      totalWaitMin: route.planned_wait_min,
      incentives: 0,
      deductions: 0,
    };

    const driverPay = computeDriverPay(payInput, payRates);

    // Revenue = sum of delivery fees
    const totalRevenue = fees.reduce((s, f) => s + f.deliveryFee, 0);
    const overheadAlloc = totalRevenue * 0.05; // 5% overhead allocation

    const marginCheck = checkRouteMargin(totalRevenue, driverPay.netPay, overheadAlloc);

    // Persist fees to route_stops and route
    for (const fee of fees) {
      await db("route_stops").where("id", fee.stopId).update({
        cost_share: fee.share,
        allocated_cost: fee.allocatedCost,
        delivery_fee: fee.deliveryFee,
      });

      // Also update the order's delivery fee
      await db("orders").where("id", fee.orderId).update({
        delivery_fee: fee.deliveryFee,
        total_amount: db.raw("product_total + ?", [fee.deliveryFee]),
      });
    }

    await db("routes").where("id", routeId).update({
      driver_pay: driverPay.netPay,
      total_revenue: totalRevenue,
      route_margin: marginCheck.margin,
      updated_at: new Date(),
    });

    return { fees, driverPay, margin: marginCheck };
  }

  /**
   * Simple MVP fee calculator (no route context needed).
   */
  computeSimpleFee(kmFromFarm: number, toteCount: number, windowTightnessHours: number): number {
    const rates: SimpleRates = {
      base: 8.0,
      ratePerKm: 0.45,
      ratePerTote: 0.75,
      ratePerTwHour: 2.50,
    };
    return computeSimpleFee(kmFromFarm, toteCount, windowTightnessHours, rates);
  }
}

export const pricingService = new PricingService();
