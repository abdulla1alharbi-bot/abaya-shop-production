import jwt from "jsonwebtoken";
import type { Role } from "../types/role.js";

const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set and at least 32 characters`);
  }
  return value;
}

export interface AccessTokenPayload {
  sub: string;
  username: string;
  name: string;
  role: Role;
  permissions: string[];
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const secret = requireEnv("JWT_ACCESS_SECRET", accessSecret);
  return jwt.sign(payload, secret, { expiresIn: "15m", algorithm: "HS256" });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const secret = requireEnv("JWT_ACCESS_SECRET", accessSecret);
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload & AccessTokenPayload;
  if (
    typeof decoded.sub !== "string" ||
    typeof decoded.username !== "string" ||
    typeof decoded.name !== "string" ||
    typeof decoded.role !== "string"
  ) {
    throw new Error("Invalid access token payload");
  }
  const permissions = Array.isArray(decoded.permissions)
    ? decoded.permissions.filter((x): x is string => typeof x === "string")
    : [];
  return {
    sub: decoded.sub,
    username: decoded.username,
    name: decoded.name,
    role: decoded.role as Role,
    permissions,
  };
}

export function signRefreshToken(userId: string): string {
  const secret = requireEnv("JWT_REFRESH_SECRET", refreshSecret);
  return jwt.sign({ sub: userId }, secret, { expiresIn: "7d", algorithm: "HS256" });
}

export function verifyRefreshToken(token: string): { sub: string } {
  const secret = requireEnv("JWT_REFRESH_SECRET", refreshSecret);
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload & { sub?: string };
  if (typeof decoded.sub !== "string") {
    throw new Error("Invalid refresh token");
  }
  return { sub: decoded.sub };
}
