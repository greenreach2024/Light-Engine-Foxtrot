import dayjs from "dayjs";
import { db } from "../../db/index.js";
import { env } from "../../config/env.js";
import { NotFoundError, BadRequestError } from "../../shared/utils/errors.js";
import { generateInvoiceNumber, round } from "../../shared/utils/helpers.js";
import type { Invoice, Order } from "../../shared/types/index.js";
import type { GenerateInvoiceInput, GeneratePayoutInput } from "./billing.validation.js";

export class BillingService {
  // ─── Customer Invoices ──────────────────────────────────

  async generateInvoice(input: GenerateInvoiceInput): Promise<Invoice> {
    return db.transaction(async (trx) => {
      const customer = await trx("customers").where("id", input.customer_id).first();
      if (!customer) throw new NotFoundError("Customer", input.customer_id);

      const orders = await trx("orders")
        .whereIn("id", input.order_ids)
        .where("customer_id", input.customer_id)
        .where("status", "delivered") as Order[];

      if (orders.length === 0) throw new BadRequestError("No delivered orders found");

      // Count invoices today for numbering
      const [{ count }] = await trx("invoices")
        .whereRaw("created_at::date = CURRENT_DATE")
        .count("id as count");
      const invoiceNumber = generateInvoiceNumber(Number(count) + 1);

      const subtotal = orders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
      const tax = round(subtotal * env.TAX_RATE);
      const total = round(subtotal + tax);
      const dueDate = dayjs().add(customer.payment_terms_days, "day").format("YYYY-MM-DD");

      const [invoice] = await trx("invoices")
        .insert({
          invoice_number: invoiceNumber,
          customer_id: input.customer_id,
          status: "issued",
          issued_date: dayjs().format("YYYY-MM-DD"),
          due_date: dueDate,
          subtotal,
          tax,
          total,
        })
        .returning("*");

      // Insert invoice lines
      for (const order of orders) {
        await trx("invoice_lines").insert({
          invoice_id: invoice.id,
          order_id: order.id,
          description: `Order ${order.order_number} — Products + Delivery`,
          quantity: 1,
          unit_price: Number(order.total_amount ?? 0),
          line_total: Number(order.total_amount ?? 0),
        });
      }

      return invoice;
    });
  }

  async listInvoices(customerId?: string) {
    let query = db("invoices").orderBy("created_at", "desc");
    if (customerId) query = query.where("customer_id", customerId);
    return query;
  }

  async getInvoice(id: string): Promise<Invoice & { lines: any[] }> {
    const invoice = await db("invoices").where("id", id).first();
    if (!invoice) throw new NotFoundError("Invoice", id);
    const lines = await db("invoice_lines").where("invoice_id", id);
    return { ...invoice, lines };
  }

  async markPaid(id: string): Promise<Invoice> {
    const [invoice] = await db("invoices")
      .where("id", id)
      .update({
        status: "paid",
        paid_date: dayjs().format("YYYY-MM-DD"),
        amount_paid: db.raw("total"),
        updated_at: new Date(),
      })
      .returning("*");
    if (!invoice) throw new NotFoundError("Invoice", id);
    return invoice;
  }

  // ─── Driver Payouts ─────────────────────────────────────

  async generatePayout(input: GeneratePayoutInput) {
    return db.transaction(async (trx) => {
      const driver = await trx("drivers").where("id", input.driver_id).first();
      if (!driver) throw new NotFoundError("Driver", input.driver_id);

      // Get completed routes in period
      const routes = await trx("routes")
        .where("driver_id", input.driver_id)
        .where("status", "completed")
        .whereBetween("actual_end_at", [
          `${input.period_start}T00:00:00Z`,
          `${input.period_end}T23:59:59Z`,
        ]);

      if (routes.length === 0) throw new BadRequestError("No completed routes in period");

      const totalKm = routes.reduce((s: number, r: any) => s + (r.actual_km ?? r.planned_km), 0);
      const totalStops = routes.reduce((s: number, r: any) => s + r.planned_stops, 0);
      const grossPay = routes.reduce((s: number, r: any) => s + Number(r.driver_pay ?? 0), 0);

      const [payout] = await trx("driver_payouts")
        .insert({
          driver_id: input.driver_id,
          status: "pending",
          period_start: input.period_start,
          period_end: input.period_end,
          total_routes: routes.length,
          total_km: round(totalKm),
          total_stops: totalStops,
          gross_pay: round(grossPay),
          deductions: 0,
          incentives: 0,
          net_pay: round(grossPay),
        })
        .returning("*");

      // Insert payout lines
      for (const route of routes) {
        await trx("payout_lines").insert({
          payout_id: payout.id,
          route_id: route.id,
          description: `Route ${route.route_number}`,
          amount: Number(route.driver_pay ?? 0),
        });
      }

      return payout;
    });
  }

  async listPayouts(driverId?: string) {
    let query = db("driver_payouts").orderBy("created_at", "desc");
    if (driverId) query = query.where("driver_id", driverId);
    return query;
  }

  async markPayoutPaid(id: string) {
    const [payout] = await db("driver_payouts")
      .where("id", id)
      .update({ status: "paid", paid_at: new Date(), updated_at: new Date() })
      .returning("*");
    if (!payout) throw new NotFoundError("DriverPayout", id);
    return payout;
  }
}

export const billingService = new BillingService();
