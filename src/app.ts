import Fastify, { type FastifyError } from "fastify";
import { randomUUID } from "node:crypto";
import { logger } from "./shared/logger.js";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import type { Config } from "./config.js";
import { identify } from "./http/identity.js";
import type { Request, Route } from "./http/routes.js";
import { idempotent } from "./modules/idempotency/service.js";
import type { StatementProvider } from "./modules/statements/provider.js";
import { AppError, type Identity, type ResponseData } from "./shared/types.js";
import { registerWalletsRoutes } from "./modules/wallets/routes.js";
import { registerTransfersRoutes } from "./modules/transfers/routes.js";
import { registerRiskRoutes } from "./modules/risk/routes.js";
import { registerStatementsRoutes } from "./modules/statements/routes.js";
import { registerReconciliationRoutes } from "./modules/reconciliation/routes.js";
export function buildApp(
  config: Config,
  pool: Pool,
  provider: StatementProvider,
) {
  logger.setLevel(config.LOG_LEVEL);
  const app = Fastify({
    logger: false,
    bodyLimit: 16384,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  });
  app.addHook("onRequest", (request, reply, done) => {
    reply.header("x-request-id", request.id);
    logger.forRequest(request.id, () => {
      logger.info("request.started", {
        method: request.method,
        route: request.routeOptions.url ?? "unmatched",
      });
      done();
    });
  });
  app.addHook("onResponse", async (request, reply) => {
    const fields = {
      request_id: request.id,
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      status_code: reply.statusCode,
      duration_ms: Math.round(reply.elapsedTime),
    };
    if (reply.statusCode >= 500) logger.error("request.completed", fields);
    else if (reply.statusCode >= 400) logger.warn("request.completed", fields);
    else logger.info("request.completed", fields);
  });
  const identity = (r: Request): Promise<Identity> =>
    identify(pool, r.headers.authorization, config.ADMIN_TOKEN);
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    logger.warn("request.rejected", {
      request_id: request.id,
      error_code: error instanceof AppError ? error.code : "REQUEST_ERROR",
    });
    if (error instanceof AppError)
      return reply.code(error.status).send({
        code: error.code,
        message: error.message,
        request_id: request.id,
      });
    if (
      error instanceof z.ZodError ||
      error.validation ||
      error.statusCode === 400
    )
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "Invalid request fields",
        request_id: request.id,
      });
    if (error.code === "23505")
      return reply.code(409).send({
        code: "CONFLICT",
        message: "Record already exists",
        request_id: request.id,
      });
    if (
      error.code === "23514" ||
      error.code === "22003" ||
      error.code === "23503"
    )
      return reply.code(422).send({
        code: "INVALID_OPERATION",
        message: "Request violates account or ledger constraints",
        request_id: request.id,
      });
    if (error.code === "40P01" || error.code === "40001")
      return reply.code(409).send({
        code: "RETRY_REQUIRED",
        message: "Transaction conflict; retry with the same key",
        request_id: request.id,
      });
    if (error.statusCode === 413 || error.statusCode === 415)
      return reply.code(error.statusCode).send({
        code: "INVALID_PAYLOAD",
        message: "Unsupported or oversized request body",
        request_id: request.id,
      });
    logger.error("request.failed", { request_id: request.id, error_code: "INTERNAL_ERROR" });
    return reply.code(500).send({
      code: "INTERNAL_ERROR",
      message: "Request failed",
      request_id: request.id,
    });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      code: "NOT_FOUND",
      message: "Route not found",
      request_id: request.id,
    }),
  );
  function post(
    path: string,
    work: (
      r: Request,
      who: Identity,
      client: PoolClient,
    ) => Promise<ResponseData>,
    onboarding = false,
  ): void {
    app.post<Route>(path, async (request, reply) => {
      const who = onboarding
        ? { caller: "onboarding", userId: null, admin: false }
        : await identity(request);
      const header = request.headers["idempotency-key"];
      const result = await idempotent(
        pool,
        who,
        typeof header === "string" ? header : undefined,
        request.url,
        request.body ?? null,
        request.id,
        async (client) => {
          const response = await work(request, who, client);
          return response;
        },
        request.routeOptions.url === "/admin/reconciliation/run"
          ? "REPEATABLE READ"
          : "READ COMMITTED",
      );
      return reply
        .code(result.code)
        .type("application/json")
        .send(
          typeof result.body === "string"
            ? result.body
            : JSON.stringify(result.body),
        );
    });
  }

  const context = { app, pool, provider, identity, post };
  registerWalletsRoutes(context);
  registerTransfersRoutes(context);
  registerRiskRoutes(context);
  registerStatementsRoutes(context);
  registerReconciliationRoutes(context);
  return app;
}
