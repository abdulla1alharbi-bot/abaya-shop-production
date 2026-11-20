export const UAE_VAT_RATE = 0.05;

export const FILS_PER_AED = 100;

/**
 * The most a payment may exceed what the invoice still owes. The owner's rule is
 * that cash rounding (163 on a 162.50 bill) stays in the till as rounding income —
 * but that was meant for change, not for a mistyped invoice number (33,488 AED on
 * a 300 AED bill) or the same payment saved twice, both of which inflated every
 * collections report by AED 167,851 before this cap existed.
 */
export const MAX_PAYMENT_ROUNDING_FILS = 500;

/** A second identical payment (same invoice, method and amount) inside this window is treated as a double save. */
export const REPEAT_PAYMENT_WINDOW_MS = 60_000;

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
