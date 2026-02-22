import { z } from "zod";

export const applyDriverSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(10),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  preferred_zone: z.string().min(1),
  vehicle_type: z.enum(["car", "van", "reefer_van", "reefer_truck", "pickup"]),
  capacity_weight_kg: z.number().positive().optional(),
  capacity_totes: z.number().int().positive().optional(),
  contractor_acknowledged: z.boolean().refine((v) => v === true, {
    message: "Contractor acknowledgement is required",
  }),
});

export const uploadDocSchema = z.object({
  doc_type: z.enum(["licence", "insurance", "right_to_work", "vehicle_photo", "food_safety"]),
  file_url: z.string().url(),
  file_name: z.string().min(1),
  file_size: z.number().int().positive().optional(),
  expires_at: z.string().optional(),
});

export const reviewDocSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  reject_reason: z.string().optional(),
});

export const submitBgCheckSchema = z.object({
  provider: z.string().default("internal"),
  provider_ref: z.string().optional(),
});

export const setupBankingSchema = z.object({
  stripe_account_id: z.string().min(1),
  bank_last4: z.string().length(4).optional(),
});

export const signAgreementSchema = z.object({
  agreement_type: z.enum(["contractor_v1", "dpwra_disclosure_v1"]),
  version: z.string().min(1),
  ip_address: z.string().optional(),
});

export const transitionStatusSchema = z.object({
  status: z.enum([
    "applicant", "docs_pending", "bg_check", "banking",
    "agreement", "training", "active", "suspended", "deactivated",
  ]),
});

export type ApplyDriverInput = z.infer<typeof applyDriverSchema>;
export type UploadDocInput = z.infer<typeof uploadDocSchema>;
export type ReviewDocInput = z.infer<typeof reviewDocSchema>;
export type SetupBankingInput = z.infer<typeof setupBankingSchema>;
export type SignAgreementInput = z.infer<typeof signAgreementSchema>;
