import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../middleware/error.middleware.js";

/**
 * Fabric stock rules (tailoring / job materials)
 * ───────────────────────────────────────────────
 * NO RESERVATION MODEL: fabric is never reserved/held at order creation.
 * The only stock movement is the physical deduction at CUTTING completion.
 *
 * - On invoice/job creation: `JobOrderMaterial` stores chosen `rollId` + planned `meters`
 *   and records the computed material cost; **no** stock movement, **no** reservation.
 * - Stock is **deducted once** when the **CUTTING** work stage is completed (`deductFabricOnCuttingComplete`).
 *   Availability is validated at this point (`assertEnoughAvailable`); a shortfall throws INSUFFICIENT_STOCK.
 *   Lines with `fabricDeducted: false` are processed; each is marked `fabricDeducted: true`, `deductedMeters`, `deductedRollId`.
 * - **Reopen CUTTING**: restores using `deductedRollId ?? rollId` + `deductedMeters`, clears flags (`restoreFabricOnCuttingReopen`).
 * - **Job cancel / invoice void**: restores every line still `fabricDeducted: true` once (`restoreAllDeductedMaterialsForJob`).
 *   Uncut lines (`fabricDeducted: false`) hold no stock, so nothing is released.
 * - **PATCH material** after cutting: adjusts by delta or swap roll (`patchJobOrderMaterialFabric`).
 * - **Delivery / job DELIVERED via PATCH**: does **not** touch fabric (see invoices `/:id/deliver` comment).
 *
 * Idempotency: deduction only runs for `fabricDeducted: false`; restore only for `fabricDeducted: true`, then flags cleared.
 * NOTE: fabric is never reserved. The legacy `reservedMeters` column on `FabricRoll` is fully unused — no code
 * reads or writes it (kept only to avoid a destructive column drop). The sole stock gate is the cutting deduction.
 */

/** Client passed to Prisma interactive transactions */
export type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$transaction" | "$on" | "$use" | "$extends"
>;

export function isCuttingWorkStageDone(
  workStages: { stageKey: string; status: string }[] | undefined,
): boolean {
  const row = workStages?.find((s) => s.stageKey === "CUTTING");
  return row?.status === "DONE";
}

/** Roll to use when restoring stock for a deducted line (handles post-deduction roll changes). */
export function physicalRollIdForRestore(m: { rollId: string; deductedRollId?: string | null }): string {
  return m.deductedRollId?.trim() || m.rollId;
}

/** Physical meters last removed from stock for this line (when fabricDeducted). */
export function metersLastDeducted(m: {
  fabricDeducted: boolean;
  deductedMeters?: number | null;
  meters: number;
}): number {
  if (!m.fabricDeducted) return 0;
  return m.deductedMeters ?? m.meters;
}

async function assertEnoughAvailable(tx: PrismaTx, rollId: string, needMeters: number): Promise<void> {
  const roll = await tx.fabricRoll.findUnique({ where: { id: rollId } });
  if (!roll) throw new AppError(400, `Roll ${rollId} not found`, "NOT_FOUND");
  // No reservation model: availableMeters is the physical stock on the roll.
  // This is the only stock gate — enforced at cutting time.
  if (roll.availableMeters < needMeters - 1e-9) {
    throw new AppError(400, `Insufficient fabric on roll ${roll.rollCode}`, "INSUFFICIENT_STOCK");
  }
}

/**
 * Record the chosen fabric for a job material at creation time and return the computed
 * cost in fils. No reservation, no stock movement — stock is only deducted at cutting.
 */
export async function reserveFabricForMaterial(
  tx: PrismaTx,
  rollId: string,
  meters: number,
): Promise<number> {
  return computeMaterialCostFils(tx, rollId, meters);
}

/** Compute material cost in fils without changing inventory. */
export async function computeMaterialCostFils(
  tx: PrismaTx,
  rollId: string,
  meters: number,
): Promise<number> {
  if (meters <= 1e-9) return 0;
  const roll = await tx.fabricRoll.findUnique({
    where: { id: rollId },
    select: { costPerMeter: true },
  });
  return Math.round(meters * (roll?.costPerMeter ?? 0));
}

async function applyDeductionToRoll(
  tx: PrismaTx,
  params: {
    rollId: string;
    meters: number;
    jobOrderId: string;
    jobNo: number;
    reason: string;
    transactionType?: "JOB_USE";
  },
): Promise<void> {
  const { rollId, meters, jobOrderId, jobNo, reason } = params;
  if (meters <= 1e-9) return;
  await assertEnoughAvailable(tx, rollId, meters);
  const roll = (await tx.fabricRoll.findUnique({ where: { id: rollId } }))!;
  await tx.fabricRoll.update({
    where: { id: roll.id },
    data: {
      usedMeters: { increment: meters },
      availableMeters: { decrement: meters },
    },
  });
  await tx.fabricTransaction.create({
    data: {
      rollId: roll.id,
      type: params.transactionType ?? "JOB_USE",
      meters,
      reason: `${reason} (Job #${jobNo})`,
      jobOrderId,
    },
  });
}

