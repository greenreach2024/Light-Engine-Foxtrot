import { z } from "zod";

export const createPodSchema = z.object({
  route_stop_id: z.string().uuid(),
  signature_url: z.string().url().optional(),
  photo_urls: z.array(z.string().url()).default([]),
  recipient_name: z.string().optional(),
  temp_reading: z.number().optional(),
  condition_notes: z.string().optional(),
  exception_code: z.enum([
    "none", "partial_delivery", "refused", "damaged",
    "wrong_items", "temp_breach", "access_issue", "other",
  ]).default("none"),
  exception_notes: z.string().optional(),
});

export type CreatePodInput = z.infer<typeof createPodSchema>;
