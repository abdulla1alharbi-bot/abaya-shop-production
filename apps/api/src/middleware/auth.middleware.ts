import type { NextFunction, Request, Response } from "express";
import { computeEffectivePermissions } from "@abaya-shop/shared";
import { verifyAccessToken } from "../utils/jwt.js";
import { AppError } from "./error.middleware.js";

const BEARER = /^Bearer\s+(.+)$/i;

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") {
    next(new AppError(401, "Missing authorization header", "UNAUTHORIZED"));
    return;
  }
  const match = BEARER.exec(header);
  if (!match?.[1]) {
    next(new AppError(401, "Invalid authorization header", "UNAUTHORIZED"));
    return;
  }
  try {
    const payload = verifyAccessToken(match[1]);
    const permissions =
      payload.permissions.length > 0
        ? payload.permissions
        : computeEffectivePermissions(payload.role, null, null);
    req.user = {
      id: payload.sub,
      username: payload.username,
      name: payload.name,
      role: payload.role,
      permissions,
    };
    next();
  } catch {
    next(new AppError(401, "Invalid or expired access token", "UNAUTHORIZED"));
  }
}
