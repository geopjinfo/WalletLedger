# Run the demo

Use Node.js 22 or later and Docker Compose. Run these commands from the repository root.

1. If `.env` does not exist, copy `.env.example` to `.env`. Set `OPENROUTER_API_KEY` for live Q&A; leave it blank to use the mock. `DEMO_BASE_URL` must match the API port, and `ADMIN_TOKEN` must match the running API.
2. Start the services and install the local dependencies:

   ```sh
   docker compose up -d --build
   docker compose ps
   npm ci
   ```

   Wait until the API and worker are running. Migrations run automatically before they start.

3. Run the walkthrough:

   ```sh
   npm run demo
   ```

   For recording, pause after each result with:

   ```sh
   npm run demo:step
   ```

   Setup runs first. Each result stays visible; press Enter to execute the next step. Do not pipe this command through PowerShell. Finish the payments within ten minutes so the velocity hold triggers.

   To see the API and worker events while stepping, open a second terminal:

   ```sh
   docker compose logs -f --tail=20 api worker
   ```

   Backend events appear in that terminal. The demo terminal shows requests and results. Keep `LOG_LEVEL=info` in `.env`; recreate the containers after changing it.

The output follows this sequence:

| Step | What happens |
| --- | --- |
| Setup | Creates fresh Asha and Rahul users and wallets; funds Asha with 100,000 paise. |
| Transfer | Sends 1,000 paise to Rahul and displays the posted transfer, balanced ledger entries and audit record. |
| Retry | Repeats the same body and idempotency key; checks that the response is identical without another payment. |
| Held transfer | Sends more payments until the sixth outgoing payment triggers the velocity rule. The held transfer has no ledger entries. |
| Admin decision | Releases the held transfer so it posts. |
| Reconciliation | Runs the checks immediately; a healthy database reports zero issues. |
| Statement question | Asks how much Asha sent Rahul during the current UTC date. Checks the answer is 6,000 paise across six transfers. |
| Balances | Displays 94,000 paise for Asha and 6,000 paise for Rahul. |

Each run creates new users and retains existing data. No seed or database reset is needed. A failed request or an unexpected retry, hold or Q&A result stops the walkthrough with an error.
