export const reconciliationChecks = {
  global: `SELECT NULL::bigint AS entity_id, COALESCE(sum(amount) FILTER (WHERE direction='debit'),0)::text AS expected,
    COALESCE(sum(amount) FILTER (WHERE direction='credit'),0)::text AS actual FROM ledger_entries
    HAVING COALESCE(sum(amount) FILTER (WHERE direction='debit'),0) <> COALESCE(sum(amount) FILTER (WHERE direction='credit'),0)`,
  transfer: `SELECT transfer_id AS entity_id, COALESCE(sum(amount) FILTER (WHERE direction='debit'),0)::text AS expected,
    COALESCE(sum(amount) FILTER (WHERE direction='credit'),0)::text AS actual FROM ledger_entries GROUP BY transfer_id
    HAVING COALESCE(sum(amount) FILTER (WHERE direction='debit'),0) <> COALESCE(sum(amount) FILTER (WHERE direction='credit'),0)`,
  balance: `SELECT a.id AS entity_id, COALESCE(sum(CASE WHEN l.direction='credit' THEN l.amount ELSE -l.amount END),0)::text AS expected,
    a.balance::text AS actual FROM accounts a LEFT JOIN ledger_entries l ON l.account_id=a.id GROUP BY a.id
    HAVING a.balance <> COALESCE(sum(CASE WHEN l.direction='credit' THEN l.amount ELSE -l.amount END),0)`,
  overdraft: `SELECT a.id AS entity_id,'0'::text AS expected,sum(CASE WHEN l.direction='credit' THEN l.amount ELSE -l.amount END)::text AS actual
    FROM accounts a JOIN ledger_entries l ON l.account_id=a.id WHERE a.kind='wallet' GROUP BY a.id
    HAVING sum(CASE WHEN l.direction='credit' THEN l.amount ELSE -l.amount END)<0`,
  orphan: `SELECT t.id AS entity_id,'ledger entries'::text AS expected,'missing'::text AS actual FROM transfers t
    WHERE t.status IN ('posted','reversed') AND NOT EXISTS(SELECT 1 FROM ledger_entries l WHERE l.transfer_id=t.id)
    UNION ALL SELECT l.id,'transfer','missing' FROM ledger_entries l LEFT JOIN transfers t ON t.id=l.transfer_id WHERE t.id IS NULL`,
} as const;
