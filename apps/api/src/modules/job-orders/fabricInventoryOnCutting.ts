import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../middleware/error.middleware.js";

/**
 * Fabric stock rules (tailoring / job materials)
 * ───────────────────────────────────────────────
 * - On invoice/job creation: `JobOrderMaterial` stores chosen `rollId` + planned `meters`; **no** stock movement.
 * - Stock is **deducted once** when the **CUTTING** work stage is completed (`deductFabricOnCuttingComplete`).
 *   Lines with `fabricDeducted: false` are processed; each is marked `fabricDeducted: true`, `deductedMeters`, `deductedRollId`.
 * - **Reopen CUTTING**: restores using `deductedRollId ?? rollId` + `deductedMeters`, clears flags (`restoreFabricOnCuttingReopen`).
 * - **Job cancel / invoice void**: restores every line still `fabricDeducted: true` once (`restoreAllDeductedMaterialsForJob`).
 * - **PATCH material** after cutting: adjusts by delta or swap roll (`patchJobOrderMaterialFabric`).
 * - **Delivery / job DELIVERED via PATCH**: does **not** touch fabric (see invoices `/:id/deliver` comment).
 *
 * Idempotency: deduction only runs for `fabricDeducted: false`; restore only for `fabricDeducted: true`, then flags cleared.
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
  // availableMeters includes reservedMeters (promised to jobs not yet cut).
  // At cutting time, the reservation is already in place, so check only availableMeters.
  if (roll.availableMeters < needMeters - 1e-9) {
    throw new AppError(400, `Insufficient fabric on roll ${roll.rollCode}`, "INSUFFICIENT_STOCK");
  }
}

/** Reserve fabric at job creation time (before cutting). Returns computed cost in fils. */
export async function reserveFabricForMaterial(
  tx: PrismaTx,
  rollId: string,
  meters: number,
): Promise<number> {
  if (meters <= 1e-9) return 0;
  const roll = await tx.fabricRoll.findUnique({ where: { id: rollId } });
  if (!roll) throw new AppError(400, `Roll ${rollId} not found`, "NOT_FOUND");
  const free = roll.availableMeters - roll.reservedMeters;
  if (free < meters - 1e-9) {
    throw new AppError(
      400,
      `Insufficient fabric on roll ${roll.rollCode} (free: ${free.toFixed(2)}m, need: ${meters}m)`,
      "INSUFFICIENT_STOCK",
    );
  }
  await tx.fabricRoll.update({
    where: { id: rollId },
    data: { reservedMeters: { increment: meters } },
  });
  return Math.round(meters * (roll.costPerMeter ?? 0));
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

/** Release reservation without deducting stock (job cancelled before cutting). */
export async function releaseReservation(
  tx: PrismaTx,
  rollId: string,
  meters: number,
): Promise<void> {
  if (meters <= 1e-9) return;
  await tx.fabricRoll.update({
    where: { id: rollId },
    data: { reservedMeters: { decrement: meters } },
  });
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
      // Reservation fulfilled: fabric moves from reserved → used
      reservedMeters: { decrement: Math.min(meters, roll.reservedMeters) },
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
 * Restore every deducted line (`fabricDeducted: true`) and release reservations for
 * uncut lines (`fabricDeducted: false`). Used on job cancel / invoice void.
 * (Idempotent: second run finds nothing to process.)
 */
export async function restoreAllDeductedMaterialsForJob(
  tx: PrismaTx,
  params: { jobOrderId: string; jobNo: number; reason: string },
): Promise<void> {
  const materials = await tx.jobOrderMaterial.findMany({
    where: { jobOrderId: params.jobOrderId },
  });
  for (const m of materials) {
    if (m.fabricDeducted) {
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
    } else if (m.meters > 1e-9) {
      // Not yet cut — release the reservation so other jobs can use this fabric.
      await releaseReservation(tx, m.rollId, m.meters);
    }
  }
}

/**
 * When Cutting is reopened: return booked meters to rolls and re-add reservation
 * (uses `deductedRollId` / `deductedMeters`).
 */
export async function restoreFabricOnCuttingReopen(
  tx: PrismaTx,
  params: { jobOrderId: string; jobNo: number; stageKey: string },
): Promise<void> {
  if (params.stageKey !== "CUTTING") return;
  // Capture which materials were deducted before restoring them.
  const deductedMaterials = await tx.jobOrderMaterial.findMany({
    where: { jobOrderId: params.jobOrderId, fabricDeducted: true },
  });
  await restoreAllDeductedMaterialsForJob(tx, {
    jobOrderId: params.jobOrderId,
    jobNo: params.jobNo,
    reason: "[REOPEN] cutting reopened — stock restored",
  });
  // Re-add reservation: materials are now back to fabricDeducted: false (planned, not cut).
  for (const m of deductedMaterials) {
    const meters = metersLastDeducted(m);
    if (meters > 1e-9) {
      await tx.fabricRoll.update({
        where: { id: m.rollId },
        data: { reservedMeters: { increment: meters } },
      });
    }
  }
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

  // Before cutting completed: update reservation and check free meters.
  if (!cuttingDone || !m.fabricDeducted) {
    const freeMeters = newRoll.availableMeters - newRoll.reservedMeters;
    // Add back the current reservation for this material before checking
    const currentReservation = m.rollId === newRollId ? m.meters : 0;
    if (freeMeters + currentReservation < newMeters - 1e-9) {
      throw new AppError(400, `Insufficient fabric on roll ${newRoll.rollCode}`, "INSUFFICIENT_STOCK");
    }
    // Adjust reservations if roll or meters changed
    if (m.rollId !== newRollId) {
      await tx.fabricRoll.update({ where: { id: m.rollId }, data: { reservedMeters: { decrement: m.meters } } });
      await tx.fabricRoll.update({ where: { id: newRollId }, data: { reservedMeters: { increment: newMeters } } });
    } else if (Math.abs(newMeters - m.meters) > 1e-9) {
      await tx.fabricRoll.update({ where: { id: m.rollId }, data: { reservedMeters: { increment: newMeters - m.meters } } });
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
