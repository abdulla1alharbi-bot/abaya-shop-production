import type { NextFunction, Request, Response } from "express";
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
    // Taken as-is: an empty list means every permission was revoked. Falling back
    // to the role defaults here handed a locked-out user their full role back.
    const permissions = payload.permissions;
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
