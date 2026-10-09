import { writeFile } from "node:fs/promises";
import { DatabaseError } from "pg";
import { createPool } from "../src/database/pool.js";
import { loadDatabaseConfig } from "../src/config.js";
const url = loadDatabaseConfig().DATABASE_URL;
const pool = createPool(url);
const a = await pool.connect();
const b = await pool.connect();
const lines = [
  "# Isolation experiments",
  "",
  "Recorded on PostgreSQL 16.13 with two independent connections. Use two psql sessions to reproduce the labelled commands. The lab tables are separate from the wallet schema.",
  "",
];
async function command(session: "A" | "B", sql: string): Promise<void> {
  const client = session === "A" ? a : b;
  lines.push(`\`${session}> ${sql}\``);
  try {
    const result = await client.query<{ balance: number; name?: string }>(sql);
    lines.push("```json", JSON.stringify(result.rows), "```", "");
  } catch (error) {
    if (error instanceof DatabaseError)
      lines.push(`Error ${error.code}: ${error.message}`, "");
    else throw error;
  }
}
try {
  await a.query(
    "CREATE TABLE isolation_accounts(id INTEGER PRIMARY KEY,balance INTEGER NOT NULL);CREATE TABLE isolation_users(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO isolation_accounts VALUES(1,500);INSERT INTO isolation_users VALUES(1,'Asha')",
  );
  for (const level of ["READ COMMITTED", "REPEATABLE READ"]) {
    lines.push(`## ${level}`, "");
    await a.query("UPDATE isolation_accounts SET balance=500");
    await command("A", `BEGIN ISOLATION LEVEL ${level}`);
    await command("A", "SELECT balance FROM isolation_accounts WHERE id=1");
    await command("B", "UPDATE isolation_accounts SET balance=400 WHERE id=1");
    await command("A", "SELECT balance FROM isolation_accounts WHERE id=1");
    await command("A", "COMMIT");
  }
  lines.push("## Repeatable Read with a join", "");
  await a.query("UPDATE isolation_accounts SET balance=500");
  await command("A", "BEGIN ISOLATION LEVEL REPEATABLE READ");
  const join =
    "SELECT balance,name FROM isolation_accounts JOIN isolation_users USING(id)";
  await command("A", join);
  await command("B", "UPDATE isolation_accounts SET balance=400 WHERE id=1");
  await command("A", join);
  await command("A", "COMMIT");
  lines.push("## Serializable conflict", "");
  await a.query("UPDATE isolation_accounts SET balance=500");
  await command("A", "BEGIN ISOLATION LEVEL SERIALIZABLE");
  await command("B", "BEGIN ISOLATION LEVEL SERIALIZABLE");
  await command("A", "SELECT balance FROM isolation_accounts WHERE id=1");
  await command("B", "SELECT balance FROM isolation_accounts WHERE id=1");
  await command("A", "UPDATE isolation_accounts SET balance=400 WHERE id=1");
  await command("A", "COMMIT");
  await command("B", "UPDATE isolation_accounts SET balance=400 WHERE id=1");
  await command("B", "ROLLBACK");
  lines.push(
    "## Unsafe lost update",
    "Both sessions read 500 and independently spend 100. Without a locked re-read, both overwrite the balance with 400; the correct result is 300.",
    "",
  );
  await a.query("UPDATE isolation_accounts SET balance=500");
  await command("A", "BEGIN");
  await command("B", "BEGIN");
  await command("A", "SELECT balance FROM isolation_accounts WHERE id=1");
  await command("B", "SELECT balance FROM isolation_accounts WHERE id=1");
  await command("A", "UPDATE isolation_accounts SET balance=400 WHERE id=1");
  await command("A", "COMMIT");
  await command("B", "UPDATE isolation_accounts SET balance=400 WHERE id=1");
  await command("B", "COMMIT");
  await command("A", "SELECT balance FROM isolation_accounts WHERE id=1");
  lines.push(
    "The production path locks account rows in ascending ID order, reads balances while holding the locks, and writes both ledger sides and balances in the same Read Committed transaction. The 20 stampede runs verify that concurrent requests cannot reuse stale funds.",
  );
  await writeFile("docs/isolation.md", lines.join("\n") + "\n");
} finally {
  await a.query("ROLLBACK");
  await b.query("ROLLBACK");
  await a.query("DROP TABLE IF EXISTS isolation_accounts,isolation_users");
  a.release();
  b.release();
  await pool.end();
}
