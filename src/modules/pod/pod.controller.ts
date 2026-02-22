import { Request, Response } from "express";
import { podService } from "./pod.service.js";
import { ok, created, asyncHandler } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const podController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const pod = await podService.create(req.body, auth.driverId!);
    created(res, pod);
  }),

  getByStop: asyncHandler(async (req: Request, res: Response) => {
    const pod = await podService.getByStop(req.params.stopId as string);
    ok(res, pod);
  }),

  listByRoute: asyncHandler(async (req: Request, res: Response) => {
    const pods = await podService.listByRoute(req.params.routeId as string);
    ok(res, pods);
  }),
};
