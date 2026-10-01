# Development

## Requirements

- Node.js ≥ 20.11 (22 recommended, see `.nvmrc`), npm ≥ 10
- One of: Docker (for PostgreSQL) **or** nothing extra (`npm run db:local`)
- Optional: [Foundry](https://getfoundry.sh) for the Solidity contract

## Setup

```bash
npm install
cp .env.example .env
```

### Database

With Docker:

```bash
docker compose up -d postgres
```

`docker-compose.yml` does not publish Postgres by default. For host access during
development, add `ports: ['5432:5432']` to the `postgres` service or use a
`docker-compose.override.yml`.

Without Docker (embedded PGlite over the Postgres wire protocol, stored in `.data/`):

```bash
npm run db:local
# then in .env: DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
```

Apply migrations:

```bash
npm run db:migrate
```

### Run

In three terminals:

```bash
npm run dev:indexer   # http://localhost:4100/metrics
npm run dev:api       # http://localhost:4000/api/status
npm run dev:web       # http://localhost:3000
```

Then check everything end to end:

```bash
npm run demo
```

## Workspace scripts

| Script                     | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `npm run lint`             | ESLint (type-aware `strictTypeChecked`), zero warnings allowed |
| `npm run typecheck`        | `tsc --noEmit` in every workspace + scripts                    |
| `npm test`                 | Vitest across all packages and apps                            |
| `npm run test:e2e`         | Playwright (starts a fixture API and the web app itself)       |
| `npm run test:contracts`   | `forge test`                                                   |
| `npm run build`            | tsup bundles (API, indexer) + Next.js production build         |
| `npm run format`           | Prettier                                                       |
| `npm run db:generate`      | Generate a migration after editing `schema.ts`                 |
| `npm run verify:protocols` | Check the protocol registry against the chain                  |
| `npm run check:secrets`    | Secret scan of tracked files                                   |

## Conventions

- TypeScript `strict` + `noUncheckedIndexedAccess`; no `any`, no `@ts-ignore`.
  The only `eslint-disable` style exceptions are documented in `eslint.config.mjs`
  (test-only rules for Vitest matchers).
- Workspace packages ship TypeScript source with extensionless relative imports
  ([ADR-008](adr/008-monorepo-tooling.md)).
- Addresses and hashes are lowercase everywhere internally.
- uint256 is `bigint` in code, `numeric(78,0)` in SQL, decimal string in JSON.
- Schema change → edit `schema.ts` → `npm run db:generate` → commit the SQL. CI fails if
  the schema and migrations drift.

## Adding things

- **A protocol**: new adapter in `packages/blockchain/src/protocols/`, add to
  `DEFAULT_PROTOCOL_ADAPTERS`, run `npm run verify:protocols`.
- **A heuristic**: implement `Heuristic` in `apps/api/src/analysis/heuristics.ts`, add it
  to `DEFAULT_HEURISTICS`, and add tests for both the firing and the non-firing case.
- **An ABI for decoding**: add an `AbiSource` (standard ABIs in `decoder.ts`, protocol
  ABIs in their adapter).
