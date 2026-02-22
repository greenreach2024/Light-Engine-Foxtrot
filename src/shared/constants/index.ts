// ─── Business constants ──────────────────────────────────────

/** Temp classes ordered by strictness (frozen > chilled > ambient) */
export const TEMP_CLASS_PRIORITY: Record<string, number> = {
  ambient: 0,
  chilled: 1,
  frozen: 2,
};

/** Default driver scoring weights */
export const DRIVER_SCORE_WEIGHTS = {
  reliability: 0.35,
  proximity: 0.25,
  vehicleFit: 0.25,
  acceptanceRate: 0.10,
  riskPenalty: 0.05,
} as const;

/** Hard route limits (overridable via env) */
export const ROUTE_LIMITS = {
  maxStops: 18,
  maxDurationMin: 270,       // 4.5 hours
  coldChainMaxMin: 180,      // 3 hours
  maxWaitPerStopMin: 30,
  driverBreakAfterMin: 240,  // mandatory break after 4h
} as const;

/** Order number sequence namespace (for DB sequences) */
export const SEQUENCES = {
  orderNumber: "order_number_seq",
  invoiceNumber: "invoice_number_seq",
  routeNumber: "route_number_seq",
} as const;

/** Default payment terms options */
export const PAYMENT_TERMS = [7, 14, 30] as const;
