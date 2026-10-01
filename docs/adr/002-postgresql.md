# ADR-002: PostgreSQL as the primary store

- Status: accepted
- Date: 2026-10-01

## Context

Indexed chain data is relational (blocks → transactions → receipts/logs → transfers),
needs exact 256-bit integers, transactional batch writes, cascading deletes for reorgs,
and ad-hoc analytical queries (aggregations per address, per token, per protocol).

## Decision

Use **PostgreSQL** with **Drizzle ORM** for schema and migrations. Tests use **PGlite**
(Postgres compiled to WASM) so they run real SQL in-process.

## Consequences

- `numeric(78,0)` stores any uint256 exactly; `ON DELETE CASCADE` gives one-statement
  reorg rollback; multi-statement transactions give atomic batch + checkpoint writes.
- SQL aggregates (`FILTER`, `UNION`, keyset predicates) express the analytics directly.
- Drizzle keeps the schema in TypeScript (typed rows) and generates reviewable SQL
  migrations; raw `sql` templates remain parameterised.
- PGlite lets repository, indexer and API tests run without a database server, and also
  provides a zero-install local database (`npm run db:local`) when Docker is
  unavailable. CI still applies the migrations to a real PostgreSQL server.
- Rejected: a document store (weak for joins and exact numerics); ClickHouse (excellent
  for scans, but adds operational weight and lacks the transactional semantics the reorg
  model relies on at this scale).
