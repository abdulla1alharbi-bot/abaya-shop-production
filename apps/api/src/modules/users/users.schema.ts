import { z } from "zod";
import { ALL_PERMISSIONS, normalizeUsername, validateUsernameFormat } from "@abaya-shop/shared";

const roleEnum = z.enum(["OWNER", "MANAGER", "ADMIN", "SELLER", "WORKER", "WORKSHOP_SUPERVISOR", "ACCOUNTANT"]);

const validPerm = new Set<string>(ALL_PERMISSIONS as unknown as string[]);

function sanitizePermList(arr: string[] | undefined): string[] | undefined {
  if (arr === undefined) return undefined;
  const out = arr.filter((p) => validPerm.has(p));
  return out;
}

function permissionList() {
  return z
    .array(z.string())
    .optional()
    .transform((arr) => sanitizePermList(arr));
}

function usernameZod() {
  return z
    .string()
    .transform((s) => normalizeUsername(s))
    .superRefine((val, ctx) => {
      const err = validateUsernameFormat(val);
      if (err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
      }
    });
}

const optionalEmailCreate = z
  .union([z.string().email("البريد غير صالح"), z.literal("")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v));

const optionalEmailUpdate = z
  .union([z.string().email("البريد غير صالح"), z.literal("")])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "" ? null : v));

export const createUserSchema = z.object({
  username: usernameZod(),
  name: z.string().min(1, "الاسم الكامل مطلوب").max(200),
  password: z.string().min(8, "كلمة المرور 8 أحرف على الأقل"),
  role: roleEnum,
  email: optionalEmailCreate,
  phone: z
    .string()
    .max(80)
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
  isActive: z.boolean().optional().default(true),
  extraPermissions: permissionList(),
  revokedPermissions: permissionList(),
});

export const updateUserSchema = z.object({
  username: usernameZod().optional(),
  name: z.string().min(1).max(200).optional(),
  password: z.union([z.string().min(8, "كلمة المرور 8 أحرف على الأقل"), z.literal("")]).optional(),
  role: roleEnum.optional(),
  email: optionalEmailUpdate,
  phone: z
    .string()
    .max(80)
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const t = v.trim();
      return t === "" ? null : t;
    }),
  isActive: z.boolean().optional(),
  extraPermissions: permissionList(),
  revokedPermissions: permissionList(),
});

export type CreateUserBody = z.output<typeof createUserSchema>;
export type UpdateUserBody = z.output<typeof updateUserSchema>;
