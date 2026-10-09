import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./database/pool.js";
import { createProvider } from "./modules/statements/provider.js";
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = buildApp(config, pool, createProvider(config));
app.addHook("onClose", async () => pool.end());
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close();
  });
await pool.query("SELECT 1");
await app.listen({ port: config.PORT, host: "0.0.0.0" });
console.log(`Wallet API listening on port ${config.PORT}`);
