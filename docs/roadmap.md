# Roadmap

## V1 (this release)

- [x] Ethereum Sepolia
- [x] Custom indexer: checkpoint, retries, rate limiting, reorg rollback, health/metrics
- [x] Transactions, receipts and logs
- [x] ERC-20, ERC-721 and ERC-1155 transfer detection; token metadata
- [x] Address analysis API with coverage on every response
- [x] Protocol detection (Uniswap, Aave V3) via an on-chain-verified registry
- [x] Evidence-based classification and "Explain this wallet"
- [x] Web dashboard with timeline, heatmap, counterparties, relationship graph, token flow
- [x] EIP-7702-aware address kind resolution
- [x] OnChainIntelligenceRegistry contract (Foundry)

## V2

- Ethereum Mainnet deployment and mainnet protocol addresses
- More protocols as adapters (e.g. Curve, Balancer, Compound, Lido), each verified on-chain
- Full ENS support (forward/reverse on the indexed chain, avatar records not fetched)
- Pool and pair verification through factory lookups (`getPool`, `getPair`)
- Universal Router command decoding
- Advanced graph: multi-hop relationships, token flow paths
- Contract metadata: verified source/ABI from Sourcify (free, open)

## V3

- Multi-chain EVM (one indexer per chain, shared schema)
- Advanced analytics: materialised aggregates, cohort and time-window queries
- Reorg improvements: index at the head with confirmation status per row, finality-aware
- Distributed indexing: partitioned backfill workers with leader election
- Internal transaction tracing (`debug_traceBlock`) where the RPC supports it
