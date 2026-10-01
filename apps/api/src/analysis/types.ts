import type { ProtocolAction } from '@eoi/blockchain';
import type { AddressActivitySummary, ContractActivityRow, Coverage } from '@eoi/database';
import type {
  AddressKind,
  AddressKindSource,
  ClassificationDto,
  Hex,
  ProtocolCategory,
  TokenMetadataStatus,
  TokenStandard,
} from '@eoi/shared';

export interface ProtocolActionCount {
  protocolId: string;
  protocolName: string;
  category: ProtocolCategory;
  /** Null when the call targeted a known protocol contract but the function is not interpreted. */
  action: ProtocolAction | null;
  transactionCount: number;
}

/** Everything the heuristics may look at. Built from indexed data plus point-in-time RPC reads. */
export interface AnalysisInput {
  address: Hex;
  kind: AddressKind;
  kindSource: AddressKindSource | null;
  kindCheckedAtBlock: bigint | null;
  delegatedTo: Hex | null;
  summary: AddressActivitySummary;
  protocolActions: ProtocolActionCount[];
  contractActivity: ContractActivityRow | null;
  token: {
    standard: TokenStandard | null;
    name: string | null;
    symbol: string | null;
    decimals: number | null;
    metadataStatus: TokenMetadataStatus;
  } | null;
  coverage: Coverage;
}

/**
 * A classification rule. Rules are pure and must return their evidence; a rule that
 * cannot point to concrete counts from the input must not fire.
 */
export interface Heuristic {
  id: string;
  /** Human-readable statement of the rule, including thresholds. Shown to users. */
  rule: string;
  evaluate(input: AnalysisInput): Omit<ClassificationDto, 'id' | 'rule'> | null;
}
