import { Router } from "express";
import { orderController } from "./order.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { createOrderSchema, updateOrderStatusSchema } from "./order.validation.js";

export const orderRouter = Router();

orderRouter.use(authenticate);

orderRouter.get("/", orderController.list);
orderRouter.get("/:id", orderController.getById);
orderRouter.post("/", requireRole("admin", "ops", "customer_admin", "customer_user"), validate({ body: createOrderSchema }), orderController.create);
orderRouter.patch("/:id/status", requireRole("admin", "ops"), validate({ body: updateOrderStatusSchema }), orderController.updateStatus);
orderRouter.post("/:id/cancel", requireRole("admin", "ops", "customer_admin"), orderController.cancel);
