import { z } from "zod";

export const createPayStatementSchema = z.object({
  driver_id: z.string().uuid(),
  period_start: z.string(), // DATE string YYYY-MM-DD
  period_end: z.string(),
});

export const resolveHoldSchema = z.object({
  outcome: z.enum(["release", "adjusted"]),
  adjusted_amount: z.number().optional(),
  notes: z.string().optional(),
});

export const createFeeQuoteSchema = z.object({
  route_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  estimated_km: z.number().positive(),
  estimated_min: z.number().int().positive(),
  estimated_stops: z.number().int().positive(),
  estimated_wait_min: z.number().int().min(0).default(0),
});

export type CreatePayStatementInput = z.infer<typeof createPayStatementSchema>;
export type ResolveHoldInput = z.infer<typeof resolveHoldSchema>;
export type CreateFeeQuoteInput = z.infer<typeof createFeeQuoteSchema>;
