import { Router } from "express";
import { payoutController } from "./payout.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { createPayoutBatchSchema, approvePayoutBatchSchema } from "./payout.validation.js";

export const payoutRouter = Router();

payoutRouter.use(authenticate);

// Batches
payoutRouter.get("/batches", requireRole("admin", "ops"), payoutController.listBatches);
payoutRouter.get("/batches/:id", requireRole("admin", "ops"), payoutController.getBatch);
payoutRouter.post(
  "/batches",
  requireRole("admin", "ops"),
  validate({ body: createPayoutBatchSchema }),
  payoutController.createBatch,
);
payoutRouter.patch(
  "/batches/:id/approve",
  requireRole("admin"),
  validate({ body: approvePayoutBatchSchema }),
  payoutController.approveBatch,
);
payoutRouter.post(
  "/batches/:id/process",
  requireRole("admin"),
  payoutController.processBatch,
);

// Driver payouts
payoutRouter.get(
  "/drivers/:driverId",
  payoutController.getDriverPayouts,
);

// CRA T4A reporting
payoutRouter.get(
  "/cra/t4a/:year",
  requireRole("admin"),
  payoutController.getT4aDrivers,
);
