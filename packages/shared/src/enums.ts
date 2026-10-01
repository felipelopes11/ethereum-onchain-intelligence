export const TOKEN_STANDARDS = ['erc20', 'erc721', 'erc1155'] as const;
export type TokenStandard = (typeof TOKEN_STANDARDS)[number];

/**
 * `unknown` is a legitimate, persisted state: an address seen in a transaction
 * whose bytecode has not been checked yet. We never default it to `eoa`.
 */
export const ADDRESS_KINDS = ['eoa', 'contract', 'unknown'] as const;
export type AddressKind = (typeof ADDRESS_KINDS)[number];

/**
 * How an address kind was established.
 * - transaction-sender: the address signed a transaction. Only EOAs can, so this is
 *   definitive even when the account has EIP-7702 delegated code.
 * - deployment-receipt / emitted-log: the address has executable code. Since EIP-7702
 *   (Pectra) a delegated EOA also emits logs, so these are reconciled with sender evidence.
 * - eth_getCode: point-in-time state read; a 0xef0100 designator marks a delegated EOA.
 */
export const ADDRESS_KIND_SOURCES = [
  'deployment-receipt',
  'emitted-log',
  'eth_getCode',
  'transaction-sender',
] as const;
export type AddressKindSource = (typeof ADDRESS_KIND_SOURCES)[number];

/**
 * Epistemic status of any statement the system makes about an address.
 * - observed: directly read from blocks, receipts, logs or chain state.
 * - inferred: derived deterministically from observed data (e.g. a log shape matches ERC-20).
 * - heuristic: a rule-of-thumb classification that can be wrong.
 */
export const EVIDENCE_BASES = ['observed', 'inferred', 'heuristic'] as const;
export type EvidenceBasis = (typeof EVIDENCE_BASES)[number];

export const TX_STATUSES = ['success', 'reverted'] as const;
export type TxStatus = (typeof TX_STATUSES)[number];

export const TOKEN_METADATA_STATUSES = ['pending', 'complete', 'partial', 'failed'] as const;
export type TokenMetadataStatus = (typeof TOKEN_METADATA_STATUSES)[number];

export const PROTOCOL_CATEGORIES = ['dex', 'lending', 'wrapper', 'other'] as const;
export type ProtocolCategory = (typeof PROTOCOL_CATEGORIES)[number];
