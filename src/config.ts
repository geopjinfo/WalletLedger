import { z } from "zod";
const settings = z.object({
  DATABASE_URL: z.url(),
  ADMIN_TOKEN: z.string().min(12),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  RECONCILIATION_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(0),
  LLM_BASE_URL: z.url().optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).default(""),
});
export type Config = z.infer<typeof settings>;
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
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
    throw new Error(
      "Invalid environment: DATABASE_URL, ADMIN_TOKEN, PORT or scheduler/LLM settings",
    );
  if (
    result.data.LLM_BASE_URL &&
    (!result.data.LLM_API_KEY || !result.data.LLM_MODEL)
  ) {
    throw new Error("LLM_API_KEY and LLM_MODEL are required with LLM_BASE_URL");
  }
  return result.data;
}
