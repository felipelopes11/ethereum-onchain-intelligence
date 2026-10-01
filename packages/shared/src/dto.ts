/**
 * Wire types shared by the API and the web app.
 *
 * Conventions:
 * - uint256 / int values (wei, token amounts, gas, block numbers) are decimal strings,
 *   because JSON numbers lose precision above 2^53 - 1.
 * - Addresses and hashes are lowercase 0x-prefixed hex.
 * - Timestamps are ISO-8601 UTC strings.
 */
import type {
  AddressKind,
  AddressKindSource,
  EvidenceBasis,
  ProtocolCategory,
  TokenMetadataStatus,
  TokenStandard,
  TxStatus,
} from './enums';
import type { Hex } from './schemas';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** The block range the indexer has processed. Every analytical response carries it. */
export interface CoverageDto {
  chainId: number;
  fromBlock: string | null;
  toBlock: string | null;
  updatedAt: string | null;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiErrorDto {
  error: { code: string; message: string; details?: JsonValue };
}

export interface BlockRefDto {
  blockNumber: string;
  timestamp: string;
  transactionHash: Hex;
}

export interface LabelDto {
  label: string;
  category: string;
  source: string;
}

export interface TokenDto {
  address: Hex;
  standard: TokenStandard | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  metadataStatus: TokenMetadataStatus;
}

export interface ContractDto {
  address: Hex;
  deployer: Hex | null;
  deploymentTransactionHash: Hex | null;
  deploymentBlock: string | null;
  interfaces: TokenStandard[];
}

export interface ProtocolRefDto {
  id: string;
  name: string;
  category: ProtocolCategory;
}

export interface ProtocolInteractionDto extends ProtocolRefDto {
  transactionCount: number;
  contracts: { address: Hex; role: string }[];
  firstBlock: string;
  lastBlock: string;
}

export interface TransferCountsDto {
  incoming: number;
  outgoing: number;
}

export interface AddressSummaryDto {
  address: Hex;
  chainId: number;
  kind: AddressKind;
  kindSource: AddressKindSource | null;
  /** EIP-7702 delegate, when the account's code is a delegation designator. */
  delegatedTo: Hex | null;
  /** Live state read from RPC; null when the RPC call failed. */
  balance: { wei: string; blockNumber: string } | null;
  /** Account nonce from RPC: number of transactions ever sent by an EOA (all history, not just indexed). */
  nonce: number | null;
  transactionCount: { sent: number; received: number; total: number };
  firstSeen: BlockRefDto | null;
  lastSeen: BlockRefDto | null;
  contractsInteracted: number;
  tokens: number;
  transfers: Record<TokenStandard, TransferCountsDto>;
  protocols: ProtocolInteractionDto[];
  labels: LabelDto[];
  contract: ContractDto | null;
  token: TokenDto | null;
  ensName: string | null;
  coverage: CoverageDto;
}

export interface TransactionListItemDto {
  hash: Hex;
  blockNumber: string;
  timestamp: string;
  from: Hex;
  to: Hex | null;
  contractCreated: Hex | null;
  value: string;
  status: TxStatus | null;
  direction: 'out' | 'in' | 'self';
  selector: Hex | null;
  functionName: string | null;
  protocol: ProtocolRefDto | null;
  fee: string | null;
}

export interface DecodedArgDto {
  name: string;
  type: string;
  value: JsonValue;
}

export type DecodedCallDto =
  | { status: 'empty' }
  | {
      status: 'decoded';
      selector: Hex;
      functionName: string;
      signature: string;
      abiSource: string;
      args: DecodedArgDto[];
    }
  | { status: 'unknown'; selector: Hex | null; reason: string };

export interface TokenAmountDto {
  token: Hex;
  symbol: string | null;
  decimals: number | null;
  raw: string;
}

export interface DecodedEventDto {
  logIndex: number;
  address: Hex;
  status: 'decoded' | 'unknown';
  name: string | null;
  signature: string | null;
  abiSource: string | null;
  args: DecodedArgDto[];
  /** Present for token transfer events, so the UI can render "1,250 USDC". */
  transfer: {
    standard: TokenStandard;
    from: Hex;
    to: Hex;
    amount: TokenAmountDto | null;
    tokenId: string | null;
  }[];
  raw: { topics: Hex[]; data: Hex };
}

export interface TransactionDetailDto {
  hash: Hex;
  chainId: number;
  source: 'index' | 'rpc';
  blockNumber: string;
  blockHash: Hex;
  timestamp: string;
  confirmations: string | null;
  from: Hex;
  to: Hex | null;
  contractCreated: Hex | null;
  value: string;
  nonce: string;
  type: number;
  gasLimit: string;
  gasUsed: string | null;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  effectiveGasPrice: string | null;
  fee: string | null;
  status: TxStatus | null;
  transactionIndex: number;
  input: Hex;
  decoded: DecodedCallDto;
  protocol: ProtocolRefDto | null;
  events: DecodedEventDto[];
}

export interface TokenHoldingDto {
  token: TokenDto;
  standard: TokenStandard;
  /** Net flow observed in indexed transfers. NOT a balance: transfers before coverage are unknown. */
  netObserved: string;
  incoming: string;
  outgoing: string;
  transferCount: number;
  lastTransferBlock: string;
}

export interface EvidenceItemDto {
  description: string;
  value: number | string;
}

export interface ClassificationDto {
  id: string;
  label: string;
  basis: EvidenceBasis;
  evidence: EvidenceItemDto[];
  /** Human readable description of the rule, so the reader can judge it. */
  rule: string;
}

export interface ExplainReportDto {
  address: Hex;
  chainId: number;
  generatedAt: string;
  coverage: CoverageDto;
  observedActivity: EvidenceItemDto[];
  classifications: ClassificationDto[];
  unknowns: string[];
  limitations: string[];
  methodology: string[];
}

export interface ActivityBucketDto {
  /** Bucket start, ISO-8601 UTC. */
  start: string;
  outgoing: number;
  incoming: number;
}

export interface CounterpartyDto {
  address: Hex;
  transactionCount: number;
  label: string | null;
  protocol: ProtocolRefDto | null;
  isContract: boolean | null;
}

export interface TokenFlowDto {
  token: TokenDto;
  standard: TokenStandard;
  incoming: string;
  outgoing: string;
  incomingCount: number;
  outgoingCount: number;
}

export interface AddressActivityDto {
  address: Hex;
  coverage: CoverageDto;
  /** Hourly when the address's indexed activity spans few days, daily otherwise. */
  timelineUnit: 'hour' | 'day';
  timeline: ActivityBucketDto[];
  /** 7 x 24 matrix (UTC day of week x hour) of transaction counts. */
  hourOfWeek: number[][];
  counterparties: CounterpartyDto[];
  tokenFlows: TokenFlowDto[];
}

export interface IndexerStatusDto {
  chainId: number;
  lastProcessedBlock: string | null;
  lastProcessedHash: Hex | null;
  chainHead: string | null;
  lag: string | null;
  updatedAt: string | null;
  confirmations: number | null;
}

export type SearchResultDto =
  { type: 'address'; address: Hex; ensName: string | null } | { type: 'transaction'; hash: Hex };
