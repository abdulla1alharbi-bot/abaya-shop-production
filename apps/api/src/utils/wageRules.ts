import type { Prisma } from "@prisma/client";

/** Job stages at which a piece's stage wages count as earned. */
export const COMPLETED_WAGE_JOB_STAGES = ["READY", "DELIVERED"] as const;

/**
 * ProductionEntry filter for "earned" wages: entries on a finished piece, plus
 * manual entries with no job order at all (general work recorded on the worker
 * page). A bare `jobOrder: { stage: … }` filter can never match a null relation,
 * so that general work used to be left out of the worker's balance and the wage
 * reports while payroll still counted it.
 */
export const EARNED_WAGE_ENTRY: Prisma.ProductionEntryWhereInput = {
  OR: [{ jobOrderId: null }, { jobOrder: { stage: { in: [...COMPLETED_WAGE_JOB_STAGES] } } }],
};
