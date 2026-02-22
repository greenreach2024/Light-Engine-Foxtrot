import { Router } from "express";
import { billingController } from "./billing.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { generateInvoiceSchema, generatePayoutSchema } from "./billing.validation.js";

export const billingRouter = Router();

billingRouter.use(authenticate);

// Invoices
billingRouter.post("/invoices", requireRole("admin", "ops"), validate({ body: generateInvoiceSchema }), billingController.generateInvoice);
billingRouter.get("/invoices", billingController.listInvoices);
billingRouter.get("/invoices/:id", billingController.getInvoice);
billingRouter.post("/invoices/:id/paid", requireRole("admin", "ops"), billingController.markPaid);

// Payouts
billingRouter.post("/payouts", requireRole("admin", "ops"), validate({ body: generatePayoutSchema }), billingController.generatePayout);
billingRouter.get("/payouts", billingController.listPayouts);
billingRouter.post("/payouts/:id/paid", requireRole("admin", "ops"), billingController.markPayoutPaid);
