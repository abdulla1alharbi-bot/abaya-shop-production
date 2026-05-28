import type { ErrorRequestHandler } from "express";
import { logger } from "../utils/logger.js";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errorMiddleware: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { message: err.message, code: err.code, ...(err.data ?? {}) },
    });
    return;
  }

  logger.error("Unhandled error", { err, path: req.path, method: req.method });

  const message =
    process.env.NODE_ENV === "production" ? "Internal server error" : err.message;

  res.status(500).json({
    success: false,
    error: { message },
  });
};
