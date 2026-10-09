import type { Pool, PoolClient } from "pg";
import { AppError, first, type Json } from "../../shared/types.js";
import { reconciliationChecks } from "./queries.js";
interface Issue {
  entity_id: string | null;
  expected: string;
  actual: string;
}
export async function reconcile(
  pool: Pool,
  transactionClient?: PoolClient,
): Promise<Json> {
  const owned = transactionClient === undefined;
  const client = transactionClient ?? (await pool.connect());
  try {
    if (owned) await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await client.query("SAVEPOINT job_lock");
    try {
      await client.query(
        "SELECT id FROM job_locks WHERE name='reconciliation' FOR UPDATE NOWAIT",
      );
    } catch {
      throw new AppError(
        "JOB_RUNNING",
        409,
        "Reconciliation is already running",
      );
    }
    const run = first(
      (
        await client.query<{ id: string }>(
          "INSERT INTO reconciliation_runs(status) VALUES('running') RETURNING id",
        )
      ).rows,
    );
    const counts: { [key: string]: Json } = {};
    let issues = 0;
    const findings: { name: string; row: Issue }[] = [];
    for (const [name, query] of Object.entries(reconciliationChecks)) {
      const result = await client.query<Issue>(query);
      counts[name] = {
        count: result.rows.length,
        findings: result.rows.map((row) => ({ ...row })),
      };
      for (const issue of result.rows) {
        findings.push({ name, row: issue });
      }
    }
    // Report root problems once; keep every dependent check result in the run.
    const root = await client.query<Issue & { check_name: string }>(`
      SELECT 'entry_amount'::text AS check_name,l.id AS entity_id,t.amount::text AS expected,l.amount::text AS actual
      FROM ledger_entries l JOIN transfers t ON t.id=l.transfer_id WHERE l.amount<>t.amount
      UNION ALL SELECT 'missing_entry',t.id,'two entries',count(l.id)::text
      FROM transfers t LEFT JOIN ledger_entries l ON l.transfer_id=t.id WHERE t.status IN ('posted','reversed')
      GROUP BY t.id HAVING count(l.id)<2
      UNION ALL SELECT 'stored_balance',a.id,COALESCE(sum(m.delta),0)::text,a.balance::text
      FROM accounts a LEFT JOIN (
       SELECT source_account_id AS account_id,-amount::numeric AS delta FROM transfers WHERE status IN ('posted','reversed')
       UNION ALL SELECT destination_account_id,amount::numeric FROM transfers WHERE status IN ('posted','reversed')
      ) m ON m.account_id=a.id GROUP BY a.id HAVING a.balance<>COALESCE(sum(m.delta),0)`);
    const problems = root.rows.length
      ? root.rows
      : findings.map((f) => ({ ...f.row, check_name: f.name }));
    for (const issue of problems) {
      await client.query(
        "INSERT INTO reconciliation_issues(run_id,check_name,entity_id,expected,actual) VALUES($1,$2,$3,$4,$5)",
        [
          run.id,
          issue.check_name,
          issue.entity_id,
          issue.expected,
          issue.actual,
        ],
      );
      issues++;
    }
    await client.query(
      "UPDATE reconciliation_runs SET ended_at=clock_timestamp(),status=$2,issue_count=$3,check_result=$4 WHERE id=$1",
      [run.id, issues ? "failed" : "passed", issues, JSON.stringify(counts)],
    );
    if (owned) await client.query("COMMIT");
    return {
      id: run.id,
      status: issues ? "failed" : "passed",
      issue_count: issues,
      checks: counts,
    };
  } catch (error) {
    if (owned) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (owned) client.release();
  }
}
