import type { PoolClient } from "pg";
import {
  AppError,
  first,
  type Account,
  type Identity,
  type Transfer,
} from "../../shared/types.js";
import { checkRisk } from "../risk/service.js";
export interface PostingInput {
  source: string;
  destination: string;
  amount: number;
  note: string;
  type: Transfer["type"];
  original?: string;
}
async function lockAccounts(
  client: PoolClient,
  source: string,
  destination: string,
): Promise<[Account, Account]> {
  if (source === destination)
    throw new AppError(
      "SAME_ACCOUNT",
      422,
      "Source and destination must differ",
    );
  const result = await client.query<Account>(
    "SELECT id,user_id,kind,balance FROM accounts WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE",
    [[source, destination]],
  );
  const from = result.rows.find((a) => a.id === source);
  const to = result.rows.find((a) => a.id === destination);
  if (!from || !to) throw new AppError("NOT_FOUND", 404, "Account not found");
  return [from, to];
}
function sufficient(account: Account, amount: number): void {
  if (account.kind === "wallet" && BigInt(account.balance) < BigInt(amount))
    throw new AppError("INSUFFICIENT_FUNDS", 422, "Insufficient funds");
}
async function postEntries(
  client: PoolClient,
  transfer: Transfer,
): Promise<void> {
  await client.query(
    "UPDATE accounts SET balance=balance-$2::bigint WHERE id=$1",
    [transfer.source_account_id, transfer.amount],
  );
  await client.query(
    "UPDATE accounts SET balance=balance+$2::bigint WHERE id=$1",
    [transfer.destination_account_id, transfer.amount],
  );
  await client.query(
    "INSERT INTO ledger_entries(transfer_id,account_id,direction,amount) VALUES($1,$2,'debit',$4),($1,$3,'credit',$4)",
    [
      transfer.id,
      transfer.source_account_id,
      transfer.destination_account_id,
      transfer.amount,
    ],
  );
}
export async function createTransfer(
  client: PoolClient,
  identity: Identity,
  input: PostingInput,
): Promise<Transfer> {
  const [source, destination] = await lockAccounts(
    client,
    input.source,
    input.destination,
  );
  const owned = input.type === "topup" ? destination : source;
  if (!identity.admin && owned.user_id !== identity.userId)
    throw new AppError("FORBIDDEN", 403, "Account does not belong to caller");
  sufficient(source, input.amount);
  const matches = await checkRisk(
    client,
    input.source,
    input.destination,
    input.amount,
  );
  const status = matches.some((m) => m.action === "hold") ? "held" : "posted";
  const transfer = first(
    (
      await client.query<Transfer>(
        "INSERT INTO transfers(source_account_id,destination_account_id,type,status,amount,note,original_transfer_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          input.source,
          input.destination,
          input.type,
          status,
          input.amount,
          input.note,
          input.original ?? null,
        ],
      )
    ).rows,
  );
  for (const match of matches)
    await client.query(
      "INSERT INTO risk_flags(transfer_id,rule_id,detail) VALUES($1,$2,$3)",
      [transfer.id, match.ruleId, JSON.stringify(match)],
    );
  if (status === "posted") {
    await postEntries(client, transfer);
    if (input.original)
      await client.query("UPDATE transfers SET status='reversed' WHERE id=$1", [
        input.original,
      ]);
  }
  return transfer;
}
export async function reverseTransfer(
  client: PoolClient,
  identity: Identity,
  id: string,
): Promise<Transfer> {
  const original = first(
    (
      await client.query<Transfer>(
        "SELECT * FROM transfers WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows,
  );
  if (original.status !== "posted" || original.type === "reversal")
    throw new AppError(
      "NOT_REVERSIBLE",
      409,
      "Only a posted original transfer can be reversed",
    );
  const previous = await client.query<{ id: string }>(
    "SELECT id FROM transfers WHERE original_transfer_id=$1",
    [id],
  );
  if (previous.rowCount)
    throw new AppError("ALREADY_REVERSED", 409, "A reversal already exists");
  if (!identity.admin) {
    const owner = first(
      (
        await client.query<{ user_id: string | null }>(
          "SELECT user_id FROM accounts WHERE id=$1",
          [original.source_account_id],
        )
      ).rows,
    );
    if (owner.user_id !== identity.userId)
      throw new AppError(
        "FORBIDDEN",
        403,
        "Transfer does not belong to caller",
      );
  }
  return createTransfer(
    client,
    { ...identity, admin: true },
    {
      source: original.destination_account_id,
      destination: original.source_account_id,
      amount: Number(original.amount),
      note: `Reversal of ${id}`,
      type: "reversal",
      original: id,
    },
  );
}
export async function decideTransfer(
  client: PoolClient,
  id: string,
  decision: "release" | "reject",
): Promise<Transfer> {
  const transfer = first(
    (
      await client.query<Transfer>(
        "SELECT * FROM transfers WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows,
  );
  if (transfer.status !== "held")
    throw new AppError("NOT_HELD", 409, "Transfer is not held");
  if (decision === "release") {
    if (transfer.original_transfer_id) {
      const original = first(
        (
          await client.query<Transfer>(
            "SELECT * FROM transfers WHERE id=$1 FOR UPDATE",
            [transfer.original_transfer_id],
          )
        ).rows,
      );
      if (original.status !== "posted")
        throw new AppError(
          "NOT_REVERSIBLE",
          409,
          "Original is no longer reversible",
        );
    }
    const [source] = await lockAccounts(
      client,
      transfer.source_account_id,
      transfer.destination_account_id,
    );
    sufficient(source, Number(transfer.amount));
    await postEntries(client, transfer);
    if (transfer.original_transfer_id)
      await client.query("UPDATE transfers SET status='reversed' WHERE id=$1", [
        transfer.original_transfer_id,
      ]);
  }
  return first(
    (
      await client.query<Transfer>(
        "UPDATE transfers SET status=$2 WHERE id=$1 RETURNING *",
        [id, decision === "release" ? "posted" : "rejected"],
      )
    ).rows,
  );
}
export async function systemAccount(
  client: PoolClient,
  kind: "cash_in" | "cash_out" | "fee_revenue",
): Promise<string> {
  return first(
    (
      await client.query<{ id: string }>(
        "SELECT id FROM accounts WHERE kind=$1",
        [kind],
      )
    ).rows,
  ).id;
}
