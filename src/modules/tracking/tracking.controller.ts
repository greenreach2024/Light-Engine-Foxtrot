import { Request, Response } from "express";
import { trackingService } from "./tracking.service.js";
import { ok, asyncHandler } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const trackingController = {
  getTimeline: asyncHandler(async (req: Request, res: Response) => {
    const timeline = await trackingService.getTimeline(req.params.shipmentId as string);
    ok(res, timeline);
  }),

  getDriverLocation: asyncHandler(async (req: Request, res: Response) => {
    const location = await trackingService.getDriverLocation(req.params.driverId as string);
    ok(res, location);
  }),

  getRouteEta: asyncHandler(async (req: Request, res: Response) => {
    const eta = await trackingService.getRouteEta(req.params.routeId as string);
    ok(res, eta);
  }),

  getActiveRoutes: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const driverId = (req.params.driverId as string) || auth.driverId!;
    const routes = await trackingService.getActiveRoutes(driverId);
    ok(res, routes);
  }),

  checkGeofence: asyncHandler(async (req: Request, res: Response) => {
    const radius = req.query.radius ? Number(req.query.radius) : undefined;
    const result = await trackingService.checkGeofence(
      req.params.driverId as string,
      req.params.stopId as string,
      radius,
    );
    ok(res, result);
  }),
};
