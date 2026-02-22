import { Router } from "express";
import { driverOnboardingController } from "./driver-onboarding.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import {
  applyDriverSchema,
  uploadDocSchema,
  reviewDocSchema,
  setupBankingSchema,
  signAgreementSchema,
  transitionStatusSchema,
} from "./driver-onboarding.validation.js";

export const driverOnboardingRouter = Router();

// ─── Public: driver application (no auth) ─────────────────
driverOnboardingRouter.post(
  "/apply",
  validate({ body: applyDriverSchema }),
  driverOnboardingController.apply,
);

// ─── Authenticated routes ─────────────────────────────────
driverOnboardingRouter.use(authenticate);

// Onboarding status
driverOnboardingRouter.get(
  "/:driverId/status",
  driverOnboardingController.getOnboardingStatus,
);

// Documents
driverOnboardingRouter.get(
  "/:driverId/documents",
  driverOnboardingController.listDocuments,
);
driverOnboardingRouter.post(
  "/:driverId/documents",
  requireRole("driver", "admin", "ops"),
  validate({ body: uploadDocSchema }),
  driverOnboardingController.uploadDocument,
);
driverOnboardingRouter.patch(
  "/documents/:docId/review",
  requireRole("admin", "ops"),
  validate({ body: reviewDocSchema }),
  driverOnboardingController.reviewDocument,
);

// Background Check
driverOnboardingRouter.get(
  "/:driverId/background-check",
  driverOnboardingController.getBackgroundCheck,
);
driverOnboardingRouter.post(
  "/:driverId/background-check",
  requireRole("admin", "ops"),
  driverOnboardingController.submitBackgroundCheck,
);
driverOnboardingRouter.patch(
  "/background-check/:checkId",
  requireRole("admin", "ops"),
  driverOnboardingController.updateBackgroundCheck,
);

// Banking
driverOnboardingRouter.post(
  "/:driverId/banking",
  requireRole("driver", "admin", "ops"),
  validate({ body: setupBankingSchema }),
  driverOnboardingController.setupBanking,
);
driverOnboardingRouter.patch(
  "/:driverId/banking/verify",
  requireRole("admin", "ops"),
  driverOnboardingController.verifyBanking,
);

// Agreements
driverOnboardingRouter.get(
  "/:driverId/agreements",
  driverOnboardingController.listAgreements,
);
driverOnboardingRouter.post(
  "/:driverId/agreements",
  requireRole("driver", "admin", "ops"),
  validate({ body: signAgreementSchema }),
  driverOnboardingController.signAgreement,
);

// Force status (admin only)
driverOnboardingRouter.patch(
  "/:driverId/force-status",
  requireRole("admin"),
  validate({ body: transitionStatusSchema }),
  driverOnboardingController.forceStatus,
);
