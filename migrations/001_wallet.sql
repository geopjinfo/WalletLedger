CREATE TABLE users (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name VARCHAR(120) NOT NULL CHECK (length(trim(name)) > 0),
 email VARCHAR(254) NOT NULL UNIQUE,
 phone VARCHAR(24) NOT NULL UNIQUE,
 kyc_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending','verified','rejected')),
 token_hash CHAR(64) NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE accounts (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id BIGINT REFERENCES users(id),
 name VARCHAR(120) NOT NULL CHECK (length(trim(name)) > 0),
 kind VARCHAR(16) NOT NULL CHECK (kind IN ('wallet','cash_in','cash_out','fee_revenue')),
 currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
 balance BIGINT NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK ((kind = 'wallet' AND user_id IS NOT NULL AND balance >= 0) OR (kind <> 'wallet' AND user_id IS NULL))
);
CREATE UNIQUE INDEX accounts_system_kind ON accounts(kind) WHERE user_id IS NULL;
CREATE INDEX accounts_user ON accounts(user_id);
CREATE TABLE transfers (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source_account_id BIGINT NOT NULL REFERENCES accounts(id),
 destination_account_id BIGINT NOT NULL REFERENCES accounts(id),
 type VARCHAR(16) NOT NULL CHECK (type IN ('topup','peer','withdrawal','fee','reversal')),
 status VARCHAR(16) NOT NULL CHECK (status IN ('held','posted','rejected','reversed')),
 amount BIGINT NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
 note VARCHAR(500) NOT NULL DEFAULT '',
 original_transfer_id BIGINT UNIQUE REFERENCES transfers(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK (source_account_id <> destination_account_id),
 CHECK ((type = 'reversal') = (original_transfer_id IS NOT NULL))
);
CREATE INDEX transfers_outgoing ON transfers(source_account_id, created_at DESC) WHERE status IN ('posted','reversed');
CREATE INDEX transfers_recipient ON transfers(source_account_id,destination_account_id) WHERE status IN ('posted','reversed');
CREATE TABLE ledger_entries (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 transfer_id BIGINT NOT NULL REFERENCES transfers(id),
 account_id BIGINT NOT NULL REFERENCES accounts(id),
 direction VARCHAR(6) NOT NULL CHECK (direction IN ('debit','credit')),
 amount BIGINT NOT NULL CHECK (amount > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (transfer_id,account_id,direction)
);
CREATE INDEX ledger_entries_statement ON ledger_entries(account_id,created_at DESC,id DESC);
CREATE TABLE transfer_status_history (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 transfer_id BIGINT NOT NULL REFERENCES transfers(id),
 previous_status VARCHAR(16),
 status VARCHAR(16) NOT NULL,
 actor VARCHAR(100) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX transfer_status_history_transfer ON transfer_status_history(transfer_id,id);
CREATE TABLE idempotency_keys (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id BIGINT REFERENCES users(id),
 caller VARCHAR(100) NOT NULL,
 key UUID NOT NULL,
 request_hash CHAR(64) NOT NULL,
 status VARCHAR(16) NOT NULL CHECK (status IN ('processing','completed')),
 response_code INTEGER,
 response_body TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (user_id,key), UNIQUE (caller,key),
 CHECK ((status = 'processing' AND response_code IS NULL AND response_body IS NULL) OR
        (status = 'completed' AND response_code BETWEEN 200 AND 599 AND response_body IS NOT NULL))
);
CREATE TABLE risk_rules (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name VARCHAR(32) NOT NULL UNIQUE CHECK (name IN ('velocity','amount_spike','new_payee')),
 threshold BIGINT NOT NULL CHECK (threshold > 0),
 window_second INTEGER NOT NULL CHECK (window_second > 0),
 action VARCHAR(8) NOT NULL CHECK (action IN ('hold','flag')),
 enabled BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE risk_flags (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 transfer_id BIGINT NOT NULL REFERENCES transfers(id),
 rule_id BIGINT NOT NULL REFERENCES risk_rules(id),
 detail JSONB NOT NULL,
 explanation TEXT,
 label VARCHAR(16) CHECK (label IN ('likely_ok','review','likely_fraud')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (transfer_id,rule_id)
);
CREATE INDEX risk_flags_pending ON risk_flags(created_at) WHERE explanation IS NULL;
CREATE TABLE reconciliation_runs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 ended_at TIMESTAMPTZ,
 status VARCHAR(16) NOT NULL CHECK (status IN ('running','passed','failed')),
 issue_count INTEGER NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
 check_result JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE reconciliation_issues (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id BIGINT NOT NULL REFERENCES reconciliation_runs(id),
 check_name VARCHAR(40) NOT NULL,
 entity_id BIGINT,
 expected TEXT NOT NULL,
 actual TEXT NOT NULL
);
CREATE INDEX reconciliation_issues_run ON reconciliation_issues(run_id);
CREATE TABLE job_locks (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name VARCHAR(40) NOT NULL UNIQUE
);
INSERT INTO job_locks(name) VALUES ('reconciliation');
INSERT INTO accounts(name,kind) VALUES ('Cash in','cash_in'),('Cash out','cash_out'),('Fee revenue','fee_revenue');
INSERT INTO risk_rules(name,threshold,window_second,action) VALUES
 ('velocity',5,600,'hold'),('amount_spike',5,2592000,'hold'),('new_payee',1000000,1,'flag');

CREATE FUNCTION reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Ledger entries are immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON ledger_entries
 FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();

CREATE FUNCTION verify_transfer_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE CONSTRAINT TRIGGER transfers_balanced AFTER INSERT OR UPDATE ON transfers
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_transfer_ledger();
CREATE CONSTRAINT TRIGGER entries_balanced AFTER INSERT ON ledger_entries
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_transfer_ledger();

CREATE FUNCTION audit_transfer_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  INSERT INTO transfer_status_history(transfer_id,status,actor)
  VALUES(NEW.id,NEW.status,COALESCE(NULLIF(current_setting('wallet.actor',true),''),'database'));
 ELSIF OLD.status <> NEW.status THEN
  IF NOT ((OLD.status='held' AND NEW.status IN ('posted','rejected')) OR
          (OLD.status='posted' AND NEW.status='reversed')) THEN
   RAISE EXCEPTION 'Invalid status transition' USING ERRCODE='23514';
  END IF;
  INSERT INTO transfer_status_history(transfer_id,previous_status,status,actor)
  VALUES(NEW.id,OLD.status,NEW.status,COALESCE(NULLIF(current_setting('wallet.actor',true),''),'database'));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER transfers_status_audit AFTER INSERT OR UPDATE ON transfers
 FOR EACH ROW EXECUTE FUNCTION audit_transfer_status();
