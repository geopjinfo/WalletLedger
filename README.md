# WalletLedger

An INR wallet backend with a double-entry ledger, atomic transfers, client-key retries, reconciliation, fraud rules, and statement questions.

## Run

Requires Docker Compose. Start PostgreSQL 16.13, migrations, API, and worker:

```sh
docker compose up --build
```

The Docker API listens on `http://localhost:18080` (override with `API_PORT`). Compose binds exposed ports to loopback. The supplied database password and admin token are local-development defaults, not deployment secrets.

Run the required tests on disposable fixture data:

```sh
docker compose --profile test run --rm tests
```

This command builds the test image, migrates a separate `wallet_test` database, checks strict types, builds the source, and runs all six scenarios. The test database uses temporary storage and exposes no host port. It does not touch the application's `wallet` database. Stop the test database afterward with `docker compose --profile test stop test-postgres`.

For local Node.js development (Node 22+): `npm ci`, set `DATABASE_URL` and `ADMIN_TOKEN`, then run `npm run migrate`, `npm run build`, and `npm start`. `npm run typecheck` checks the application, scripts, and tests with strict TypeScript options. Application code uses concrete interfaces, unions, runtime schemas, and narrowed error classes, without explicit unrestricted types.

Clone the submission with `git clone https://github.com/geopjinfo/WalletLedger.git`, then `cd WalletLedger`. Run the Docker commands above from that directory. The default provider is a deterministic mock; no API key is needed.

## Reviewer walkthrough

With the API running, execute:

```sh
docker compose exec -e ADMIN_TOKEN=local-admin-change-me -e DEMO_BASE_URL=http://localhost:3000 api npm run demo
```

The walkthrough creates synthetic users, funds a wallet, posts a peer transfer, checks its ledger and audit history, retries the identical request, triggers the sixth-transfer velocity hold, releases it, runs reconciliation, and asks a statement question. It checks exact response replay and the expected 6,000-paise answer. Tokens are omitted from its output. Each run adds its own fixture data; it does not reset the database.

See the [five-minute captioned demo](docs/demo.mp4), [captured responses](docs/demo-transcript.md), [demo guide](docs/demo.md), and [API contract](docs/api.md). The video presents real responses from this walkthrough; it is not a live screen recording and has no narration.

## Configuration

| Setting | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection URL; required |
| ADMIN_TOKEN | Administrator bearer token, at least 12 characters; required for API/worker |
| PORT | API port, defaults to 3000 |
| RECONCILIATION_HOUR_UTC | Nightly hour, 0-23; defaults to midnight UTC (04:00 Dubai) |
| LLM_BASE_URL | Optional OpenAI-compatible chat-completions endpoint |
| LLM_API_KEY, LLM_MODEL | Required when a remote provider is configured |
| ALLOW_TEST_RESET | Must be true to permit destructive test fixtures |
| ALLOW_SEED_RESET | Must be true to permit replacing data with seed fixtures |
| SEED_TRANSFERS | Seed transfer count, defaults to 100,000; range 10,000-1,000,000 |

Missing configuration fails at startup. No listeners or jobs start when `app.ts` is imported. `server.ts` and `worker.ts` are independent process entry points.

## API

See [API contract](docs/api.md) for headers, requests, responses, errors, and pagination.

Creating a user returns an opaque token once (and on an exact onboarding retry). Pass `Authorization: Bearer <token>` thereafter. Only hashes are stored in `users`; saved onboarding responses necessarily contain the issued token, so database access must be restricted. Admin routes require the configured admin token. This is a small caller-identity mechanism for the assignment, not a registration or KYC-verification product.

Every POST requires a UUID `Idempotency-Key`. Keys are unique per user; admin and unauthenticated onboarding use separate namespaces. The canonical body hash includes the request path. A processing request returns 409, a completed request replays its status and body exactly, and reusing a key with a different request returns 422. Validation failures before completion and transient database failures can be retried. Completed business rejections are saved. Response text preserves field order. Keys are not expired, so retries do not lose protection after 24 hours.

## Money and transactions

Routes and services are grouped under `src/modules/` for wallets, transfers, idempotency, risk, reconciliation, and statements. `src/http/` owns request schemas, identity, and route contracts; `src/database/` owns connections, transactions, and migrations. `app.ts` wires these modules together. Type checking also rejects explicit unrestricted type keywords in source, scripts, and tests.

Amounts are positive integer paise up to JavaScript's safe-integer limit. Database IDs and balances are returned as decimal strings to avoid precision loss. All accounts share one table; system accounts have no user and may have negative balances. Currency is constrained to INR. Generated IDs stay stable when contact details change.

