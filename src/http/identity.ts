import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { AppError, type Identity } from "../shared/types.js";
export const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
export async function identify(
  pool: Pool,
  header: string | undefined,
  adminToken: string,
): Promise<Identity> {
  if (!header?.startsWith("Bearer "))
    throw new AppError("UNAUTHORIZED", 401, "Bearer token required");
  const token = header.slice(7);
  if (
    timingSafeEqual(Buffer.from(digest(token)), Buffer.from(digest(adminToken)))
  )
    return { caller: "admin", userId: null, admin: true };
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE token_hash=$1",
    [digest(token)],
  );
  const user = result.rows[0];
  if (!user) throw new AppError("UNAUTHORIZED", 401, "Invalid bearer token");
  return { caller: `user:${user.id}`, userId: user.id, admin: false };
}
export function requireAdmin(identity: Identity): void {
  if (!identity.admin)
    throw new AppError("FORBIDDEN", 403, "Administrator access required");
}
