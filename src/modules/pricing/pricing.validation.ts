import { z } from "zod";

export const quoteRouteSchema = z.object({
  route_id: z.string().uuid(),
  margin_override: z.number().min(0).max(2).optional(),
});

export const simpleFeeSchema = z.object({
  km_from_farm: z.number().positive(),
  tote_count: z.number().int().positive(),
  window_tightness_hours: z.number().positive(),
});

export type QuoteRouteInput = z.infer<typeof quoteRouteSchema>;
export type SimpleFeeInput = z.infer<typeof simpleFeeSchema>;
