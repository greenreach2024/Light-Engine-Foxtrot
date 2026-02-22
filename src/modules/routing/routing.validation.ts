import { z } from "zod";

export const optimizeRoutesSchema = z.object({
  wave_id: z.string().uuid(),
  depot_lat: z.number(),
  depot_lng: z.number(),
  max_stops_per_route: z.number().int().positive().optional(),
  max_duration_min: z.number().int().positive().optional(),
});

export const reoptimizeSchema = z.object({
  route_id: z.string().uuid(),
  reason: z.enum(["cancellation", "addition", "traffic", "driver_change"]),
});

export type OptimizeRoutesInput = z.infer<typeof optimizeRoutesSchema>;
