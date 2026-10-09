import { createPool } from "../src/database/pool.js";
export async function seed(url: string, count = 100000): Promise<void> {
  if (!Number.isSafeInteger(count) || count < 10000 || count > 1000000)
    throw new Error("Transfer count must be 10000 to 1000000");
  const pool = createPool(url);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role=replica");
    await client.query(
      "TRUNCATE ledger_entries,transfers,transfer_status_history,risk_flags,idempotency_keys,reconciliation_issues,reconciliation_runs,accounts,users RESTART IDENTITY CASCADE",
    );
    await client.query(
      "INSERT INTO users(name,email,phone,kyc_status,token_hash) SELECT 'User '||n,'user'||n||'@example.test','+1555'||lpad(n::text,7,'0'),'verified',encode(sha256(('seed-user-'||n)::bytea),'hex') FROM generate_series(1,1000) n",
    );
    await client.query(
      "INSERT INTO accounts(name,kind) VALUES('Cash in','cash_in'),('Cash out','cash_out'),('Fees','fee_revenue')",
    );
    await client.query(
      "INSERT INTO accounts(user_id,name,kind) SELECT ((n-1)/2)+1,'Wallet '||n,'wallet' FROM generate_series(1,2000) n",
    );
    await client.query(
      "INSERT INTO transfers(source_account_id,destination_account_id,type,status,amount,created_at) SELECT 1,4+((n-1)%2000),'topup','posted',100000,clock_timestamp()-make_interval(secs=>n) FROM generate_series(1,$1::int) n",
      [count],
    );
    await client.query(
      "INSERT INTO ledger_entries(transfer_id,account_id,direction,amount,created_at) SELECT id,source_account_id,'debit',amount,created_at FROM transfers UNION ALL SELECT id,destination_account_id,'credit',amount,created_at FROM transfers",
    );
    await client.query(
      "INSERT INTO transfer_status_history(transfer_id,status,actor) SELECT id,status,'seed' FROM transfers",
    );
    await client.query(
      "UPDATE accounts a SET balance=COALESCE((SELECT sum(CASE WHEN l.direction='credit' THEN l.amount ELSE -l.amount END) FROM ledger_entries l WHERE l.account_id=a.id),0)",
    );
    await client.query("UPDATE risk_rules SET enabled=true");
    await client.query("COMMIT");
    await client.query("ANALYZE");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/seed.ts")) {
  const url = process.env["DATABASE_URL"];
  if (!url || process.env["ALLOW_SEED_RESET"] !== "true")
    throw new Error(
      "Seeding replaces fixture data; set DATABASE_URL and ALLOW_SEED_RESET=true",
    );
  await seed(url, Number(process.env["SEED_TRANSFERS"] ?? 100000));
  console.log("Seed complete");
}
