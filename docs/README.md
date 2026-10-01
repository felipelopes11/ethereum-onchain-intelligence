# Technical documentation

| Topic                                   | Document                                           |
| --------------------------------------- | -------------------------------------------------- |
| Architecture                            | [architecture.md](architecture.md)                 |
| Data model                              | [data-model.md](data-model.md)                     |
| Indexer                                 | [indexer.md](indexer.md)                           |
| Ethereum integration                    | [ethereum-integration.md](ethereum-integration.md) |
| Transaction decoder                     | [transaction-decoder.md](transaction-decoder.md)   |
| Token detection                         | [token-detection.md](token-detection.md)           |
| Protocol detection                      | [protocol-detection.md](protocol-detection.md)     |
| Wallet analysis & "Explain this wallet" | [wallet-analysis.md](wallet-analysis.md)           |
| Security                                | [security.md](security.md)                         |
| Performance                             | [performance.md](performance.md)                   |
| Limitations                             | [limitations.md](limitations.md)                   |
| Development                             | [development.md](development.md)                   |
| Deployment                              | [deployment.md](deployment.md)                     |
| Testing                                 | [testing.md](testing.md)                           |
| Roadmap                                 | [roadmap.md](roadmap.md)                           |

## Architecture Decision Records

| ADR                                     | Decision                                            |
| --------------------------------------- | --------------------------------------------------- |
| [001](adr/001-ethereum-sepolia.md)      | Ethereum Sepolia as the default network             |
| [002](adr/002-postgresql.md)            | PostgreSQL (+ Drizzle, PGlite for tests)            |
| [003](adr/003-custom-indexer.md)        | Custom indexer on raw JSON-RPC                      |
| [004](adr/004-viem.md)                  | viem behind a `BlockchainProvider` abstraction      |
| [005](adr/005-reorg-handling.md)        | Reorg handling: confirmations, continuity, rollback |
| [006](adr/006-hex-text-storage.md)      | Lowercase hex text for addresses and hashes         |
| [007](adr/007-eip-7702-address-kind.md) | Address kind resolution after EIP-7702              |
| [008](adr/008-monorepo-tooling.md)      | npm workspaces, source packages, bundled apps       |
