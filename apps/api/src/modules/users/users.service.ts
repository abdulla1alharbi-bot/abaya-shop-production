import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import {
  USERNAME_TAKEN_MESSAGE,
  normalizeUsername,
  computeEffectivePermissions,
  parseJsonStringArray,
} from "@abaya-shop/shared";
import type { CreateUserBody, UpdateUserBody } from "./users.schema.js";

function uniqueFieldFromError(err: unknown): "username" | "email" | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
    return null;
  }
  const t = err.meta?.target;
  const fields = Array.isArray(t) ? (t as string[]) : typeof t === "string" ? [t] : [];
  if (fields.includes("username")) return "username";
  if (fields.includes("email")) return "email";
  return null;
}

function permissionJsonField(arr: string[] | undefined): string | null | undefined {
  if (arr === undefined) return undefined;
  if (arr.length === 0) return null;
  return JSON.stringify(arr);
}

export async function listUsers() {
  const rows = await prisma.user.findMany({
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      extraPermissions: true,
      revokedPermissions: true,
    },
  });
  return rows.map((u) => ({
    ...u,
    extraPermissions: parseJsonStringArray(u.extraPermissions),
    revokedPermissions: parseJsonStringArray(u.revokedPermissions),
    permissions: computeEffectivePermissions(u.role, u.extraPermissions, u.revokedPermissions),
  }));
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      extraPermissions: true,
      revokedPermissions: true,
    },
  });
  if (!user) {
    throw new AppError(404, "المستخدم غير موجود", "NOT_FOUND");
  }
  return {
    ...user,
    extraPermissions: parseJsonStringArray(user.extraPermissions),
    revokedPermissions: parseJsonStringArray(user.revokedPermissions),
    permissions: computeEffectivePermissions(user.role, user.extraPermissions, user.revokedPermissions),
  };
}

export async function createUser(body: CreateUserBody, canEditPermissionOverrides: boolean) {
  if (
    (body.extraPermissions !== undefined || body.revokedPermissions !== undefined) &&
    !canEditPermissionOverrides
  ) {
    throw new AppError(403, "لا يمكن تعديل الصلاحيات التفصيلية بدون إذن", "FORBIDDEN");
  }

  const username = normalizeUsername(body.username);
  const passwordHash = await bcrypt.hash(body.password, 12);
  const createData: Prisma.UserCreateInput = {
    username,
    name: body.name.trim(),
    password: passwordHash,
    role: body.role,
    email: body.email ?? undefined,
    phone: body.phone,
    isActive: body.isActive ?? true,
  };
  if (body.extraPermissions !== undefined) {
    createData.extraPermissions = permissionJsonField(body.extraPermissions) ?? null;
  }
  if (body.revokedPermissions !== undefined) {
    createData.revokedPermissions = permissionJsonField(body.revokedPermissions) ?? null;
  }
  try {
    const created = await prisma.user.create({
      data: createData,
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        extraPermissions: true,
        revokedPermissions: true,
      },
    });
    return {
      ...created,
      extraPermissions: parseJsonStringArray(created.extraPermissions),
      revokedPermissions: parseJsonStringArray(created.revokedPermissions),
      permissions: computeEffectivePermissions(created.role, created.extraPermissions, created.revokedPermissions),
    };
  } catch (err) {
    const field = uniqueFieldFromError(err);
    if (field === "username") {
      throw new AppError(409, USERNAME_TAKEN_MESSAGE, "USERNAME_TAKEN");
    }
    if (field === "email") {
      throw new AppError(409, "البريد الإلكتروني مستخدم بالفعل", "EMAIL_TAKEN");
    }
    throw err;
  }
}

export async function updateUser(
  id: string,
  body: UpdateUserBody,
  actingUserId: string,
  canEditPermissionOverrides: boolean,
) {
  if (body.isActive === false && id === actingUserId) {
    throw new AppError(400, "لا يمكن تعطيل حسابك الحالي", "SELF_DEACTIVATE");
  }

  if (
    (body.extraPermissions !== undefined || body.revokedPermissions !== undefined) &&
    !canEditPermissionOverrides
  ) {
    throw new AppError(403, "لا يمكن تعديل الصلاحيات التفصيلية بدون إذن", "FORBIDDEN");
  }

  const data: Prisma.UserUpdateInput = {};

  if (body.name !== undefined) {
    data.name = body.name.trim();
  }
  if (body.role !== undefined) {
    data.role = body.role;
  }
  if (body.isActive !== undefined) {
    data.isActive = body.isActive;
  }
  if (body.email !== undefined) {
    data.email = body.email;
  }
  if (body.phone !== undefined) {
    data.phone = body.phone;
  }
  if (body.username !== undefined) {
    data.username = normalizeUsername(body.username);
  }
  if (body.password !== undefined && body.password !== "") {
    data.password = await bcrypt.hash(body.password, 12);
  }
  if (body.extraPermissions !== undefined) {
    data.extraPermissions = permissionJsonField(body.extraPermissions) ?? null;
  }
  if (body.revokedPermissions !== undefined) {
    data.revokedPermissions = permissionJsonField(body.revokedPermissions) ?? null;
  }

  if (Object.keys(data).length === 0) {
    return getUserById(id);
  }

  const permissionsChanged =
    body.role !== undefined ||
    body.extraPermissions !== undefined ||
    body.revokedPermissions !== undefined ||
    body.isActive === false;

  try {
    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        extraPermissions: true,
        revokedPermissions: true,
      },
    });
    if (permissionsChanged) {
      await prisma.refreshToken.deleteMany({ where: { userId: id } });
      await prisma.auditLog.create({
        data: {
          userId: actingUserId,
          action: "USER_UPDATED",
          entity: "User",
          entityId: id,
          newValue: JSON.stringify({
            role: body.role,
            isActive: body.isActive,
            extraPermissions: body.extraPermissions,
            revokedPermissions: body.revokedPermissions,
          }),
        },
      });
    }

    return {
      ...updated,
      extraPermissions: parseJsonStringArray(updated.extraPermissions),
      revokedPermissions: parseJsonStringArray(updated.revokedPermissions),
      permissions: computeEffectivePermissions(updated.role, updated.extraPermissions, updated.revokedPermissions),
    };
  } catch (err) {
    const field = uniqueFieldFromError(err);
    if (field === "username") {
      throw new AppError(409, USERNAME_TAKEN_MESSAGE, "USERNAME_TAKEN");
    }
    if (field === "email") {
      throw new AppError(409, "البريد الإلكتروني مستخدم بالفعل", "EMAIL_TAKEN");
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new AppError(404, "المستخدم غير موجود", "NOT_FOUND");
    }
    throw err;
  }
}
