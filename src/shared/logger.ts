import { AsyncLocalStorage } from "node:async_hooks";
import { pino } from "pino";

const context = new AsyncLocalStorage<{ request_id: string }>();
const output = pino({
  base: { service: "wallet-ledger" },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: () => ({ message: "Error details omitted" }),
    req: () => undefined,
    res: () => undefined,
  },
  redact: {
    paths: ["authorization", "token", "password", "api_key", "body", "headers", "question", "note"],
    remove: true,
  },
});

interface LogFields {
  component?: string;
  request_id?: string;
  method?: string;
  route?: string;
  status_code?: number;
  duration_ms?: number;
  transfer_id?: string;
  transfer_type?: string;
  status?: string;
  decision?: string;
  rule_ids?: string[];
  run_id?: string;
  check?: string;
  issue_count?: number;
  flag_id?: string;
  count?: number;
  question_type?: number;
  provider_status?: number;
  port?: number;
  error_code?: string;
}

export const logger = {
  setLevel(level: "debug" | "info" | "warn" | "error" | "silent"): void {
    output.level = level;
  },
  info(event: string, fields: LogFields = {}): void {
    output.info({ ...context.getStore(), ...fields, event });
  },
  warn(event: string, fields: LogFields = {}): void {
    output.warn({ ...context.getStore(), ...fields, event });
  },
  error(event: string, fields: LogFields = {}): void {
    output.error({ ...context.getStore(), ...fields, event });
  },
  forRequest(requestId: string, next: () => void): void {
    context.run({ request_id: requestId }, next);
  },
};
