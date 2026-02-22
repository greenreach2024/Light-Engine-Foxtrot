import { Request, Response } from "express";
import { settlementService } from "./settlement.service.js";
import { ok, created, asyncHandler, parsePagination } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const settlementController = {
  createFeeQuote: asyncHandler(async (req: Request, res: Response) => {
    const quote = await settlementService.createFeeQuote(req.body);
    created(res, quote);
  }),

  getFeeQuote: asyncHandler(async (req: Request, res: Response) => {
    const quote = await settlementService.getFeeQuote(
      req.params.routeId as string,
      req.params.driverId as string,
    );
    ok(res, quote);
  }),

  createPayStatement: asyncHandler(async (req: Request, res: Response) => {
    const statement = await settlementService.createPayStatement(req.body);
    created(res, statement);
  }),

  getPayStatement: asyncHandler(async (req: Request, res: Response) => {
    const statement = await settlementService.getPayStatement(req.params.id as string);
    ok(res, statement);
  }),

  listPayStatements: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const driverId = (req.params.driverId as string) || auth.driverId!;
    const { page, perPage, offset } = parsePagination(req.query);
    const { statements, total } = await settlementService.listPayStatements(
      driverId, page, perPage, offset,
    );
    ok(res, statements, { page, perPage, total });
  }),

  finalizePayStatement: asyncHandler(async (req: Request, res: Response) => {
    const statement = await settlementService.finalizePayStatement(req.params.id as string);
    ok(res, statement);
  }),

  resolveHold: asyncHandler(async (req: Request, res: Response) => {
    const statement = await settlementService.resolveHold(
      req.params.lineId as string,
      req.body,
    );
    ok(res, statement);
  }),
};