Balances are stored for fast spending checks and recomputed from the ledger during reconciliation. Posting locks affected accounts in ascending ID order under Read Committed, re-reads available funds, inserts the transfer and both entries, and updates balances before commit. Deferred triggers check ledger balance and stored balances. Entries cannot be updated, deleted, or truncated. Reversals create new entries linked to the original; only one full reversal is allowed and it requires funds in the debited wallet. A full reversal preserves the original ledger and audits the status change. No partial reversals or fee schedule are added.

Read Committed with row locks avoids stale spending checks without Serializable's extra conflict retries. Deadlock/serialization errors return a retryable 409; clients reuse the same key. See [isolation experiments](docs/isolation.md) for observed behavior and the unsafe lost-update comparison.

## Fraud and reconciliation

Thresholds live in `risk_rules`: more than five outgoing posted transfers in ten minutes holds the next transfer; more than five times the 30-day outgoing average holds it; a first recipient payment above 1,000,000 paise is flagged and allowed. No history means no amount-spike hold. Original posted transfers remain in history after reversal. Windows use database timestamps; the current candidate is included in velocity. Account locks serialize outgoing checks. Rules also run for top-ups, withdrawals, and reversals. System account history therefore participates where applicable. The assignment does not specify exclusions.

Held transfers have no entries. Admin release re-locks accounts, checks funds, and posts once without re-running the rule that caused the hold. Rejecting a hold changes status only. Fees can use the shared posting service with the fee account; no fee endpoint or automatic charge is specified in the brief.

The nightly worker runs reconciliation in Repeatable Read and locks the job row with NOWAIT. It reports, never repairs. All five SQL checks and their findings are saved in the run. Issue rows identify root entry-amount, missing-entry, and stored-balance problems so the three injected corruptions are reported once; dependent mismatches remain in the run's check results. This root grouping assumes the current two-line posting convention. Held/rejected transfers are excluded from missing-entry checks.

Flag explanations run after reconciliation and do not affect money decisions. A remote provider may explain flags; the default mock supports deterministic question templates and explanations. Q&A validates the provider's structured output and runs only application-owned parameterized SQL scoped to the caller. Notes are never instructions. Dates are inclusive UTC days. Transfer counts include top-ups and withdrawals; largest-transfer questions include all original posted events touching the caller. Reversals are excluded from Q&A and original reversed transfers remain as historical events. Recipient names must resolve uniquely among the caller's historical recipients; ambiguous names return 422.

## Fixtures and evidence

Replace the local application data with 1,000 users, 2,000 wallets, and 100,000 transfers:

```sh
docker compose exec -e ALLOW_SEED_RESET=true api npm run seed
```

Seed fixtures use generated contact details and controlled bulk insertion in one transaction. The script temporarily bypasses triggers only in that privileged fixture transaction, then recalculates balances. This mechanism is never exposed by the API.

For the million-entry measurements (also replaces application data):

```sh
docker compose exec -e ALLOW_SEED_RESET=true -e SEED_TRANSFERS=500000 api npm run seed
docker compose exec api npx tsx scripts/performance.ts
```

The schema, lab, and recorded query plans live in `docs/`. Tests combine basic behavior and essential edges into six scenarios, including the 20 stampede runs, exact retries, three corruptions on 10,000 transfers, fraud boundaries, and ten statement examples with injection-resistant caller isolation. CI runs the same checks using the mock provider.

Nightly global totals, stored-balance comparisons, and overdraft checks must inspect the ledger and can afford full scans. Transfer grouping and orphan checks benefit from the transfer foreign-key index; statement and fraud requests need account/time and source/destination indexes because they run on the request path. Deep offset pagination still visits skipped rows, even with the statement index. See [measured query plans](docs/performance.md) for all five checks, OFFSET 100000, and per-rule timings.

## Trade-offs and next steps

Stored balances add writes and consistency checks but avoid summing a wallet's full history on each spend. Shared accounts keep all money movements in one posting model. Email and phone are caller-controlled values with uniqueness constraints; generated IDs provide stable references. Explicit SQL keeps the money transaction and locks visible.

For deployment, use a restricted database role for the API and separate privileged migration/fixture roles, replace the development credentials, and verify the selected remote LLM provider. Cursor pagination would address deep-offset cost. Those changes are outside the required local submission.

The captioned five-minute API demo is included. [Hosted acceptance checks passed](https://github.com/geopjinfo/WalletLedger/actions/runs/37912965222), including strict type checking, build, empty-database migrations and all six test scenarios. Optional cursor pagination, key expiry, caching, rate limiting, and sharding are outside this build.
