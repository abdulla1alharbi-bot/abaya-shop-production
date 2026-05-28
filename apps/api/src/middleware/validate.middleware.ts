import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { AppError } from "./error.middleware.js";

function formatZodError(err: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  return err.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(new AppError(400, formatZodError(parsed.error), "VALIDATION_ERROR"));
      return;
    }
    req.body = parsed.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError(400, formatZodError(parsed.error), "VALIDATION_ERROR"));
      return;
    }
    (req as Request & { validatedQuery: T }).validatedQuery = parsed.data;
    next();
  };
}
