import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { UnauthorizedError } from "../shared/utils/errors.js";
import type { AuthPayload, AuthenticatedRequest } from "../shared/types/common.js";

/**
 * JWT authentication middleware.
 * Extracts Bearer token, verifies it, and attaches `req.auth`.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;

    if (payload.role === "driver" && !payload.driverId) {
      const driver = await db("drivers")
        .where("user_id", payload.userId)
        .where("is_active", true)
        .first();
      if (driver) payload.driverId = driver.id;
    }

    (req as AuthenticatedRequest).auth = payload;
    next();
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
}
