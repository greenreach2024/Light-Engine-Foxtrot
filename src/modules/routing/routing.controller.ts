import { Request, Response } from "express";
import { routingService } from "./routing.service.js";
import { ok, created, asyncHandler } from "../../shared/types/common.js";

export const routingController = {
  optimize: asyncHandler(async (req: Request, res: Response) => {
    const routes = await routingService.optimizeForWave(req.body);
    created(res, routes);
  }),

  getRoute: asyncHandler(async (req: Request, res: Response) => {
    const route = await routingService.getRoute(req.params.id as string);
    ok(res, route);
  }),

  listRoutes: asyncHandler(async (req: Request, res: Response) => {
    const routes = await routingService.listRoutes(req.query.wave_id as string);
    ok(res, routes);
  }),

  updateStatus: asyncHandler(async (req: Request, res: Response) => {
    const route = await routingService.updateRouteStatus(req.params.id as string, req.body.status);
    ok(res, route);
  }),
};
