ALTER TABLE idempotency_keys ALTER COLUMN response_body TYPE TEXT USING response_body::text;
