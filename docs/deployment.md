# Deployment

## Docker Compose (whole stack)

```bash
cp .env.example .env      # optional: defaults work for Sepolia
docker compose up --build
```

| Service    | Image target | Port            | Notes                                            |
| ---------- | ------------ | --------------- | ------------------------------------------------ |
| `postgres` | postgres:17  | —               | volume `pgdata`; not published to the host       |
| `migrate`  | `indexer`    | —               | runs `dist/migrate.js` once, then exits          |
| `indexer`  | `indexer`    | 4100 (internal) | starts after migrations succeed; 30 s stop grace |
| `api`      | `api`        | 4000            | healthcheck on `/health`                         |
| `web`      | `web`        | 3000            | starts when the API is healthy                   |

`NEXT_PUBLIC_API_URL` is a **build argument**: it is baked into the client bundle and
must be the API URL as reached from users' browsers.

The images: API and indexer are self-contained tsup bundles (no `node_modules` in the
runtime image); web is the Next.js standalone server. All run as the unprivileged `node`
user under `tini`.

## Connecting to Ethereum Sepolia

Any Sepolia JSON-RPC endpoint works:

- Free public endpoints (default: `https://ethereum-sepolia-rpc.publicnode.com`). Keep
  `RPC_MAX_REQUESTS_PER_SECOND` low (≈10).
- A free-tier key from a provider (Alchemy, Infura, QuickNode…), kept in your local `.env`
  only. Raise the request rate accordingly.
- Your own node (e.g. Geth + a consensus client).

The indexer checks `eth_chainId` at startup and refuses a mismatch. For a quick demo use
`INDEXER_START_BLOCK=-500`; for a fixed backfill use an absolute block number.

## Publishing the frontend

The web app is a standard Next.js app and needs only `NEXT_PUBLIC_API_URL`.

**Vercel** (free tier):

1. Import the repository; set _Root Directory_ to `apps/web`.
2. Vercel detects npm workspaces; the build command is `npm run build`.
3. Set `NEXT_PUBLIC_API_URL` to the public URL of your API.
4. Add the Vercel domain to the API's `CORS_ORIGIN`.

**Any container host**: build the `web` target with
`--build-arg NEXT_PUBLIC_API_URL=https://api.example.com` and run it on port 3000.

## Publishing the API and indexer

Any host that runs containers (Fly.io, Railway, Render, a VPS) plus a managed Postgres:

- Run `migrate` once per release, before the new API/indexer.
- Run exactly **one** indexer per chain and database.
- Behind a reverse proxy, set `TRUST_PROXY=true` so rate limiting sees client IPs.
- Use `/ready` (API) and `/ready` on port 4100 (indexer) for readiness probes, `/health`
  for liveness.

## Deploying the registry contract (optional)

```bash
cd contracts
cast wallet import deployer --interactive         # encrypted keystore, prompts for the key
forge script script/Deploy.s.sol --rpc-url "$ETHEREUM_RPC_URL" --account deployer --broadcast
```

The deployer becomes the owner. Never put a private key in `.env`.
