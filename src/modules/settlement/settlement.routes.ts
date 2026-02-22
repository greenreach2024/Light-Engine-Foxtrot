import { Router } from "express";
import { settlementController } from "./settlement.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { createPayStatementSchema, resolveHoldSchema, createFeeQuoteSchema } from "./settlement.validation.js";

export const settlementRouter = Router();

settlementRouter.use(authenticate);

// Fee quotes (DPWRA disclosure)
settlementRouter.post(
  "/fee-quotes",
  requireRole("admin", "ops"),
  validate({ body: createFeeQuoteSchema }),
  settlementController.createFeeQuote,
);
settlementRouter.get(
  "/fee-quotes/:routeId/:driverId",
  settlementController.getFeeQuote,
);

// Pay statements
settlementRouter.post(
  "/pay-statements",
  requireRole("admin", "ops"),
  validate({ body: createPayStatementSchema }),
  settlementController.createPayStatement,
);
settlementRouter.get(
  "/pay-statements/:id",
  settlementController.getPayStatement,
);
settlementRouter.get(
  "/drivers/:driverId/pay-statements",
  settlementController.listPayStatements,
);
settlementRouter.patch(
  "/pay-statements/:id/finalize",
  requireRole("admin", "ops"),
  settlementController.finalizePayStatement,
);

// Hold resolution
settlementRouter.patch(
  "/holds/:lineId/resolve",
  requireRole("admin", "ops"),
  validate({ body: resolveHoldSchema }),
  settlementController.resolveHold,
);
