import { Router } from "express";
import { notificationController } from "./notification.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { sendNotificationSchema } from "./notification.validation.js";

export const notificationRouter = Router();

notificationRouter.use(authenticate);

notificationRouter.post("/", requireRole("admin", "ops"), validate({ body: sendNotificationSchema }), notificationController.send);
notificationRouter.get("/", notificationController.list);
notificationRouter.patch("/:id/read", notificationController.markRead);
notificationRouter.post("/read-all", notificationController.markAllRead);
