import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool, transaction } from "./pool.js";
const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url);
try {
  await transaction(pool, "migration", async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('wallet_migrations'))",
    );
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL UNIQUE)",
    );
    const directory = resolve("migrations");
    for (const name of (await readdir(directory))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const existing = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (existing.rowCount) continue;
      await client.query(await readFile(resolve(directory, name), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
        name,
      ]);
    }
  });
} finally {
  await pool.end();
}
