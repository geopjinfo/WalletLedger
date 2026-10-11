import type { RouteContext } from "../../http/routes.js";
import * as validation from "../../http/validation.js";
import type { Transfer } from "../../shared/types.js";
import { parameter } from "../../http/routes.js";
import type { Route } from "../../http/routes.js";
import { decideTransfer } from "../transfers/service.js";
import { requireAdmin } from "../../http/identity.js";
export function registerRiskRoutes({
  app,
  pool,
  identity,
  post,
}: RouteContext): void {
  post("/admin/risk/:transfer_id/decision", async (r, who, client) => {
    requireAdmin(who);
    const t = await decideTransfer(
      client,
      parameter(r, "transfer_id"),
      validation.decisionBody.parse(r.body).decision,
    );
    return {
      code: 200,
      body: { ...t, created_at: t.created_at.toISOString() },
    };
  });
  app.get<Route>("/admin/risk/queue", async (r) => {
    requireAdmin(await identity(r));
    const page = validation.pagination.parse(r.query);
    return (
      await pool.query<Transfer>(
        "SELECT t.* FROM transfers t WHERE t.status='held' OR EXISTS(SELECT 1 FROM risk_flags f WHERE f.transfer_id=t.id) ORDER BY t.created_at DESC,t.id DESC LIMIT $1 OFFSET $2",
        [page.limit, page.offset],
      )
    ).rows;
  });
}
