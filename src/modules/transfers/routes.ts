import type { RouteContext } from "../../http/routes.js";
import * as validation from "../../http/validation.js";
import { AppError } from "../../shared/types.js";
import { first } from "../../shared/types.js";
import type { Transfer } from "../../shared/types.js";
import { parameter } from "../../http/routes.js";
import { transferResponse } from "../../http/routes.js";
import type { Route } from "../../http/routes.js";
import { createTransfer } from "../transfers/service.js";
import { reverseTransfer } from "../transfers/service.js";
import { systemAccount } from "../transfers/service.js";
export function registerTransfersRoutes({
  app,
  pool,
  identity,
  post,
}: RouteContext): void {
  post("/transfers", async (r, who, client) => {
    const b = validation.transferBody.parse(r.body);
    const kinds = await client.query<{ id: string; kind: string }>(
      "SELECT id,kind FROM accounts WHERE id=ANY($1::bigint[])",
      [[b.source_account_id, b.destination_account_id]],
    );
    if (kinds.rows.some((a) => a.kind !== "wallet"))
      throw new AppError(
        "INVALID_ACCOUNTS",
        422,
        "Peer transfers require two wallets",
      );
    return transferResponse(
      await createTransfer(client, who, {
        source: b.source_account_id,
        destination: b.destination_account_id,
        amount: b.amount,
        note: b.note,
        type: "peer",
      }),
    );
  });
  for (const kind of ["topup", "withdraw"] as const)
    post(`/transfers/${kind}`, async (r, who, client) => {
      const b = validation.moneyBody.parse(r.body);
      const wallet = first(
        (
          await client.query<{ kind: string }>(
            "SELECT kind FROM accounts WHERE id=$1",
            [b.wallet_id],
          )
        ).rows,
      );
      if (wallet.kind !== "wallet")
        throw new AppError("INVALID_ACCOUNT", 422, "A user wallet is required");
      const system = await systemAccount(
        client,
        kind === "topup" ? "cash_in" : "cash_out",
      );
      return transferResponse(
        await createTransfer(client, who, {
          source: kind === "topup" ? system : b.wallet_id,
          destination: kind === "topup" ? b.wallet_id : system,
          amount: b.amount,
          note: b.note,
          type: kind === "topup" ? "topup" : "withdrawal",
        }),
      );
    });
  post("/transfers/:id/reverse", async (r, who, client) =>
    transferResponse(await reverseTransfer(client, who, parameter(r))),
  );
  app.get<Route>("/transfers/:id", async (r) => {
    const who = await identity(r);
    const t = first(
      (
        await pool.query<Transfer>("SELECT * FROM transfers WHERE id=$1", [
          parameter(r),
        ])
      ).rows,
    );
    const owners = await pool.query<{ user_id: string | null }>(
      "SELECT user_id FROM accounts WHERE id=ANY($1::bigint[])",
      [[t.source_account_id, t.destination_account_id]],
    );
    if (!who.admin && !owners.rows.some((a) => a.user_id === who.userId))
      throw new AppError(
        "FORBIDDEN",
        403,
        "Transfer does not belong to caller",
      );
    const entries = await pool.query<{
      id: string;
      account_id: string;
      direction: string;
      amount: string;
    }>(
      "SELECT id,account_id,direction,amount FROM ledger_entries WHERE transfer_id=$1 ORDER BY id",
      [t.id],
    );
    const history = await pool.query<{
      status: string;
      actor: string;
      created_at: Date;
    }>(
      "SELECT status,actor,created_at FROM transfer_status_history WHERE transfer_id=$1 ORDER BY id",
      [t.id],
    );
    return { ...t, entries: entries.rows, history: history.rows };
  });
}
