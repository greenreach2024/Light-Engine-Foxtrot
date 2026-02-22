import { db } from "../../db/index.js";
import { NotFoundError, BadRequestError } from "../../shared/utils/errors.js";
import { generateOrderNumber } from "../../shared/utils/helpers.js";
import { TEMP_CLASS_PRIORITY } from "../../shared/constants/index.js";
import type { Order, OrderLine, TempClass } from "../../shared/types/index.js";
import type { CreateOrderInput, UpdateOrderStatusInput } from "./order.validation.js";

export class OrderService {
  async list(filters: { customerId?: string; status?: string; date?: string }, page: number, perPage: number, offset: number) {
    let query = db("orders").orderBy("created_at", "desc").limit(perPage).offset(offset);
    let countQuery = db("orders").count("id as count");

    if (filters.customerId) {
      query = query.where("customer_id", filters.customerId);
      countQuery = countQuery.where("customer_id", filters.customerId);
    }
    if (filters.status) {
      query = query.where("status", filters.status);
      countQuery = countQuery.where("status", filters.status);
    }
    if (filters.date) {
      query = query.where("requested_date", filters.date);
      countQuery = countQuery.where("requested_date", filters.date);
    }

    const [orders, [{ count }]] = await Promise.all([query, countQuery]);
    return { orders, total: Number(count) };
  }

  async getById(id: string): Promise<Order & { lines: OrderLine[] }> {
    const order = await db("orders").where("id", id).first() as Order | undefined;
    if (!order) throw new NotFoundError("Order", id);
    const lines = await db("order_lines").where("order_id", id);
    return { ...order, lines };
  }

  async create(input: CreateOrderInput, placedBy: string): Promise<Order> {
    return db.transaction(async (trx) => {
      // Get today's order count for numbering
      const [{ count }] = await trx("orders")
        .whereRaw("created_at::date = CURRENT_DATE")
        .count("id as count");
      const orderNumber = generateOrderNumber(Number(count) + 1);

      // Look up product details for line calculations
      const productIds = input.lines.map((l) => l.product_id);
      const products = await trx("products").whereIn("id", productIds);
      const productMap = new Map(products.map((p: any) => [p.id, p]));

      // Build lines with computed fields
      let totalWeight = 0;
      let totalVolume = 0;
      let toteCount = 0;
      let productTotal = 0;
      let highestTemp: TempClass = "ambient";

      const lineRows = input.lines.map((line) => {
        const product = productMap.get(line.product_id);
        if (!product) throw new BadRequestError(`Product ${line.product_id} not found`);

        // Get customer-specific price
        const lineWeight = (product.weight_kg ?? 0) * line.qty;
        const lineVolume = (product.volume_l ?? 0) * line.qty;

        totalWeight += lineWeight;
        totalVolume += lineVolume;
        toteCount += Math.ceil(line.qty); // rough tote estimate

        if (TEMP_CLASS_PRIORITY[product.temp_class] > TEMP_CLASS_PRIORITY[highestTemp]) {
          highestTemp = product.temp_class;
        }

        // For MVP, use catalog price or 0
        const unitPrice = 0; // will be filled from customer_catalog lookup
        const lineTotal = unitPrice * line.qty;
        productTotal += lineTotal;

        return {
          order_id: "", // placeholder
          product_id: line.product_id,
          qty: line.qty,
          unit_price: unitPrice,
          line_total: lineTotal,
          weight_kg: lineWeight,
          volume_l: lineVolume,
          temp_class: product.temp_class,
        };
      });

      // Look up customer catalog prices
      const catalogPrices = await trx("customer_catalog")
        .where("customer_id", input.customer_id)
        .whereIn("product_id", productIds);
      const priceMap = new Map(catalogPrices.map((c: any) => [c.product_id, Number(c.price)]));

      // Apply prices
      productTotal = 0;
      for (const line of lineRows) {
        const price = priceMap.get(line.product_id) ?? 0;
        line.unit_price = price;
        line.line_total = price * line.qty;
        productTotal += line.line_total;
      }

      // Insert order
      const [order] = await trx("orders")
        .insert({
          order_number: orderNumber,
          customer_id: input.customer_id,
          location_id: input.location_id,
          placed_by: placedBy,
          status: "confirmed",
          requested_date: input.requested_date,
          window_open: input.window_open,
          window_close: input.window_close,
          total_weight_kg: totalWeight,
          total_volume_l: totalVolume,
          tote_count: toteCount,
          temp_class: highestTemp,
          product_total: productTotal,
          notes: input.notes ?? null,
        })
        .returning("*");

      // Insert lines
      const linesWithOrderId = lineRows.map((l) => ({ ...l, order_id: order.id }));
      await trx("order_lines").insert(linesWithOrderId);

      return order;
    });
  }

  async updateStatus(id: string, input: UpdateOrderStatusInput): Promise<Order> {
    const [order] = await db("orders")
      .where("id", id)
      .update({ status: input.status, updated_at: new Date() })
      .returning("*");
    if (!order) throw new NotFoundError("Order", id);
    return order;
  }

  async cancel(id: string): Promise<Order> {
    const order = await this.getById(id);
    if (!["draft", "confirmed"].includes(order.status)) {
      throw new BadRequestError("Cannot cancel order in current status");
    }
    return this.updateStatus(id, { status: "cancelled" });
  }

  /** Get orders eligible for wave planning (confirmed + matching date) */
  async getOrdersForWave(date: string): Promise<Order[]> {
    return db("orders")
      .where({ requested_date: date, status: "confirmed" })
      .orderBy("window_open");
  }
}

export const orderService = new OrderService();
