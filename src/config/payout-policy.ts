// ─── Payout Policy Configuration ─────────────────────────────
// Structured config equivalent to the YAML spec.
// All rates are in CAD. This is the single source of truth
// for driver pay calculation.

export interface PayoutPolicyConfig {
  version: string;
  effective_from: string;

  pay_period: {
    cycle: "weekly";
    start_day: "monday";
    end_day: "sunday";
    pay_day: "friday";
    timezone: string;
  };

  per_route_rates: {
    base: number;        // flat per route
    per_km: number;
    per_engaged_min: number;
    per_stop: number;
    per_wait_min: number;
    wait_grace_min: number;
  };

  minimum_guarantee: {
    enabled: boolean;
    per_engaged_hour: number;   // if total pay / engaged hours < this, top up
  };

  exceptions: {
    access_issue: { outcome: "hold"; hold_days: number };
    partial_delivery: { outcome: "adjusted"; rule: string };
    refused: { outcome: "hold"; hold_days: number };
    damaged: { outcome: "hold"; hold_days: number };
    wrong_items: { outcome: "hold"; hold_days: number };
    temp_breach: { outcome: "hold"; hold_days: number };
  };

  hold_release: {
    auto_release_days: number;
    requires_ops_approval: boolean;
  };

  cra: {
    t4a_box: string;
    admin_threshold: number;
    calendar_year_reset: boolean;
  };

  stripe: {
    payout_method: "manual";
    currency: "CAD";
    description_template: string;
  };
}

/**
 * Active payout policy.
 */
export const PAYOUT_POLICY: PayoutPolicyConfig = {
  version: "v1.0",
  effective_from: "2025-07-01",

  pay_period: {
    cycle: "weekly",
    start_day: "monday",
    end_day: "sunday",
    pay_day: "friday",
    timezone: "America/Toronto",
  },

  per_route_rates: {
    base: 15.00,
    per_km: 0.55,
    per_engaged_min: 0.18,
    per_stop: 1.25,
    per_wait_min: 0.20,
    wait_grace_min: 10,
  },

  minimum_guarantee: {
    enabled: true,
    per_engaged_hour: 22.00,
  },

  exceptions: {
    access_issue: { outcome: "hold", hold_days: 3 },
    partial_delivery: { outcome: "adjusted", rule: "pro-rata on accepted totes" },
    refused: { outcome: "hold", hold_days: 5 },
    damaged: { outcome: "hold", hold_days: 7 },
    wrong_items: { outcome: "hold", hold_days: 5 },
    temp_breach: { outcome: "hold", hold_days: 7 },
  },

  hold_release: {
    auto_release_days: 14,
    requires_ops_approval: true,
  },

  cra: {
    t4a_box: "048",
    admin_threshold: 500,
    calendar_year_reset: true,
  },

  stripe: {
    payout_method: "manual",
    currency: "CAD",
    description_template: "GreenReach Delivery — {period_start} to {period_end}",
  },
};

/**
 * Calculate route pay based on policy rates.
 */
export function calculateRoutePay(
  policy: PayoutPolicyConfig,
  route: {
    distance_km: number;
    engaged_min: number;
    stops: number;
    wait_min: number;
  },
): {
  base: number;
  distance: number;
  time: number;
  stop_fee: number;
  wait: number;
  total: number;
} {
  const r = policy.per_route_rates;
  const base = r.base;
  const distance = route.distance_km * r.per_km;
  const time = route.engaged_min * r.per_engaged_min;
  const stop_fee = route.stops * r.per_stop;
  const billableWait = Math.max(0, route.wait_min - r.wait_grace_min);
  const wait = billableWait * r.per_wait_min;
  const total = base + distance + time + stop_fee + wait;

  return {
    base: round2(base),
    distance: round2(distance),
    time: round2(time),
    stop_fee: round2(stop_fee),
    wait: round2(wait),
    total: round2(total),
  };
}

/**
 * Check if minimum guarantee top-up is needed for a pay period.
 */
export function calculateMinimumGuarantee(
  policy: PayoutPolicyConfig,
  totalPay: number,
  totalEngagedMin: number,
): { needed: boolean; adjustment: number; effectiveHourlyRate: number } {
  if (!policy.minimum_guarantee.enabled || totalEngagedMin === 0) {
    return { needed: false, adjustment: 0, effectiveHourlyRate: 0 };
  }

  const totalEngagedHours = totalEngagedMin / 60;
  const effectiveHourlyRate = totalPay / totalEngagedHours;
  const minRate = policy.minimum_guarantee.per_engaged_hour;

  if (effectiveHourlyRate >= minRate) {
    return { needed: false, adjustment: 0, effectiveHourlyRate: round2(effectiveHourlyRate) };
  }

  const guaranteedTotal = totalEngagedHours * minRate;
  const adjustment = guaranteedTotal - totalPay;

  return {
    needed: true,
    adjustment: round2(adjustment),
    effectiveHourlyRate: round2(effectiveHourlyRate),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
