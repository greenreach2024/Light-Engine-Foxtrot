import { Router } from "express";
import { shipmentController } from "./shipment.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { createShipmentSchema, updateShipmentStatusSchema, recordEventSchema } from "./shipment.validation.js";

export const shipmentRouter = Router();

shipmentRouter.use(authenticate);

shipmentRouter.get("/", shipmentController.list);
shipmentRouter.get("/:id", shipmentController.getById);
shipmentRouter.post(
  "/",
  requireRole("admin", "ops"),
  validate({ body: createShipmentSchema }),
  shipmentController.create,
);
shipmentRouter.patch(
  "/:id/status",
  requireRole("driver", "admin", "ops"),
  validate({ body: updateShipmentStatusSchema }),
  shipmentController.updateStatus,
);

// Events
shipmentRouter.get("/:id/events", shipmentController.getEvents);
shipmentRouter.post(
  "/events",
  requireRole("driver", "admin", "ops"),
  validate({ body: recordEventSchema }),
  shipmentController.recordEvent,
);
