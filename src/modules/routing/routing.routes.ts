import { Router } from "express";
import { routingController } from "./routing.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { optimizeRoutesSchema } from "./routing.validation.js";

export const routingRouter = Router();

routingRouter.use(authenticate);

routingRouter.get("/routes", routingController.listRoutes);
routingRouter.get("/routes/:id", routingController.getRoute);
routingRouter.post("/optimize", requireRole("admin", "ops"), validate({ body: optimizeRoutesSchema }), routingController.optimize);
routingRouter.patch("/routes/:id/status", requireRole("admin", "ops"), routingController.updateStatus);
