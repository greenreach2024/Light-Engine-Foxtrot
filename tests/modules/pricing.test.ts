import { describe, it, expect } from "vitest";
import {
  allocateCost,
  computeSimpleFee,
  type AllocationWeights,
  type StopAllocationInput,
  type SimpleRates,
} from "../../src/modules/pricing/cost-allocator.js";
import {
  computeDriverPay,
  checkRouteMargin,
  type PayRates,
  type RoutePayInput,
} from "../../src/modules/pricing/driver-pay.service.js";

describe("Pricing — Cost Allocation", () => {
  const weights: AllocationWeights = { wKm: 0.45, wMin: 0.35, wVol: 0.15, wEqual: 0.05 };

  it("allocates cost proportionally across stops", () => {
    const stops: StopAllocationInput[] = [
      { stopId: "s1", orderId: "o1", marginalKm: 10, marginalMin: 20, volumeShare: 0.5, floorFee: 0 },
      { stopId: "s2", orderId: "o2", marginalKm: 10, marginalMin: 20, volumeShare: 0.5, floorFee: 0 },
    ];

    const result = allocateCost(100, stops, weights, 0.5, new Map());

    // Equal stops → equal shares
    expect(result[0].share).toBeCloseTo(0.5, 1);
    expect(result[1].share).toBeCloseTo(0.5, 1);
    // Fee = allocatedCost * (1 + margin) = 50 * 1.5 = 75
    expect(result[0].deliveryFee).toBeCloseTo(75, 0);
  });

  it("applies floor fee when allocated cost is below floor", () => {
    const stops: StopAllocationInput[] = [
      { stopId: "s1", orderId: "o1", marginalKm: 1, marginalMin: 2, volumeShare: 0.1, floorFee: 20 },
    ];

    const result = allocateCost(10, stops, weights, 0.5, new Map());

    // allocatedCost = 10 (100% share of $10) but floor is $20
    expect(result[0].deliveryFee).toBe(30); // max(20, 10) * 1.5 = 30
  });

  it("includes surcharges", () => {
    const stops: StopAllocationInput[] = [
      { stopId: "s1", orderId: "o1", marginalKm: 10, marginalMin: 10, volumeShare: 1, floorFee: 0 },
    ];
    const surcharges = new Map([["s1", 5.0]]);

    const result = allocateCost(100, stops, weights, 0.0, surcharges);

    // Fee = max(0, 100) * (1 + 0) + 5 = 105
    expect(result[0].deliveryFee).toBe(105);
  });
});

describe("Pricing — Simple Fee", () => {
  it("computes a menu-style delivery fee", () => {
    const rates: SimpleRates = { base: 8, ratePerKm: 0.45, ratePerTote: 0.75, ratePerTwHour: 2.5 };
    // 20km, 10 totes, 2h window (tight → 4-2=2 extra)
    const fee = computeSimpleFee(20, 10, 2, rates);
    // 8 + 20*0.45 + 10*0.75 + 2*2.5 = 8 + 9 + 7.5 + 5 = 29.5
    expect(fee).toBeCloseTo(29.5, 1);
  });

  it("no tightness penalty for >= 4h window", () => {
    const rates: SimpleRates = { base: 8, ratePerKm: 0.45, ratePerTote: 0.75, ratePerTwHour: 2.5 };
    const fee = computeSimpleFee(10, 5, 6, rates);
    // 8 + 10*0.45 + 5*0.75 + 0 = 8 + 4.5 + 3.75 = 16.25
    expect(fee).toBeCloseTo(16.25, 1);
  });
});

describe("Driver Pay", () => {
  const rates: PayRates = {
    payBase: 15,
    payPerKm: 0.55,
    payPerActiveMin: 0.18,
    payPerStop: 1.25,
    payPerWaitMin: 0.20,
    minEarningsRatePerMin: 0.35,
    waitGraceMin: 10,
  };

  it("computes driver pay for the spec example route", () => {
    const input: RoutePayInput = {
      totalKm: 68,
      activeMin: 165,
      stops: 10,
      totalWaitMin: 20,
      incentives: 0,
      deductions: 0,
    };

    const result = computeDriverPay(input, rates);

    // base=15, km=68*0.55=37.4, time=165*0.18=29.7, stops=10*1.25=12.5
    // paidWait = max(0, 20 - 10*10) = 0 (grace covers all wait)
    // gross = 15 + 37.4 + 29.7 + 12.5 + 0 = 94.6
    expect(result.basePay).toBe(15);
    expect(result.kmPay).toBeCloseTo(37.4, 1);
    expect(result.timePay).toBeCloseTo(29.7, 1);
    expect(result.stopPay).toBeCloseTo(12.5, 1);
    expect(result.waitPay).toBe(0); // grace covers 20 min across 10 stops
    expect(result.grossPay).toBeCloseTo(94.6, 0);

    // Guarantee: 0.35 * 165 = 57.75 → gross 94.6 exceeds, no guarantee
    expect(result.guaranteeApplied).toBe(false);
    expect(result.netPay).toBeCloseTo(94.6, 0);
  });

  it("applies minimum earnings guarantee", () => {
    const input: RoutePayInput = {
      totalKm: 5,
      activeMin: 120,
      stops: 1,
      totalWaitMin: 0,
      incentives: 0,
      deductions: 0,
    };

    const result = computeDriverPay(input, rates);

    // gross = 15 + 5*0.55 + 120*0.18 + 1*1.25 + 0 = 15 + 2.75 + 21.6 + 1.25 = 40.6
    // guarantee = 0.35 * 120 = 42
    expect(result.guaranteeApplied).toBe(true);
    expect(result.netPay).toBeCloseTo(42, 0);
  });
});

describe("Route Margin Check", () => {
  it("passes when margin is above threshold", () => {
    const result = checkRouteMargin(200, 100, 10, 0.10);
    expect(result.margin).toBe(90);
    expect(result.marginPct).toBeCloseTo(0.45, 1);
    expect(result.passes).toBe(true);
  });

  it("fails when margin is below threshold", () => {
    const result = checkRouteMargin(100, 95, 10, 0.10);
    expect(result.margin).toBe(-5);
    expect(result.passes).toBe(false);
  });
});
