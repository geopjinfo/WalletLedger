# API contract

Docker base URL: `http://localhost:18080` (override with `API_PORT`). A local Node process defaults to port 3000. JSON requests use `Content-Type: application/json`. All POST requests require `Idempotency-Key: <UUID>`. Except user creation, send `Authorization: Bearer <user-token>` or the admin token as appropriate. IDs are decimal strings; request amounts are integer paise; response amounts/balances are decimal strings.

| Method and path | Request | Result |
| --- | --- | --- |
| POST /users | name, email, phone | 201: id, contact fields, kyc_status, token |
| POST /users/{id}/wallets | name | 201: id, name, balance, currency |
| GET /wallets/{id}/balance | No body | 200: id, balance, currency |
| GET /wallets/{id}/statement | limit=20, offset=0 | 200: entries, limit, offset |
| POST /transfers/topup | wallet_id, amount, optional note | 201 posted or 202 held: transfer |
| POST /transfers | source_account_id, destination_account_id, amount, optional note | 201 posted or 202 held: transfer |
| POST /transfers/withdraw | wallet_id, amount, optional note | 201 posted or 202 held: transfer |
| POST /transfers/{id}/reverse | Empty object | 201 posted or 202 held: reversal linked to original |
| GET /transfers/{id} | No body | 200: transfer, entries, history |
| POST /admin/reconciliation/run | Empty object | 202: run ID, status, issue_count, checks |
| GET /admin/reconciliation/runs/{id} | No body | 200: run, complete check results, root issues |
| GET /admin/risk/queue | limit=20, offset=0 | 200: held or flagged transfers |
| POST /admin/risk/{transfer_id}/decision | decision: release or reject | 200: updated transfer |
| POST /users/{id}/statement/ask | question | 200: type, value, unit, transfer_ids, from, to |

Statement entries are ordered by created_at DESC, id DESC. Limit is 1-100 and offset is 0-1,000,000. Transfer responses include id, source_account_id, destination_account_id, type, status, amount, note, original_transfer_id, and created_at. KYC starts pending; verification is outside the assignment API.

Example:

```json
{"source_account_id":"4","destination_account_id":"5","amount":1000,"note":"Lunch"}
```

Errors share `{"code":"INSUFFICIENT_FUNDS","message":"Insufficient funds","request_id":"req-1"}`. Missing/invalid keys or bodies return 400; missing/invalid identity 401; ownership/admin failures 403; absent records 404; processing requests, duplicates, or transaction conflicts 409; mismatched request keys, insufficient funds, invalid operations, or unsupported questions 422. Infrastructure failures return 500 without database details. Saved rejections replay their original request ID.

The default mock accepts these templates with explicit dates:

- `sent to Rahul from 2026-08-01 to 2026-08-31`
- `received from 2026-08-01 to 2026-08-31`
- `largest transfer from 2026-08-01 to 2026-08-31`
- `number of transfers from 2026-08-01 to 2026-08-31`

A configured provider can interpret other phrasing into those four validated question types. No generated SQL is executed. Unsupported or invalid date questions return 422. Values come from database rows; returned IDs identify the contributing events.

Admin rejection is used for held transfers because no money has moved; the brief's wording about reversing a hold is interpreted as cancelling it. Posted transfers use the separate reversal endpoint. Manual reconciliation currently completes the checks before returning its 202 report; it does not require polling to begin execution.
