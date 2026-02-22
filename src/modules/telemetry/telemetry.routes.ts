import { Router } from "express";
import { telemetryController } from "./telemetry.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { gpsPingSchema, gpsPingBatchSchema } from "./telemetry.validation.js";

export const telemetryRouter = Router();

telemetryRouter.use(authenticate);

// Driver GPS pings
telemetryRouter.post("/ping", requireRole("driver"), validate({ body: gpsPingSchema }), telemetryController.recordPing);
telemetryRouter.post("/ping/batch", requireRole("driver"), validate({ body: gpsPingBatchSchema }), telemetryController.recordBatch);

// Position & tracking (ops)
telemetryRouter.get("/position/:driverId", requireRole("admin", "ops"), telemetryController.getLatest);
telemetryRouter.get("/track/:routeId", requireRole("admin", "ops"), telemetryController.getRouteTrack);

// ETA
telemetryRouter.get("/eta", telemetryController.estimateEta);

// Route adherence metrics
telemetryRouter.get("/adherence/:routeId", requireRole("admin", "ops"), telemetryController.routeAdherence);
