import { Request, Response } from "express";
import { billingService } from "./billing.service.js";
import { ok, created, asyncHandler } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const billingController = {
  // Invoices
  generateInvoice: asyncHandler(async (req: Request, res: Response) => {
    const invoice = await billingService.generateInvoice(req.body);
    created(res, invoice);
  }),

  listInvoices: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const customerId = auth.customerId ?? (req.query.customer_id as string);
    const invoices = await billingService.listInvoices(customerId);
    ok(res, invoices);
  }),

  getInvoice: asyncHandler(async (req: Request, res: Response) => {
    const invoice = await billingService.getInvoice(req.params.id as string);
    ok(res, invoice);
  }),

  markPaid: asyncHandler(async (req: Request, res: Response) => {
    const invoice = await billingService.markPaid(req.params.id as string);
    ok(res, invoice);
  }),

  // Payouts
  generatePayout: asyncHandler(async (req: Request, res: Response) => {
    const payout = await billingService.generatePayout(req.body);
    created(res, payout);
  }),

  listPayouts: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const driverId = auth.driverId ?? (req.query.driver_id as string);
    const payouts = await billingService.listPayouts(driverId);
    ok(res, payouts);
  }),

  markPayoutPaid: asyncHandler(async (req: Request, res: Response) => {
    const payout = await billingService.markPayoutPaid(req.params.id as string);
    ok(res, payout);
  }),
};
