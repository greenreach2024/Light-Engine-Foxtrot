import { Router } from "express";
import { pricingController } from "./pricing.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { quoteRouteSchema, simpleFeeSchema } from "./pricing.validation.js";

export const pricingRouter = Router();

pricingRouter.use(authenticate);

// Route-level cost allocation pricing
pricingRouter.post("/quote-route", requireRole("admin", "ops"), validate({ body: quoteRouteSchema }), pricingController.quoteRoute);

// Simple MVP fee calculator
pricingRouter.post("/simple-fee", validate({ body: simpleFeeSchema }), pricingController.simpleFee);
