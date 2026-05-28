import type { NextFunction, Request, Response } from "express";
import { AppError } from "./error.middleware.js";

/** User must have at least one of the given permissions. */
export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (keys.length === 0) {
      next(new AppError(500, "requirePermission: no keys", "CONFIG"));
      return;
    }
    const user = req.user;
    if (!user) {
      next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));
      return;
    }
    const perms = user.permissions ?? [];
    if (keys.some((k) => perms.includes(k))) {
      next();
      return;
    }
    next(new AppError(403, "ليس لديك صلاحية لهذا الإجراء", "FORBIDDEN"));
  };
}

/** User must have every listed permission. */
export function requireAllPermissions(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (keys.length === 0) {
      next(new AppError(500, "requireAllPermissions: no keys", "CONFIG"));
      return;
    }
    const user = req.user;
    if (!user) {
      next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));
      return;
    }
    const perms = user.permissions ?? [];
    if (keys.every((k) => perms.includes(k))) {
      next();
      return;
    }
    next(new AppError(403, "ليس لديك صلاحية لهذا الإجراء", "FORBIDDEN"));
  };
}
