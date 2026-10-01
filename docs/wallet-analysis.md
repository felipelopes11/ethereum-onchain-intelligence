# Wallet analysis

Code: [`apps/api/src/analysis`](../apps/api/src/analysis),
[`apps/api/src/services/address-service.ts`](../apps/api/src/services/address-service.ts).

## Evidence levels

Every statement carries a `basis`:

| Basis       | Meaning                                       | Example                                                       |
| ----------- | --------------------------------------------- | ------------------------------------------------------------- |
| `observed`  | Read directly from chain data                 | "Transactions signed by this address: 164"                    |
| `inferred`  | Derived deterministically from observed data  | "Likely ERC-20 token contract" (emitted ERC-20-shaped events) |
| `heuristic` | Rule with an explicit threshold; can be wrong | "Likely DeFi participant"                                     |

## Heuristics (v1.0.0)

| Id                    | Basis     | Fires when                                                                   |
| --------------------- | --------- | ---------------------------------------------------------------------------- |
| `account-type`        | observed  | Kind is known; distinguishes EOA, EOA with EIP-7702 delegation, and contract |
| `token-contract`      | inferred  | Contract with ERC-20 standard in `tokens`                                    |
| `nft-contract`        | inferred  | Contract with ERC-721/1155 standard                                          |
| `contract-deployer`   | observed  | ≥ 1 successful contract creation sent by the address                         |
| `defi-participant`    | heuristic | ≥ 3 outgoing transactions to known DEX or lending contracts                  |
| `heavy-contract-user` | heuristic | ≥ 20 sent transactions and ≥ 70 % of them carry calldata                     |

Each heuristic is a pure function `(AnalysisInput) → { label, basis, evidence[] } | null`
with a human-readable `rule` string that includes its thresholds. A rule that cannot point
to concrete counts does not fire. Adding one means appending to `DEFAULT_HEURISTICS`.

## "Explain this wallet"

`GET /api/address/:address/explain` returns a deterministic report:

- **Observed activity**: counts (sent/received, contract calls, token transfers by standard,
  interactions per known protocol).
- **Classifications**: each with basis badge, evidence list and rule.
- **Unknowns**: always includes owner identity, off-chain activity and intent; adds
  coverage gaps and unresolved address type when applicable.
- **Limitations** and **Methodology**.

Identical indexed data produces an identical report (tested). No generative model is
involved, and the system works without any AI API.

Example (real Sepolia address during development):

```
Observed activity:  164 transactions sent · 164 with calldata · 158 interactions with Uniswap
Classifications:
  Externally owned account (EOA) with EIP-7702 delegation   [observed]
    - Transactions signed by this address: 164
    - EIP-7702 delegation designator points to 0x63c0…e32b
  Likely DeFi participant                                    [heuristic]
    - Interactions with known DeFi contracts: 158 · Swap-related: 158
  Heavy contract user                                        [heuristic]
Unknowns: owner identity · off-chain activity · intent · activity before block 11821802
```

## Other endpoints

| Endpoint                           | Content                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /api/address/:a`              | Summary: kind + evidence, live balance/nonce, counts, first/last seen, protocols, labels, coverage |
| `GET /api/address/:a/transactions` | Keyset-paginated history with decoded method and protocol                                          |
| `GET /api/address/:a/tokens`       | Per-token observed flows (explicitly not balances)                                                 |
| `GET /api/address/:a/protocols`    | Protocol interactions and interpreted actions                                                      |
| `GET /api/address/:a/activity`     | Timeline (adaptive hour/day), hour-of-week matrix, counterparties, token flows                     |
| `GET /api/transaction/:hash`       | Decoded call and events; RPC fallback outside coverage (`source: "rpc"`)                           |
