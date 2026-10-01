# Ethereum integration

## One abstraction for all RPC access

`BlockchainProvider` ([`packages/blockchain/src/provider.ts`](../packages/blockchain/src/provider.ts))
is the only way the application reaches a node. `EvmProvider` implements it with viem.
No other module calls viem's client directly, so retries, rate limits and normalisation
live in one place and tests substitute fakes (`FakeChain` in the indexer tests, a stub
provider in the API tests).

| Method                      | JSON-RPC                                                                 | Used by                       |
| --------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| `getLatestBlockNumber`      | `eth_blockNumber`                                                        | indexer, API status           |
| `getBlockWithTransactions`  | `eth_getBlockByNumber(n, true)`                                          | indexer                       |
| `getBlockReceipts`          | `eth_getBlockReceipts(blockHash)` → fallback `eth_getTransactionReceipt` | indexer                       |
| `getBlockHeader`            | `eth_getBlockByNumber(n, false)`                                         | reorg recovery                |
| `getTransaction`/`…Receipt` | `eth_getTransactionByHash` / `…Receipt`                                  | API fallback for unindexed tx |
| `getBalance`                | `eth_blockNumber` + `eth_getBalance(addr, n)`                            | API (pinned to a block)       |
| `getTransactionCount`       | `eth_getTransactionCount`                                                | API (nonce)                   |
| `getCode`                   | `eth_getCode`                                                            | API (address kind, EIP-7702)  |
| `readContracts`             | `eth_call` (batched)                                                     | token metadata                |

## Normalisation

`normalize.ts` converts viem objects into plain, library-independent types with
**lowercase** addresses and hashes. Pending objects (null block number/hash) are rejected
with `DataInconsistencyError`: the platform only reports mined data.

## Consistency checks

- Receipts are requested **by block hash**, so they cannot come from a different fork
  than the block we hold; `assertReceiptsMatchBlock` also checks count, block hash and the
  transaction set. Load-balanced RPC providers occasionally serve a lagging backend; the
  error is retryable.
- Within a batch every block must extend its predecessor (`parentHash`).
- Startup verifies `eth_chainId`.

## Address kind and EIP-7702

Since the Pectra upgrade (EIP-7702) an EOA can set a _delegation designator_ as its code
(`0xef0100 ‖ delegate`). Two classic rules break:

1. "has code ⇒ contract": a delegated EOA has code.
2. "emitted a log ⇒ contract": delegated code runs in the EOA's context, so its logs
   carry the EOA's address.

The resolver therefore orders evidence: **signed a transaction ⇒ EOA** (definitive), then
a delegation designator ⇒ EOA, then emitted logs / deployment receipts ⇒ contract, then
plain `eth_getCode`. This was found on real Sepolia data: an address with 3,000+ nonce
and bytecode `0xef0100…` was being labelled a contract. See
[ADR-007](adr/007-eip-7702-address-kind.md).

## ENS

ENS lives on mainnet. `MainnetEnsResolver` is optional (`ENS_RPC_URL`). Without it,
searching a `.eth` name returns `501 ENS_UNAVAILABLE`; everything else works. Reverse
records are set by the address owner, so the UI presents them as claims.

## Adding Ethereum mainnet (or another EVM chain)

Every table is keyed by `chain_id`; `SUPPORTED_CHAINS` already contains mainnet.
Running a mainnet deployment means pointing `ETHEREUM_RPC_URL`/`ETHEREUM_CHAIN_ID` at it
and adding mainnet deployments to the protocol adapters. Indexing many chains from one
process (multi-chain) is V3 on the roadmap.
