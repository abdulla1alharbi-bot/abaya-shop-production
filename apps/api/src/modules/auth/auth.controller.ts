import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { loginBodySchema } from "./auth.schema.js";
import * as authService from "./auth.service.js";

export const postLogin = [
  validateBody(loginBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.login(req.body, res);
    res.status(200).json({ success: true, data: result });
  }),
];

export const postRefresh = [
  asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies?.refreshToken as string | undefined;
    const result = await authService.refresh(token, res);
    res.status(200).json({ success: true, data: result });
  }),
];

export const postLogout = [
  asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies?.refreshToken as string | undefined;
    await authService.logout(token, res);
    res.status(200).json({ success: true, data: { message: "Logged out" } });
  }),
];

export const getMe = [
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: { message: "Unauthorized" } });
      return;
    }
    const user = await authService.getMe(userId);
    res.status(200).json({ success: true, data: user });
  }),
];
