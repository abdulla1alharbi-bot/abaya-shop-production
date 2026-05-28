/**
 * Application roles and fine-grained permissions.
 * Effective permissions = role defaults ∪ extraPermissions ∖ revokedPermissions (invalid keys ignored).
 */

export const APP_ROLES = ["OWNER", "MANAGER", "ADMIN", "SELLER", "WORKER", "WORKSHOP_SUPERVISOR", "ACCOUNTANT"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** All known permission keys (dot notation: module.action). */
export const ALL_PERMISSIONS = [
  "dashboard.view",

  "pos.use",
  "pos.readyMade",
  "pos.tailoring",
  "pos.checkout",

  "invoices.view",
  "invoices.create",
  "invoices.edit",
  "invoices.payment",
  "invoices.deliver",
  "invoices.print",
  "invoices.creditOverride",

  "customers.view",
  "customers.create",
  "customers.edit",

  "workers.view",
  "workers.create",
  "workers.edit",
  "workers.wages",

  "models.view",
  "models.create",
  "models.edit",
  "models.delete",

  "fabrics.view",
  "fabrics.create",
  "fabrics.edit",
  "fabrics.delete",

  "readyMade.view",
  "readyMade.create",
  "readyMade.edit",
  "readyMade.delete",

  "jobProcess.view",
  "jobProcess.update",
  "jobProcess.assignWorkers",
  "jobProcess.complete",
  /** Change stage worker wage amounts (internal labor rates). */
  "jobProcess.editWage",
  /** Reopen a completed stage (non-admin supervisors). */
  "jobProcess.reopenStage",
  /** Correct worker/wage/date/notes on completed pipeline stages (owner/manager). */
  "jobProcess.adminEdit",
  /** Directly move a job order to READY status, bypassing remaining pipeline stages. */
  "jobProcess.markReady",
  /** Pass or fail a job at the QA inspection stage. */
  "jobProcess.inspect",

  "reports.sales",
  "reports.wages",
  "reports.balances",
  "reports.financial",
  "reports.mostRequested",

  "expenses.view",
  "expenses.create",
  "expenses.edit",
  "expenses.delete",

  "settings.view",
  "settings.manage",

  "users.view",
  "users.create",
  "users.edit",
  "users.permissions",

  /** Used by upload API (images, PDFs). */
  "upload.use",

  /** View the audit log (owner only by default). */
  "audit.view",
] as const;

export type PermissionId = (typeof ALL_PERMISSIONS)[number];

const VALID = new Set<string>(ALL_PERMISSIONS as unknown as string[]);

/** Default permission sets per role (before user extra/revoke). */
export const ROLE_DEFAULTS: Record<AppRole, readonly string[]> = {
  OWNER: [...ALL_PERMISSIONS],

  /**
   * Matrix + practical extras so POS and workshop flows work: checkout, tailoring tabs,
   * and completing/reopening job stages.
   */
  MANAGER: [
    "dashboard.view",
    "pos.use",
    "pos.readyMade",
    "pos.tailoring",
    "pos.checkout",
    "invoices.view",
    "invoices.create",
    "invoices.edit",
    "invoices.payment",
    "invoices.deliver",
    "invoices.print",
    "invoices.creditOverride",
    "customers.view",
    "customers.create",
    "customers.edit",
    "workers.view",
    "jobProcess.view",
    "jobProcess.update",
    "jobProcess.assignWorkers",
    "jobProcess.complete",
    "jobProcess.editWage",
    "jobProcess.adminEdit",
    "jobProcess.inspect",
    "models.view",
    "models.create",
    "models.edit",
    "fabrics.view",
    "fabrics.create",
    "fabrics.edit",
    "readyMade.view",
    "readyMade.create",
    "readyMade.edit",
    "reports.sales",
    "reports.balances",
    "reports.wages",
    "reports.financial",
    "reports.mostRequested",
    "expenses.view",
    "expenses.create",
    "settings.view",
    "upload.use",
  ],

  /** Same capability matrix as MANAGER — use for accounts stored as "Admin" in legacy DBs. */
  ADMIN: [
    "dashboard.view",
    "pos.use",
    "pos.readyMade",
    "pos.tailoring",
    "pos.checkout",
    "invoices.view",
    "invoices.create",
    "invoices.edit",
    "invoices.payment",
    "invoices.deliver",
    "invoices.print",
    "invoices.creditOverride",
    "customers.view",
    "customers.create",
    "customers.edit",
    "workers.view",
    "jobProcess.view",
    "jobProcess.update",
    "jobProcess.assignWorkers",
    "jobProcess.complete",
    "jobProcess.editWage",
    "jobProcess.adminEdit",
    "jobProcess.inspect",
    "models.view",
    "models.create",
    "models.edit",
    "fabrics.view",
    "fabrics.create",
    "fabrics.edit",
    "readyMade.view",
    "readyMade.create",
    "readyMade.edit",
    "reports.sales",
    "reports.balances",
    "reports.wages",
    "reports.financial",
    "reports.mostRequested",
    "expenses.view",
    "expenses.create",
    "settings.view",
    "upload.use",
  ],

  /**
   * Sales floor: POS, invoices, customers, reports — no tailoring **setup** (models/fabrics admin).
   * Model & fabric **selection** in POS uses `pos.tailoring` + catalog/fabric list APIs (not `models.view` / `fabrics.view`).
   */
  SELLER: [
    "dashboard.view",
    "pos.use",
    "pos.readyMade",
    "pos.tailoring",
    "pos.checkout",
    "invoices.view",
    "invoices.create",
    "invoices.payment",
    "invoices.deliver",
    "invoices.print",
    "customers.view",
    "customers.create",
    "customers.edit",
    "jobProcess.view",
    "reports.sales",
    "reports.balances",
    "readyMade.view",
    "upload.use",
  ],

  /** Workshop: job pipeline + models; dashboard for a sensible home after login. */
  WORKER: [
    "dashboard.view",
    "jobProcess.view",
    "jobProcess.update",
    "jobProcess.assignWorkers",
    "jobProcess.complete",
    "models.view",
    "upload.use",
  ],

  WORKSHOP_SUPERVISOR: [
    "dashboard.view",
    "jobProcess.view",
    "jobProcess.update",
    "jobProcess.assignWorkers",
    "jobProcess.complete",
    "jobProcess.reopenStage",
    "jobProcess.inspect",
    "models.view",
    "fabrics.view",
    "upload.use",
  ],

  ACCOUNTANT: [
    "dashboard.view",
    "invoices.view",
    "invoices.payment",
    "invoices.print",
    "customers.view",
    "reports.sales",
    "reports.wages",
    "reports.balances",
    "reports.financial",
    "expenses.view",
    "expenses.create",
    "expenses.edit",
    "workers.wages",
    "upload.use",
  ],
};

export function normalizeAppRole(role: string): AppRole {
  if (role === "SALESPERSON") return "SELLER";
  if ((APP_ROLES as readonly string[]).includes(role)) return role as AppRole;
  return "SELLER";
}

export function parseJsonStringArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v) as unknown;
      return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Compute effective permission strings for API/JWT.
 */
