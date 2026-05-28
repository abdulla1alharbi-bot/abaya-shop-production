export const UAE_VAT_RATE = 0.05;

export const FILS_PER_AED = 100;

export const DEFAULT_PIECE_RATES_FILS: Record<string, number> = {
  SEW_BASIC: 1500,
  SEW_LINING: 2000,
  HAND_EMBROIDERY: 3500,
  MACHINE_EMBROIDERY: 2500,
  CUTTING: 800,
  FINISHING: 500,
  CUSTOM: 0,
};

export const PRODUCT_CATEGORY_NAMES = [
  "WALTER",
  "SHALIA",
  "GASHWA",
  "NICKAB",
  "MODEL",
  "EMBROIDERY",
  "H&T",
  "NORMAL",
] as const;

export const EXPENSE_CATEGORY_NAMES = [
  "Rent",
  "Utilities",
  "Salaries",
  "Supplies",
  "Maintenance",
  "Other",
] as const;

export const VOID_CATEGORIES = {
  DEFECT: "عيب في المنتج",
  WRONG_SIZE: "مقاس خاطئ",
  CUSTOMER_CHANGED_MIND: "العميل غير رأيه",
  DATA_ENTRY_ERROR: "خطأ في الإدخال",
  OTHER: "أخرى",
} as const;

export type VoidCategory = keyof typeof VOID_CATEGORIES;
