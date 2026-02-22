import { z } from "zod";

export const createOrderSchema = z.object({
  customer_id: z.string().uuid(),
  location_id: z.string().uuid(),
  requested_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  window_open: z.string().datetime(),
  window_close: z.string().datetime(),
  notes: z.string().optional(),
  lines: z.array(
    z.object({
      product_id: z.string().uuid(),
      qty: z.number().positive(),
    }),
  ).min(1),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    "draft", "confirmed", "picking", "packed", "staged",
    "dispatched", "in_transit", "delivered", "cancelled", "exception",
  ]),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
