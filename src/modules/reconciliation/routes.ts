import type { RouteContext } from "../../http/routes.js";
import { first } from "../../shared/types.js";
import type { Json } from "../../shared/types.js";
import { parameter } from "../../http/routes.js";
import type { Route } from "../../http/routes.js";
import { requireAdmin } from "../../http/identity.js";
import { reconcile } from "../reconciliation/service.js";
import { emptyBody } from "../../http/validation.js";
export function registerReconciliationRoutes({
  app,
  pool,
  identity,
  post,
}: RouteContext): void {
  post("/admin/reconciliation/run", async (r, who, client) => {
    requireAdmin(who);
    emptyBody.parse(r.body);
    return { code: 202, body: await reconcile(pool, client) };
  });
  app.get<Route>("/admin/reconciliation/runs/:id", async (r) => {
    requireAdmin(await identity(r));
    const run = first(
      (
        await pool.query<{
          id: string;
          status: string;
          issue_count: number;
          check_result: Json;
        }>(
          "SELECT id,status,issue_count,check_result FROM reconciliation_runs WHERE id=$1",
          [parameter(r)],
        )
      ).rows,
    );
    const issues = await pool.query<{
      check_name: string;
      entity_id: string | null;
      expected: string;
      actual: string;
    }>(
      "SELECT check_name,entity_id,expected,actual FROM reconciliation_issues WHERE run_id=$1 ORDER BY id",
      [run.id],
    );
    return { ...run, issues: issues.rows };
  });
}
