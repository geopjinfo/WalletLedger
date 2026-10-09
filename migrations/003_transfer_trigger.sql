CREATE OR REPLACE FUNCTION verify_transfer_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target BIGINT; t transfers; count_entry BIGINT; debit NUMERIC; credit NUMERIC;
BEGIN
 IF TG_TABLE_NAME = 'transfers' THEN target := NEW.id; ELSE target := NEW.transfer_id; END IF;
 SELECT * INTO t FROM transfers WHERE id = target;
 SELECT count(*), COALESCE(sum(amount) FILTER (WHERE direction='debit'),0),
 COALESCE(sum(amount) FILTER (WHERE direction='credit'),0) INTO count_entry,debit,credit
 FROM ledger_entries WHERE transfer_id=target;
 IF t.status IN ('posted','reversed') THEN
  IF count_entry < 2 OR debit <> credit OR debit <> t.amount THEN
   RAISE EXCEPTION 'Transfer % is unbalanced',target USING ERRCODE='23514';
  END IF;
 ELSIF count_entry <> 0 THEN
  RAISE EXCEPTION 'Unposted transfer has ledger entries' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
