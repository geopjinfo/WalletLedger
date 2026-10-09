import { writeFile } from "node:fs/promises";
import { createPool } from "../src/database/pool.js";
import { reconciliationChecks } from "../src/modules/reconciliation/queries.js";
import { checkRisk, riskQueries } from "../src/modules/risk/service.js";
const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL required");
const pool = createPool(url);
try {
  const size = await pool.query<{ count: string }>(
    "SELECT count(*) FROM ledger_entries",
  );
  const lines = [
    "# Query plans",
    "",
    `Measured on PostgreSQL 16.13 with ${size.rows[0]?.count} ledger entries. Timings depend on the host and cache state.`,
    "",
  ];
  for (const [name, sql] of Object.entries(reconciliationChecks)) {
    const plan = await pool.query<{ "QUERY PLAN": string }>(
      "EXPLAIN (ANALYZE,BUFFERS) " + sql,
    );
    lines.push(
      `## ${name}`,
      "",
      "```sql",
      sql,
      "```",
      "",
      "```text",
      ...plan.rows.map((r) => r["QUERY PLAN"]),
      "```",
      "",
    );
  }
  const page = await pool.query<{ "QUERY PLAN": string }>(
    "EXPLAIN (ANALYZE,BUFFERS) SELECT id,transfer_id,amount FROM ledger_entries WHERE account_id=1 ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET 100000",
  );
  lines.push(
    "## Deep statement offset",
    "",
    "```text",
    ...page.rows.map((r) => r["QUERY PLAN"]),
    "```",
    "",
    "OFFSET discards the first 100,000 matching rows even with an ordered index. This work grows with the offset. The statement index avoids a separate sort but cannot skip counting those rows.",
    "",
    "Global balance and transfer grouping are nightly scans over the ledger. Stored-balance and overdraft checks scan and group entries by account. Foreign keys prevent ordinary orphans; missing-entry checks use the transfer index supplied by the unique (transfer_id, account_id, direction) constraint. Full scans are acceptable for the nightly checks, while statement and fraud lookups need selective indexes.",
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE risk_rules SET enabled=true");
    await client.query("SELECT id FROM accounts WHERE id=1 FOR UPDATE");
    const started = performance.now();
    await checkRisk(client, "1", "4", 100000);
    const elapsed = performance.now() - started;
    const queries: [string, string, (string | number)[]][] = [
      ["Velocity", riskQueries.velocity, ["1", 600]],
      ["Amount spike", riskQueries.amount_spike, ["1", 100000, 5, 2592000]],
      ["New payee", riskQueries.new_payee, ["1", "4"]],
    ];
    lines.push("## Individual fraud rules", "");
    for (const [name, query, values] of queries) {
      const plan = await client.query<{ "QUERY PLAN": string }>(
        "EXPLAIN (ANALYZE,BUFFERS) " + query,
        values,
      );
      lines.push(
        `### ${name}`,
        "",
        "```text",
        ...plan.rows.map((r) => r["QUERY PLAN"]),
        "```",
        "",
      );
    }
    lines.push(
      "## Fraud queries",
      "",
      `All three rule queries plus the rule lookup took ${elapsed.toFixed(3)} ms on the cash-in account with 500,000 historical outgoing transfers. This measures query overhead while holding its account lock; it excludes HTTP and commit time.`,
      "",
      "Velocity and amount-spike filters use transfers_outgoing (source_account_id, created_at DESC), a partial index on posted/reversed rows. The new-payee query uses transfers_recipient (source_account_id, destination_account_id). Broad history windows may still choose a sequential scan; this hot system-account fixture is a worst-case history size for the required rules.",
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  await writeFile("docs/performance.md", lines.join("\n") + "\n");
} finally {
  await pool.end();
}
