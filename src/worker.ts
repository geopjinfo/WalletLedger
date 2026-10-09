import { loadConfig } from "./config.js";
import { createPool } from "./database/pool.js";
import { reconcile } from "./modules/reconciliation/service.js";
import { createProvider } from "./modules/statements/provider.js";
import { explainFlags } from "./modules/statements/service.js";
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const provider = createProvider(config);
let stopped = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    stopped = true;
  });
let lastDay = "";
while (!stopped) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() >= config.RECONCILIATION_HOUR_UTC && day !== lastDay) {
    try {
      await reconcile(pool);
      await explainFlags(pool, provider);
      lastDay = day;
    } catch {
      console.error("Nightly run failed; retrying on the next check");
    }
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 1000));
}
await pool.end();
