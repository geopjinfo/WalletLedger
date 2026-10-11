import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { StatementProvider } from "../modules/statements/provider.js";
import type {
  Identity,
  Json,
  ResponseData,
  Transfer,
} from "../shared/types.js";
import { id } from "./validation.js";
export type Route = {
  Body: Json;
  Params: { [key: string]: string };
  Querystring: { [key: string]: string };
};
export type Request = FastifyRequest<Route>;
export interface RouteContext {
  app: FastifyInstance;
  pool: Pool;
  provider: StatementProvider;
  identity: (request: Request) => Promise<Identity>;
  post: (
    path: string,
    work: (
      request: Request,
      identity: Identity,
      client: PoolClient,
    ) => Promise<ResponseData>,
    onboarding?: boolean,
  ) => void;
}
export function parameter(request: Request, name = "id"): string {
  return id.parse(request.params[name]);
}
export function transferResponse(transfer: Transfer): ResponseData {
  return {
    code: transfer.status === "held" ? 202 : 201,
    body: { ...transfer, created_at: transfer.created_at.toISOString() },
  };
}
