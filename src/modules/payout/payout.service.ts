import { db } from "../../db/index.js";
import { NotFoundError, BadRequestError } from "../../shared/utils/errors.js";
import { PAYOUT_POLICY } from "../../config/payout-policy.js";
import { logger } from "../../shared/utils/logger.js";
import type { CreatePayoutBatchInput } from "./payout.validation.js";

export class PayoutService {
  // ─── Batch Creation ──────────────────────────────────────

  async createBatch(input: CreatePayoutBatchInput) {
    return db.transaction(async (trx) => {
      // Validate all statements are finalized
      const statements = await trx("pay_statements").whereIn("id", input.statement_ids);
      if (statements.length !== input.statement_ids.length) {
        throw new BadRequestError("One or more statement IDs are invalid");
      }

      const nonFinalized = statements.filter((s: any) => s.status !== "finalized");
      if (nonFinalized.length > 0) {
        throw new BadRequestError(
          `${nonFinalized.length} statements are not finalized`,
        );
      }

      // Generate batch number
      const date = input.pay_date.replace(/-/g, "");
      const countResult = await trx("payout_batches")
        .where("batch_number", "like", `PB-${date}-%`)
        .count("id as count");
      const seq = String(Number(countResult[0].count) + 1).padStart(3, "0");
      const batch_number = `PB-${date}-${seq}`;

      const totalAmount = statements.reduce((s: number, st: any) => s + Number(st.net_pay), 0);
      const driverIds = [...new Set(statements.map((s: any) => s.driver_id))];

      const [batch] = await trx("payout_batches")
        .insert({
          batch_number,
          status: "draft",
          pay_date: input.pay_date,
          total_drivers: driverIds.length,
          total_amount: totalAmount,
        })
        .returning("*");

      // Create individual payout records
      for (const stmt of statements) {
        await trx("payouts").insert({
          batch_id: batch.id,
          driver_id: stmt.driver_id,
          statement_id: stmt.id,
          amount: stmt.net_pay,
          currency: PAYOUT_POLICY.stripe.currency,
          status: "pending",
        });
      }

      return batch;
    });
  }

  // ─── Batch approval ──────────────────────────────────────

  async approveBatch(batchId: string, approvedBy: string, notes?: string) {
    const [batch] = await db("payout_batches")
      .where("id", batchId)
      .where("status", "draft")
      .update({
        status: "approved",
        approved_by: approvedBy,
        approved_at: new Date(),
        notes,
        updated_at: new Date(),
      })
      .returning("*");

    if (!batch) throw new BadRequestError("Batch not in draft status or not found");
    return batch;
  }

  // ─── Process batch (Stripe stub) ─────────────────────────

  async processBatch(batchId: string) {
    const batch = await db("payout_batches").where("id", batchId).first();
    if (!batch) throw new NotFoundError("PayoutBatch", batchId);
    if (batch.status !== "approved") {
      throw new BadRequestError("Batch must be approved before processing");
    }

    await db("payout_batches")
      .where("id", batchId)
      .update({ status: "processing", updated_at: new Date() });

    const payouts = await db("payouts").where("batch_id", batchId);

    let successCount = 0;
    let failCount = 0;

    for (const payout of payouts) {
      try {
        // ── Stripe Connect transfer stub ──
        // In production: const transfer = await stripe.transfers.create({...})
        const stripeTransferId = `tr_stub_${payout.id.slice(0, 8)}`;

        logger.info(
          {
            payout_id: payout.id,
            driver_id: payout.driver_id,
            amount: payout.amount,
            currency: payout.currency,
            stripe_transfer_id: stripeTransferId,
          },
          "payout.stripe_transfer_stub",
        );

        await db("payouts")
          .where("id", payout.id)
          .update({
            status: "paid",
            stripe_transfer_id: stripeTransferId,
            paid_at: new Date(),
            updated_at: new Date(),
          });

        // Mark pay statement as paid
        await db("pay_statements")
          .where("id", payout.statement_id)
          .update({ status: "paid", updated_at: new Date() });

        successCount++;
      } catch (err: any) {
        logger.error({ payout_id: payout.id, error: err.message }, "payout.stripe_transfer_failed");

        await db("payouts")
          .where("id", payout.id)
          .update({
            status: "failed",
            error_message: err.message,
            updated_at: new Date(),
          });
        failCount++;
      }
    }

    const finalStatus = failCount === 0 ? "completed" : "failed";
    await db("payout_batches")
      .where("id", batchId)
      .update({
        status: finalStatus,
        processed_at: new Date(),
        updated_at: new Date(),
      });

    return {
      batch_id: batchId,
      status: finalStatus,
      success: successCount,
      failed: failCount,
      total: payouts.length,
    };
  }

  // ─── Queries ─────────────────────────────────────────────

  async getBatch(id: string) {
    const batch = await db("payout_batches").where("id", id).first();
    if (!batch) throw new NotFoundError("PayoutBatch", id);

    const payouts = await db("payouts")
      .where("batch_id", id)
      .join("drivers", "drivers.id", "payouts.driver_id")
      .join("users", "users.id", "drivers.user_id")
      .select(
        "payouts.*",
        "users.first_name",
        "users.last_name",
        "users.email",
      );

    return { ...batch, payouts };
  }

  async listBatches(page: number, perPage: number, offset: number) {
    const [batches, [{ count }]] = await Promise.all([
      db("payout_batches").orderBy("pay_date", "desc").limit(perPage).offset(offset),
      db("payout_batches").count("id as count"),
    ]);
    return { batches, total: Number(count) };
  }

  async getDriverPayouts(driverId: string, page: number, perPage: number, offset: number) {
    const [payouts, [{ count }]] = await Promise.all([
      db("payouts")
        .where("driver_id", driverId)
        .orderBy("created_at", "desc")
        .limit(perPage)
        .offset(offset),
      db("payouts").where("driver_id", driverId).count("id as count"),
    ]);
    return { payouts, total: Number(count) };
  }

  // ─── CRA T4A helper ─────────────────────────────────────

  async getDriversAboveT4aThreshold(year: number) {
    const drivers = await db("pay_statements")
      .where("status", "paid")
      .whereRaw("EXTRACT(YEAR FROM period_start) = ?", [year])
      .groupBy("driver_id")
      .havingRaw("SUM(net_pay) >= ?", [PAYOUT_POLICY.cra.admin_threshold])
      .select("driver_id")
      .sum("net_pay as total_fees");

    return drivers;
  }
}

export const payoutService = new PayoutService();
