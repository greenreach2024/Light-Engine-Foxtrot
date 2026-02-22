import { Request, Response } from "express";
import { dispatchService } from "./dispatch.service.js";
import { wavePlannerService } from "./wave-planner.service.js";
import { ok, created, asyncHandler } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const dispatchController = {
  // Waves
  listWaves: asyncHandler(async (req: Request, res: Response) => {
    const waves = await dispatchService.listWaves({
      date: req.query.date as string,
      status: req.query.status as string,
    });
    ok(res, waves);
  }),

  getWave: asyncHandler(async (req: Request, res: Response) => {
    const wave = await dispatchService.getWave(req.params.id as string);
    ok(res, wave);
  }),

  createWave: asyncHandler(async (req: Request, res: Response) => {
    const wave = await dispatchService.createWave(req.body);
    created(res, wave);
  }),

  updateWaveStatus: asyncHandler(async (req: Request, res: Response) => {
    const wave = await dispatchService.updateWaveStatus(req.params.id as string, req.body.status);
    ok(res, wave);
  }),

  // Wave planning (auto-group orders)
  planWaves: asyncHandler(async (req: Request, res: Response) => {
    const date = req.query.date as string;
    if (!date) throw new Error("date query param required");
    const groups = await wavePlannerService.planWaves(date);
    ok(res, groups);
  }),

  // Route offers
  offerRoute: asyncHandler(async (req: Request, res: Response) => {
    const offers = await dispatchService.offerRoute(req.body);
    created(res, offers);
  }),

  respondToOffer: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const offer = await dispatchService.respondToOffer(
      req.params.offerId as string,
      auth.driverId!,
      req.body.status === "accepted",
    );
    ok(res, offer);
  }),

  getMyOffers: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const offers = await dispatchService.getDriverOffers(auth.driverId!);
    ok(res, offers);
  }),
};
