import { Request, Response } from "express";
import { shipmentService } from "./shipment.service.js";
import { ok, created, asyncHandler, parsePagination } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const shipmentController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const shipment = await shipmentService.create(req.body, auth.userId);
    created(res, shipment);
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const shipment = await shipmentService.getById(req.params.id as string);
    ok(res, shipment);
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const { page, perPage, offset } = parsePagination(req.query);
    const filters = {
      status: req.query.status as string | undefined,
      driver_id: req.query.driver_id as string | undefined,
    };
    const { shipments, total } = await shipmentService.list(page, perPage, offset, filters);
    ok(res, shipments, { page, perPage, total });
  }),

  updateStatus: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const shipment = await shipmentService.updateStatus(
      req.params.id as string,
      req.body,
      auth.userId,
    );
    ok(res, shipment);
  }),

  recordEvent: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const event = await shipmentService.recordEvent(req.body, auth.userId);
    created(res, event);
  }),

  getEvents: asyncHandler(async (req: Request, res: Response) => {
    const events = await shipmentService.getEvents(req.params.id as string);
    ok(res, events);
  }),
};
