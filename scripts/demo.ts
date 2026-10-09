import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Json } from "../src/shared/types.js";

const base = process.env["DEMO_BASE_URL"] ?? "http://localhost:18080";
const admin = process.env["ADMIN_TOKEN"];
if (!admin) throw new Error("ADMIN_TOKEN is required for the demo");
const userSchema = z.object({ id: z.string(), token: z.string() });
const walletSchema = z.object({ id: z.string() });
const transferSchema = z.object({ id: z.string(), status: z.string() });

async function post(path: string, body: Json, token?: string, key = randomUUID()) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return { status: response.status, text };
}
async function get(path: string, token: string): Promise<string> {
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.text();
}
async function person(name: string) {
  const suffix = randomUUID();
  const response = await post("/users", {
    name,
    email: `${suffix}@example.test`,
    phone: String(randomInt(10000000000000, 99999999999999)),
  });
  const user = userSchema.parse(JSON.parse(response.text));
  const wallet = walletSchema.parse(JSON.parse((await post(
    `/users/${user.id}/wallets`, { name: "Main" }, user.token,
  )).text));
  return { ...user, wallet: wallet.id };
}
function show(title: string, text: string): void {
  console.log(`\n## ${title}\n\n${text}`);
}

const suffix = randomUUID().slice(0, 8);
const sender = await person(`Asha ${suffix}`);
const recipient = await person(`Rahul ${suffix}`);
const topup = await post("/transfers/topup", { wallet_id: sender.wallet, amount: 100000 }, sender.token);
const funding = transferSchema.parse(JSON.parse(topup.text));
if (funding.status === "held") await post(`/admin/risk/${funding.id}/decision`, { decision: "release" }, admin);
show("Setup", `Created two users and wallets; funded sender with 100000 paise.\nWallet IDs: ${sender.wallet}, ${recipient.wallet}. Tokens are omitted.`);
const key = randomUUID();
const body = { source_account_id: sender.wallet, destination_account_id: recipient.wallet, amount: 1000, note: "Lunch" };
const first = await post("/transfers", body, sender.token, key);
const transfer = transferSchema.parse(JSON.parse(first.text));
if (first.status !== 201) throw new Error("Expected posted peer transfer");
show("Transfer", `POST /transfers\n${JSON.stringify(body)}\nHTTP ${first.status}\n${first.text}`);
show("Ledger and audit", await get(`/transfers/${transfer.id}`, sender.token));
const retry = await post("/transfers", body, sender.token, key);
if (retry.status !== first.status || retry.text !== first.text) throw new Error("Retry did not replay exactly");
show("Retry", `Same UUID key and body: HTTP ${retry.status}. Byte-for-byte response equal: true.\n${retry.text}`);
let held = "";
for (let i = 0; i < 5; i++) {
  const next = await post("/transfers", body, sender.token);
  const data = transferSchema.parse(JSON.parse(next.text));
  if (data.status === "held") {
    held = data.id;
    show("Held transfer", `Sixth outgoing request: HTTP ${next.status}\n${await get(`/transfers/${held}`, sender.token)}`);
    break;
  }
}
if (!held) throw new Error("Velocity rule did not hold the sixth request");
show("Admin decision", (await post(`/admin/risk/${held}/decision`, { decision: "release" }, admin)).text);
show("Reconciliation", (await post("/admin/reconciliation/run", {}, admin)).text);
const day = new Date().toISOString().slice(0, 10);
const question = `sent to Rahul ${suffix} from ${day} to ${day}`;
const answer = await post(`/users/${sender.id}/statement/ask`, { question }, sender.token);
if (z.object({ value: z.string() }).parse(JSON.parse(answer.text)).value !== "6000") throw new Error("Unexpected statement total");
show("Statement question", `${question}\n${answer.text}\nExpected: 6000 paise across six posted peer transfers.`);
show("Balances", `Sender: ${await get(`/wallets/${sender.wallet}/balance`, sender.token)}\nRecipient: ${await get(`/wallets/${recipient.wallet}/balance`, recipient.token)}`);
