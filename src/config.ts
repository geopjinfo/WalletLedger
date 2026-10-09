import { z } from "zod";
import { existsSync } from "node:fs";
const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ });
const httpUrl = z.url({ protocol: /^https?$/ });
const booleanSetting = z.enum(["true", "false"]).default("false").transform((value) => value === "true");
const databaseSettings = z.object({ DATABASE_URL: databaseUrl });
function readEnvironment(): NodeJS.ProcessEnv {
  if (existsSync(".env")) process.loadEnvFile(".env");
  return process.env;
}
function configurationError(issues: z.ZodError): Error {
  return new Error(`Invalid environment settings: ${issues.issues.map((issue) => issue.path.join(".")).join(", ")}`);
}
export function loadDatabaseConfig(environment: NodeJS.ProcessEnv = readEnvironment()) {
  const result = databaseSettings.safeParse(environment);
  if (!result.success) throw configurationError(result.error);
  return result.data;
}
export function loadSeedConfig(environment: NodeJS.ProcessEnv = readEnvironment()) {
  const result = databaseSettings.extend({
    ALLOW_SEED_RESET: booleanSetting,
    SEED_TRANSFERS: z.coerce.number().int().min(10000).max(1000000).default(100000),
  }).safeParse(environment);
  if (!result.success) throw configurationError(result.error);
  return result.data;
}
export function loadTestConfig(environment: NodeJS.ProcessEnv = readEnvironment()) {
  const result = databaseSettings.extend({
    ALLOW_TEST_RESET: booleanSetting.refine((allowed) => allowed, "Tests require a disposable database and ALLOW_TEST_RESET=true"),
  }).safeParse(environment);
  if (!result.success) throw configurationError(result.error);
  return result.data;
}
export function loadDemoConfig(environment: NodeJS.ProcessEnv = readEnvironment()) {
  const result = z.object({
    ADMIN_TOKEN: z.string().trim().min(12),
    DEMO_BASE_URL: httpUrl.default("http://localhost:18080"),
  }).safeParse(environment);
  if (!result.success) throw configurationError(result.error);
  return result.data;
}
const settings = z.object({
  DATABASE_URL: databaseUrl,
  ADMIN_TOKEN: z.string().trim().min(12),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  RECONCILIATION_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(0),
  LLM_BASE_URL: httpUrl.optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).default(""),
}).superRefine((value, context) => {
  if (!value.LLM_BASE_URL) return;
  if (!value.LLM_API_KEY) context.addIssue({ code: "custom", path: ["LLM_API_KEY"], message: "Required for a remote provider" });
  if (!value.LLM_MODEL) context.addIssue({ code: "custom", path: ["LLM_MODEL"], message: "Required for a remote provider" });
});
export type Config = z.infer<typeof settings>;
export function loadConfig(environment: NodeJS.ProcessEnv = readEnvironment()): Config {
  const openRouterKey = environment["OPENROUTER_API_KEY"]?.trim() || undefined;
  const endpoint =
    environment["LLM_BASE_URL"]?.trim() ||
    (openRouterKey ? "https://openrouter.ai/api/v1/chat/completions" : undefined);
  const result = settings.safeParse({
    ...environment,
    LLM_BASE_URL: endpoint,
    LLM_API_KEY: environment["LLM_API_KEY"]?.trim() || openRouterKey,
    LLM_MODEL:
      environment["LLM_MODEL"]?.trim() ||
      (endpoint === "https://openrouter.ai/api/v1/chat/completions"
        ? "google/gemma-4-26b-a4b-it:free"
        : undefined),
  });
  if (!result.success)
    throw configurationError(result.error);
  return result.data;
}
