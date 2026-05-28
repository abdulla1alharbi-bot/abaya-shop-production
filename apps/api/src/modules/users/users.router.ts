import { Router } from "express";
import type { Request, Response } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { createUserSchema, updateUserSchema } from "./users.schema.js";
import * as usersService from "./users.service.js";

export const usersRouter = Router();
usersRouter.use(authMiddleware);

usersRouter.get(
  "/",
  requirePermission("users.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    const items = await usersService.listUsers();
    res.status(200).json({ success: true, data: { items } });
  }),
);

usersRouter.get(
  "/:id",
  requirePermission("users.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ success: false, error: { message: "Missing id" } });
      return;
    }
    const user = await usersService.getUserById(id);
    res.status(200).json({ success: true, data: user });
  }),
);

usersRouter.post(
  "/",
  requirePermission("users.create"),
  validateBody(createUserSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const acting = req.user;
    if (!acting) {
      res.status(401).json({ success: false, error: { message: "Unauthorized" } });
      return;
    }
    const canEdit = acting.permissions.includes("users.permissions");
    const user = await usersService.createUser(req.body, canEdit);
    res.status(201).json({ success: true, data: user });
  }),
);

usersRouter.patch(
  "/:id",
  requirePermission("users.edit"),
  validateBody(updateUserSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ success: false, error: { message: "Missing id" } });
      return;
    }
    const acting = req.user;
    if (!acting) {
      res.status(401).json({ success: false, error: { message: "Unauthorized" } });
      return;
    }
    const canEdit = acting.permissions.includes("users.permissions");
    const user = await usersService.updateUser(id, req.body, acting.id, canEdit);
    res.status(200).json({ success: true, data: user });
  }),
);
