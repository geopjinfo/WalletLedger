import { z } from "zod";
import { DatabaseError, type Pool, type PoolClient } from "pg";
import { transaction, type Isolation } from "../../database/pool.js";
import { digest } from "../../http/identity.js";
import {
  AppError,
  type Identity,
  type Json,
  type ResponseData,
} from "../../shared/types.js";
interface KeyRow {
  request_hash: string;
  response_code: number;
  response_body: Json;
}
function canonical(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k] ?? null))
      .join(",") +
    "}"
  );
}
export async function idempotent(
  pool: Pool,
  identity: Identity,
  key: string | undefined,
  operation: string,
  body: Json,
  requestId: string,
  work: (client: PoolClient) => Promise<ResponseData>,
  isolation: Isolation = "READ COMMITTED",
): Promise<ResponseData> {
  if (!z.uuid().safeParse(key).success || !key)
    throw new AppError("INVALID_KEY", 400, "UUID Idempotency-Key required");
  const hash = digest(operation + ":" + canonical(body));
  return transaction(
    pool,
    identity.caller,
    async (client) => {
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",
        [identity.caller + ":" + key],
      );
      if (!lock.rows[0]?.acquired)
        throw new AppError(
          "IN_PROGRESS",
          409,
          "Request is processing; retry shortly",
        );
      const previous = await client.query<KeyRow>(
        "SELECT request_hash,response_code,response_body FROM idempotency_keys WHERE caller=$1 AND key=$2",
        [identity.caller, key],
      );
      const row = previous.rows[0];
      if (row) {
        if (row.request_hash !== hash)
          throw new AppError(
            "KEY_REUSED",
            422,
            "Key was used for a different request",
          );
        return { code: row.response_code, body: row.response_body };
      }
      await client.query(
        "INSERT INTO idempotency_keys(user_id,caller,key,request_hash,status) VALUES($1,$2,$3,$4,'processing')",
        [identity.userId, identity.caller, key, hash],
      );
      await client.query("SAVEPOINT operation");
      let result: ResponseData;
      try {
        result = await work(client);
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT operation");
        if (error instanceof AppError)
          result = {
            code: error.status,
            body: {
              code: error.code,
              message: error.message,
              request_id: requestId,
            },
          };
        else if (error instanceof DatabaseError && error.code === "23505")
          result = {
            code: 409,
            body: {
              code: "CONFLICT",
              message: "Record already exists",
              request_id: requestId,
            },
          };
        else throw error;
      }
      await client.query(
        "UPDATE idempotency_keys SET status='completed',response_code=$3,response_body=$4 WHERE caller=$1 AND key=$2",
        [identity.caller, key, result.code, JSON.stringify(result.body)],
      );
      return result;
    },
    isolation,
  );
}
