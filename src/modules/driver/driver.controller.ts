import { Request, Response } from "express";
import { driverService } from "./driver.service.js";
import { ok, created, asyncHandler, parsePagination } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const driverController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { page, perPage, offset } = parsePagination(req.query);
    const { drivers, total } = await driverService.list(page, perPage, offset);
    ok(res, drivers, { page, perPage, total });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const driver = await driverService.getById(req.params.id as string);
    ok(res, driver);
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const driver = await driverService.create(req.body);
    created(res, driver);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const driver = await driverService.update(req.params.id as string, req.body);
    ok(res, driver);
  }),

  setAvailability: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const driverId = req.params.id as string || auth.driverId!;
    const driver = await driverService.setAvailability(driverId, req.body.is_available);
    ok(res, driver);
  }),
};
