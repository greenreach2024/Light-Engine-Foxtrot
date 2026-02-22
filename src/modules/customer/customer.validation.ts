import { z } from "zod";

export const createCustomerSchema = z.object({
  name: z.string().min(1),
  billing_email: z.string().email(),
  payment_terms_days: z.number().int().refine((v) => [7, 14, 30].includes(v)),
  tax_id: z.string().optional(),
  notes: z.string().optional(),
});

export const createLocationSchema = z.object({
  label: z.string().min(1),
  address_line1: z.string().min(1),
  address_line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postal_code: z.string().min(1),
  country: z.string().default("US"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  receiving_open: z.string().regex(/^\d{2}:\d{2}$/),
  receiving_close: z.string().regex(/^\d{2}:\d{2}$/),
  dock_rules: z.string().optional(),
  unload_time_min: z.number().int().min(1).default(15),
  has_dock: z.boolean().default(false),
  requires_stairs: z.boolean().default(false),
  special_instructions: z.string().optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
