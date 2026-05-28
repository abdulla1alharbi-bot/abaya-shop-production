import { z } from "zod";
import { normalizeUsername, validateUsernameFormat } from "@abaya-shop/shared";

export const loginBodySchema = z.object({
  username: z
    .string()
    .transform((s) => normalizeUsername(s))
    .superRefine((val, ctx) => {
      const err = validateUsernameFormat(val);
      if (err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
      }
    }),
  password: z.string().min(1, "أدخل كلمة المرور"),
});

export type LoginBody = z.output<typeof loginBodySchema>;
