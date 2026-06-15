import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
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

  // Translate known Prisma errors into meaningful HTTP responses instead of a bare 500.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target.join("، ") : String(target ?? "");
      res.status(409).json({
        success: false,
        error: {
          message: fields
            ? `هذه القيمة مستخدمة مسبقاً (${fields}). اختر قيمة مختلفة.`
            : "هذه القيمة مستخدمة مسبقاً. اختر قيمة مختلفة.",
          code: "DUPLICATE",
        },
      });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({
        success: false,
        error: { message: "السجل غير موجود.", code: "NOT_FOUND" },
      });
      return;
    }
    if (err.code === "P2003") {
      res.status(400).json({
        success: false,
        error: { message: "مرجع غير صالح. تأكد من الحقول المرتبطة.", code: "FK_CONSTRAINT" },
      });
      return;
    }
  }

  logger.error("Unhandled error", { err, path: req.path, method: req.method });

  const message =
    process.env.NODE_ENV === "production" ? "Internal server error" : err.message;

  res.status(500).json({
    success: false,
    error: { message },
  });
};
