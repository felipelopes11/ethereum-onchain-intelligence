# Performance

The first goal was correctness; the measures below are the ones that were needed, not
speculative optimisations.

## Measured baseline

Indexing live Sepolia from a laptop through a free public RPC
(`ethereum-sepolia-rpc.publicnode.com`), local PGlite database:

| Metric             | Value                                      |
| ------------------ | ------------------------------------------ |
| Sepolia block size | ~100 transactions, ~200–260 logs per block |
| Batch of 5 blocks  | ~2.1–3.1 s end to end (≈ 1.6–2.0 blocks/s) |
| Steady state       | follows the head, lag = `CONFIRMATIONS`    |

Sepolia produces a block every 12 s, so this is ~20× faster than the chain. Throughput is
bounded by the RPC rate limit, not by the database.

## PostgreSQL indexes

Indexes follow query shapes (full list in [data-model.md](data-model.md#indexes)):

- Address history is a `UNION` of two index range scans
  (`(chain_id, from_address, block_number, transaction_index)` and the `to_address` twin)
  instead of one `OR` scan.
- Composite primary keys double as indexes for the most common lookups (by hash, by
  block/log index).
- Partial indexes for sparse predicates (`contract_address IS NOT NULL`,
  `metadata_status = 'pending'`).
- Not indexed on purpose: `topic1..3` (token transfer tables answer address queries),
  `input` (selector is denormalised instead).

## Batch processing

- A batch of `INDEXER_BATCH_SIZE` blocks is one transaction: fewer commits and an atomic
  checkpoint.
- Multi-row inserts, chunked below Postgres' 65,535 bind-parameter limit
  (`chunkForInsert`).
- Contracts and tokens are merged in memory per batch, so each is upserted once.

## RPC batching and concurrency

- `eth_getBlockReceipts` returns all receipts of a block in one call (per-transaction
  fallback for nodes without it).
- viem's HTTP transport batches concurrent requests (up to 50 per JSON-RPC batch).
- Up to `INDEXER_FETCH_CONCURRENCY` blocks are fetched in parallel, but persisted in
  order. Token metadata is fetched concurrently after the batch commits.
- A token bucket caps request rate; full-jitter backoff avoids synchronised retry storms.

## Caching

- Postgres is the source of truth after indexing; no cache sits in front of it.
- Live RPC reads in the API (balance, nonce, bytecode, chain head, ENS) use a bounded
  TTL cache with in-flight request coalescing. `eth_getCode` results are also persisted
  to `addresses`.
- API responses carry `Cache-Control: public, max-age=5`; TanStack Query dedupes
  requests across tabs (`staleTime` 10 s).

## Pagination

Keyset (cursor) pagination on `(block_number, transaction_index)`. Each `UNION` branch
applies the keyset predicate and `LIMIT n+1` itself, so a page touches at most
`2·(n+1)` rows whatever its depth, and pages stay stable while new blocks arrive. The
cursor is opaque base64url.

## Database transactions

- Indexer: one transaction per batch (blocks + derived rows + checkpoint); rollback in
  one transaction.
- API: read-only autocommit queries; `statement_timeout` bounds each one.

## Next steps when needed

Measured bottlenecks would come first. Likely candidates: `COPY` instead of multi-row
`INSERT` for backfills, a paid or self-hosted RPC with higher limits, materialised
per-address aggregates for very active addresses, and partitioning large tables by block
range (V3: distributed indexing).
