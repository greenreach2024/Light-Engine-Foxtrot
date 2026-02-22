import { Request, Response } from "express";
import { driverOnboardingService } from "./driver-onboarding.service.js";
import { ok, created, asyncHandler } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const driverOnboardingController = {
  // ─── Public: Apply ─────────────────────────────────────
  apply: asyncHandler(async (req: Request, res: Response) => {
    const result = await driverOnboardingService.apply(req.body);
    created(res, result);
  }),

  // ─── Documents ─────────────────────────────────────────
  uploadDocument: asyncHandler(async (req: Request, res: Response) => {
    const doc = await driverOnboardingService.uploadDocument(
      req.params.driverId as string,
      req.body,
    );
    created(res, doc);
  }),

  reviewDocument: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const doc = await driverOnboardingService.reviewDocument(
      req.params.docId as string,
      auth.userId,
      req.body,
    );
    ok(res, doc);
  }),

  listDocuments: asyncHandler(async (req: Request, res: Response) => {
    const docs = await driverOnboardingService.listDocuments(req.params.driverId as string);
    ok(res, docs);
  }),

  // ─── Background Check ─────────────────────────────────
  submitBackgroundCheck: asyncHandler(async (req: Request, res: Response) => {
    const check = await driverOnboardingService.submitBackgroundCheck(
      req.params.driverId as string,
      req.body,
    );
    created(res, check);
  }),

  updateBackgroundCheck: asyncHandler(async (req: Request, res: Response) => {
    const check = await driverOnboardingService.updateBackgroundCheck(
      req.params.checkId as string,
      req.body.status,
    );
    ok(res, check);
  }),

  getBackgroundCheck: asyncHandler(async (req: Request, res: Response) => {
    const check = await driverOnboardingService.getBackgroundCheck(req.params.driverId as string);
    ok(res, check);
  }),

  // ─── Banking ───────────────────────────────────────────
  setupBanking: asyncHandler(async (req: Request, res: Response) => {
    const account = await driverOnboardingService.setupBanking(
      req.params.driverId as string,
      req.body,
    );
    ok(res, account);
  }),

  verifyBanking: asyncHandler(async (req: Request, res: Response) => {
    const account = await driverOnboardingService.verifyBanking(req.params.driverId as string);
    ok(res, account);
  }),

  // ─── Agreements ────────────────────────────────────────
  signAgreement: asyncHandler(async (req: Request, res: Response) => {
    const agreement = await driverOnboardingService.signAgreement(
      req.params.driverId as string,
      req.body,
    );
    created(res, agreement);
  }),

  listAgreements: asyncHandler(async (req: Request, res: Response) => {
    const agreements = await driverOnboardingService.listAgreements(req.params.driverId as string);
    ok(res, agreements);
  }),

  // ─── Status ────────────────────────────────────────────
  getOnboardingStatus: asyncHandler(async (req: Request, res: Response) => {
    const status = await driverOnboardingService.getOnboardingStatus(req.params.driverId as string);
    ok(res, status);
  }),

  forceStatus: asyncHandler(async (req: Request, res: Response) => {
    const driver = await driverOnboardingService.forceStatus(
      req.params.driverId as string,
      req.body.status,
    );
    ok(res, driver);
  }),
};
