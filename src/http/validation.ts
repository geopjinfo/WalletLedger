import { z } from "zod";
export const id = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const amount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const userBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    phone: z.string().regex(/^\+?[0-9]{7,15}$/),
  })
  .strict();
export const walletBody = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();
export const transferBody = z
  .object({
    source_account_id: id,
    destination_account_id: id,
    amount,
    note: z.string().max(500).default(""),
  })
  .strict();
export const moneyBody = z
  .object({ wallet_id: id, amount, note: z.string().max(500).default("") })
  .strict();
export const decisionBody = z
  .object({ decision: z.enum(["release", "reject"]) })
  .strict();
export const askBody = z
  .object({ question: z.string().trim().min(1).max(1000) })
  .strict();
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});
