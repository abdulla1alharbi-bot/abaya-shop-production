import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import axios from "axios";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import type { Role } from "@abaya-shop/shared";
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS_AR,
  USERNAME_TAKEN_MESSAGE,
  normalizeUsername,
  validateUsernameFormat,
} from "@abaya-shop/shared";
import { cn } from "@/lib/utils";

/** Main roles in the product (legacy ADMIN kept only when editing that role). */
const PRIMARY_ROLES: readonly Role[] = ["OWNER", "MANAGER", "SELLER", "WORKER", "WORKSHOP_SUPERVISOR", "ACCOUNTANT"] as const;

/** Role descriptions use per-role i18n keys under settings.userForm.roleDesc.*. */
const ROLE_DESC_KEYS: Record<Role, string> = {
  OWNER: "settings.userForm.roleDesc.OWNER",
  SELLER: "settings.userForm.roleDesc.SELLER",
  WORKER: "settings.userForm.roleDesc.WORKER",
  WORKSHOP_SUPERVISOR: "settings.userForm.roleDesc.WORKSHOP_SUPERVISOR",
  ACCOUNTANT: "settings.userForm.roleDesc.ACCOUNTANT",
  MANAGER: "settings.userForm.roleDesc.MANAGER",
  ADMIN: "settings.userForm.roleDesc.ADMIN",
};

const roleEnum = z.enum(["OWNER", "MANAGER", "ADMIN", "SELLER", "WORKER", "WORKSHOP_SUPERVISOR", "ACCOUNTANT"]);

function usernameField() {
  return z
    .string()
    .transform((s) => normalizeUsername(s))
    .superRefine((val, ctx) => {
      const err = validateUsernameFormat(val);
      if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
    });
}

type TFunc = (key: string) => string;

function makeCreateSchema(t: TFunc) {
  return z.object({
    username: usernameField(),
    name: z.string().min(1, t("settings.userForm.errNameRequired")),
    password: z.string().min(8, t("settings.userForm.errPasswordMin")),
    role: roleEnum,
    email: z.union([z.string().email(t("settings.userForm.errEmailInvalid")), z.literal("")]).optional(),
    phone: z.string().optional(),
    isActive: z.coerce.boolean(),
  });
}

function makeEditSchema(t: TFunc) {
  return z.object({
    username: usernameField(),
    name: z.string().min(1, t("settings.userForm.errNameRequired")),
    password: z.union([z.string(), z.literal("")]).optional(),
    role: roleEnum,
    email: z.union([z.string().email(t("settings.userForm.errEmailInvalid")), z.literal("")]).optional(),
    phone: z.string().optional(),
    isActive: z.coerce.boolean(),
  });
}

type CreateValues = z.infer<ReturnType<typeof makeCreateSchema>>;
type EditValues = z.infer<ReturnType<typeof makeEditSchema>>;

function normalizeRole(r: string): Role {
  if (r === "SALESPERSON") return "SELLER";
  return r as Role;
}

function buildRoleList(isNew: boolean, existingRole: string | undefined, watched: Role): Role[] {
  const norm = existingRole != null ? normalizeRole(existingRole) : watched;
  const includeAdmin = !isNew && (norm === "ADMIN" || watched === "ADMIN");
  if (includeAdmin) {
    return [...PRIMARY_ROLES, "ADMIN"];
  }
  return [...PRIMARY_ROLES];
}

