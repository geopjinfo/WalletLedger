# Query plans

Measured on PostgreSQL 16.13 with 1000000 ledger entries. Timings depend on the host and cache state.

## global

```sql
SELECT NULL::bigint AS entity_id, COALESCE(sum(amount) FILTER (WHERE direction='debit'),0)::text AS expected,
    COALESCE(sum(amount) FILTER (WHERE direction='credit'),0)::text AS actual FROM ledger_entries
    HAVING COALESCE(sum(amount) FILTER (WHERE direction='debit'),0) <> COALESCE(sum(amount) FILTER (WHERE direction='credit'),0)
```

```text
Finalize Aggregate  (cost=18679.58..18679.60 rows=1 width=72) (actual time=122.142..126.310 rows=0 loops=1)
  Filter: (COALESCE(sum(amount) FILTER (WHERE ((direction)::text = 'debit'::text)), '0'::numeric) <> COALESCE(sum(amount) FILTER (WHERE ((direction)::text = 'credit'::text)), '0'::numeric))
  Rows Removed by Filter: 1
  Buffers: shared hit=6161 read=3185
  ->  Gather  (cost=18679.34..18679.55 rows=2 width=64) (actual time=122.008..126.296 rows=3 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=6161 read=3185
        ->  Partial Aggregate  (cost=17679.34..17679.35 rows=1 width=64) (actual time=118.648..118.649 rows=1 loops=3)
              Buffers: shared hit=6161 read=3185
              ->  Parallel Seq Scan on ledger_entries  (cost=0.00..13512.67 rows=416667 width=14) (actual time=0.021..44.961 rows=333333 loops=3)
                    Buffers: shared hit=6161 read=3185
Planning:
  Buffers: shared hit=27 read=3
Planning Time: 0.154 ms
Execution Time: 126.343 ms
```

## transfer

```sql
SELECT transfer_id AS entity_id, COALESCE(sum(amount) FILTER (WHERE direction='debit'),0)::text AS expected,
    COALESCE(sum(amount) FILTER (WHERE direction='credit'),0)::text AS actual FROM ledger_entries GROUP BY transfer_id
    HAVING COALESCE(sum(amount) FILTER (WHERE direction='debit'),0) <> COALESCE(sum(amount) FILTER (WHERE direction='credit'),0)
```

```text
GroupAggregate  (cost=0.42..105419.92 rows=534826 width=72) (actual time=906.397..906.398 rows=0 loops=1)
  Group Key: transfer_id
  Filter: (COALESCE(sum(amount) FILTER (WHERE ((direction)::text = 'debit'::text)), '0'::numeric) <> COALESCE(sum(amount) FILTER (WHERE ((direction)::text = 'credit'::text)), '0'::numeric))
  Rows Removed by Filter: 500000
  Buffers: shared hit=995620 read=11772 written=6082
  ->  Index Scan using ledger_entries_transfer_id_account_id_direction_key on ledger_entries  (cost=0.42..78165.17 rows=1000000 width=22) (actual time=0.042..405.000 rows=1000000 loops=1)
        Buffers: shared hit=995620 read=11772 written=6082
Planning:
  Buffers: shared hit=11 read=1
Planning Time: 0.139 ms
JIT:
  Functions: 6
  Options: Inlining false, Optimization false, Expressions true, Deforming true
  Timing: Generation 0.458 ms, Inlining 0.000 ms, Optimization 0.268 ms, Emission 5.531 ms, Total 6.257 ms
Execution Time: 927.440 ms
```

## balance

```sql
SELECT a.id AS entity_id, COALESCE(sum(CASE WHEN l.direction='credit' THEN l.amount ELSE -l.amount END),0)::text AS expected,
    a.balance::text AS actual FROM accounts a LEFT JOIN ledger_entries l ON l.account_id=a.id GROUP BY a.id
    HAVING a.balance <> COALESCE(sum(CASE WHEN l.direction='credit' THEN l.amount ELSE -l.amount END),0)
```

