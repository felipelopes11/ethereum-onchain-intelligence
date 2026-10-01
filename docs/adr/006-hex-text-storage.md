# ADR-006: Store addresses and hashes as lowercase hex text

- Status: accepted
- Date: 2026-10-01

## Context

Addresses (20 bytes) and hashes (32 bytes) can be stored as `bytea` (compact) or as text.

## Decision

Store them as **lowercase `0x`-prefixed hex** in `varchar(42)` / `varchar(66)`, with
`CHECK` constraints on the identity columns.

## Consequences

- Readable in `psql`, logs and query plans; no encode/decode at every boundary; the
  database, DTOs and JSON share one representation.
- About 2× the bytes of `bytea` for these columns and slightly larger indexes. At this
  project's scale (testnet, windowed indexing) readability wins; switching later is a
  mechanical migration if storage becomes a bottleneck.
- Normalisation happens at the edges (RPC normalisation, Zod schemas). The `CHECK`
  constraints make a mixed-case write fail instead of creating a duplicate identity.
  EIP-55 checksums are validated on input, not stored.
