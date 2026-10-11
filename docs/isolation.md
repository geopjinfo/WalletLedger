# Isolation experiments

Recorded on PostgreSQL 16.13 with two independent connections. Use two psql sessions to reproduce the labelled commands. The lab tables are separate from the wallet schema.

## READ COMMITTED

`A> BEGIN ISOLATION LEVEL READ COMMITTED`
```json
[]
```

`A> SELECT balance FROM isolation_accounts WHERE id=1`
```json
[{"balance":500}]
```

`B> UPDATE isolation_accounts SET balance=400 WHERE id=1`
```json
[]
```

`A> SELECT balance FROM isolation_accounts WHERE id=1`
```json
[{"balance":400}]
```

`A> COMMIT`
```json
[]
```

## REPEATABLE READ

`A> BEGIN ISOLATION LEVEL REPEATABLE READ`
```json
[]
```

`A> SELECT balance FROM isolation_accounts WHERE id=1`
```json
[{"balance":500}]
```

`B> UPDATE isolation_accounts SET balance=400 WHERE id=1`
```json
[]
```

`A> SELECT balance FROM isolation_accounts WHERE id=1`
```json
[{"balance":500}]
```

`A> COMMIT`
```json
[]
```

## Repeatable Read with a join

`A> BEGIN ISOLATION LEVEL REPEATABLE READ`
```json
[]
```

`A> SELECT balance,name FROM isolation_accounts JOIN isolation_users USING(id)`
```json
[{"balance":500,"name":"Asha"}]
```

`B> UPDATE isolation_accounts SET balance=400 WHERE id=1`
```json
[]
```

`A> SELECT balance,name FROM isolation_accounts JOIN isolation_users USING(id)`
```json
[{"balance":500,"name":"Asha"}]
```

`A> COMMIT`
```json
[]
```

## Serializable conflict

`A> BEGIN ISOLATION LEVEL SERIALIZABLE`
```json
[]
```

`B> BEGIN ISOLATION LEVEL SERIALIZABLE`
```json
[]
```

`A> SELECT balance FROM isolation_accounts WHERE id=1`
```json
[{"balance":500}]
```

`B> SELECT balance FROM isolation_accounts WHERE id=1`
```json
[{"balance":500}]
```

`A> UPDATE isolation_accounts SET balance=400 WHERE id=1`
```json
[]
```

`A> COMMIT`
```json
[]
```

`B> UPDATE isolation_accounts SET balance=400 WHERE id=1`
Error 40001: could not serialize access due to concurrent update

`B> ROLLBACK`
```json
[]
```

## Unsafe lost update
Both sessions read 500 and independently spend 100. Without a locked re-read, both overwrite the balance with 400; the correct result is 300.

`A> BEGIN`
```json
[]
```

`B> BEGIN`
```json
[]
```

`A> SELECT balance FROM isolation_accounts WHERE id=1`
```json
[{"balance":500}]
```

`B> SELECT balance FROM isolation_accounts WHERE id=1`
```json
[{"balance":500}]
```

`A> UPDATE isolation_accounts SET balance=400 WHERE id=1`
```json
[]
```

`A> COMMIT`
```json
[]
```

`B> UPDATE isolation_accounts SET balance=400 WHERE id=1`
```json
[]
```

`B> COMMIT`
```json
[]
```

`A> SELECT balance FROM isolation_accounts WHERE id=1`
```json
[{"balance":400}]
```

The production path locks account rows in ascending ID order, reads balances while holding the locks, and writes both ledger sides and balances in the same Read Committed transaction. The 20 stampede runs verify that concurrent requests cannot reuse stale funds.
