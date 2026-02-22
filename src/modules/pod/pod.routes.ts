import { Router } from "express";
import { podController } from "./pod.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { createPodSchema } from "./pod.validation.js";

export const podRouter = Router();

podRouter.use(authenticate);

podRouter.post("/", requireRole("driver"), validate({ body: createPodSchema }), podController.create);
podRouter.get("/stop/:stopId", podController.getByStop);
podRouter.get("/route/:routeId", podController.listByRoute);
