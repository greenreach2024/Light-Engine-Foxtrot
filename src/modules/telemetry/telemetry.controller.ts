import { Request, Response } from "express";
import { telemetryService } from "./telemetry.service.js";
import { ok, asyncHandler } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const telemetryController = {
  recordPing: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    await telemetryService.recordPing(auth.driverId!, req.body);
    res.status(204).end();
  }),

  recordBatch: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    await telemetryService.recordBatch(auth.driverId!, req.body.pings);
    res.status(204).end();
  }),

  getLatest: asyncHandler(async (req: Request, res: Response) => {
    const pos = await telemetryService.getLatestPosition(req.params.driverId as string);
    ok(res, pos);
  }),

  getRouteTrack: asyncHandler(async (req: Request, res: Response) => {
    const track = await telemetryService.getRouteTrack(req.params.routeId as string);
    ok(res, track);
  }),

  estimateEta: asyncHandler(async (req: Request, res: Response) => {
    const { driver_id, dest_lat, dest_lng } = req.query;
    const eta = await telemetryService.estimateEta(
      driver_id as string,
      parseFloat(dest_lat as string),
      parseFloat(dest_lng as string),
    );
    ok(res, eta);
  }),

  routeAdherence: asyncHandler(async (req: Request, res: Response) => {
    const result = await telemetryService.getRouteAdherence(req.params.routeId as string);
    ok(res, result);
  }),
};
