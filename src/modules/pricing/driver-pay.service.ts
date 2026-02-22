import { round } from "../../shared/utils/helpers.js";

/**
 * Driver pay calculator.
 *
 * Pay_route = P_base + (KM · p_km) + (MIN_active · p_min) + (STOPS · p_stop) + (WAIT · p_wait) + Incentives − Deductions
 *
 * Pay_route ≥ MinEarningsRate · MIN_active    (floor guarantee)
 */

export interface PayRates {
  payBase: number;
  payPerKm: number;
  payPerActiveMin: number;
  payPerStop: number;
  payPerWaitMin: number;
  minEarningsRatePerMin: number;
  waitGraceMin: number;
}

export interface RoutePayInput {
  totalKm: number;
  activeMin: number;       // driving + loading/unloading
  stops: number;
  totalWaitMin: number;    // raw wait time
  incentives: number;      // on-time bonus, peak bonus, etc.
  deductions: number;      // rare: missing scans, etc.
}

export interface RoutePayResult {
  basePay: number;
  kmPay: number;
  timePay: number;
  stopPay: number;
  waitPay: number;
  incentives: number;
  deductions: number;
  grossPay: number;
  guaranteeApplied: boolean;
  guaranteeAmount: number;
  netPay: number;
}

export function computeDriverPay(input: RoutePayInput, rates: PayRates): RoutePayResult {
  const basePay = round(rates.payBase);
  const kmPay = round(input.totalKm * rates.payPerKm);
  const timePay = round(input.activeMin * rates.payPerActiveMin);
  const stopPay = round(input.stops * rates.payPerStop);

  // Paid wait = total wait minus grace per stop
  const paidWaitMin = Math.max(0, input.totalWaitMin - input.stops * rates.waitGraceMin);
  const waitPay = round(paidWaitMin * rates.payPerWaitMin);

  const grossPay = round(basePay + kmPay + timePay + stopPay + waitPay + input.incentives - input.deductions);

  // Minimum earnings guarantee: Pay >= MinRate × ActiveMin
  const guaranteeAmount = round(rates.minEarningsRatePerMin * input.activeMin);
  const guaranteeApplied = grossPay < guaranteeAmount;
  const netPay = Math.max(grossPay, guaranteeAmount);

  return {
    basePay,
    kmPay,
    timePay,
    stopPay,
    waitPay,
    incentives: round(input.incentives),
    deductions: round(input.deductions),
    grossPay,
    guaranteeApplied,
    guaranteeAmount,
    netPay: round(netPay),
  };
}

/**
 * Route margin check — must pass before publishing.
 *
 * Margin_route = Revenue_route − Pay_route − OverheadAlloc_route
 */
export interface MarginCheckResult {
  revenue: number;
  driverPay: number;
  overheadAlloc: number;
  margin: number;
  marginPct: number;
  passes: boolean;
  minMarginPct: number;
}

export function checkRouteMargin(
  totalRevenue: number,
  driverPay: number,
  overheadAlloc: number,
  minMarginPct = 0.10,
): MarginCheckResult {
  const margin = round(totalRevenue - driverPay - overheadAlloc);
  const marginPct = totalRevenue > 0 ? round(margin / totalRevenue, 4) : 0;

  return {
    revenue: round(totalRevenue),
    driverPay: round(driverPay),
    overheadAlloc: round(overheadAlloc),
    margin,
    marginPct,
    passes: marginPct >= minMarginPct,
    minMarginPct,
  };
}
