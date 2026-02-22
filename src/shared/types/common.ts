import { Request, Response, NextFunction } from "express";

// ─── API response envelope ───────────────────────────────────

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  meta?: { page?: number; perPage?: number; total?: number };
}

export function ok<T>(res: Response, data: T, meta?: ApiResponse["meta"]): void {
  res.json({ ok: true, data, meta } satisfies ApiResponse<T>);
}

export function created<T>(res: Response, data: T): void {
  res.status(201).json({ ok: true, data } satisfies ApiResponse<T>);
}

// ─── Pagination ──────────────────────────────────────────────

export interface PaginationQuery {
  page: number;
  perPage: number;
  offset: number;
}

export function parsePagination(query: Request["query"]): PaginationQuery {
  const page = Math.max(1, parseInt(query.page as string, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(query.per_page as string, 10) || 25));
  return { page, perPage, offset: (page - 1) * perPage };
}

// ─── Typed request with auth ─────────────────────────────────

export interface AuthPayload {
  userId: string;
  role: string;
  customerId?: string;
  driverId?: string;
}

export interface AuthenticatedRequest extends Request {
  auth: AuthPayload;
}

// ─── Async handler wrapper ───────────────────────────────────

export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
