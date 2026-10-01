# Limitations

What the system cannot know or does not do, stated plainly.

## Inherent to blockchain data

- **Identity**: who controls an address is not on-chain. Many addresses can belong to
  one person; one address (multisig, smart account) can serve many.
- **Intent and off-chain context**: why a transaction happened, exchange accounts,
  payments outside the chain.
- **Token identity**: names and symbols are self-declared; Sepolia has many "USDC"s.

## Scope of the index

- Only blocks within the coverage range (`sync_state.start_block … last_processed_block`)
  are analysed. Every API response carries this range.
- The newest `CONFIRMATIONS` blocks are intentionally not indexed yet.
- **Internal transactions** (value moved inside contract execution) are not traced.
  Only top-level transactions, receipts and logs are indexed.
- Token "net flow" is not a balance. ETH balance and nonce are live RPC reads.

## Decoding and detection

- Decoding covers ERC-20/721/1155, WETH, and the Uniswap/Aave ABIs in the registry.
  Everything else is reported as an unknown interaction with selector and raw input.
- Universal Router / multicall inner commands are not decoded.
- Protocol detection covers only registered addresses on Sepolia (Uniswap, Aave V3).
- ERC-20/721 detection is structural; a contract may emit standard-shaped events without
  implementing the standard.

## Heuristics

- Thresholds are explicit but arbitrary; classifications can be wrong.
- Address kind via `eth_getCode` is a point-in-time read.
- Since EIP-7702, delegated EOAs emit logs; the indexer's `addresses` table may record
  such an account as a contract via `emitted-log` until the API reconciles it with
  transaction-sender evidence (the API's answer is authoritative).

## Operational

- One indexer instance per chain and database (no leader election yet).
- The PGlite-based `npm run db:local` is a development convenience. It multiplexes all
  clients over one Postgres session and is not meant for production; Docker Compose runs
  a real PostgreSQL server.
- ENS requires a mainnet RPC (`ENS_RPC_URL`); it is disabled otherwise.
