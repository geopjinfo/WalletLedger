import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  AppError,
  first,
  type Identity,
  type Json,
} from "../../shared/types.js";
import { digest } from "../../http/identity.js";
export async function createUser(
  client: PoolClient,
  body: { name: string; email: string; phone: string },
): Promise<Json> {
  const token = randomBytes(32).toString("hex");
  const user = first(
    (
      await client.query<{
        id: string;
        name: string;
        email: string;
        phone: string;
        kyc_status: string;
      }>(
        "INSERT INTO users(name,email,phone,token_hash) VALUES($1,$2,$3,$4) RETURNING id,name,email,phone,kyc_status",
        [body.name, body.email.toLowerCase(), body.phone, digest(token)],
      )
    ).rows,
  );
  return { ...user, token };
}
export async function openWallet(
  client: PoolClient,
  identity: Identity,
  userId: string,
  name: string,
): Promise<Json> {
  if (identity.userId !== userId && !identity.admin)
    throw new AppError("FORBIDDEN", 403, "User does not match caller");
  const exists = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE id=$1",
    [userId],
  );
  first(exists.rows);
  return {
    ...first(
      (
        await client.query<{
          id: string;
          name: string;
          balance: string;
          currency: string;
        }>(
          "INSERT INTO accounts(user_id,name,kind) VALUES($1,$2,'wallet') RETURNING id,name,balance,currency",
          [userId, name],
        )
      ).rows,
    ),
  };
}
export async function ownedWallet(
  pool: Pool,
  identity: Identity,
  id: string,
): Promise<{ id: string; balance: string; currency: string }> {
  const row = first(
    (
      await pool.query<{
        id: string;
        user_id: string | null;
        balance: string;
        currency: string;
      }>(
        "SELECT id,user_id,balance,currency FROM accounts WHERE id=$1 AND kind='wallet'",
        [id],
      )
    ).rows,
  );
  if (row.user_id !== identity.userId && !identity.admin)
    throw new AppError("FORBIDDEN", 403, "Wallet does not belong to caller");
  return { id: row.id, balance: row.balance, currency: row.currency };
}
