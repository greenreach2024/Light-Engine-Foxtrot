import { z } from "zod";

export const generateInvoiceSchema = z.object({
  customer_id: z.string().uuid(),
  order_ids: z.array(z.string().uuid()).min(1),
});

export const generatePayoutSchema = z.object({
  driver_id: z.string().uuid(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type GenerateInvoiceInput = z.infer<typeof generateInvoiceSchema>;
export type GeneratePayoutInput = z.infer<typeof generatePayoutSchema>;
