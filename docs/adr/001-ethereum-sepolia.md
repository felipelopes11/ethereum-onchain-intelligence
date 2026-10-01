# ADR-001: Ethereum Sepolia as the default network

- Status: accepted
- Date: 2026-10-01

## Context

The platform must be runnable for free, demonstrable in an interview, and realistic
enough to exercise real token and protocol activity. Options: a local devnet (Anvil),
Holesky/Hoodi, Sepolia, or mainnet.

## Decision

Use **Ethereum Sepolia** as the default network (`ETHEREUM_CHAIN_ID=11155111`).

## Consequences

- Free public RPC endpoints exist; no paid dependency.
- Real, continuous activity: during development ~100 transactions and ~250 logs per
  block, real ERC-20/721/1155 transfers, and live Uniswap and Aave V3 deployments.
- Post-merge proof-of-stake behaviour (finality, rare reorgs) matches mainnet, so the
  reorg strategy is meaningful.
- Testnet data is noisy: many tokens impersonate well-known names. That stresses the
  "self-declared" handling, which is desirable.
- Every table is keyed by `chain_id` and `SUPPORTED_CHAINS` includes mainnet, so
  switching networks is configuration plus protocol deployments (roadmap V2).
- A local Anvil devnet was rejected as the default because it has no organic activity to
  analyse; tests use deterministic fixtures instead.
