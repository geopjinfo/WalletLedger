import { Pool, type PoolClient } from "pg";
import { logger } from "../shared/logger.js";
export type Isolation = "READ COMMITTED" | "REPEATABLE READ";
export function createPool(url: string): Pool {
  const pool = new Pool({
    options: "-c timezone=UTC",
    connectionString: url,
    max: 20,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", () => logger.error("database.connection_failed"));
  return pool;
}
export async function transaction<T>(
  pool: Pool,
  actor: string,
  work: (client: PoolClient) => Promise<T>,
  isolation: Isolation = "READ COMMITTED",
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    await client.query("SELECT set_config('wallet.actor',$1,true)", [actor]);
    const result = await work(client);
    await client.query("COMMIT");
    logger.info("transaction.committed");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    logger.warn("transaction.rolled_back");
    throw error;
  } finally {
    client.release();
  }
}
