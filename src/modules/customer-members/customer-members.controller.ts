import { Request, Response } from "express";
import { customerMembersService } from "./customer-members.service.js";
import { ok, created, asyncHandler } from "../../shared/types/common.js";
import type { AuthenticatedRequest } from "../../shared/types/common.js";

export const customerMembersController = {
  invite: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const member = await customerMembersService.invite(
      req.params.customerId as string,
      req.body,
      auth.userId,
    );
    created(res, member);
  }),

  accept: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const member = await customerMembersService.accept(
      req.params.memberId as string,
      auth.userId,
    );
    ok(res, member);
  }),

  listMembers: asyncHandler(async (req: Request, res: Response) => {
    const members = await customerMembersService.listMembers(
      req.params.customerId as string,
    );
    ok(res, members);
  }),

  getMember: asyncHandler(async (req: Request, res: Response) => {
    const member = await customerMembersService.getMember(req.params.memberId as string);
    ok(res, member);
  }),

  updateRole: asyncHandler(async (req: Request, res: Response) => {
    const member = await customerMembersService.updateRole(
      req.params.memberId as string,
      req.body.role,
    );
    ok(res, member);
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const member = await customerMembersService.remove(req.params.memberId as string);
    ok(res, member);
  }),

  getMyOrganizations: asyncHandler(async (req: Request, res: Response) => {
    const auth = (req as AuthenticatedRequest).auth;
    const orgs = await customerMembersService.getOrganizations(auth.userId);
    ok(res, orgs);
  }),
};
