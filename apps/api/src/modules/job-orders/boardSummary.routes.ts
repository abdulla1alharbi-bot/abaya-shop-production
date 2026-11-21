import type { Router } from "express";
import { prisma } from "../../config/db.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { summarizePendingJobs } from "../../utils/jobUrgency.js";

/**
 * Real totals for «مهام الورشة».
 *
 * The board renders at most 500 pieces (the list endpoint's cap) and used to count
 * only those, so with ~1,600 open pieces every figure was pinned at a total of 500
 * and work entered elsewhere (e.g. 63 alteration pieces made ready) never showed.
 * Counted in SQL over every piece instead. Overdue uses the same definition as the
 * dashboard badge, so the two screens agree.
 */

/** Same scope as the board's list (`open=true`): everything not handed over, converted or cancelled. */
const OPEN_STAGES_EXCLUDED = ["DELIVERED", "CONVERTED_TO_READY", "CANCELLED"];

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function registerBoardSummaryRoute(router: Router): void {
  router.get(
    "/board-summary",
    requirePermission("jobProcess.view"),
    asyncHandler(async (_req, res) => {
      const now = new Date();
      const start = startOfLocalDay(now);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      const [groups, urgency] = await Promise.all([
        prisma.jobOrder.groupBy({
          by: ["stage"],
          where: { stage: { notIn: OPEN_STAGES_EXCLUDED } },
          _count: { _all: true },
        }),
        summarizePendingJobs(prisma, start, end),
      ]);
      const byStage: Record<string, number> = {};
      for (const g of groups) byStage[g.stage] = g._count._all;
      const ready = byStage.READY ?? 0;
      const inWork = Object.entries(byStage).reduce((s, [stage, n]) => (stage === "READY" ? s : s + n), 0);
      res.status(200).json({
        success: true,
        data: { byStage, inWork, ready, overdue: urgency.overdueCount, dueToday: urgency.dueTodayCount },
      });
    }),
  );
}
