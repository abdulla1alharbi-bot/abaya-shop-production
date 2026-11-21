import type { Prisma } from "@prisma/client";
import { EXTRA_WORK_TYPES } from "@abaya-shop/shared";

/**
 * Wage lines for «شغل إضافي» (ARI / PUSSOS) dated in `date`.
 *
 * The dashboard, the nightly report and the financial / workshop-wage reports
 * total wages from completed pipeline stages (JobOrderWorkStage). Extra work is
 * not a stage — it lives only as a ProductionEntry — so every one of those
 * totals must add these lines too, or wages are understated and profit
 * overstated. Payroll and worker balances already read ProductionEntry and need
 * nothing extra.
 */
export function extraWorkWagesWhere(date: Prisma.DateTimeFilter): Prisma.ProductionEntryWhereInput {
  return { workType: { in: [...EXTRA_WORK_TYPES] }, date };
}

/** Columns every wage view needs from an extra-work line. */
export const extraWorkWageSelect = {
  id: true,
  workType: true,
  totalFils: true,
  date: true,
  workerId: true,
  worker: { select: { name: true } },
  jobOrder: { select: { jobNo: true, productStyle: true } },
} as const satisfies Prisma.ProductionEntrySelect;
