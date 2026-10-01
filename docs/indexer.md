# Indexer

Code: [`apps/indexer`](../apps/indexer). Entry point `src/main.ts`; core loop `src/indexer.ts`;
pure transformation `src/bundle-builder.ts`.

## Loop

```
loop until SIGINT/SIGTERM:
  checkpoint = sync_state
  safeHead   = eth_blockNumber − CONFIRMATIONS
  next       = checkpoint + 1   (or INDEXER_START_BLOCK on first run)
  if next > safeHead: sleep(POLL_INTERVAL); continue
  fetch blocks [next .. min(next+BATCH−1, safeHead)] with FETCH_CONCURRENCY in flight
  if first.parentHash ≠ checkpoint.hash: recover from reorg; continue
  if any block does not extend its predecessor: retry (chain moved mid-fetch)
  BEGIN; insert blocks, txs, receipts, logs, transfers, contracts, tokens; update checkpoint; COMMIT
  fetch metadata for pending tokens
```

## Guarantees

| Property             | Mechanism                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Resume after restart | Checkpoint in `sync_state`, written in the **same transaction** as the batch                   |
| No duplicates        | Natural primary keys + `ON CONFLICT DO NOTHING`; replaying a batch is a no-op                  |
| No partial batches   | One DB transaction per batch; a constraint violation rolls back everything (tested)            |
| Reorg awareness      | Confirmation depth + `parentHash` continuity + rollback to common ancestor (ADR-005)           |
| Consistent receipts  | Receipts fetched **by block hash** and checked: same count, same block hash, same tx set       |
| Wrong network guard  | Startup aborts if `eth_chainId` ≠ `ETHEREUM_CHAIN_ID`                                          |
| Graceful shutdown    | Abort signal stops scheduling; the in-flight transaction commits or rolls back; DB pool closed |

These were exercised against live Sepolia during development. The process was hard-killed
mid-run several times and the database was taken down underneath it; each time it resumed
at checkpoint + 1. After ~1,444 blocks (~175k transactions) the indexed range had no gaps
and an unbroken `parentHash` chain.

| Database situation | Behaviour                                                                              |
| ------------------ | -------------------------------------------------------------------------------------- |
| Outage             | Pool `error` events are logged (not fatal); iterations fail and back off; `/ready` 503 |
| Recovery           | The pool reconnects on the next query; indexing resumes from the checkpoint            |

## Retry, backoff, rate limiting

- `EvmProvider` wraps every RPC call in `withRetry`: exponential backoff with **full
  jitter** (`random(0, min(cap, base·2^n))`), at most `RPC_MAX_RETRIES` retries.
- Only transient errors are retried (`isRetryableRpcError`): HTTP 408/429/5xx, timeouts,
  JSON-RPC `-32005` (limit exceeded), `-32000 header not found`, data-inconsistency
  errors. Invalid params or reverted calls fail immediately.
- A token bucket (`RPC_MAX_REQUESTS_PER_SECOND`) keeps the client under public endpoint
  limits, which is cheaper than eating 429s.
- viem's HTTP transport batches concurrent calls into JSON-RPC batch requests.
- The outer loop backs off exponentially (capped at 60 s) on repeated iteration failures.

## Observability

Structured JSON logs (pino). Per batch:

```json
{
  "msg": "batch indexed",
  "fromBlock": "11821802",
  "toBlock": "11821806",
  "targetBlock": "11821842",
  "chainHead": "11821854",
  "lag": "36",
  "latencyMs": 3129,
  "blocksPerSecond": 1.6,
  "transactions": 504,
  "logs": 1323,
  "transfers": 378,
  "malformed": 0,
  "rpc": { "requests": 12, "errors": 0, "retries": 0, "reverts": 0 }
}
```

`rpc.reverts` counts `eth_call` reverts separately from `errors`: a token without
`name()` is an expected answer, not an infrastructure failure.

Health server on `INDEXER_HEALTH_PORT` (default 4100):

| Endpoint   | Meaning                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| `/health`  | Liveness: the process serves requests                                          |
| `/ready`   | Readiness: the loop succeeded recently (RPC and DB reachable), else 503        |
| `/metrics` | JSON snapshot: current/target block, lag, blocks/s, latency, reorgs, RPC stats |

## Token metadata

New token contracts are inserted with `metadata_status = 'pending'`. After each batch the
indexer reads `name`, `symbol`, `decimals`, `totalSupply` and ERC-165
`supportsInterface(721/1155)` concurrently. Missing optional functions are recorded as
`null` and the status becomes `partial` or `failed`; nothing is guessed. Strings are
sanitised (control and bidi-override characters removed, length capped). Legacy
`bytes32` name/symbol (MKR-style) are supported.

## Configuration

See [`.env.example`](../.env.example). The most important knobs: `CONFIRMATIONS`,
`INDEXER_START_BLOCK` (`-500`, an absolute block, or `latest`), `INDEXER_BATCH_SIZE`,
`INDEXER_FETCH_CONCURRENCY`, `RPC_MAX_REQUESTS_PER_SECOND`, `INDEXER_MAX_REORG_DEPTH`.
