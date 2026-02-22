import { Request, Response } from "express";
import { orderService } from "./order.service.js";
import { ok, created, asyncHandler, parsePagination } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const orderController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { page, perPage, offset } = parsePagination(req.query);
    const auth = (req as AuthenticatedRequest).auth;
    const filters = {
      customerId: auth.customerId ?? (req.query.customer_id as string),
      status: req.query.status as string,
      date: req.query.date as string,
    };
    const { orders, total } = await orderService.list(filters, page, perPage, offset);
    ok(res, orders, { page, perPage, total });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const order = await orderService.getById(req.params.id as string);
    ok(res, order);
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const order = await orderService.create(req.body, auth.userId);
    created(res, order);
  }),

  updateStatus: asyncHandler(async (req: Request, res: Response) => {
    const order = await orderService.updateStatus(req.params.id as string, req.body);
    ok(res, order);
  }),

  cancel: asyncHandler(async (req: Request, res: Response) => {
    const order = await orderService.cancel(req.params.id as string);
    ok(res, order);
  }),
};
