import { z } from "zod";

export const createPayoutBatchSchema = z.object({
  pay_date: z.string(), // YYYY-MM-DD
  statement_ids: z.array(z.string().uuid()).min(1),
});

export const approvePayoutBatchSchema = z.object({
  notes: z.string().optional(),
});

export type CreatePayoutBatchInput = z.infer<typeof createPayoutBatchSchema>;