async function applyRestoreToRoll(
  tx: PrismaTx,
  params: {
    rollId: string;
    meters: number;
    jobOrderId: string;
    jobNo: number;
    reason: string;
    transactionType?: "JOB_RESTORE";
  },
): Promise<void> {
  const { rollId, meters, jobOrderId, jobNo, reason } = params;
  if (meters <= 1e-9) return;
  const roll = await tx.fabricRoll.findUnique({ where: { id: rollId } });
  if (!roll) throw new AppError(400, `Roll ${rollId} not found`, "NOT_FOUND");
  if (roll.usedMeters < meters - 1e-6) {
    throw new AppError(
      400,
      `Cannot safely restore ${meters}m on roll ${roll.rollCode} (recorded used: ${roll.usedMeters})`,
      "INVALID_STOCK",
    );
  }
  await tx.fabricRoll.update({
    where: { id: roll.id },
    data: {
      usedMeters: { decrement: meters },
      availableMeters: { increment: meters },
    },
  });
  await tx.fabricTransaction.create({
    data: {
      rollId: roll.id,
      type: params.transactionType ?? "JOB_RESTORE",
      meters,
      reason: `${reason} (Job #${jobNo})`,
      jobOrderId,
    },
  });
}

/**
 * When Cutting is marked done: apply fabric usage once per material line (`fabricDeducted: false` only).
 */
export async function deductFabricOnCuttingComplete(
  tx: PrismaTx,
  params: { jobOrderId: string; jobNo: number; stageKey: string },
): Promise<void> {
  if (params.stageKey !== "CUTTING") return;

  const materials = await tx.jobOrderMaterial.findMany({
    where: { jobOrderId: params.jobOrderId, fabricDeducted: false },
  });
  if (materials.length === 0) return;

  const reason = "[CUTTING_COMPLETE] cutting stage done — fabric use";

  for (const m of materials) {
    // No stock movement for zero planned meters; leave line undeducted so it stays visible for correction.
    if (m.meters <= 1e-9) continue;

    await applyDeductionToRoll(tx, {
      rollId: m.rollId,
      meters: m.meters,
      jobOrderId: params.jobOrderId,
      jobNo: params.jobNo,
      reason,
    });
    await tx.jobOrderMaterial.update({
      where: { id: m.id },
      data: {
        fabricDeducted: true,
        deductedMeters: m.meters,
        deductedRollId: m.rollId,
      },
    });
  }
}

/**
 * Record cutting waste for a job: deducts `wasteMeters` from the first material
 * line's roll (over and above the planned meters) and accumulates it on the line
 * as `wasteMeters`. Logged as a `WASTE` fabric transaction so wastage reports and
 * COGS stay accurate. No-op when the job has no materials or waste is ~0.
 */
export async function recordCuttingWaste(
  tx: PrismaTx,
  params: { jobOrderId: string; jobNo: number; wasteMeters: number },
): Promise<void> {
  if (params.wasteMeters <= 1e-9) return;
  const material = await tx.jobOrderMaterial.findFirst({
    where: { jobOrderId: params.jobOrderId },
    orderBy: { meters: "desc" },
  });
  if (!material) return;

  const roll = await tx.fabricRoll.findUnique({ where: { id: material.rollId } });
  if (!roll) return;
  // Waste can't exceed what's physically left on the roll.
  const meters = Math.min(params.wasteMeters, Math.max(0, roll.availableMeters));
  if (meters <= 1e-9) return;

  await tx.fabricRoll.update({
    where: { id: roll.id },
    data: {
      usedMeters: { increment: meters },
      availableMeters: { decrement: meters },
    },
  });
  await tx.fabricTransaction.create({
    data: {
      rollId: roll.id,
      type: "WASTE",
      meters,
      reason: `[CUTTING_WASTE] هدر قص (Job #${params.jobNo})`,
      jobOrderId: params.jobOrderId,
    },
  });
  await tx.jobOrderMaterial.update({
    where: { id: material.id },
    data: { wasteMeters: { increment: meters } },
  });
}

/**
 * Restore every deducted line (`fabricDeducted: true`). Used on job cancel / invoice void.
 * Uncut lines (`fabricDeducted: false`) never touched stock, so there is nothing to release.
 * (Idempotent: second run finds nothing to process.)
 */
export async function restoreAllDeductedMaterialsForJob(
  tx: PrismaTx,
  params: { jobOrderId: string; jobNo: number; reason: string },
): Promise<void> {
  const materials = await tx.jobOrderMaterial.findMany({
    where: { jobOrderId: params.jobOrderId, fabricDeducted: true },
  });
  for (const m of materials) {
    // Cutting was done — restore stock from usedMeters back to availableMeters.
    const rollId = physicalRollIdForRestore(m);
    const amt = metersLastDeducted(m);
    if (amt > 1e-9) {
      await applyRestoreToRoll(tx, {
        rollId,
        meters: amt,
        jobOrderId: params.jobOrderId,
        jobNo: params.jobNo,
        reason: params.reason,
      });
    }
    await tx.jobOrderMaterial.update({
      where: { id: m.id },
      data: { fabricDeducted: false, deductedMeters: null, deductedRollId: null },
    });
  }
}