```text
HashAggregate  (cost=32063.62..32118.60 rows=1993 width=72) (actual time=706.513..706.515 rows=0 loops=1)
  Group Key: a.id
  Filter: ((a.balance)::numeric <> COALESCE(sum(CASE WHEN ((l.direction)::text = 'credit'::text) THEN l.amount ELSE (- l.amount) END), '0'::numeric))
  Batches: 1  Memory Usage: 625kB
  Rows Removed by Filter: 2003
  Buffers: shared hit=9373 read=15 dirtied=15
  ->  Hash Right Join  (cost=87.07..22063.62 rows=1000000 width=30) (actual time=0.761..441.114 rows=1000002 loops=1)
        Hash Cond: (l.account_id = a.id)
        Buffers: shared hit=9373 read=15 dirtied=15
        ->  Seq Scan on ledger_entries l  (cost=0.00..19346.00 rows=1000000 width=22) (actual time=0.005..94.251 rows=1000000 loops=1)
              Buffers: shared hit=9346
        ->  Hash  (cost=62.03..62.03 rows=2003 width=16) (actual time=0.751..0.752 rows=2003 loops=1)
              Buckets: 2048  Batches: 1  Memory Usage: 110kB
              Buffers: shared hit=27 read=15 dirtied=15
              ->  Seq Scan on accounts a  (cost=0.00..62.03 rows=2003 width=16) (actual time=0.158..0.423 rows=2003 loops=1)
                    Buffers: shared hit=27 read=15 dirtied=15
Planning:
  Buffers: shared hit=88 read=7
Planning Time: 0.478 ms
Execution Time: 706.598 ms
```

## overdraft

```sql
SELECT a.id AS entity_id,'0'::text AS expected,sum(CASE WHEN l.direction='credit' THEN l.amount ELSE -l.amount END)::text AS actual
    FROM accounts a JOIN ledger_entries l ON l.account_id=a.id WHERE a.kind='wallet' GROUP BY a.id
    HAVING sum(CASE WHEN l.direction='credit' THEN l.amount ELSE -l.amount END)<0
```

```text
Finalize GroupAggregate  (cost=19995.87..20525.90 rows=667 width=72) (actual time=199.237..203.213 rows=0 loops=1)
  Group Key: a.id
  Filter: (sum(CASE WHEN ((l.direction)::text = 'credit'::text) THEN l.amount ELSE (- l.amount) END) < '0'::numeric)
  Rows Removed by Filter: 2000
  Buffers: shared hit=9494
  ->  Gather Merge  (cost=19995.87..20462.57 rows=4000 width=40) (actual time=195.091..200.398 rows=6000 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=9494
        ->  Sort  (cost=18995.85..19000.85 rows=2000 width=40) (actual time=182.283..182.417 rows=2000 loops=3)
              Sort Key: a.id
              Sort Method: quicksort  Memory: 174kB
              Buffers: shared hit=9494
              Worker 0:  Sort Method: quicksort  Memory: 174kB
              Worker 1:  Sort Method: quicksort  Memory: 174kB
              ->  Partial HashAggregate  (cost=18861.19..18886.19 rows=2000 width=40) (actual time=181.086..181.669 rows=2000 loops=3)
                    Group Key: a.id
                    Batches: 1  Memory Usage: 625kB
                    Buffers: shared hit=9478
                    Worker 0:  Batches: 1  Memory Usage: 625kB
                    Worker 1:  Batches: 1  Memory Usage: 625kB
                    ->  Hash Join  (cost=92.04..14700.77 rows=416042 width=22) (actual time=38.845..125.529 rows=166667 loops=3)
                          Hash Cond: (l.account_id = a.id)
                          Buffers: shared hit=9478
                          ->  Parallel Seq Scan on ledger_entries l  (cost=0.00..13512.67 rows=416667 width=22) (actual time=0.011..39.809 rows=333333 loops=3)
                                Buffers: shared hit=9346
                          ->  Hash  (cost=67.04..67.04 rows=2000 width=8) (actual time=0.831..0.832 rows=2000 loops=3)
                                Buckets: 2048  Batches: 1  Memory Usage: 95kB
                                Buffers: shared hit=126
                                ->  Seq Scan on accounts a  (cost=0.00..67.04 rows=2000 width=8) (actual time=0.055..0.495 rows=2000 loops=3)
                                      Filter: ((kind)::text = 'wallet'::text)
                                      Rows Removed by Filter: 3
                                      Buffers: shared hit=126
Planning:
  Buffers: shared hit=28
Planning Time: 0.227 ms
Execution Time: 203.319 ms
```

