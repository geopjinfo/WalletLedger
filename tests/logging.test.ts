import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { z } from "zod";

test("request logs correlate concurrent failures without exposing input or errors", () => {
  const script = `
    import { buildApp } from './src/app.ts';
    import { createPool } from './src/database/pool.ts';
    import { MockProvider } from './src/modules/statements/provider.ts';
    import { logger } from './src/shared/logger.ts';
    const pool = createPool('postgres://unused:unused@127.0.0.1:1/unused');
    const app = buildApp({ ADMIN_TOKEN: 'private-admin-value', DATABASE_URL: '', PORT: 3000, LOG_LEVEL: 'info', RECONCILIATION_HOUR_UTC: 0, LLM_MODEL: '' }, pool, new MockProvider());
    app.get('/logging-test', async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      logger.info('test.awaited');
      throw new Error('private-error-value');
    });
    await Promise.all([1, 2].map(() => app.inject({ method: 'GET', url: '/logging-test?token=private-query-value', headers: { authorization: 'Bearer private-header-value', 'x-request-id': 'private-client-id' } })));
    await app.inject({ method: 'POST', url: '/users', headers: { 'content-type': 'application/json' }, payload: '{"note":"private-body-value",' });
    await app.inject({ method: 'GET', url: '/private-path-value' });
    await app.close();
    await pool.end();
  `;
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { encoding: "utf8" });
  assert.doesNotMatch(output, /private-/);
  const records = output.trim().split("\n").map((line) => z.object({
    event: z.string(), request_id: z.string().optional(), route: z.string().optional(), status_code: z.number().optional(),
  }).parse(JSON.parse(line)));
  const requests = records.filter((record) => record.event === "request.started");
  assert.equal(requests.length, 4);
  assert.equal(new Set(requests.map((record) => record.request_id)).size, 4);
  for (const start of requests) {
    assert.ok(records.some((record) => record.event === "request.completed" && record.request_id === start.request_id));
    if (start.route === "/logging-test") {
      assert.ok(records.some((record) => record.event === "test.awaited" && record.request_id === start.request_id));
    }
  }
  assert.deepEqual(records.filter((record) => record.event === "request.completed").map((record) => record.status_code).sort(), [400, 404, 500, 500]);
});
