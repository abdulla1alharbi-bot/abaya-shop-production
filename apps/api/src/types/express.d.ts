import type { Role } from "./role.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        name: string;
        role: Role;
        permissions: string[];
      };
      /** Set by validateQuery middleware */
      validatedQuery?: unknown;
    }
  }
}

export {};
