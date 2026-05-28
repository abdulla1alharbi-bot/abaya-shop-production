import { Router } from "express";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

export const branchesRouter = Router();
branchesRouter.use(authMiddleware);

branchesRouter.get(
  "/",
  requirePermission("pos.use"),
  asyncHandler(async (_req, res) => {
    const branches = await prisma.branch.findMany({ orderBy: { name: "asc" } });
    res.status(200).json({ success: true, data: branches });
  }),
);
