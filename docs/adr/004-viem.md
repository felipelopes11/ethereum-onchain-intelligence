# ADR-004: viem for Ethereum access and ABI handling

- Status: accepted
- Date: 2026-10-01

## Context

Both backend and frontend need JSON-RPC access, ABI encoding/decoding, unit formatting
and address utilities. Candidates: ethers v6, web3.js, viem.

## Decision

Use **viem**, wrapped behind our own `BlockchainProvider` interface.

## Consequences

- Native `bigint` everywhere, strict TypeScript inference from ABIs (`parseAbi`), strict
  event decoding (used to tell ERC-20 and ERC-721 `Transfer` apart), typed RPC error
  classes (used for retry classification), HTTP request batching.
- Tree-shakeable, so the browser bundle only pays for formatting and validation helpers.
- The `BlockchainProvider` boundary keeps viem out of the rest of the system: normalised
  types are plain objects, tests use fakes, and swapping the client library would be
  local to one package.
- viem's own retries are disabled (`retryCount: 0`) because retries, backoff and rate
  limiting live in `EvmProvider`, where they are observable and tested.
