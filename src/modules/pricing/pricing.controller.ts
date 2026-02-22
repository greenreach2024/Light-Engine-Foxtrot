import { Request, Response } from "express";
import { pricingService } from "./pricing.service.js";
import { ok, asyncHandler } from "../../shared/types/common.js";

export const pricingController = {
  quoteRoute: asyncHandler(async (req: Request, res: Response) => {
    const { route_id, margin_override } = req.body;
    const result = await pricingService.quoteRoute(route_id, margin_override);
    ok(res, result);
  }),

  simpleFee: asyncHandler(async (req: Request, res: Response) => {
    const { km_from_farm, tote_count, window_tightness_hours } = req.body;
    const fee = pricingService.computeSimpleFee(km_from_farm, tote_count, window_tightness_hours);
    ok(res, { fee });
  }),
};
