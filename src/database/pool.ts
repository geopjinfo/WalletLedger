import { Pool, type PoolClient } from "pg";
export type Isolation = "READ COMMITTED" | "REPEATABLE READ";
export function createPool(url: string): Pool {
  return new Pool({
    options: "-c timezone=UTC",
    connectionString: url,
    max: 20,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
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
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
