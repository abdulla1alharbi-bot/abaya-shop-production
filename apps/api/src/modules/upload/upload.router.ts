import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";

const MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "models");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function extFromMime(mimetype: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heif",
  };
  return map[mimetype] ?? ".jpg";
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    cb(null, `${randomUUID()}${extFromMime(file.mimetype)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("NOT_IMAGE"));
      return;
    }
    cb(null, true);
  },
});

export const uploadRouter = Router();
uploadRouter.use(authMiddleware);

uploadRouter.post(
  "/",
  requirePermission("upload.use"),
  (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          next(new AppError(400, "Image must be 5MB or smaller", "FILE_TOO_LARGE"));
          return;
        }
        next(new AppError(400, err.message, "UPLOAD_ERROR"));
        return;
      }
      if (err instanceof Error) {
        if (err.message === "NOT_IMAGE") {
          next(new AppError(400, "Only image files are allowed", "BAD_REQUEST"));
          return;
        }
        next(new AppError(400, err.message, "BAD_REQUEST"));
        return;
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new AppError(400, "No file uploaded", "BAD_REQUEST");
    }
    const publicPath = `/uploads/models/${file.filename}`;
    res.status(201).json({ success: true, data: { url: publicPath } });
  }),
);
