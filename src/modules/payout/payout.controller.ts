import { Request, Response } from "express";
import { payoutService } from "./payout.service.js";
import { ok, created, asyncHandler, parsePagination } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const payoutController = {
  createBatch: asyncHandler(async (req: Request, res: Response) => {
    const batch = await payoutService.createBatch(req.body);
    created(res, batch);
  }),

  approveBatch: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const batch = await payoutService.approveBatch(
      req.params.id as string,
      auth.userId,
      req.body.notes,
    );
    ok(res, batch);
  }),

  processBatch: asyncHandler(async (req: Request, res: Response) => {
    const result = await payoutService.processBatch(req.params.id as string);
    ok(res, result);
  }),

  getBatch: asyncHandler(async (req: Request, res: Response) => {
    const batch = await payoutService.getBatch(req.params.id as string);
    ok(res, batch);
  }),

  listBatches: asyncHandler(async (req: Request, res: Response) => {
    const { page, perPage, offset } = parsePagination(req.query);
    const { batches, total } = await payoutService.listBatches(page, perPage, offset);
    ok(res, batches, { page, perPage, total });
  }),

  getDriverPayouts: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const driverId = (req.params.driverId as string) || auth.driverId!;
    const { page, perPage, offset } = parsePagination(req.query);
    const { payouts, total } = await payoutService.getDriverPayouts(
      driverId, page, perPage, offset,
    );
    ok(res, payouts, { page, perPage, total });
  }),

  getT4aDrivers: asyncHandler(async (req: Request, res: Response) => {
    const year = Number(req.params.year) || new Date().getFullYear();
    const drivers = await payoutService.getDriversAboveT4aThreshold(year);
    ok(res, drivers);
  }),
};
