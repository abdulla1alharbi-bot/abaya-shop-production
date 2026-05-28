import { Router } from "express";
import * as authController from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/login", ...authController.postLogin);

authRouter.get("/refresh", ...authController.postRefresh);
authRouter.post("/refresh", ...authController.postRefresh);

authRouter.post("/logout", ...authController.postLogout);
authRouter.get("/me", ...authController.getMe);