import type { Hex } from 'viem';
import type { ProtocolCategory } from '@eoi/shared';
import type { AbiSource } from '../decoder';

/**
 * What a protocol call does, derived only from the decoded function name of a call
 * to a known protocol contract. It says nothing about whether the call succeeded
 * economically or what the user intended.
 */
export const PROTOCOL_ACTIONS = [
  'swap',
  'add-liquidity',
  'remove-liquidity',
  'collect-fees',
  'supply',
  'withdraw',
  'borrow',
  'repay',
  'liquidation',
  'flash-loan',
  'collateral-config',
  'faucet-mint',
  'batched-call',
] as const;
export type ProtocolAction = (typeof PROTOCOL_ACTIONS)[number];

export const ACTION_GROUPS: Record<ProtocolAction, 'trading' | 'liquidity' | 'lending' | 'other'> =
  {
    swap: 'trading',
    'add-liquidity': 'liquidity',
    'remove-liquidity': 'liquidity',
    'collect-fees': 'liquidity',
    supply: 'lending',
    withdraw: 'lending',
    borrow: 'lending',
    repay: 'lending',
    liquidation: 'lending',
    'flash-loan': 'lending',
    'collateral-config': 'lending',
    'faucet-mint': 'other',
    'batched-call': 'other',
  };

export interface ProtocolContract {
  address: Hex;
  /** e.g. "v3-swap-router-02". Shown to users. */
  role: string;
  /** ABI sources (by id) that describe this contract. */
  abiIds: readonly string[];
  /** Read-only checks proving this deployment is what we claim. See verify-protocols script. */
  verification?: {
    functionSignature: string;
    expect: { kind: 'address'; equals: Hex } | { kind: 'nonzero' };
  };
}

/**
 * A protocol adapter is declarative configuration plus a pure interpretation table.
 * Adding a protocol means adding one of these; no indexer or API code changes.
 */
export interface ProtocolAdapter {
  id: string;
  name: string;
  category: ProtocolCategory;
  website: string;
  deployments: Partial<Record<number, readonly ProtocolContract[]>>;
  abis: readonly AbiSource[];
  /** function name -> action. Functions not listed are recognised but not interpreted. */
  functionActions: Readonly<Record<string, ProtocolAction>>;
  /** event name -> action, for events emitted by known protocol contracts. */
  eventActions?: Readonly<Record<string, ProtocolAction>>;
}
