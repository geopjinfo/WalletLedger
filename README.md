# WalletLedger

An INR wallet backend with a double-entry ledger, atomic transfers, client-key retries, reconciliation, fraud rules, and statement questions.

## Run

Docker Compose starts PostgreSQL 16.13, migrations, API, and worker:

`.env.example` lists all settings and local defaults. To customize, copy it to `.env`: `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`). Otherwise, Compose defaults suffice.

```sh
docker compose up --build
```

The API listens on `http://127.0.0.1:18080` (`API_PORT` overrides). Exposed ports bind to loopback; the supplied database password and admin token are local-development defaults, not deployment secrets.

Run the required tests on disposable fixture data:

```sh
docker compose --profile test run --rm tests
```

This builds the test image, migrates a separate `wallet_test` database, checks strict types, builds source, and runs all six scenarios. Temporary storage and no host port isolate it from the application's `wallet` database. Afterward: `docker compose --profile test stop test-postgres`.

For Node 22+ development: `npm ci`, set `DATABASE_URL` and `ADMIN_TOKEN`, then `npm run migrate`, `npm run build`, and `npm start`. `npm run typecheck` applies strict TypeScript checks to application, scripts, and tests. Application code uses concrete interfaces, unions, runtime schemas, and narrowed error classes without explicit unrestricted types.

Clone: `git clone https://github.com/geopjinfo/WalletLedger.git`, then `cd WalletLedger` and run the Docker commands above. The default deterministic mock needs no API key.

## Reviewer walkthrough

With the API running, execute:

```sh
docker compose exec -e ADMIN_TOKEN=local-admin-change-me -e DEMO_BASE_URL=http://localhost:3000 api npm run demo
```

The walkthrough creates synthetic users, funds a wallet, posts a peer transfer, checks ledger/audit history, retries the request, triggers and releases the sixth-transfer velocity hold, reconciles, and asks a statement question. It verifies exact response replay and the 6,000-paise answer, omits tokens, and adds fixtures without resetting the database.

See the [five-minute captioned demo](docs/demo.mp4), [demo guide](docs/demo.md), and [API contract](docs/api.md). The video shows real walkthrough responses, without live screen recording or narration.

## Logs

API and worker emit Pino JSON to stdout. Follow with:

```sh
docker compose logs -f --tail=100 api worker
```

Generated `request_id` values also appear in the `x-request-id` header. Events include route templates, status, duration, retries, fraud rule/transfer IDs, commits/rollbacks, reconciliation check counts, and worker/provider outcomes. `transfer.prepared` and `reconciliation.prepared` indicate open transactions; `transaction.committed` confirms persistence.

Logs omit headers, bodies, tokens, payment notes, questions, names, balances, amounts, provider content, and raw errors. Codes identify expected failures; request IDs propagate through async calls to distinguish concurrent requests.

`LOG_LEVEL` defaults to `info`; `warn`/`error` reduce output and `silent` disables it. Recreate containers after configuration changes.

## Configuration

| Setting | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection URL; required |
| ADMIN_TOKEN | Administrator bearer token, at least 12 characters; required for API/worker |
| PORT | API port, defaults to 3000 |
| LOG_LEVEL | debug, info, warn, error or silent; defaults to info |
| API_PORT, POSTGRES_PORT | Docker host ports, defaults to 18080 and 5433 |
| RECONCILIATION_HOUR_UTC | Nightly hour, 0-23; defaults to midnight UTC (04:00 Dubai) |
| OPENROUTER_API_KEY | Enables OpenRouter with the default free model; optional |
| LLM_BASE_URL | Optional full chat-completions endpoint override |
| LLM_API_KEY | Optional key override; takes precedence over OPENROUTER_API_KEY |
| LLM_MODEL | Optional model override; OpenRouter defaults to apodex/apodex-1.1-mini:free |
| ALLOW_TEST_RESET | Must be true to permit destructive test fixtures |
| ALLOW_SEED_RESET | Must be true to permit replacing data with seed fixtures |
| SEED_TRANSFERS | Seed transfer count, defaults to 100,000; range 10,000-1,000,000 |
| DEMO_BASE_URL | Walkthrough API URL, defaults to http://127.0.0.1:18080 |

Missing configuration fails startup. Importing `app.ts` starts no listeners/jobs; `server.ts` and `worker.ts` are independent entry points.

### OpenRouter

Copy `.env.example` to root `.env` and set:

```dotenv
OPENROUTER_API_KEY=your-key-here
```

Rebuild/recreate API and worker to pass the setting to both:

```sh
docker compose up --build -d api worker
```

