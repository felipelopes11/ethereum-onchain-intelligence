# ADR-007: Address kind resolution after EIP-7702

- Status: accepted
- Date: 2026-10-01

## Context

The initial rules were "emitted a log or has bytecode ⇒ contract". Running against live
Sepolia showed an address with nonce above 3,000 that had signed hundreds of indexed
transactions yet returned bytecode from `eth_getCode`. Its code was `0xef0100 ‖ address`:
an **EIP-7702 delegation designator** (Pectra upgrade). The account is an EOA that
delegates execution, and delegated code emits logs under the EOA's own address.

## Decision

Resolve the kind from evidence in this order, and expose the source:

1. Signed an indexed transaction ⇒ **EOA** (`transaction-sender`). Only EOAs originate
   transactions, with or without delegation.
2. `eth_getCode` is a delegation designator ⇒ **EOA**, with `delegatedTo`.
3. Deployment receipt or emitted log ⇒ **contract**.
4. `eth_getCode` non-empty ⇒ contract; empty ⇒ EOA (persisted with its block number).
5. RPC unavailable and no indexed evidence ⇒ **unknown**, never a default of EOA.

A migration (`0001`) added `transaction-sender` to the `address_kind_source` enum.

## Consequences

- Delegated EOAs are classified correctly, with the delegate address shown.
- The indexer's `addresses` table may still record `emitted-log ⇒ contract` for such
  accounts; the API's resolution is authoritative, as stated in the limitations.
- This is the project's principle at work: rules are revised when real data contradicts
  them, and the evidence behind each classification stays visible.
