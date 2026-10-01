# Ethereum On-Chain Intelligence

An open-source Ethereum indexer and address-analysis platform that turns public
on-chain data into verifiable, evidence-labelled information.

[![CI](https://github.com/felipelopes11/ethereum-onchain-intelligence/actions/workflows/ci.yml/badge.svg)](https://github.com/felipelopes11/ethereum-onchain-intelligence/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

## Demo

Screenshots taken against live Ethereum Sepolia data during development:

| Address analysis                                              | Transaction decoding                          |
| ------------------------------------------------------------- | --------------------------------------------- |
| ![Address overview](docs/images/address-overview.jpg)         | ![Transaction](docs/images/transaction.jpg)   |
| ![Observed relationships](docs/images/relationship-graph.jpg) | ![Events](docs/images/transaction-events.jpg) |

Run it locally in one command (see [Running with Docker](#running-with-docker)), then
`npm run demo` prints live examples taken from whatever is currently indexed.

## Features

- **Custom block indexer** for Ethereum Sepolia: transactions, receipts and logs;
  checkpointed atomic batches; retries with exponential backoff and jitter; client-side
  rate limiting; graceful shutdown; confirmation depth, `parentHash` continuity checks
  and automatic rollback on chain reorganisations.
- **Token detection** for ERC-20, ERC-721 and ERC-1155 (`TransferSingle`/`TransferBatch`)
  from event structure, with defensive metadata reads (`name`, `symbol`, `decimals`,
  `totalSupply`, ERC-165).
- **Transaction decoding** from local ABIs, without guessing: ambiguous selectors are
  reported as ambiguous, and unknown calls are shown as _Unknown contract interaction_
  with selector and raw input.
- **Protocol detection** (Uniswap, Aave V3) through an explicit address registry that is
  verified on-chain (`npm run verify:protocols`), kept separate from interpreting the
  call into an action.
- **Evidence-based wallet analysis** where every statement is _observed_, _inferred_ or
  _heuristic_, with its rule and evidence. **"Explain this wallet"** builds a
  deterministic report with unknowns and limitations; no generative AI is involved.
- **EIP-7702 aware**: delegated EOAs are not mistaken for contracts.
- **Web UI** (Next.js): search by address, transaction hash or ENS; address tabs;
  readable events with a raw view; activity timeline, weekday×hour heatmap,
  counterparty frequency, relationship graph and token flow, each with a table view.
- **Solidity**: `OnChainIntelligenceRegistry`, a small release and chain-config registry
  tested with Foundry (including fuzzing).
- **Operations**: structured logs, liveness/readiness endpoints, metrics, Docker Compose,
  GitHub Actions CI.

## Architecture

```mermaid
flowchart LR
  RPC[(Ethereum JSON-RPC<br/>Sepolia)] -- blocks, receipts, logs --> IDX[Indexer]
  IDX -- atomic batches + checkpoint --> DB[(PostgreSQL)]
  DB --> API[API · Fastify]
  RPC -- live reads: balance, nonce, code --> API
  API --> WEB[Web · Next.js]
```

```
apps/
  indexer/      block indexer, reorg recovery, health/metrics server
  api/          REST API, address analysis, heuristics, "Explain this wallet"
  web/          Next.js UI, TanStack Query, SVG visualisations, Playwright E2E
packages/
  blockchain/   BlockchainProvider + EvmProvider (viem), ABIs, decoder, token events, protocols
  database/     Drizzle schema, SQL migrations, repositories, PGlite test harness
  shared/       DTOs, Zod schemas, enums, chain metadata
  config/       typed environment parsing
contracts/      OnChainIntelligenceRegistry (Solidity, Foundry)
docs/           technical documentation and ADRs
scripts/        demo, protocol verification, secret scan, local Postgres
```

Details: [docs/architecture.md](docs/architecture.md).

## Why Ethereum?

Ethereum's execution layer is a public, append-only (modulo reorgs) record with a
well-specified JSON-RPC interface and standardised event layouts (ERC-20/721/1155). That
makes it possible to build analysis on facts anyone can re-derive from any node, rather
than on a vendor's database. Sepolia gives the same proof-of-stake semantics with real
DeFi deployments at zero cost ([ADR-001](docs/adr/001-ethereum-sepolia.md)).

## Why an indexer?

JSON-RPC answers "give me block N" or "give me this receipt". It cannot answer "every
transaction this address made", "all transfers of this token" or "which protocols does
this wallet use". An indexer reads the chain once, in order, and stores it relationally
so those questions become indexed SQL queries. Owning the indexer also means owning the
correctness model: confirmations, reorgs, idempotency and a coverage range that every API
response reports ([ADR-003](docs/adr/003-custom-indexer.md),
[ADR-005](docs/adr/005-reorg-handling.md)).

## Tech stack

| Area           | Choices                                                                |
| -------------- | ---------------------------------------------------------------------- |
| Frontend       | Next.js 16, React 19, TypeScript, Tailwind CSS 4, TanStack Query, viem |
| Backend        | Node.js, Fastify 5, Zod, viem, pino                                    |
| Database       | PostgreSQL 17, Drizzle ORM (PGlite for tests and Docker-less dev)      |
| Smart contract | Solidity 0.8.28, Foundry, OpenZeppelin 5                               |
| Testing        | Vitest, Testing Library, Playwright, Foundry (fuzzing)                 |
| Tooling        | npm workspaces, tsup, ESLint (typescript-eslint strict), Prettier      |
| Infrastructure | Docker, Docker Compose, GitHub Actions                                 |

## Getting started

Requirements: Node.js ≥ 20.11 (22 recommended) and either Docker or nothing else.

```bash
npm install
cp .env.example .env
```

Start a database, either with Docker:

```bash
docker compose up -d postgres
```

or without Docker, using embedded Postgres (PGlite):

```bash
npm run db:local
```

Then migrate and run the three processes in separate terminals:

```bash
npm run db:migrate
npm run dev:indexer
npm run dev:api
npm run dev:web
```

Open http://localhost:3000 and run `npm run demo` for a health check with live examples.
More in [docs/development.md](docs/development.md).

## Environment variables

All variables are documented in [`.env.example`](.env.example) and validated at startup.
The essentials:

| Variable                      | Default                                       | Purpose                                                     |
| ----------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`                | `postgres://eoi:eoi@localhost:5432/eoi`       | PostgreSQL connection                                       |
| `ETHEREUM_RPC_URL`            | `https://ethereum-sepolia-rpc.publicnode.com` | JSON-RPC endpoint (server-side only)                        |
| `ETHEREUM_CHAIN_ID`           | `11155111`                                    | Must match the RPC, checked at startup                      |
| `CONFIRMATIONS`               | `12`                                          | Depth before a block is indexed                             |
| `INDEXER_START_BLOCK`         | `-500`                                        | First run only: absolute block, negative offset or `latest` |
| `RPC_MAX_REQUESTS_PER_SECOND` | `10`                                          | Client-side rate limit                                      |
| `CORS_ORIGIN`                 | `http://localhost:3000`                       | Allowed web origin(s)                                       |
| `ENS_RPC_URL`                 | (empty)                                       | Optional mainnet RPC for ENS; disabled when empty           |
| `NEXT_PUBLIC_API_URL`         | `http://localhost:4000`                       | API URL as seen by the browser (build time)                 |

## Running with Docker

```bash
docker compose up --build
```

This starts PostgreSQL, runs the migrations once, then starts the indexer, the API
(http://localhost:4000) and the web app (http://localhost:3000). Details:
[docs/deployment.md](docs/deployment.md).

## Running tests

```bash
npm test                 # unit + integration (Vitest; repositories run on real SQL via PGlite)
npm run test:e2e         # Playwright: search, address page, transaction page
npm run test:contracts   # Foundry, including fuzz tests
npm run lint && npm run typecheck && npm run build
```

What each layer covers: [docs/testing.md](docs/testing.md).

## Project structure

See [Architecture](#architecture) and [docs/README.md](docs/README.md) for the full
documentation index.

## Example queries

```bash
curl http://localhost:4000/api/status
curl http://localhost:4000/api/examples                 # demo targets from the current index
curl http://localhost:4000/api/address/<address>
curl http://localhost:4000/api/address/<address>/explain
curl "http://localhost:4000/api/address/<address>/transactions?limit=10"
curl http://localhost:4000/api/address/<address>/tokens
curl http://localhost:4000/api/address/<address>/protocols
curl http://localhost:4000/api/address/<address>/activity
curl http://localhost:4000/api/transaction/<hash>
curl "http://localhost:4000/api/search?q=<address|hash|name.eth>"
```

Excerpt of `/explain` for a real Sepolia address:

```json
{
  "label": "Likely DeFi participant",
  "basis": "heuristic",
  "evidence": [
    { "description": "Interactions with known DeFi contracts", "value": 158 },
    { "description": "Swap-related transactions", "value": 158 },
    { "description": "Protocols", "value": "Uniswap" }
  ],
  "rule": "At least 3 outgoing transactions to known DEX or lending protocol contracts (explicit address registry)."
}
```

## Security

The platform is read-only and never asks for private keys or seed phrases. Inputs are
validated with Zod, queries are parameterised, the API is rate-limited, chain data is
treated as untrusted (strict decoding, sanitised token metadata, inert rendering), and a
secret scan runs in CI. Full threat model: [docs/security.md](docs/security.md).

## Limitations

- Only the indexed block range is analysed; every response states it.
- Internal transactions are not traced.
- Owner identity, intent and off-chain activity cannot be inferred from chain data.
- Token names are self-declared; protocol detection covers only registered contracts.
- Classifications are heuristics with explicit thresholds and can be wrong.

More: [docs/limitations.md](docs/limitations.md).

## Roadmap

- **V1**: Sepolia, indexer, transactions, ERC-20/721/1155, address analysis, protocol
  detection, dashboard (done).
- **V2**: Ethereum mainnet, more protocols, ENS, advanced graph, contract metadata.
- **V3**: multi-chain EVM, advanced analytics, reorg improvements, distributed indexing.

Details: [docs/roadmap.md](docs/roadmap.md).

## License

[MIT](LICENSE)
