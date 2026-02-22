import { describe, it, expect } from "vitest";
import {
  PAYOUT_POLICY,
  calculateRoutePay,
  calculateMinimumGuarantee,
  type PayoutPolicyConfig,
} from "../../src/config/payout-policy.js";

describe("Payout Policy", () => {
  describe("PAYOUT_POLICY config", () => {
    it("has version v1.0 effective from July 2025", () => {
      expect(PAYOUT_POLICY.version).toBe("v1.0");
      expect(PAYOUT_POLICY.effective_from).toBe("2025-07-01");
    });

    it("weekly pay cycle Mon-Sun, pay Friday, Toronto TZ", () => {
      const pp = PAYOUT_POLICY.pay_period;
      expect(pp.cycle).toBe("weekly");
      expect(pp.start_day).toBe("monday");
      expect(pp.end_day).toBe("sunday");
      expect(pp.pay_day).toBe("friday");
      expect(pp.timezone).toBe("America/Toronto");
    });

    it("base rate is $15, per km $0.55", () => {
      expect(PAYOUT_POLICY.per_route_rates.base).toBe(15);
      expect(PAYOUT_POLICY.per_route_rates.per_km).toBe(0.55);
    });

    it("minimum guarantee at $22/engaged hour", () => {
      expect(PAYOUT_POLICY.minimum_guarantee.enabled).toBe(true);
      expect(PAYOUT_POLICY.minimum_guarantee.per_engaged_hour).toBe(22);
    });

    it("CRA T4A box 048 with $500 threshold", () => {
      expect(PAYOUT_POLICY.cra.t4a_box).toBe("048");
      expect(PAYOUT_POLICY.cra.admin_threshold).toBe(500);
    });

    it("Stripe manual payouts in CAD", () => {
      expect(PAYOUT_POLICY.stripe.payout_method).toBe("manual");
      expect(PAYOUT_POLICY.stripe.currency).toBe("CAD");
    });
  });

  describe("calculateRoutePay", () => {
    const policy = PAYOUT_POLICY;

    it("returns correct breakdown for a typical route", () => {
      const result = calculateRoutePay(policy, {
        distance_km: 30,
        engaged_min: 45,
        stops: 5,
        wait_min: 15, // 5 billable after 10-min grace
      });

      expect(result.base).toBe(15);
      expect(result.distance).toBe(16.5);   // 30 × 0.55
      expect(result.time).toBe(8.1);        // 45 × 0.18
      expect(result.stop_fee).toBe(6.25);   // 5 × 1.25
      expect(result.wait).toBe(1);           // 5 × 0.20
      expect(result.total).toBe(46.85);     // 15 + 16.5 + 8.1 + 6.25 + 1.0
    });

    it("applies wait grace period — no wait fee under 10 min", () => {
      const result = calculateRoutePay(policy, {
        distance_km: 10,
        engaged_min: 20,
        stops: 2,
        wait_min: 8, // under 10-min grace
      });

      expect(result.wait).toBe(0);
    });

    it("wait exactly at grace period = no charge", () => {
      const result = calculateRoutePay(policy, {
        distance_km: 10,
        engaged_min: 20,
        stops: 2,
        wait_min: 10, // exactly at grace
      });

      expect(result.wait).toBe(0);
    });

    it("handles zero-distance zero-stop route (base only)", () => {
      const result = calculateRoutePay(policy, {
        distance_km: 0,
        engaged_min: 0,
        stops: 0,
        wait_min: 0,
      });

      expect(result.base).toBe(15);
      expect(result.distance).toBe(0);
      expect(result.time).toBe(0);
      expect(result.stop_fee).toBe(0);
      expect(result.wait).toBe(0);
      expect(result.total).toBe(15);
    });

    it("rounds to 2 decimal places", () => {
      const result = calculateRoutePay(policy, {
        distance_km: 7,   // 7 × 0.55 = 3.85
        engaged_min: 13,  // 13 × 0.18 = 2.34
        stops: 3,         // 3 × 1.25 = 3.75
        wait_min: 11,     // 1 × 0.20 = 0.20
      });

      // Verify each component is rounded to 2 decimal places
      const isRounded = (n: number) => Number(n.toFixed(2)) === n;
      expect(isRounded(result.base)).toBe(true);
      expect(isRounded(result.distance)).toBe(true);
      expect(isRounded(result.time)).toBe(true);
      expect(isRounded(result.stop_fee)).toBe(true);
      expect(isRounded(result.wait)).toBe(true);
      expect(isRounded(result.total)).toBe(true);
    });

    it("total equals sum of components", () => {
      const result = calculateRoutePay(policy, {
        distance_km: 25,
        engaged_min: 60,
        stops: 8,
        wait_min: 20,
      });

      const sum = result.base + result.distance + result.time + result.stop_fee + result.wait;
      // Allow tiny floating point tolerance
      expect(Math.abs(result.total - sum)).toBeLessThan(0.01);
    });
  });

  describe("calculateMinimumGuarantee", () => {
    const policy = PAYOUT_POLICY;

    it("no top-up when hourly rate exceeds minimum", () => {
      // $60 for 120 engaged minutes = $30/hr > $22/hr
      const result = calculateMinimumGuarantee(policy, 60, 120);
      expect(result.needed).toBe(false);
      expect(result.adjustment).toBe(0);
      expect(result.effectiveHourlyRate).toBe(30);
    });

    it("top-up needed when hourly rate below minimum", () => {
      // $20 for 120 engaged minutes = $10/hr < $22/hr
      // Guaranteed: 2 hours × $22 = $44, adjustment = $24
      const result = calculateMinimumGuarantee(policy, 20, 120);
      expect(result.needed).toBe(true);
      expect(result.adjustment).toBe(24);
      expect(result.effectiveHourlyRate).toBe(10);
    });

    it("exact minimum rate = no top-up", () => {
      // $22 for 60 engaged minutes = $22/hr
      const result = calculateMinimumGuarantee(policy, 22, 60);
      expect(result.needed).toBe(false);
      expect(result.adjustment).toBe(0);
    });

    it("zero engaged minutes returns no guarantee", () => {
      const result = calculateMinimumGuarantee(policy, 100, 0);
      expect(result.needed).toBe(false);
      expect(result.adjustment).toBe(0);
      expect(result.effectiveHourlyRate).toBe(0);
    });

    it("disabled guarantee returns no adjustment", () => {
      const disabledPolicy: PayoutPolicyConfig = {
        ...policy,
        minimum_guarantee: { enabled: false, per_engaged_hour: 22 },
      };
      const result = calculateMinimumGuarantee(disabledPolicy, 10, 120);
      expect(result.needed).toBe(false);
      expect(result.adjustment).toBe(0);
    });
  });
});
