# ADR-003: A custom indexer instead of a hosted indexing service

- Status: accepted
- Date: 2026-10-01

## Context

Address analysis needs blocks, transactions, receipts and logs in a queryable store.
Alternatives: hosted APIs (Etherscan, Alchemy enhanced APIs), The Graph subgraphs,
off-the-shelf frameworks (Ponder, Envio), or a custom indexer.

## Decision

Build a **small custom indexer** on raw JSON-RPC.

## Consequences

- Zero-cost and vendor-neutral: any standard JSON-RPC node works.
- Every stored fact is traceable to an RPC response; nothing depends on a third party's
  interpretation of the chain.
- Full control over the correctness model: confirmation depth, parent-hash continuity,
  atomic checkpoints and rollback (ADR-005), plus explicit retry and rate-limit behaviour.
- It is the core of the project as a portfolio piece: it shows how indexing actually works.
- Costs: we own backfill speed, operations and schema evolution. Mitigated by keeping the
  scope tight (no traces or internal transactions in V1) and by the RPC abstraction.
- Hosted APIs were rejected as a mandatory dependency (paid tiers, opaque semantics,
  rate limits). Subgraphs were rejected because they need per-contract mappings, not
  whole-chain address analysis.
