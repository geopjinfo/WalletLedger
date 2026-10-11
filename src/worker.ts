import { loadConfig } from "./config.js";
import { logger } from "./shared/logger.js";
import { createPool } from "./database/pool.js";
import { reconcile } from "./modules/reconciliation/service.js";
import { createProvider } from "./modules/statements/provider.js";
import { explainFlags } from "./modules/statements/service.js";
const config = loadConfig();
logger.setLevel(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL);
const provider = createProvider(config);
let stopped = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    stopped = true;
  });
let lastDay = "";
logger.info("worker.started", { component: "worker" });
while (!stopped) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() >= config.RECONCILIATION_HOUR_UTC && day !== lastDay) {
    try {
      logger.info("worker.cycle_started", { component: "worker" });
      await reconcile(pool);
      await explainFlags(pool, provider);
      lastDay = day;
      logger.info("worker.cycle_completed", { component: "worker" });
    } catch {
      logger.error("worker.cycle_failed", { component: "worker" });
    }
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 1000));
}
await pool.end();
logger.info("worker.stopped", { component: "worker" });
