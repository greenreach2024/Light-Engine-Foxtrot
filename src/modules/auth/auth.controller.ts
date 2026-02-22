import { Request, Response } from "express";
import { authService } from "./auth.service.js";
import { ok, created, asyncHandler } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const authController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.register(req.body);
    await authService.logAudit(result.user.id, "REGISTER", "user", result.user.id, undefined, req.ip);
    created(res, result);
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.login(req.body);
    await authService.logAudit(result.user.id, "LOGIN", "user", result.user.id, undefined, req.ip);
    ok(res, result);
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const user = await authService.getProfile(auth.userId);
    ok(res, user);
  }),
};
