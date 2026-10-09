CREATE FUNCTION verify_entry_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE computed NUMERIC; stored BIGINT; source BIGINT; destination BIGINT;
BEGIN
 SELECT source_account_id,destination_account_id INTO source,destination FROM transfers WHERE id=NEW.transfer_id;
 IF (NEW.direction='debit' AND NEW.account_id<>source) OR
    (NEW.direction='credit' AND NEW.account_id<>destination) THEN
  RAISE EXCEPTION 'Ledger direction does not match transfer accounts' USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount ELSE -amount END),0)
 INTO computed FROM ledger_entries WHERE account_id=NEW.account_id;
 SELECT balance INTO stored FROM accounts WHERE id=NEW.account_id;
 IF computed<>stored THEN RAISE EXCEPTION 'Ledger account does not match stored balance' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER entries_account_consistent AFTER INSERT ON ledger_entries
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_entry_account();
