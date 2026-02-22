import { z } from "zod";

export const createDriverSchema = z.object({
  user_id: z.string().uuid(),
  vehicle_type: z.enum(["car", "van", "refrigerated_van", "small_truck", "refrigerated_truck"]),
  vehicle_plate: z.string().optional(),
  capacity_weight_kg: z.number().positive(),
  capacity_volume_l: z.number().positive(),
  capacity_totes: z.number().int().positive().default(50),
  insurance_expiry: z.string().optional(),
  license_expiry: z.string().optional(),
  has_food_safety_cert: z.boolean().default(false),
  home_zone_lat: z.number().optional(),
  home_zone_lng: z.number().optional(),
  home_zone_radius_km: z.number().positive().optional(),
});

export const updateAvailabilitySchema = z.object({
  is_available: z.boolean(),
});

export type CreateDriverInput = z.infer<typeof createDriverSchema>;