## orphan

```sql
SELECT t.id AS entity_id,'ledger entries'::text AS expected,'missing'::text AS actual FROM transfers t
    WHERE t.status IN ('posted','reversed') AND NOT EXISTS(SELECT 1 FROM ledger_entries l WHERE l.transfer_id=t.id)
    UNION ALL SELECT l.id,'transfer','missing' FROM ledger_entries l LEFT JOIN transfers t ON t.id=l.transfer_id WHERE t.id IS NULL
```

```text
Gather  (cost=11860.50..57817.13 rows=2 width=72) (actual time=616.000..623.536 rows=0 loops=1)
  Workers Planned: 2
  Workers Launched: 2
  Buffers: shared hit=18958 read=12234
  ->  Parallel Append  (cost=10860.50..56816.93 rows=2 width=72) (actual time=580.150..580.155 rows=0 loops=3)
        Buffers: shared hit=18958 read=12234
        ->  Parallel Hash Right Anti Join  (cost=11381.33..30623.17 rows=1 width=72) (actual time=311.202..311.205 rows=0 loops=3)
              Hash Cond: (l.transfer_id = t.id)
              Buffers: shared hit=9533 read=6063
              ->  Parallel Seq Scan on ledger_entries l  (cost=0.00..13512.67 rows=416667 width=8) (actual time=0.015..51.088 rows=333333 loops=3)
                    Buffers: shared hit=9346
              ->  Parallel Hash  (cost=8777.17..8777.17 rows=208333 width=8) (actual time=114.541..114.542 rows=166667 loops=3)
                    Buckets: 524288  Batches: 1  Memory Usage: 23680kB
                    Buffers: shared hit=110 read=6063
                    ->  Parallel Seq Scan on transfers t  (cost=0.00..8777.17 rows=208333 width=8) (actual time=0.032..160.523 rows=500000 loops=1)
                          Filter: ((status)::text = ANY ('{posted,reversed}'::text[]))
                          Buffers: shared hit=110 read=6063
        ->  Parallel Hash Anti Join  (cost=10860.50..26193.75 rows=1 width=72) (actual time=403.418..403.419 rows=0 loops=2)
              Hash Cond: (l_1.transfer_id = t_1.id)
              Buffers: shared hit=9425 read=6171
              ->  Parallel Seq Scan on ledger_entries l_1  (cost=0.00..13512.67 rows=416667 width=16) (actual time=0.017..69.306 rows=500000 loops=2)
                    Buffers: shared hit=9346
              ->  Parallel Hash  (cost=8256.33..8256.33 rows=208333 width=8) (actual time=146.126..146.126 rows=250000 loops=2)
                    Buckets: 524288  Batches: 1  Memory Usage: 23680kB
                    Buffers: shared hit=2 read=6171
                    ->  Parallel Seq Scan on transfers t_1  (cost=0.00..8256.33 rows=208333 width=8) (actual time=0.036..51.852 rows=250000 loops=2)
                          Buffers: shared hit=2 read=6171
Planning:
  Buffers: shared hit=142 read=15
Planning Time: 0.802 ms
Execution Time: 623.580 ms
```

## Deep statement offset

