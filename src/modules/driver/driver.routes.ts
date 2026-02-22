import { Router } from "express";
import { driverController } from "./driver.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { createDriverSchema, updateAvailabilitySchema } from "./driver.validation.js";

export const driverRouter = Router();

driverRouter.use(authenticate);

driverRouter.get("/", requireRole("admin", "ops"), driverController.list);
driverRouter.get("/:id", driverController.getById);
driverRouter.post("/", requireRole("admin", "ops"), validate({ body: createDriverSchema }), driverController.create);
driverRouter.patch("/:id", requireRole("admin", "ops"), driverController.update);
driverRouter.patch("/:id/availability", requireRole("driver", "admin", "ops"), validate({ body: updateAvailabilitySchema }), driverController.setAvailability);
