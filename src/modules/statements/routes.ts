import type { RouteContext } from "../../http/routes.js";
import * as validation from "../../http/validation.js";
import { parameter } from "../../http/routes.js";
import { askStatement } from "../statements/service.js";
export function registerStatementsRoutes({
  pool,
  provider,
  post,
}: RouteContext): void {
  post("/users/:id/statement/ask", async (r, who, _client) => ({
    code: 200,
    body: await askStatement(
      pool,
      provider,
      who,
      parameter(r),
      validation.askBody.parse(r.body).question,
    ),
  }));
}
