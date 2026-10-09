import type { Pool } from "pg";
import { AppError, type Identity, type Json } from "../../shared/types.js";
import type { StatementProvider } from "./provider.js";
export async function askStatement(
  pool: Pool,
  provider: StatementProvider,
  identity: Identity,
  userId: string,
  question: string,
): Promise<Json> {
  if (identity.userId !== userId)
    throw new AppError(
      "FORBIDDEN",
      403,
      "Questions are limited to your own accounts",
    );
  const input = await provider.interpret(question);
  let counterparty: string | null = null;
  if (input.type === 1) {
    const matches = await pool.query<{ id: string }>(
      `SELECT DISTINCT u.id FROM users u JOIN accounts a ON a.user_id=u.id
      JOIN transfers t ON t.destination_account_id=a.id JOIN accounts sender ON sender.id=t.source_account_id
      WHERE sender.user_id=$1 AND lower(u.name)=lower($2) AND t.status IN ('posted','reversed')`,
      [userId, input.counterparty],
    );
    if (matches.rows.length > 1)
      throw new AppError(
        "AMBIGUOUS_PERSON",
        422,
        "More than one recipient has that name",
      );
    counterparty = matches.rows[0]?.id ?? "-1";
  }
  const result = await pool.query<{
    id: string;
    amount: string;
    sent: boolean;
    received: boolean;
  }>(
    `SELECT t.id,t.amount,
    s.user_id=$1::bigint AS sent,d.user_id=$1::bigint AS received FROM transfers t
    JOIN accounts s ON s.id=t.source_account_id JOIN accounts d ON d.id=t.destination_account_id
    WHERE t.status IN ('posted','reversed') AND t.type <> 'reversal'
    AND (s.user_id=$1 OR d.user_id=$1) AND t.created_at >= $2::date
    AND t.created_at < $3::date + interval '1 day'
    AND ($4::bigint IS NULL OR (s.user_id=$1 AND d.user_id=$4))
    ORDER BY t.amount DESC,t.id`,
    [userId, input.from, input.to, counterparty],
  );
  let rows = result.rows;
  if (input.type === 2) rows = rows.filter((r) => r.received && !r.sent);
  if (input.type === 3) rows = rows.slice(0, 1);
  const value =
    input.type === 4
      ? BigInt(rows.length)
      : rows.reduce((sum, r) => sum + BigInt(r.amount), 0n);
  return {
    type: input.type,
    value: value.toString(),
    unit: input.type === 4 ? "transfers" : "paise",
    transfer_ids: rows.map((r) => r.id),
    from: input.from,
    to: input.to,
  };
}
export async function explainFlags(
  pool: Pool,
  provider: StatementProvider,
): Promise<void> {
  const pending = await pool.query<{
    id: string;
    source_account_id: string;
    detail: Json;
  }>(`SELECT f.id,t.source_account_id,f.detail FROM risk_flags f JOIN transfers t ON t.id=f.transfer_id
    WHERE f.explanation IS NULL ORDER BY f.id`);
  for (const flag of pending.rows) {
    const history = await pool.query<{
      id: string;
      amount: string;
      note: string;
    }>(
      "SELECT id,amount,note FROM transfers WHERE source_account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 10",
      [flag.source_account_id],
    );
    try {
      const result = await provider.explain({
        rule: flag.detail,
        transfers: history.rows.map((r) => ({ ...r })),
      });
      await pool.query(
        "UPDATE risk_flags SET explanation=$2,label=$3 WHERE id=$1 AND explanation IS NULL",
        [flag.id, result.explanation, result.label],
      );
    } catch {
      console.error(
        `Could not explain risk flag ${flag.id}; it remains pending`,
      );
    }
  }
}
