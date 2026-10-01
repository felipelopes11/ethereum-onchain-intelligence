# Transaction decoder

Code: [`packages/blockchain/src/decoder.ts`](../packages/blockchain/src/decoder.ts).

## How calldata is decoded

`AbiRegistry` indexes every registered ABI by 4-byte selector (functions) and topic0
(events). Sources: ERC-20, ERC-721, ERC-1155, WETH, plus the ABIs declared by protocol
adapters. No external signature database is queried: decoding is local, deterministic and
works offline.

| Input                                   | Result                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `0x` (no calldata)                      | `{ status: 'empty' }`: a plain value transfer                                |
| shorter than 4 bytes                    | `unknown`, reason given                                                      |
| selector not in any ABI                 | `unknown` with selector + raw input: shown as _Unknown contract interaction_ |
| selector known, payload does not decode | `unknown` (never a partial guess)                                            |
| selector known and decodes              | `decoded`: function name, canonical signature, named args, ABI source        |
| > 128 KiB calldata                      | `unknown` (DoS guard)                                                        |

## Selector collisions: not guessing

ERC-20 `transferFrom(address,address,uint256)` and ERC-721 `transferFrom(...)` share a
selector; the third argument is an _amount_ in one and a _tokenId_ in the other. The
decoder resolves candidates in this order:

1. ABIs registered for the **exact target contract** (protocol registry),
2. ABIs of the target's **known token standard** (from the `tokens` table),
3. a single unambiguous candidate,
4. otherwise it decodes the types but reports `abiSource: "ambiguous:erc20,erc721"` with
   positional argument names. The UI warns that names are withheld.

## Events

`decodeEvent` uses viem's strict decoding, which rejects a candidate whose indexed layout
does not match. That is how ERC-20 `Transfer` (3 topics) and ERC-721 `Transfer`
(4 topics) are separated even though topic0 is identical. Unknown events keep their raw
topics and data, and the UI opens the raw view by default for them.

Pool/pair event layouts (Uniswap V2 `Swap`/`Sync`, V3 `Swap`/`Mint`/`Burn`) are
registered **for decoding only**. A matching layout is shown as `layout: uniswap-v2-pair-layout`
but never attributes the transaction to Uniswap, because anyone can emit identical events.

## Values

All decoded integers are converted with `toJsonValue`: `bigint` → decimal string, never
`Number`. Addresses are normalised to lowercase.
