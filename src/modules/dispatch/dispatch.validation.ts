import { z } from "zod";

export const createWaveSchema = z.object({
  wave_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  wave_label: z.string().min(1),
  cutoff_at: z.string().datetime(),
  departure_at: z.string().datetime().optional(),
});

export const offerRouteSchema = z.object({
  route_id: z.string().uuid(),
  driver_ids: z.array(z.string().uuid()).min(1),
  expires_in_min: z.number().int().positive().default(15),
});

export const respondOfferSchema = z.object({
  status: z.enum(["accepted", "declined"]),
});

export type CreateWaveInput = z.infer<typeof createWaveSchema>;
export type OfferRouteInput = z.infer<typeof offerRouteSchema>;