```text
Limit  (cost=8874.83..8876.60 rows=20 width=32) (actual time=36.804..36.811 rows=20 loops=1)
  Buffers: shared hit=941 read=492
  ->  Index Scan using ledger_entries_statement on ledger_entries  (cost=0.42..44893.09 rows=505867 width=32) (actual time=0.018..31.265 rows=100020 loops=1)
        Index Cond: (account_id = 1)
        Buffers: shared hit=941 read=492
Planning:
  Buffers: shared hit=17
Planning Time: 0.106 ms
Execution Time: 36.830 ms
```

OFFSET discards the first 100,000 matching rows even with an ordered index. This work grows with the offset. The statement index avoids a separate sort but cannot skip counting those rows.

Global balance and transfer grouping are nightly scans over the ledger. Stored-balance and overdraft checks scan and group entries by account. Foreign keys prevent ordinary orphans; missing-entry checks use the transfer index supplied by the unique (transfer_id, account_id, direction) constraint. Full scans are acceptable for the nightly checks, while statement and fraud lookups need selective indexes.
## Individual fraud rules

### Velocity

```text
Aggregate  (cost=973.97..973.98 rows=1 width=8) (actual time=0.197..0.198 rows=1 loops=1)
  Buffers: shared hit=13
  ->  Index Only Scan using transfers_outgoing on transfers  (cost=0.43..972.56 rows=563 width=0) (actual time=0.027..0.159 rows=578 loops=1)
        Index Cond: ((source_account_id = '1'::bigint) AND (created_at > (statement_timestamp() - '00:10:00'::interval)))
        Heap Fetches: 578
        Buffers: shared hit=13
Planning Time: 0.147 ms
Execution Time: 0.213 ms
```

### Amount spike

```text
Finalize Aggregate  (cost=12381.51..12381.52 rows=1 width=1) (actual time=98.620..102.300 rows=1 loops=1)
  Buffers: shared hit=207 read=5972
  ->  Gather  (cost=12381.28..12381.49 rows=2 width=32) (actual time=98.526..102.289 rows=3 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=207 read=5972
        ->  Partial Aggregate  (cost=11381.28..11381.29 rows=1 width=32) (actual time=84.184..84.185 rows=1 loops=3)
              Buffers: shared hit=207 read=5972
              ->  Parallel Seq Scan on transfers  (cost=0.00..10860.50 rows=208312 width=8) (actual time=0.028..68.484 rows=166667 loops=3)
                    Filter: (((status)::text = ANY ('{posted,reversed}'::text[])) AND (source_account_id = '1'::bigint) AND (created_at > (statement_timestamp() - '720:00:00'::interval)))
                    Buffers: shared hit=207 read=5972
Planning Time: 0.233 ms
Execution Time: 102.386 ms
```

### New payee

```text
Result  (cost=2.20..2.21 rows=1 width=1) (actual time=0.018..0.019 rows=1 loops=1)
  Buffers: shared hit=4
  InitPlan 1 (returns $0)
    ->  Index Only Scan using transfers_recipient on transfers  (cost=0.42..442.09 rows=249 width=0) (actual time=0.017..0.018 rows=1 loops=1)
          Index Cond: ((source_account_id = '1'::bigint) AND (destination_account_id = '4'::bigint))
          Heap Fetches: 1
          Buffers: shared hit=4
Planning Time: 0.152 ms
Execution Time: 0.030 ms
```

## Fraud queries

All three rule queries plus the rule lookup took 94.301 ms on the cash-in account with 500,000 historical outgoing transfers. This measures query overhead while holding its account lock; it excludes HTTP and commit time.

Velocity and amount-spike filters use transfers_outgoing (source_account_id, created_at DESC), a partial index on posted/reversed rows. The new-payee query uses transfers_recipient (source_account_id, destination_account_id). Broad history windows may still choose a sequential scan; this hot system-account fixture is a worst-case history size for the required rules.
