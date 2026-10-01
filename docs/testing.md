# Testing

```bash
npm test                 # Vitest: all packages and apps
npm run test:e2e         # Playwright
npm run test:contracts   # Foundry
```

## Strategy

| Layer          | Tool                | Database / chain                                  |
| -------------- | ------------------- | ------------------------------------------------- |
| Pure logic     | Vitest              | none                                              |
| Repositories   | Vitest              | **PGlite**: real Postgres (WASM), real migrations |
| Indexer        | Vitest              | PGlite + `FakeChain` (in-memory chain with forks) |
| API            | Vitest + `inject()` | PGlite seeded with fixtures + stub RPC            |
| Web components | Vitest + jsdom      | —                                                 |
| End to end     | Playwright          | fixture API server + real web app                 |
| Contract       | Foundry (+ fuzzing) | in-process EVM                                    |
| Migrations     | CI job              | real PostgreSQL 17 service                        |

PGlite makes database tests run real SQL (constraints, cascades, `numeric`, `ON CONFLICT`)
in-process, so they need no server and stay fast and isolated. CI also applies the same
migrations to a real PostgreSQL server.

## What is covered (selection)

**Database**: atomic batch commit and rollback on constraint violation; idempotent replay;
`2^256−1` round-trip; reorg rollback cascading through every derived table; replacement
fork persisted after rollback; coverage bounds; keyset pagination with no gaps or
duplicates across pages; tampered cursors rejected; evidence never downgraded by
`eth_getCode`.

**Indexer**: confirmation-depth safe head; resume from checkpoint without refetching;
relative start blocks; reorg detection → common ancestor → re-index of the new fork;
refusal of reorgs deeper than the limit; recovery from transient RPC failures; reverted
deployments not treated as contracts; malformed transfer logs kept raw; health endpoint
liveness vs readiness.

**Blockchain**: ERC-20 vs ERC-721 disambiguation; ERC-1155 single/batch; non-zero
address padding rejected; oversized/mismatched batches; selector collisions reported as
ambiguous; struct decoding (Uniswap V3); zero-arg functions; retry classification
(429/5xx/limit exceeded vs invalid params/revert); full-jitter backoff; token bucket;
`eth_getBlockReceipts` fallback; receipts from another block rejected; token metadata
with bytes32 names, out-of-range decimals, missing functions; string sanitisation;
EIP-7702 designator parsing.

**API**: validation (bad hex, bad checksum, oversized page); liveness/readiness; live
balance with block height; degraded mode when RPC is down (indexed data still served,
`kind: unknown`, nothing guessed); EIP-7702 accounts; protocol actions; deterministic
explain report; RPC fallback for unindexed transactions; 404/400 semantics; no internal
error leakage; rate limiting; CORS and security headers.

**Web**: amount formatting without precision loss; search routing; readable transfer
events; unknown events shown raw; hostile token metadata rendered inert.

**E2E**: search address → address page; invalid input; search tx hash → tx page;
summary + pagination; Explain this wallet; decoded call + events + raw view; not-found.

**Contract**: release publishing, bounds and events; chain configuration; access
control; two-step ownership; renounce disabled; fuzzing of inputs.

## Live verification (manual, documented)

Beyond automated tests, the stack was run against live Sepolia: indexing, hard kill and
restart (no gaps, intact `parentHash` chain), API queries on real addresses and
transactions, protocol registry verification (`npm run verify:protocols`) and
`npm run demo`.

Two defects were found this way and are now covered by regression tests:

- **EIP-7702 accounts labelled as contracts** (real address with delegated code):
  `apps/api/test/api.test.ts › EIP-7702 delegated accounts`, see ADR-007.
- **Process crash on database restart**: node-postgres emits an unhandled `error` event
  when an idle pooled connection drops. `createDatabase` now always listens; the test
  `packages/database/test/connection-resilience.test.ts` stops a real Postgres-protocol
  server under an idle pool and asserts the error is reported (not thrown) and that
  queries succeed after the server returns. Removing the listener makes this test fail.