function PermissionOverridesEditor({
  extra,
  revoked,
  onExtraChange,
  onRevokedChange,
}: {
  extra: string[];
  revoked: string[];
  onExtraChange: (v: string[]) => void;
  onRevokedChange: (v: string[]) => void;
}) {
  const { t } = useTranslation();
  function toggle(arr: string[], id: string, set: (v: string[]) => void) {
    if (arr.includes(id)) set(arr.filter((x) => x !== id));
    else set([...arr, id]);
  }

  return (
    <div className="space-y-4 rounded-md border border-dashed bg-muted/30 p-3">
      <p className="text-sm text-muted-foreground">
        {t("settings.userForm.overridesHint")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-brand-800">{t("settings.userForm.extraPermsTitle")}</p>
          <div className="max-h-48 space-y-1.5 overflow-y-auto text-xs">
            {ALL_PERMISSIONS.map((pid) => (
              <label key={`e-${pid}`} className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={extra.includes(pid)}
                  onChange={() => {
                    toggle(extra, pid, onExtraChange);
                    if (revoked.includes(pid)) onRevokedChange(revoked.filter((x) => x !== pid));
                  }}
                />
                <span>{PERMISSION_GROUPS_AR[pid] ?? pid}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-destructive">{t("settings.userForm.revokedPermsTitle")}</p>
          <div className="max-h-48 space-y-1.5 overflow-y-auto text-xs">
            {ALL_PERMISSIONS.map((pid) => (
              <label key={`r-${pid}`} className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={revoked.includes(pid)}
                  onChange={() => {
                    toggle(revoked, pid, onRevokedChange);
                    if (extra.includes(pid)) onExtraChange(extra.filter((x) => x !== pid));
                  }}
                />
                <span>{PERMISSION_GROUPS_AR[pid] ?? pid}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdvancedPermissionsBlock({
  canEdit,
  show,
  onToggle,
  hasStoredOverrides,
  children,
}: {
  canEdit: boolean;
  show: boolean;
  onToggle: () => void;
  hasStoredOverrides: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (!canEdit) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" className="h-auto py-1.5 pe-2 ps-0 text-sm" onClick={onToggle}>
          <ChevronDown className={cn("ms-0.5 h-4 w-4 transition-transform", show && "rotate-180")} />
          {t("settings.userForm.advancedPerms")}
        </Button>
        {!show && hasStoredOverrides ? (
          <span className="text-xs text-amber-700 dark:text-amber-500">{t("settings.userForm.hasStoredOverrides")}</span>
        ) : null}
      </div>
      {show ? <div className="space-y-2">{children}</div> : null}
    </div>
  );
}

export function UserForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { t } = useTranslation();
  const [extraPerms, setExtraPerms] = useState<string[]>([]);
  const [revokedPerms, setRevokedPerms] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["users", id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/users/${id}`);
      return res.data.data;
    },
    enabled: !isNew && Boolean(id),
  });

  const createSchema = useMemo(() => makeCreateSchema(t), [t]);
  const editSchema = useMemo(() => makeEditSchema(t), [t]);

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      username: "",
      name: "",
      password: "",
      role: "SELLER",
      email: "",
      phone: "",
      isActive: true,
    },
  });

  const editForm = useForm<EditValues>({
    resolver: zodResolver(
      editSchema.superRefine((data, ctx) => {
        if (data.password && data.password.length > 0 && data.password.length < 8) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: t("settings.userForm.errPasswordMin"), path: ["password"] });
        }
      }),
    ),
    defaultValues: {
      username: "",
      name: "",
      password: "",
      role: "SELLER",
      email: "",
      phone: "",
      isActive: true,
    },
  });

  const resetPermissionOverrides = useCallback(() => {
    setExtraPerms([]);
    setRevokedPerms([]);
  }, []);

  useEffect(() => {
    if (!existing || isNew) return;
    const ex = existing.extraPermissions;
    const rv = existing.revokedPermissions;
    setExtraPerms(Array.isArray(ex) ? (ex as string[]) : []);
    setRevokedPerms(Array.isArray(rv) ? (rv as string[]) : []);
    setShowAdvanced(false);
    editForm.reset({
      username: String(existing.username ?? ""),
      name: String(existing.name ?? ""),
      password: "",
      role: normalizeRole(String(existing.role ?? "SELLER")),
      email: existing.email ? String(existing.email) : "",
      phone: existing.phone ? String(existing.phone) : "",
      isActive: Boolean(existing.isActive),
    });
  }, [existing, isNew, editForm]);

  const existingRoleForList = !isNew && existing ? String((existing as { role: string }).role) : undefined;
  const editWatchedRole = editForm.watch("role");
  const editRoleOptions = useMemo(
    () => buildRoleList(false, existingRoleForList, (editWatchedRole as Role) || "SELLER"),
    [existingRoleForList, editWatchedRole],
  );

  const createMut = useMutation({
    mutationFn: async (values: CreateValues) => {
      const payload: Record<string, unknown> = {
        username: values.username,
        name: values.name.trim(),
        password: values.password,
        role: values.role,
        email: values.email?.trim() || undefined,
        phone: values.phone?.trim() || undefined,
        isActive: values.isActive,
      };
      if (can("users.permissions")) {
        if (extraPerms.length) payload.extraPermissions = extraPerms;
        if (revokedPerms.length) payload.revokedPermissions = revokedPerms;
      }
      await api.post("/users", payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void navigate("/settings/users");
    },
    onError: (err: unknown) => {
      const msg = axios.isAxiosError(err) ? (err.response?.data as { error?: { message?: string } })?.error?.message : undefined;
      if (msg === USERNAME_TAKEN_MESSAGE || msg?.includes("مستخدم بالفعل")) {
        createForm.setError("username", { message: USERNAME_TAKEN_MESSAGE });
      } else if (msg) {
        createForm.setError("root", { message: msg });
      }
    },
  });

  const editMut = useMutation({
    mutationFn: async (values: EditValues) => {
      const payload: Record<string, unknown> = {
        username: values.username,
        name: values.name.trim(),
        role: values.role,
        email: values.email?.trim() ?? "",
        phone: values.phone?.trim() ?? "",
        isActive: values.isActive,
      };
      if (values.password && values.password.length > 0) {
        payload.password = values.password;
      }
      if (can("users.permissions")) {
        payload.extraPermissions = extraPerms;
        payload.revokedPermissions = revokedPerms;
      }
      await api.patch(`/users/${id}`, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["users", id] });
      void navigate("/settings/users");
    },
    onError: (err: unknown) => {
      const msg = axios.isAxiosError(err) ? (err.response?.data as { error?: { message?: string } })?.error?.message : undefined;
      if (msg === USERNAME_TAKEN_MESSAGE || msg?.includes("مستخدم بالفعل")) {
        editForm.setError("username", { message: USERNAME_TAKEN_MESSAGE });
      } else if (msg) {
        editForm.setError("root", { message: msg });
      }
    },
  });

  if (isNew && !can("users.create")) {
    return <Navigate to="/dashboard" replace />;
  }
  if (!isNew && !can("users.edit")) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!isNew && isLoading) {
    return (
      <div>
        <PageHeader title={t("settings.userForm.userTitle")} />
        <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>
      </div>
    );
  }

  const hasOverrides = extraPerms.length > 0 || revokedPerms.length > 0;
  const canPerm = can("users.permissions");

  const advancedPermissionsPanel = canPerm ? (
    <PermissionOverridesEditor
      extra={extraPerms}
      revoked={revokedPerms}
      onExtraChange={setExtraPerms}
      onRevokedChange={setRevokedPerms}
    />
  ) : null;

  if (isNew) {
    return (
      <div className="mx-auto max-w-lg space-y-6 pb-8">
        <PageHeader
          title={t("settings.userForm.newTitle")}
          description={t("settings.userForm.newDescription")}
        />
        <form
          className="space-y-4 rounded-lg border bg-card p-4"
          onSubmit={createForm.handleSubmit((v) => createMut.mutate(v))}
        >
          <div className="grid gap-2">
            <Label htmlFor="username">{t("settings.userForm.usernameLabel")}</Label>
            <Input id="username" dir="auto" autoComplete="username" placeholder={t("settings.userForm.usernamePlaceholder")} {...createForm.register("username")} />
            {createForm.formState.errors.username ? (
              <p className="text-sm text-destructive">{createForm.formState.errors.username.message}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name">{t("settings.userForm.nameLabel")}</Label>
            <Input id="name" {...createForm.register("name")} />
            {createForm.formState.errors.name ? (
              <p className="text-sm text-destructive">{createForm.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{t("settings.userForm.passwordLabel")}</Label>
            <Input id="password" type="password" autoComplete="new-password" {...createForm.register("password")} />
            {createForm.formState.errors.password ? (
              <p className="text-sm text-destructive">{createForm.formState.errors.password.message}</p>
            ) : null}
          </div>
          <Controller
            name="role"
            control={createForm.control}
            render={({ field }) => (
              <div className="space-y-2">
                <div className="grid gap-2">
                  <Label htmlFor="role">{t("settings.userForm.roleLabel")}</Label>
                  <select
                    id="role"
                    className={cn(
                      "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    value={field.value}
                    onChange={(e) => {
                      field.onChange(e.target.value);
                      resetPermissionOverrides();
                    }}
                    onBlur={field.onBlur}
                    ref={field.ref}
                  >
                    {PRIMARY_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`, { defaultValue: r })}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
                  {ROLE_DESC_KEYS[field.value as Role] ? t(ROLE_DESC_KEYS[field.value as Role]) : "—"}
                </p>
              </div>
            )}
          />
          <div className="flex items-center gap-2">
            <Controller
              name="isActive"
              control={createForm.control}
              render={({ field }) => (
                <input
                  id="isActive"
                  type="checkbox"
                  className="h-4 w-4 rounded border"
                  checked={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                />
              )}
            />
            <Label htmlFor="isActive" className="font-normal">
              {t("settings.userForm.activeLabel")}
            </Label>
          </div>

          <details className="group rounded-md border border-dashed bg-muted/20 p-2">
            <summary className="cursor-pointer list-none text-sm text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
              {t("settings.userForm.contactInfo")}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-2">
                <Label htmlFor="phone">{t("settings.userForm.phoneLabel")}</Label>
                <Input id="phone" dir="ltr" inputMode="tel" {...createForm.register("phone")} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">{t("settings.userForm.emailLabel")}</Label>
                <Input id="email" dir="ltr" type="email" autoComplete="off" {...createForm.register("email")} />
              </div>
            </div>
          </details>

          <AdvancedPermissionsBlock
            canEdit={canPerm}
            show={showAdvanced}
            onToggle={() => setShowAdvanced((s) => !s)}
            hasStoredOverrides={hasOverrides}
          >
            {advancedPermissionsPanel}
          </AdvancedPermissionsBlock>

          {createForm.formState.errors.root ? (
            <p className="text-sm text-destructive">{createForm.formState.errors.root.message}</p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? t("common.saving") : t("common.save")}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link to="/settings/users">{t("common.cancel")}</Link>
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 pb-8">
      <PageHeader
        title={t("settings.userForm.editTitle")}
        description={t("settings.userForm.editDescription")}
      />
      <form className="space-y-4 rounded-lg border bg-card p-4" onSubmit={editForm.handleSubmit((v) => editMut.mutate(v))}>
        <div className="grid gap-2">
          <Label htmlFor="username">{t("settings.userForm.usernameLabel")}</Label>
          <Input id="username" dir="auto" autoComplete="username" placeholder={t("settings.userForm.usernamePlaceholder")} {...editForm.register("username")} />
          {editForm.formState.errors.username ? (
            <p className="text-sm text-destructive">{editForm.formState.errors.username.message}</p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="name">{t("settings.userForm.nameLabel")}</Label>
          <Input id="name" {...editForm.register("name")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">{t("settings.userForm.passwordEditLabel")}</Label>
          <Input id="password" type="password" autoComplete="new-password" {...editForm.register("password")} />
          {editForm.formState.errors.password ? (
            <p className="text-sm text-destructive">{editForm.formState.errors.password.message}</p>
          ) : null}
        </div>
        <Controller
          name="role"
          control={editForm.control}
          render={({ field }) => (
            <div className="space-y-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-role">{t("settings.userForm.roleLabel")}</Label>
                <select
                  id="edit-role"
                  className={cn(
                    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  value={field.value}
                  onChange={(e) => {
                    field.onChange(e.target.value);
                    resetPermissionOverrides();
                  }}
                  onBlur={field.onBlur}
                  ref={field.ref}
                >
                  {editRoleOptions.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`, { defaultValue: r })}
                    </option>
                  ))}
                </select>
              </div>
              <p className="rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
                {ROLE_DESC_KEYS[field.value as Role] ? t(ROLE_DESC_KEYS[field.value as Role]) : "—"}
              </p>
            </div>
          )}
        />
        <div className="flex items-center gap-2">
          <Controller
            name="isActive"
            control={editForm.control}
            render={({ field }) => (
              <input
                id="isActive"
                type="checkbox"
                className="h-4 w-4 rounded border"
                checked={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
              />
            )}
          />
          <Label htmlFor="isActive" className="font-normal">
            {t("settings.userForm.activeLabel")}
          </Label>
        </div>

        <details className="group rounded-md border border-dashed bg-muted/20 p-2">
          <summary className="cursor-pointer list-none text-sm text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
            {t("settings.userForm.contactInfo")}
          </summary>
          <div className="mt-3 space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="phone">{t("settings.userForm.phoneLabel")}</Label>
              <Input id="phone" dir="ltr" inputMode="tel" {...editForm.register("phone")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">{t("settings.userForm.emailLabel")}</Label>
              <Input id="email" dir="ltr" type="email" {...editForm.register("email")} />
            </div>
          </div>
        </details>

        <AdvancedPermissionsBlock
          canEdit={canPerm}
          show={showAdvanced}
          onToggle={() => setShowAdvanced((s) => !s)}
          hasStoredOverrides={hasOverrides}
        >
          {advancedPermissionsPanel}
        </AdvancedPermissionsBlock>

        {editForm.formState.errors.root ? (
          <p className="text-sm text-destructive">{editForm.formState.errors.root.message}</p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={editMut.isPending}>
            {editMut.isPending ? t("common.saving") : t("settings.userForm.saveEdits")}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/settings/users">{t("common.cancel")}</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
