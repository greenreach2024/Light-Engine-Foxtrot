import { db } from "../../db/index.js";
import { NotFoundError, BadRequestError } from "../../shared/utils/errors.js";
import { PAYOUT_POLICY, calculateRoutePay, calculateMinimumGuarantee } from "../../config/payout-policy.js";
import type { CreatePayStatementInput, ResolveHoldInput, CreateFeeQuoteInput } from "./settlement.validation.js";

export class SettlementService {
  // ─── Fee Quotes (DPWRA pre-acceptance disclosure) ────────

  async createFeeQuote(input: CreateFeeQuoteInput) {
    const route = await db("routes").where("id", input.route_id).first();
    if (!route) throw new NotFoundError("Route", input.route_id);

    const driver = await db("drivers").where("id", input.driver_id).first();
    if (!driver) throw new NotFoundError("Driver", input.driver_id);

    const pay = calculateRoutePay(PAYOUT_POLICY, {
      distance_km: input.estimated_km,
      engaged_min: input.estimated_min,
      stops: input.estimated_stops,
      wait_min: input.estimated_wait_min,
    });

    const [quote] = await db("fee_quotes")
      .insert({
        route_id: input.route_id,
        driver_id: input.driver_id,
        base_fee: pay.base,
        distance_fee: pay.distance,
        time_fee: pay.time,
        stop_fee: pay.stop_fee,
        wait_fee: pay.wait,
        total_fee: pay.total,
        estimated_km: input.estimated_km,
        estimated_min: input.estimated_min,
        estimated_stops: input.estimated_stops,
        estimated_wait_min: input.estimated_wait_min,
        policy_version: PAYOUT_POLICY.version,
      })
      .returning("*");

    return quote;
  }

  async getFeeQuote(routeId: string, driverId: string) {
    const quote = await db("fee_quotes")
      .where("route_id", routeId)
      .where("driver_id", driverId)
      .orderBy("created_at", "desc")
      .first();
    if (!quote) throw new NotFoundError("FeeQuote", `${routeId}/${driverId}`);
    return quote;
  }

  // ─── Pay Statements ─────────────────────────────────────

  async createPayStatement(input: CreatePayStatementInput) {
    const payDate = this.calculatePayDate(input.period_end);

    // Get completed routes in period
    const routes = await db("routes")
      .where("driver_id", input.driver_id)
      .where("status", "completed")
      .where("actual_end_at", ">=", input.period_start)
      .where("actual_end_at", "<=", `${input.period_end}T23:59:59Z`);

    if (routes.length === 0) {
      throw new BadRequestError("No completed routes in this period");
    }

    return db.transaction(async (trx) => {
      // Create statement
      const [statement] = await trx("pay_statements")
        .insert({
          driver_id: input.driver_id,
          status: "draft",
          period_start: input.period_start,
          period_end: input.period_end,
          pay_date: payDate,
          total_routes: routes.length,
          policy_version: PAYOUT_POLICY.version,
        })
        .returning("*");

      let grossPay = 0;
      let totalKm = 0;
      let totalStops = 0;
      let totalEngagedMin = 0;
      let holds = 0;

      // Generate line items for each route
      for (const route of routes) {
        const km = route.actual_km || route.planned_km;
        const min = route.actual_duration_min || route.planned_duration_min;
        const stops = route.planned_stops;
        const waitMin = route.planned_wait_min || 0;

        totalKm += km;
        totalStops += stops;
        totalEngagedMin += min;

        const pay = calculateRoutePay(PAYOUT_POLICY, {
          distance_km: km,
          engaged_min: min,
          stops,
          wait_min: waitMin,
        });

        // Insert line items
        const lines = [
          { type: "base", desc: `Base fee — Route ${route.route_number}`, qty: 1, rate: pay.base, amount: pay.base },
          { type: "distance", desc: `Distance ${km} km`, qty: km, rate: PAYOUT_POLICY.per_route_rates.per_km, amount: pay.distance },
          { type: "engaged_time", desc: `Engaged time ${min} min`, qty: min, rate: PAYOUT_POLICY.per_route_rates.per_engaged_min, amount: pay.time },
          { type: "stop_fee", desc: `${stops} stops`, qty: stops, rate: PAYOUT_POLICY.per_route_rates.per_stop, amount: pay.stop_fee },
          { type: "wait_time", desc: `Wait time ${waitMin} min (${PAYOUT_POLICY.per_route_rates.wait_grace_min}m grace)`, qty: Math.max(0, waitMin - PAYOUT_POLICY.per_route_rates.wait_grace_min), rate: PAYOUT_POLICY.per_route_rates.per_wait_min, amount: pay.wait },
        ];

        for (const line of lines) {
          await trx("pay_statement_lines").insert({
            statement_id: statement.id,
            line_type: line.type,
            route_id: route.id,
            description: line.desc,
            quantity: line.qty,
            rate: line.rate,
            amount: line.amount,
          });
        }

        grossPay += pay.total;

        // Check for POD exceptions (holds)
        const pods = await trx("proof_of_delivery")
          .join("route_stops", "route_stops.id", "proof_of_delivery.route_stop_id")
          .where("route_stops.route_id", route.id)
          .whereNot("proof_of_delivery.exception_code", "none");

        for (const pod of pods) {
          const exceptionConfig = PAYOUT_POLICY.exceptions[
            pod.exception_code as keyof typeof PAYOUT_POLICY.exceptions
          ];

          if (exceptionConfig?.outcome === "hold") {
            // Calculate stop value to hold
            const stopPay = calculateRoutePay(PAYOUT_POLICY, {
              distance_km: 0,
              engaged_min: 0,
              stops: 1,
              wait_min: 0,
            });
            const holdAmount = stopPay.base + stopPay.stop_fee;

            await trx("pay_statement_lines").insert({
              statement_id: statement.id,
              line_type: "hold",
              route_id: route.id,
              stop_id: pod.route_stop_id,
              description: `Hold: ${pod.exception_code} — Stop ${pod.route_stop_id}`,
              quantity: 1,
              rate: holdAmount,
              amount: -holdAmount,
              exception_outcome: "hold",
            });

            holds += holdAmount;
          }
        }
      }

      // Minimum guarantee check
      const guarantee = calculateMinimumGuarantee(PAYOUT_POLICY, grossPay, totalEngagedMin);
      if (guarantee.needed) {
        await trx("pay_statement_lines").insert({
          statement_id: statement.id,
          line_type: "minimum_guarantee_adj",
          description: `Minimum guarantee adjustment ($${PAYOUT_POLICY.minimum_guarantee.per_engaged_hour}/engaged hr)`,
          quantity: 1,
          rate: guarantee.adjustment,
          amount: guarantee.adjustment,
        });
        grossPay += guarantee.adjustment;
      }

      // Get YTD fees for CRA T4A threshold
      const ytdResult = await trx("pay_statements")
        .where("driver_id", input.driver_id)
        .where("status", "paid")
        .whereRaw("EXTRACT(YEAR FROM period_start) = EXTRACT(YEAR FROM ?::date)", [input.period_start])
        .sum("net_pay as ytd");
      const ytdFees = Number(ytdResult[0]?.ytd || 0) + grossPay - holds;

      // Update statement totals
      const [updated] = await trx("pay_statements")
        .where("id", statement.id)
        .update({
          total_km: totalKm,
          total_stops: totalStops,
          total_engaged_min: totalEngagedMin,
          gross_pay: grossPay,
          holds,
          net_pay: grossPay - holds,
          ytd_fees: ytdFees,
          t4a_threshold: ytdFees >= PAYOUT_POLICY.cra.admin_threshold,
          updated_at: new Date(),
        })
        .returning("*");

      return updated;
    });
  }