With a key, defaults are `https://openrouter.ai/api/v1/chat/completions` and `apodex/apodex-1.1-mini:free`. The released model currently supports JSON; availability/free-tier limits may change ([model details](https://openrouter.ai/apodex/apodex-1.1-mini:free)). Requests require parameter support, enforce zero prompt/completion prices, and allow no paid fallback. Reasoning is disabled; output is capped at 1,024 tokens and application-validated. Timeout: 45 seconds. Provider errors/rate limits return `LLM_UNAVAILABLE` (503); flag explanations stay pending for a later worker run.

Without a key or explicit remote settings, the deterministic mock is active; isolated tests always mock responses. Live Apodex inference was verified on 9 October 2026 ([manual verification](docs/verification.md)). `.env` is excluded from Git/Docker builds. Central config uses Node's built-in `.env` loader, with exported variables taking precedence. Zod validates API, worker, migration, fixture, and demo settings before use; errors expose field names only.

The template's `DATABASE_URL` uses localhost for Node; Compose uses internal PostgreSQL. `PORT` serves local Node; `API_PORT`/`POSTGRES_PORT` select Docker host ports. Reset flags accept only `true`/`false`, defaulting to false; isolated Docker tests enable their own reset flag.

Change `LLM_MODEL` to another compatible `:free` model, or set all three generic LLM settings for another provider. Q&A sends the question/current UTC date; flag explanations send rule details and the last ten transfers with notes. Only application-owned SQL computes statement answers.

## API

See [API contract](docs/api.md) for headers, requests, responses, errors, and pagination.

User creation returns an opaque token once, replayed on exact onboarding retries. Then use `Authorization: Bearer <token>`. `users` stores only hashes, but saved onboarding responses contain tokens: restrict database access. Admin routes require the configured admin token. This assignment's caller-identity mechanism is not a registration/KYC product.

Every POST requires a UUID `Idempotency-Key`, unique per user; admin and unauthenticated onboarding have separate namespaces. The canonical body hash includes the path. Processing returns 409; completion replays exact status/body, preserving field order; changed requests return 422. Pre-completion validation and transient database failures are retryable; completed business rejections are saved. Keys never expire, retaining protection beyond 24 hours.

## Money and transactions

`src/modules/` groups wallet, transfer, idempotency, risk, reconciliation, and statement routes/services. `src/http/` owns schemas, identity, and route contracts; `src/database/` owns connections, transactions, and migrations; `app.ts` wires them together. Type checking rejects explicit unrestricted type keywords in source, scripts, and tests.

Amounts are positive integer paise within JavaScript's safe-integer limit. IDs/balances return as decimal strings to preserve precision. One table holds all INR accounts; system accounts have no user and may be negative. Generated IDs survive contact changes.

Stored balances enable fast spending checks; reconciliation recomputes them from the ledger. Posting uses Read Committed, locks accounts by ascending ID, re-reads funds, inserts the transfer/both entries, and updates balances before commit. Deferred triggers check ledger/stored balances. Entries forbid updates, deletion, and truncation. One full reversal is allowed with sufficient funds in the debited wallet: new entries link to the original, preserving its ledger and auditing the status change. No partial reversals or fee schedule.

Read Committed row locks prevent stale spending checks without Serializable's extra conflict retries. Deadlock/serialization errors return retryable 409s; reuse the key. [Isolation experiments](docs/isolation.md) show behavior and an unsafe lost-update comparison.

## Fraud and reconciliation

Thresholds live in `risk_rules`: more than five outgoing posted transfers in ten minutes holds the next transfer; more than five times the 30-day outgoing average holds it; a first recipient payment above 1,000,000 paise is flagged and allowed. No history means no amount-spike hold. Original posted transfers remain in history after reversal. Windows use database timestamps; the current candidate is included in velocity. Account locks serialize outgoing checks. Rules also run for top-ups, withdrawals, and reversals. System account history therefore participates where applicable. The assignment does not specify exclusions.

Holds have no entries. Admin release re-locks accounts, checks funds, and posts once without re-running the triggering rule; rejection changes only status. Fees can use shared posting with the fee account; the brief specifies no fee endpoint or automatic charge.

Nightly reconciliation uses Repeatable Read and a NOWAIT job-row lock, reporting without repairs. Runs save all five SQL checks/findings. Issue rows group root entry-amount, missing-entry, and stored-balance problems, reporting each of the three injected corruptions once; dependent mismatches remain in check results. Grouping assumes two-line postings. Missing-entry checks exclude held/rejected transfers.

Post-reconciliation flag explanations never affect money decisions. Remote providers may explain flags; the default mock supports deterministic question templates/explanations. Q&A validates structured output and uses only caller-scoped, application-owned parameterized SQL. Notes are never instructions; dates are inclusive UTC days. Counts include top-ups/withdrawals; largest-transfer questions cover all original posted events touching the caller. Q&A excludes reversals but retains reversed originals as history. Recipient names must resolve uniquely within caller history; ambiguity returns 422.

## Fixtures and evidence

Replace the local application data with 1,000 users, 2,000 wallets, and 100,000 transfers:

```sh
docker compose exec -e ALLOW_SEED_RESET=true api npm run seed
```

Seeds use generated contacts and controlled bulk insertion in one privileged transaction, temporarily bypassing triggers before recalculating balances. The API never exposes this mechanism.

For the million-entry measurements (also replaces application data):

```sh
docker compose exec -e ALLOW_SEED_RESET=true -e SEED_TRANSFERS=500000 api npm run seed
docker compose exec api npx tsx scripts/performance.ts
```

`docs/` contains the schema, lab, and query plans. Six test scenarios cover basics/edges: 20 stampede runs, exact retries, three corruptions on 10,000 transfers, fraud boundaries, and ten statement examples with injection-resistant caller isolation. CI runs the same mock-provider checks.

Nightly global totals, stored-balance comparisons, and overdraft checks inspect the ledger via affordable full scans. Transfer grouping/orphan checks benefit from the transfer foreign-key index; request-path statement/fraud queries need account/time and source/destination indexes. Deep offsets visit skipped rows even with the statement index. [Measured query plans](docs/performance.md) cover all five checks, OFFSET 100000, and per-rule timings.

## Trade-offs and next steps

Stored balances add writes/consistency checks but avoid summing history per spend. Shared accounts unify money movements; explicit SQL exposes transactions/locks. Caller-controlled email/phone have uniqueness constraints; generated IDs provide stable references.

Deployment needs a restricted API database role, separate privileged migration/fixture roles, replacement development credentials, and verification of the remote LLM provider. Cursor pagination addresses deep-offset cost.

