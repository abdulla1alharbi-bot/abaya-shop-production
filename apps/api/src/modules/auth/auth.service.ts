import bcrypt from "bcryptjs";
import type { Response } from "express";
import type { Role } from "../../types/role.js";
import { prisma } from "../../config/db.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt.js";
import { AppError } from "../../middleware/error.middleware.js";
import type { LoginBody } from "./auth.schema.js";
import { normalizeUsername, computeEffectivePermissions, parseJsonStringArray } from "@abaya-shop/shared";
import { logger } from "../../utils/logger.js";

const REFRESH_COOKIE = "refreshToken";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function refreshCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.SECURE_COOKIES === "true",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SEVEN_DAYS_MS,
  };
}

function userAuthRow(user: {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: string;
  phone: string | null;
  isActive: boolean;
  extraPermissions: unknown;
  revokedPermissions: unknown;
}) {
  const permissions = computeEffectivePermissions(user.role, user.extraPermissions, user.revokedPermissions);
  const extra = parseJsonStringArray(user.extraPermissions);
  const revoked = parseJsonStringArray(user.revokedPermissions);
  return {
    accessToken: signAccessToken({
      sub: user.id,
      username: user.username,
      name: user.name,
      role: user.role as Role,
      permissions,
    }),
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      phone: user.phone,
      isActive: user.isActive,
      permissions,
      extraPermissions: extra,
      revokedPermissions: revoked,
    },
  };
}

export async function login(body: LoginBody, res: Response) {
  const username = normalizeUsername(body.username);
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.isActive) {
    throw new AppError(401, "اسم المستخدم أو كلمة المرور غير صحيحة", "INVALID_CREDENTIALS");
  }
  const ok = await bcrypt.compare(body.password, user.password);
  if (!ok) {
    throw new AppError(401, "اسم المستخدم أو كلمة المرور غير صحيحة", "INVALID_CREDENTIALS");
  }

  const refreshToken = signRefreshToken(user.id);
  const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt,
    },
  });

  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());

  return userAuthRow(user);
}

export async function refresh(refreshTokenFromCookie: string | undefined, res: Response) {
  if (!refreshTokenFromCookie) {
    throw new AppError(401, "Missing refresh token", "NO_REFRESH");
  }

  let userId: string;
  try {
    const payload = verifyRefreshToken(refreshTokenFromCookie);
    userId = payload.sub;
  } catch {
    throw new AppError(401, "Invalid refresh token", "INVALID_REFRESH");
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshTokenFromCookie },
  });
  if (!stored || stored.expiresAt < new Date()) {
    throw new AppError(401, "Refresh token revoked or expired", "REFRESH_EXPIRED");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    throw new AppError(401, "User not found or inactive", "USER_INACTIVE");
  }

  const newRefresh = signRefreshToken(user.id);
  const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS);

  // Use deleteMany by token so missing rows (race, prior logout, DB cleanup) never throw P2025.
  await prisma.$transaction(async (tx) => {
    const removed = await tx.refreshToken.deleteMany({ where: { token: refreshTokenFromCookie } });
    if (removed.count === 0) {
      logger.debug("Refresh rotation: no row deleted (concurrent rotation or token already cleared)", {
        userId: user.id,
      });
    }
    await tx.refreshToken.create({
      data: {
        token: newRefresh,
        userId: user.id,
        expiresAt,
      },
    });
  });

  res.cookie(REFRESH_COOKIE, newRefresh, refreshCookieOptions());

  return userAuthRow(user);
}

export async function logout(refreshTokenFromCookie: string | undefined, res: Response) {
  if (refreshTokenFromCookie) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshTokenFromCookie } });
  }
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: process.env.SECURE_COOKIES === "true",
    sameSite: "lax",
    path: "/",
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      phone: true,
      isActive: true,
      createdAt: true,
      extraPermissions: true,
      revokedPermissions: true,
    },
  });
  if (!user) {
    throw new AppError(404, "User not found", "NOT_FOUND");
  }
  const permissions = computeEffectivePermissions(user.role, user.extraPermissions, user.revokedPermissions);
  return {
    ...user,
    permissions,
    extraPermissions: parseJsonStringArray(user.extraPermissions),
    revokedPermissions: parseJsonStringArray(user.revokedPermissions),
  };
}
