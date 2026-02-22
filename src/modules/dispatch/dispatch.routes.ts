import { Router } from "express";
import { dispatchController } from "./dispatch.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { createWaveSchema, offerRouteSchema, respondOfferSchema } from "./dispatch.validation.js";

export const dispatchRouter = Router();

dispatchRouter.use(authenticate);

// Wave management — ops/admin
dispatchRouter.get("/waves", requireRole("admin", "ops"), dispatchController.listWaves);
dispatchRouter.get("/waves/plan", requireRole("admin", "ops"), dispatchController.planWaves);
dispatchRouter.get("/waves/:id", requireRole("admin", "ops"), dispatchController.getWave);
dispatchRouter.post("/waves", requireRole("admin", "ops"), validate({ body: createWaveSchema }), dispatchController.createWave);
dispatchRouter.patch("/waves/:id/status", requireRole("admin", "ops"), dispatchController.updateWaveStatus);

// Route offers
dispatchRouter.post("/offers", requireRole("admin", "ops"), validate({ body: offerRouteSchema }), dispatchController.offerRoute);
dispatchRouter.get("/offers/mine", requireRole("driver"), dispatchController.getMyOffers);
dispatchRouter.patch("/offers/:offerId", requireRole("driver"), validate({ body: respondOfferSchema }), dispatchController.respondToOffer);
