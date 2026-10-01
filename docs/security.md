# Security

The platform is read-only. It holds no funds, signs no transactions and never asks for
credentials. Its attack surface is: user input, untrusted chain data, the RPC
dependency, and the database.

## Private keys and seed phrases

- No component accepts, stores or transmits private keys or seed phrases. There is no
  wallet connection: analysing an address requires only its public address.
- The UI footer states that the site never asks for a key.
- The contract deploy script signs with an encrypted Foundry keystore
  (`--account deployer`), never a raw key in an environment file.
- `npm run check:secrets` (also run in CI) fails on key-like assignments, PEM keys,
  provider API keys embedded in URLs, mnemonics, GitHub tokens and committed `.env` files.

## Secrets and configuration

- All configuration comes from environment variables, validated by Zod at startup
  (`packages/config`); invalid configuration aborts with every problem listed.
- `.env` is git-ignored; only `.env.example` (no secrets) is committed.
- RPC and database URLs are passed through `redactUrl` before logging: credentials, query
  strings and long path segments (where providers embed API keys) are masked.
- API error responses never include stack traces, SQL or upstream URLs (tested).

## RPC security and abuse

- The RPC URL is server-side only; the browser never receives it.
- Client-side token-bucket rate limiting and bounded retries protect the upstream quota.
- API requests that trigger RPC calls are cached (`TtlCache`, with request coalescing),
  and bytecode checks per request are capped (`MAX_COUNTERPARTY_CODE_CHECKS`).
- The indexer refuses to run if the RPC reports a different chain id.
- RPC responses are validated: receipts must match the requested block hash, pending
  objects are rejected, and inconsistent data is retried rather than stored.

## Input validation

- Every route parameter and query string is parsed with Zod (`addressSchema`,
  `txHashSchema`, `paginationSchema`, `searchSchema`) before use.
- Mixed-case addresses must carry a valid EIP-55 checksum, so typos fail instead of
  silently querying another account.
- Page size is capped at 100; search input at 256 characters; cursors must be base64url
  and decode to a strict `block.position` pattern.

## SQL injection

All queries are parameterised: Drizzle's query builder or the `sql` template tag, which
binds interpolated values as parameters. The only `sql.raw` uses are constant
identifiers (`excluded.column`, `ASC`/`DESC`, `'hour'`/`'day'`) chosen by code, never
by input. The enum array literal in `TokenRepository` validates each value against the
closed enum first.

## Rate limiting and DoS

- `@fastify/rate-limit` per client IP (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`);
  `/health` and `/ready` are exempt so orchestration still works under load.
- `TRUST_PROXY` defaults to `false`; enabling it without a trusted proxy would let
  clients spoof `X-Forwarded-For` and evade limits.
- Body limit 1 KiB (only GET endpoints exist), request timeout 30 s, Postgres
  `statement_timeout` 10 s for API connections.
- Keyset pagination keeps every page O(page size) regardless of depth.
- Decoder limits: calldata over 128 KiB is not decoded; `TransferBatch` over 1,000 items
  is rejected as malformed.

## Untrusted chain data (malicious contracts, malformed ABI data)

Every byte from the chain is attacker-controlled:

- Event decoding is structural and strict: wrong topic counts, wrong data lengths,
  non-zero padding in address topics, mismatched batch arrays → `malformed`, kept only
  as a raw log.
- Calldata whose selector matches but whose payload does not decode is reported as
  unknown, never partially decoded.
- Token metadata calls may revert, return garbage, or return enormous strings:
  decoding failures become `null`; `decimals` is range-checked; strings are sanitised
  (control characters, zero-width and bidi-override characters stripped; length capped).
- Names and symbols are labelled _self-declared_; protocol membership requires an
  on-chain-verified address registry, not event shapes.

## XSS

- React escapes all interpolated text; the code uses no `dangerouslySetInnerHTML`.
  A test renders a token symbol of `<img src=x onerror=alert(1)>` and asserts no element
  is created.
- Links to addresses/transactions are built from validated hex only; external explorer
  links use `rel="noopener noreferrer"`.
- Security headers: Next.js sends `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`; the API uses `@fastify/helmet`. `X-Powered-By`
  is disabled.
- CORS on the API allows only the configured web origin(s) and only `GET`.

## SSRF

No endpoint fetches a user-supplied URL. The only outbound connections go to the
configured RPC URLs and the database. Token metadata such as `tokenURI` is never fetched.

## Reorgs

Covered in [ADR-005](adr/005-reorg-handling.md): confirmation depth, parent-hash
continuity, atomic rollback, and a hard stop for reorgs deeper than
`INDEXER_MAX_REORG_DEPTH`.

## Integer overflow and bigint handling

- uint256 values are `numeric(78,0)` in Postgres and `bigint` in TypeScript; JSON carries
  them as decimal strings. A test round-trips `2^256 − 1`.
- Raw SQL casts counts to `int` and large numbers to `text` so node-postgres and PGlite
  behave identically; text is converted with `BigInt()`.
- The UI formats amounts with viem's `formatUnits` on `bigint`; no value passes through
  `Number` except bounded counts.
- Solidity 0.8 checked arithmetic; the one narrowing cast (`block.timestamp` → `uint64`)
  uses OpenZeppelin `SafeCast`.

## Smart contract

`OnChainIntelligenceRegistry`: `Ownable2Step` (two-step ownership transfer),
`renounceOwnership` disabled (it would brick the registry), custom errors, input bounds,
events for every state change, no external calls, no ETH handling, not upgradeable.
Tested with Foundry, including fuzz tests.

## Containers

Runtime images run as the unprivileged `node` user with `tini` as PID 1. Postgres is not
published to the host by default.
