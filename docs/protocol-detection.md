# Protocol detection

Code: [`packages/blockchain/src/protocols`](../packages/blockchain/src/protocols).

## Detection vs interpretation

| Step               | Question                                   | Input                       | Implementation                          |
| ------------------ | ------------------------------------------ | --------------------------- | --------------------------------------- |
| **Detection**      | Is this address a known protocol contract? | an address                  | `ProtocolRegistry.detect` (address map) |
| **Interpretation** | What action does this call represent?      | protocol + decoded function | `ProtocolRegistry.interpretFunction`    |

Detection never uses event or function _shapes_: a contract emitting a Uniswap-shaped
`Swap` event is not Uniswap. Interpretation never looks at outcomes: `exactInputSingle`
is a _swap-related transaction_; whether it was profitable is not claimed.

## Adapters

A protocol is a declarative `ProtocolAdapter`:

```ts
{
  id: 'aave-v3',
  name: 'Aave V3',
  category: 'lending',
  website: 'https://aave.com',
  deployments: { 11155111: [{ address, role: 'pool', abiIds: ['aave-v3-pool'], verification }] },
  abis: [{ id: 'aave-v3-pool', abi: aaveV3PoolAbi }],
  functionActions: { supply: 'supply', borrow: 'borrow', /* ... */ },
  eventActions: { Supply: 'supply', /* ... */ },
}
```

Adding a protocol means adding one adapter file and listing it in
`DEFAULT_PROTOCOL_ADAPTERS`. No indexer or API change is needed: the indexer mirrors the
registry into `protocols`/`protocol_contracts`/`wallet_labels` at startup, and SQL
analytics join against it. The registry refuses two adapters claiming the same address.

## Currently registered (Sepolia)

| Protocol | Contracts                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------- |
| Uniswap  | V2 Router02, V2 Factory, V3 Factory, SwapRouter02, NonfungiblePositionManager, UniversalRouter |
| Aave V3  | Pool, PoolAddressesProvider, WrappedTokenGatewayV3, testnet Faucet                             |

The set is deliberately small. Each address was taken from the protocol's official
deployment list and is **verified on-chain** by `npm run verify:protocols`:

```
[ok]   Uniswap   v2-router-02      0xee567fe1…  factory() = 0xF62c03E0…  (registered V2 factory)
[ok]   Uniswap   v3-swap-router-02 0x3bfa4769…  factory() = 0x0227628f…  (registered V3 factory)
[ok]   Aave V3   pool              0x6ae43d32…  ADDRESSES_PROVIDER() = 0x012bAC54…
[ok]   Aave V3   pool-addresses-provider        getPool() = 0x6Ae43d32…
```

Contracts cross-reference each other, so a wrong address in the config is caught.

## Known limits

- Universal Router `execute` and `multicall` are interpreted as `batched-call`: the inner
  commands are not decoded, so the system does not claim what they did.
- Liquidity pools and pairs are created permissionlessly and are not in the registry;
  verifying them via `factory.getPool()` is a V2 roadmap item.
