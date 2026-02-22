import { Router } from "express";
import { customerController } from "./customer.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole, requireOwnCustomer } from "../../middleware/rbac.js";
import { createCustomerSchema, createLocationSchema } from "./customer.validation.js";

export const customerRouter = Router();

customerRouter.use(authenticate);

// Customer CRUD — ops/admin can manage, customer roles can read their own
customerRouter.get("/", requireRole("admin", "ops"), customerController.list);
customerRouter.post("/", requireRole("admin", "ops"), validate({ body: createCustomerSchema }), customerController.create);
customerRouter.get("/:id", requireOwnCustomer("id"), customerController.getById);
customerRouter.patch("/:id", requireRole("admin", "ops"), validate({ body: createCustomerSchema.partial() }), customerController.update);

// Locations
customerRouter.get("/:id/locations", requireOwnCustomer("id"), customerController.listLocations);
customerRouter.post("/:id/locations", requireRole("admin", "ops", "customer_admin"), validate({ body: createLocationSchema }), customerController.createLocation);
customerRouter.patch("/:id/locations/:locationId", requireRole("admin", "ops", "customer_admin"), customerController.updateLocation);

// Catalog
customerRouter.get("/:id/catalog", requireOwnCustomer("id"), customerController.getCatalog);
