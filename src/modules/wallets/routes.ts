import type { RouteContext } from "../../http/routes.js";
import * as validation from "../../http/validation.js";
import { parameter } from "../../http/routes.js";
import type { Route } from "../../http/routes.js";
import { createUser } from "../wallets/service.js";
import { openWallet } from "../wallets/service.js";
import { ownedWallet } from "../wallets/service.js";
export function registerWalletsRoutes({
  app,
  pool,
  identity,
  post,
}: RouteContext): void {
  post(
    "/users",
    async (r, _who, client) => ({
      code: 201,
      body: await createUser(client, validation.userBody.parse(r.body)),
    }),
    true,
  );
  post("/users/:id/wallets", async (r, who, client) => ({
    code: 201,
    body: await openWallet(
      client,
      who,
      parameter(r),
      validation.walletBody.parse(r.body).name,
    ),
  }));
  app.get<Route>("/wallets/:id/balance", async (r) =>
    ownedWallet(pool, await identity(r), parameter(r)),
  );
  app.get<Route>("/wallets/:id/statement", async (r) => {
    await ownedWallet(pool, await identity(r), parameter(r));
    const page = validation.pagination.parse(r.query);
    const rows = await pool.query<{
      id: string;
      transfer_id: string;
      direction: string;
      amount: string;
      created_at: Date;
    }>(
      "SELECT id,transfer_id,direction,amount,created_at FROM ledger_entries WHERE account_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3",
      [parameter(r), page.limit, page.offset],
    );
    return { entries: rows.rows, ...page };
  });
}
