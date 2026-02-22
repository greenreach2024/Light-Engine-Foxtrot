import { Router } from "express";
import { customerMembersController } from "./customer-members.controller.js";
import { validate } from "../../middleware/validation.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { inviteMemberSchema, updateMemberRoleSchema } from "./customer-members.validation.js";

export const customerMembersRouter = Router();

customerMembersRouter.use(authenticate);

// User's own organizations
customerMembersRouter.get("/my-organizations", customerMembersController.getMyOrganizations);

// Customer-scoped
customerMembersRouter.get(
  "/customers/:customerId/members",
  customerMembersController.listMembers,
);
customerMembersRouter.post(
  "/customers/:customerId/members",
  requireRole("customer_admin", "admin", "ops"),
  validate({ body: inviteMemberSchema }),
  customerMembersController.invite,
);

// Member-scoped
customerMembersRouter.get("/members/:memberId", customerMembersController.getMember);
customerMembersRouter.patch(
  "/members/:memberId/accept",
  customerMembersController.accept,
);
customerMembersRouter.patch(
  "/members/:memberId/role",
  requireRole("customer_admin", "admin", "ops"),
  validate({ body: updateMemberRoleSchema }),
  customerMembersController.updateRole,
);
customerMembersRouter.delete(
  "/members/:memberId",
  requireRole("customer_admin", "admin", "ops"),
  customerMembersController.remove,
);
