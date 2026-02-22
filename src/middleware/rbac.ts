import { Request, Response, NextFunction } from "express";
import type { UserRole } from "../shared/types/index.js";
import type { AuthenticatedRequest } from "../shared/types/common.js";
import { ForbiddenError } from "../shared/utils/errors.js";

/**
 * Role-based access control middleware.
 * Must be used AFTER `authenticate`.
 *
 * Usage: `router.get("/admin-only", authenticate, requireRole("admin", "ops"), handler)`
 */
export function requireRole(...allowed: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth) {
      throw new ForbiddenError("Authentication required");
    }
    if (!allowed.includes(auth.role as UserRole)) {
      throw new ForbiddenError(`Role '${auth.role}' is not authorized for this action`);
    }
    next();
  };
}

/**
 * Ensure the requesting user belongs to the customer being accessed.
 * For customer_admin / customer_user roles only.
 */
export function requireOwnCustomer(customerIdParam = "customerId") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = (req as AuthenticatedRequest).auth;
    if (auth.role === "admin" || auth.role === "ops") {
      return next(); // ops/admin can access any customer
    }
    const targetCustomerId = req.params[customerIdParam] || req.body?.customer_id;
    if (auth.customerId && auth.customerId !== targetCustomerId) {
      throw new ForbiddenError("Cannot access another customer's resources");
    }
    next();
  };
}