/**
 * When Cutting is reopened: return booked meters to rolls (uses `deductedRollId` /
 * `deductedMeters`). No reservation is re-added — lines revert to planned/uncut and
 * hold no stock until cutting is completed again.
 */
export async function restoreFabricOnCuttingReopen(
  tx: PrismaTx,
  params: { jobOrderId: string; jobNo: number; stageKey: string },
): Promise<void> {
  if (params.stageKey !== "CUTTING") return;
  await restoreAllDeductedMaterialsForJob(tx, {
    jobOrderId: params.jobOrderId,
    jobNo: params.jobNo,
    reason: "[REOPEN] cutting reopened — stock restored",
  });
}

export type PatchMaterialFabricInput = {
  rollId?: string;
  meters?: number;
};

/**
 * Update fabric selection / planned meters. Handles stock when cutting was already completed and this line was deducted.
 */
export async function patchJobOrderMaterialFabric(
  tx: PrismaTx,
  params: {
    materialId: string;
    jobOrderId: string;
    jobNo: number;
    workStages: { stageKey: string; status: string }[];
    body: PatchMaterialFabricInput;
  },
): Promise<void> {
  const m = await tx.jobOrderMaterial.findFirst({
    where: { id: params.materialId, jobOrderId: params.jobOrderId },
  });
  if (!m) throw new AppError(404, "Material line not found", "NOT_FOUND");

  const cuttingDone = isCuttingWorkStageDone(params.workStages);
  const newRollId = params.body.rollId ?? m.rollId;
  const newMeters = params.body.meters ?? m.meters;

  if (newMeters <= 0) {
    throw new AppError(400, "meters must be positive", "VALIDATION_ERROR");
  }

  const newRoll = await tx.fabricRoll.findUnique({ where: { id: newRollId } });
  if (!newRoll) throw new AppError(404, "Fabric roll not found", "NOT_FOUND");

  const newMaterialCostFils = Math.round(newMeters * (newRoll.costPerMeter ?? 0));

  // Before cutting completed: nothing is reserved or deducted yet, so just
  // update the planned line. Stock is only ever touched at cutting completion.
  if (!cuttingDone || !m.fabricDeducted) {
    // Soft availability check against physical stock (the hard gate is at cutting).
    if (newRoll.availableMeters < newMeters - 1e-9) {
      throw new AppError(400, `Insufficient fabric on roll ${newRoll.rollCode}`, "INSUFFICIENT_STOCK");
    }
    await tx.jobOrderMaterial.update({
      where: { id: m.id },
      data: { rollId: newRollId, meters: newMeters, materialCostFils: newMaterialCostFils },
    });
    return;
  }

  // After cutting: adjust inventory by difference (admin path).
  const prevRoll = physicalRollIdForRestore(m);
  const prevBooked = metersLastDeducted(m);

  if (prevRoll === newRollId) {
    const delta = newMeters - prevBooked;
    if (Math.abs(delta) < 1e-9) {
      await tx.jobOrderMaterial.update({
        where: { id: m.id },
        data: {
          meters: newMeters,
          materialCostFils: newMaterialCostFils,
          deductedMeters: newMeters,
          deductedRollId: newRollId,
        },
      });
      return;
    }
    if (delta > 0) {
      await applyDeductionToRoll(tx, {
        rollId: newRollId,
        meters: delta,
        jobOrderId: params.jobOrderId,
        jobNo: params.jobNo,
        reason: "[QTY_ADJ] quantity increased after cutting — additional use",
      });
    } else {
      await applyRestoreToRoll(tx, {
        rollId: newRollId,
        meters: -delta,
        jobOrderId: params.jobOrderId,
        jobNo: params.jobNo,
        reason: "[QTY_ADJ] quantity reduced after cutting — partial restore",
      });
    }
    await tx.jobOrderMaterial.update({
      where: { id: m.id },
      data: {
        rollId: newRollId,
        meters: newMeters,
        materialCostFils: newMaterialCostFils,
        deductedMeters: newMeters,
        fabricDeducted: true,
        deductedRollId: newRollId,
      },
    });
    return;
  }

  // Fabric roll changed after cutting: restore old roll, deduct from new.
  await applyRestoreToRoll(tx, {
    rollId: prevRoll,
    meters: prevBooked,
    jobOrderId: params.jobOrderId,
    jobNo: params.jobNo,
    reason: "[FABRIC_SWAP] fabric changed after cutting — restore previous roll",
  });

  await applyDeductionToRoll(tx, {
    rollId: newRollId,
    meters: newMeters,
    jobOrderId: params.jobOrderId,
    jobNo: params.jobNo,
    reason: "[FABRIC_SWAP] fabric changed after cutting — use new roll",
  });

  await tx.jobOrderMaterial.update({
    where: { id: m.id },
    data: {
      rollId: newRollId,
      meters: newMeters,
      materialCostFils: newMaterialCostFils,
      deductedMeters: newMeters,
      fabricDeducted: true,
      deductedRollId: newRollId,
    },
  });
}
