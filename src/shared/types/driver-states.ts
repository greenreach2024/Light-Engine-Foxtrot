// ─── Driver onboarding state machine ─────────────────────────

export type DriverOnboardingStatus =
  | "applicant"
  | "docs_pending"
  | "bg_check"
  | "banking"
  | "agreement"
  | "training"
  | "active"
  | "suspended"
  | "deactivated";

export type DriverStatusTransition = {
  from: DriverOnboardingStatus;
  to: DriverOnboardingStatus;
  guard?: string; // description of the condition required
};

/**
 * Valid state transitions for driver onboarding.
 * Each entry describes the allowed from → to + guard condition.
 */
export const DRIVER_TRANSITIONS: DriverStatusTransition[] = [
  { from: "applicant", to: "docs_pending", guard: "email_verified && phone_verified" },
  { from: "docs_pending", to: "bg_check", guard: "all_required_docs_accepted" },
  { from: "bg_check", to: "banking", guard: "background_check_passed" },
  { from: "banking", to: "agreement", guard: "payout_account_verified" },
  { from: "agreement", to: "training", guard: "contractor_agreement_signed && dpwra_disclosure_signed" },
  { from: "agreement", to: "active", guard: "contractor_agreement_signed && dpwra_disclosure_signed && training_not_required" },
  { from: "training", to: "active", guard: "training_completed" },
  // Suspension / reactivation
  { from: "active", to: "suspended", guard: "ops_action || compliance_issue" },
  { from: "suspended", to: "active", guard: "ops_reinstatement" },
  // Deactivation (from any state)
  { from: "active", to: "deactivated", guard: "driver_request || ops_action" },
  { from: "suspended", to: "deactivated", guard: "ops_action" },
];

/** Map of allowed next-states from each status */
export const ALLOWED_TRANSITIONS: Record<DriverOnboardingStatus, DriverOnboardingStatus[]> = {
  applicant: ["docs_pending"],
  docs_pending: ["bg_check"],
  bg_check: ["banking"],
  banking: ["agreement"],
  agreement: ["training", "active"],
  training: ["active"],
  active: ["suspended", "deactivated"],
  suspended: ["active", "deactivated"],
  deactivated: [],
};

/**
 * Validate a driver status transition.
 * Returns true if `from → to` is allowed.
 */
export function isValidTransition(
  from: DriverOnboardingStatus,
  to: DriverOnboardingStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Required document types for onboarding.
 */
export const REQUIRED_DOC_TYPES = ["licence", "insurance", "right_to_work"] as const;

/**
 * Onboarding checklist items with their gating status field.
 */
export const ONBOARDING_STEPS = [
  { key: "verification", label: "Email & Phone Verification", gatesStatus: "docs_pending" as const },
  { key: "documents", label: "Document Upload", gatesStatus: "bg_check" as const },
  { key: "background", label: "Background Check", gatesStatus: "banking" as const },
  { key: "banking", label: "Banking Setup", gatesStatus: "agreement" as const },
  { key: "agreement", label: "Contractor Agreement & DPWRA Disclosure", gatesStatus: "active" as const },
] as const;