  async getPayStatement(id: string) {
    const statement = await db("pay_statements").where("id", id).first();
    if (!statement) throw new NotFoundError("PayStatement", id);

    const lines = await db("pay_statement_lines")
      .where("statement_id", id)
      .orderBy("created_at", "asc");

    return { ...statement, lines };
  }

  async listPayStatements(driverId: string, page: number, perPage: number, offset: number) {
    const [statements, [{ count }]] = await Promise.all([
      db("pay_statements")
        .where("driver_id", driverId)
        .orderBy("period_start", "desc")
        .limit(perPage)
        .offset(offset),
      db("pay_statements")
        .where("driver_id", driverId)
        .count("id as count"),
    ]);
    return { statements, total: Number(count) };
  }

  async finalizePayStatement(id: string) {
    const [statement] = await db("pay_statements")
      .where("id", id)
      .where("status", "draft")
      .update({ status: "finalized", finalized_at: new Date(), updated_at: new Date() })
      .returning("*");
    if (!statement) throw new BadRequestError("Statement not in draft status");
    return statement;
  }

  // ─── Hold Resolution ─────────────────────────────────────

  async resolveHold(lineId: string, input: ResolveHoldInput) {
    const holdLine = await db("pay_statement_lines")
      .where("id", lineId)
      .where("line_type", "hold")
      .first();
    if (!holdLine) throw new NotFoundError("Hold line", lineId);

    return db.transaction(async (trx) => {
      // Update the hold line
      await trx("pay_statement_lines")
        .where("id", lineId)
        .update({ exception_outcome: input.outcome });

      if (input.outcome === "release") {
        // Add a release line to reverse the hold
        await trx("pay_statement_lines").insert({
          statement_id: holdLine.statement_id,
          line_type: "release",
          route_id: holdLine.route_id,
          stop_id: holdLine.stop_id,
          description: `Release: ${input.notes || "Hold resolved"}`,
          quantity: 1,
          rate: Math.abs(holdLine.amount),
          amount: Math.abs(holdLine.amount),
          exception_ref: holdLine.id,
          exception_outcome: "release",
        });

        // Update statement totals
        await trx("pay_statements")
          .where("id", holdLine.statement_id)
          .decrement("holds", Math.abs(holdLine.amount))
          .increment("net_pay", Math.abs(holdLine.amount));
      } else if (input.outcome === "adjusted" && input.adjusted_amount !== undefined) {
        const diff = Math.abs(holdLine.amount) - input.adjusted_amount;
        await trx("pay_statement_lines").insert({
          statement_id: holdLine.statement_id,
          line_type: "release",
          route_id: holdLine.route_id,
          stop_id: holdLine.stop_id,
          description: `Adjusted release: ${input.notes || "Partial release"}`,
          quantity: 1,
          rate: diff,
          amount: diff,
          exception_ref: holdLine.id,
          exception_outcome: "adjusted",
        });

        await trx("pay_statements")
          .where("id", holdLine.statement_id)
          .decrement("holds", diff)
          .increment("net_pay", diff);
      }

      return this.getPayStatement(holdLine.statement_id);
    });
  }

  // ─── Helpers ─────────────────────────────────────────────

  private calculatePayDate(periodEnd: string): string {
    // Pay day is Friday after period end (which is Sunday)
    const end = new Date(periodEnd);
    const day = end.getDay();
    const daysUntilFriday = (5 - day + 7) % 7 || 7; // next Friday
    end.setDate(end.getDate() + daysUntilFriday);
    return end.toISOString().slice(0, 10);
  }
}

export const settlementService = new SettlementService();
