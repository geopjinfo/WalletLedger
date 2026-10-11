import type { PoolClient } from "pg";
export const riskQueries = {
  velocity:
    "SELECT count(*) FROM transfers WHERE source_account_id=$1 AND status IN ('posted','reversed') AND created_at > statement_timestamp()-make_interval(secs => $2)",
  amount_spike:
    "SELECT COALESCE($2::numeric > avg(amount)*$3::numeric,false) AS fires FROM transfers WHERE source_account_id=$1 AND status IN ('posted','reversed') AND created_at > statement_timestamp()-make_interval(secs => $4)",
  new_payee:
    "SELECT EXISTS(SELECT 1 FROM transfers WHERE source_account_id=$1 AND destination_account_id=$2 AND status IN ('posted','reversed')) AS seen",
} as const;
export interface RiskMatch {
  ruleId: string;
  name: string;
  action: "hold" | "flag";
  threshold: string;
}
interface Rule {
  id: string;
  name: string;
  action: "hold" | "flag";
  threshold: string;
  window_second: number;
}
export async function checkRisk(
  client: PoolClient,
  source: string,
  destination: string,
  amount: number,
): Promise<RiskMatch[]> {
  const rules = await client.query<Rule>(
    "SELECT * FROM risk_rules WHERE enabled ORDER BY id",
  );
  const matches: RiskMatch[] = [];
  for (const rule of rules.rows) {
    let fires = false;
    if (rule.name === "velocity") {
      const row = await client.query<{ count: string }>(riskQueries.velocity, [
        source,
        rule.window_second,
      ]);
      fires = BigInt(row.rows[0]?.count ?? "0") + 1n > BigInt(rule.threshold);
    } else if (rule.name === "amount_spike") {
      const row = await client.query<{ fires: boolean }>(
        riskQueries.amount_spike,
        [source, amount, rule.threshold, rule.window_second],
      );
      fires = row.rows[0]?.fires ?? false;
    } else if (rule.name === "new_payee") {
      const row = await client.query<{ seen: boolean }>(riskQueries.new_payee, [
        source,
        destination,
      ]);
      fires = !row.rows[0]?.seen && BigInt(amount) > BigInt(rule.threshold);
    }
    if (fires)
      matches.push({
        ruleId: rule.id,
        name: rule.name,
        action: rule.action,
        threshold: rule.threshold,
      });
  }
  return matches;
}
