# ADR-005: Reorg handling strategy

- Status: accepted
- Date: 2026-10-01

## Context

Blocks near the chain head can be replaced. Post-merge Ethereum finalises after about two
epochs (~64 blocks, ~13 minutes); short reorgs of 1–2 blocks still occur near the head.
An indexer that assumes immediate immutability persists orphaned data.

## Decision

Three layers:

1. **Confirmation depth.** Index only up to `safeHead = latest − CONFIRMATIONS` (default
   12 ≈ 2.4 minutes). This avoids almost all reorgs at a small latency cost.
2. **Continuity check.** Before persisting, the first fetched block's `parentHash` must
   equal the stored checkpoint hash, and each block in the batch must extend the previous
   one. Receipts are fetched by block hash.
3. **Rollback.** On a mismatch, walk back from the checkpoint comparing stored hashes with
   the canonical chain until they agree (the common ancestor), then, in one transaction,
   `DELETE FROM blocks WHERE number > ancestor`. Foreign keys cascade through
   transactions, receipts, logs and transfers; addresses, contracts and tokens first
   observed on the dead fork are deleted via `first_observed_block`; the checkpoint moves
   to the ancestor. Indexing resumes on the new fork.

A reorg deeper than `INDEXER_MAX_REORG_DEPTH` (default 64, beyond finality) stops the
indexer with `ReorgTooDeepError` so an operator can inspect it instead of auto-repairing.

## Alternatives considered

- **Index only `finalized` blocks**: simplest and fully safe, but ~13 minutes behind.
  Available by setting `CONFIRMATIONS` ≈ 64; the provider already exposes
  `getFinalizedBlockNumber` for a future finality-aware mode.
- **Index the head and mark rows unconfirmed**: lowest latency, but every query must
  reason about confirmation state. Deferred to V3 ("reorg improvements").

## Consequences

- Data is at most `CONFIRMATIONS` blocks behind, and the rollback path is tested with
  simulated forks (`apps/indexer/test/indexer.test.ts`,
  `packages/database/test/ingestion-repository.test.ts`).
- Aggregates are computed by query rather than stored counters, so rollback never has to
  "un-count" anything.
