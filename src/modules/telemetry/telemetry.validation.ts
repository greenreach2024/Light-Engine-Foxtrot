import { z } from "zod";

export const gpsPingSchema = z.object({
  route_id: z.string().uuid().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed_kmh: z.number().optional(),
  heading: z.number().min(0).max(360).optional(),
  accuracy_m: z.number().optional(),
});

export const gpsPingBatchSchema = z.object({
  pings: z.array(gpsPingSchema).min(1).max(100),
});

export type GpsPingInput = z.infer<typeof gpsPingSchema>;
