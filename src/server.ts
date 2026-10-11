import { buildApp } from "./app.js";
import { logger } from "./shared/logger.js";
import { loadConfig } from "./config.js";
import { createPool } from "./database/pool.js";
import { createProvider } from "./modules/statements/provider.js";
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = buildApp(config, pool, createProvider(config));
app.addHook("onClose", async () => pool.end());
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    logger.info("api.stopping", { component: "api" });
    void app.close().catch(() => {
      logger.error("api.shutdown_failed", { component: "api" });
      process.exitCode = 1;
    });
  });
try {
  await pool.query("SELECT 1");
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info("api.started", { component: "api", port: config.PORT });
} catch {
  logger.error("api.startup_failed", { component: "api" });
  await app.close();
  process.exitCode = 1;
}