export function computeEffectivePermissions(
  role: string,
  extraPermissions: unknown,
  revokedPermissions: unknown,
): string[] {
  const r = normalizeAppRole(role);
  const base = [...ROLE_DEFAULTS[r]];
  const extra = parseJsonStringArray(extraPermissions);
  const revoked = new Set(parseJsonStringArray(revokedPermissions));
  const set = new Set<string>([...base, ...extra]);
  for (const x of revoked) set.delete(x);
  return [...set].filter((p) => VALID.has(p)).sort();
}

/** Arabic labels for simple UIs (permission id → short description). */
export const PERMISSION_GROUPS_AR: Record<string, string> = {
  "dashboard.view": "الرئيسية",

  "pos.use": "الكاشير — فتح شاشة البيع",
  "pos.readyMade": "الكاشير — بيع جاهز",
  "pos.tailoring": "الكاشير — تفصيل",
  "pos.checkout": "الكاشير — إتمام الدفع وإنشاء الفاتورة",

  "invoices.view": "الفواتير — عرض",
  "invoices.create": "الفواتير — إنشاء",
  "invoices.edit": "الفواتير — تعديل",
  "invoices.payment": "الفواتير — تحصيل",
  "invoices.deliver": "الفواتير — تسليم",
  "invoices.print": "الفواتير — طباعة",
  "invoices.creditOverride": "الفواتير — تجاوز حد الائتمان (إداري)",

  "customers.view": "العملاء — عرض",
  "customers.create": "العملاء — إضافة",
  "customers.edit": "العملاء — تعديل",

  "workers.view": "العمال — عرض",
  "workers.create": "العمال — إضافة",
  "workers.edit": "العمال — تعديل",
  "workers.wages": "العمال — أجور ومستحقات",

  "models.view": "موديلات العباية — عرض",
  "models.create": "موديلات العباية — إضافة",
  "models.edit": "موديلات العباية — تعديل",
  "models.delete": "موديلات العباية — حذف",

  "fabrics.view": "القماش — عرض",
  "fabrics.create": "القماش — إضافة",
  "fabrics.edit": "القماش — تعديل",
  "fabrics.delete": "القماش — حذف",

  "readyMade.view": "جاهز للبيع — عرض",
  "readyMade.create": "جاهز للبيع — إضافة",
  "readyMade.edit": "جاهز للبيع — تعديل",
  "readyMade.delete": "جاهز للبيع — حذف",

  "jobProcess.view": "الورشة — عرض الطلبات",
  "jobProcess.update": "الورشة — تحديث وتعيين",
  "jobProcess.assignWorkers": "الورشة — تعيين العامل لكل مرحلة",
  "jobProcess.complete": "الورشة — إكمال مرحلة",
  "jobProcess.editWage": "الورشة — تعديل أجر المرحلة (أجور العامل)",
  "jobProcess.reopenStage": "الورشة — إعادة فتح مرحلة مكتملة",
  "jobProcess.adminEdit": "الورشة — تصحيح مراحل مكتملة (إداري)",
  "jobProcess.markReady": "الورشة — تحويل طلب إلى جاهز مباشرةً",
  "jobProcess.inspect": "الورشة — فحص الجودة (تمرير أو رفض)",

  "reports.sales": "التقارير — مبيعات وفواتير",
  "reports.wages": "التقارير — أجور ورشة",
  "reports.balances": "التقارير — ذمم وأرصدة",
  "reports.financial": "التقارير — نشاط مالي",
  "reports.mostRequested": "التقارير — الأكثر طلباً",

  "expenses.view": "المصروفات — عرض",
  "expenses.create": "المصروفات — إضافة",
  "expenses.edit": "المصروفات — تعديل",
  "expenses.delete": "المصروفات — حذف",

  "settings.view": "إعدادات المحل — عرض",
  "settings.manage": "إعدادات المحل — تعديل",

  "users.view": "المستخدمين — عرض",
  "users.create": "المستخدمين — إنشاء",
  "users.edit": "المستخدمين — تعديل",
  "users.permissions": "المستخدمين — تعديل الصلاحيات التفصيلية",

  "upload.use": "رفع الملفات والصور",
};
