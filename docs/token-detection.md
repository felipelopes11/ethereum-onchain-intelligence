# Token detection

Code: [`packages/blockchain/src/token-events.ts`](../packages/blockchain/src/token-events.ts),
[`token-metadata.ts`](../packages/blockchain/src/token-metadata.ts).

## From logs, by structure

| Event                                       | Recognised when                                                           | Stored in           |
| ------------------------------------------- | ------------------------------------------------------------------------- | ------------------- |
| `Transfer(address,address,uint256)` ERC-20  | topic0 matches, **3 topics**, data exactly 32 bytes                       | `token_transfers`   |
| `Transfer(address,address,uint256)` ERC-721 | topic0 matches, **4 topics** (tokenId indexed), empty data                | `erc721_transfers`  |
| `TransferSingle(...)` ERC-1155              | 4 topics, data exactly 64 bytes                                           | `erc1155_transfers` |
| `TransferBatch(...)` ERC-1155               | 4 topics, valid ABI `(uint256[],uint256[])`, equal lengths, ≤ 1,000 items | one row per item    |

Address topics must have their upper 12 bytes zero; otherwise the log is treated as
**malformed** rather than truncated into a plausible-looking address. Malformed logs are
kept as raw logs, counted in metrics, and produce no transfer row.

A contract becomes a `token` when it emits a recognised transfer. This is an
**inference** from the event layout ("ERC-20-shaped"), not proof of standard compliance:
the emitting contract is untrusted.

## Metadata

Read after indexing, never blocking ingestion:

- `name()`, `symbol()`: `string`, with fallback to legacy `bytes32`; sanitised (control
  and bidi characters removed, max 128 / 32 code points).
- `decimals()`: decoded as `uint256` and range-checked `0..255`.
- `totalSupply()`.
- ERC-165 `supportsInterface(0x80ac58cd)` / `(0xd9b67a26)`: recorded as _declared_
  interfaces, merged into `contracts.interfaces`.

All of these are optional in the standards. Absence is stored as `null` and summarised as
`metadata_status` = `complete` | `partial` | `failed`.

## Self-declared names

Sepolia contains many tokens named "USDC", "USDT" or "Uniswap" that are not the
well-known assets. Names and symbols are always presented as **self-declared** next to the
contract address, and the docs/UI never treat a symbol as identity.

## Balances

The platform does not compute token balances from transfers. Token pages show _net
observed flow inside the indexed range_, explicitly labelled as not a balance (missing
history, mints without events, rebasing tokens).
