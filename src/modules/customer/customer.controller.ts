import { Request, Response } from "express";
import { customerService } from "./customer.service.js";
import { ok, created, asyncHandler, parsePagination } from "../../shared/types/common.js";

export const customerController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { page, perPage, offset } = parsePagination(req.query);
    const { customers, total } = await customerService.list(page, perPage, offset);
    ok(res, customers, { page, perPage, total });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const customer = await customerService.getById(req.params.id as string);
    ok(res, customer);
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const customer = await customerService.create(req.body);
    created(res, customer);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const customer = await customerService.update(req.params.id as string, req.body);
    ok(res, customer);
  }),

  // Locations
  listLocations: asyncHandler(async (req: Request, res: Response) => {
    const locations = await customerService.listLocations(req.params.id as string);
    ok(res, locations);
  }),

  createLocation: asyncHandler(async (req: Request, res: Response) => {
    const location = await customerService.createLocation(req.params.id as string, req.body);
    created(res, location);
  }),

  updateLocation: asyncHandler(async (req: Request, res: Response) => {
    const location = await customerService.updateLocation(req.params.locationId as string, req.body);
    ok(res, location);
  }),

  // Catalog
  getCatalog: asyncHandler(async (req: Request, res: Response) => {
    const catalog = await customerService.getCatalog(req.params.id as string);
    ok(res, catalog);
  }),
};
