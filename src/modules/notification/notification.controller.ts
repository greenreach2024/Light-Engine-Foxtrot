import { Request, Response } from "express";
import { notificationService } from "./notification.service.js";
import { ok, asyncHandler } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const notificationController = {
  send: asyncHandler(async (req: Request, res: Response) => {
    await notificationService.send(req.body);
    res.status(204).end();
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const unreadOnly = req.query.unread === "true";
    const notifications = await notificationService.listForUser(auth.userId, unreadOnly);
    ok(res, notifications);
  }),

  markRead: asyncHandler(async (req: Request, res: Response) => {
    await notificationService.markRead(req.params.id as string);
    res.status(204).end();
  }),

  markAllRead: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    await notificationService.markAllRead(auth.userId);
    res.status(204).end();
  }),
};
