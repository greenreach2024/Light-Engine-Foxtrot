import { Request, Response, NextFunction } from "express";
import { AppError } from "../shared/utils/errors.js";
import { logger } from "../shared/utils/logger.js";
import type { ApiResponse } from "../shared/types/common.js";

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    const body: ApiResponse = {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // Unexpected error
  logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  const body: ApiResponse = {
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  };
  res.status(500).json(body);
}
