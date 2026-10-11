CREATE FUNCTION protect_posted_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('posted','reversed') AND
 (NEW.amount,NEW.source_account_id,NEW.destination_account_id,NEW.type,NEW.original_transfer_id)
 IS DISTINCT FROM
 (OLD.amount,OLD.source_account_id,OLD.destination_account_id,OLD.type,OLD.original_transfer_id) THEN
  RAISE EXCEPTION 'Posted transfer money fields are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER transfers_money_immutable BEFORE UPDATE ON transfers FOR EACH ROW EXECUTE FUNCTION protect_posted_transfer();
CREATE FUNCTION verify_account_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE computed NUMERIC; stored BIGINT;
BEGIN
 SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount ELSE -amount END),0)
 INTO computed FROM ledger_entries WHERE account_id=NEW.id;
 SELECT balance INTO stored FROM accounts WHERE id=NEW.id;
 IF computed <> stored THEN RAISE EXCEPTION 'Account balance does not match ledger' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER accounts_balance_consistent AFTER INSERT OR UPDATE ON accounts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_account_balance();
