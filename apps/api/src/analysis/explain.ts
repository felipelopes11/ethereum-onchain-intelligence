import type { CoverageDto, EvidenceItemDto, ExplainReportDto } from '@eoi/shared';
import { classify, HEURISTICS_VERSION } from './heuristics';
import type { AnalysisInput } from './types';

const LIMITATIONS = [
  'Only blocks inside the indexed coverage range are analysed; activity before or after it is not reflected.',
  'Classifications are rule-based heuristics computed from public data. They can be wrong and are not statements of fact.',
  'Protocol detection only recognises contracts in an explicit, versioned registry; interactions with other protocols are reported as unknown contract interactions.',
  'Token names and symbols are self-declared by token contracts and may impersonate well-known assets.',
  'Internal transactions (value moved by contract calls) are not traced; only top-level transactions and emitted logs are indexed.',
  'The same person or organisation can control many addresses; addresses are analysed in isolation.',
];

const METHODOLOGY = [
  'Counts are aggregated from blocks, transactions, receipts and logs persisted by the indexer.',
  'Address type uses on-chain evidence: signed transactions (EOA, including EIP-7702 delegated accounts), emitted logs, deployment receipts, or eth_getCode.',
  'Token transfers are recognised structurally from ERC-20, ERC-721 and ERC-1155 event layouts.',
  `Classifications use heuristics version ${HEURISTICS_VERSION}; each lists its rule and evidence.`,
  'This report is deterministic: identical indexed data always produces the identical report. No generative AI is involved.',
];

function unknowns(input: AnalysisInput, coverage: CoverageDto): string[] {
  const list = [
    'Owner identity is unknown: blockchain data does not reveal who controls an address.',
    'Off-chain activity (exchange accounts, payments, communications) is unknown.',
    'Intent cannot be determined from blockchain data alone.',
  ];
  if (coverage.fromBlock !== null) {
    list.push(`Activity before block ${coverage.fromBlock} has not been indexed.`);
  }
  if (input.kind === 'unknown') {
    list.push('Whether this address is a contract could not be determined (RPC unavailable).');
  }
  if (input.protocolActions.some((p) => p.action === null)) {
    list.push(
      'Some calls to known protocol contracts use functions this system does not interpret.',
    );
  }
  return list;
}

function observedActivity({
  summary,
  contractActivity,
  protocolActions,
}: AnalysisInput): EvidenceItemDto[] {
  const transfers = summary.transfers;
  const items: EvidenceItemDto[] = [
    { description: 'Transactions (sent + received)', value: summary.total },
    { description: 'Transactions sent', value: summary.sent },
    { description: 'Transactions received', value: summary.received },
    {
      description: 'Sent transactions with calldata (contract calls)',
      value: summary.callsWithCalldata,
    },
    { description: 'Distinct known contracts called', value: summary.contractsInteracted },
    { description: 'Distinct token contracts transferred', value: summary.distinctTokens },
    {
      description: 'ERC-20 transfers (in / out)',
      value: `${transfers.erc20.incoming} / ${transfers.erc20.outgoing}`,
    },
    {
      description: 'ERC-721 transfers (in / out)',
      value: `${transfers.erc721.incoming} / ${transfers.erc721.outgoing}`,
    },
    {
      description: 'ERC-1155 transfers (in / out)',
      value: `${transfers.erc1155.incoming} / ${transfers.erc1155.outgoing}`,
    },
  ];
  const byProtocol = new Map<string, number>();
  for (const p of protocolActions)
    byProtocol.set(p.protocolName, (byProtocol.get(p.protocolName) ?? 0) + p.transactionCount);
  for (const [name, count] of [...byProtocol].sort((a, b) => b[1] - a[1])) {
    items.push({ description: `Interactions with known ${name} contracts`, value: count });
  }
  if (contractActivity && contractActivity.logsEmitted > 0) {
    items.push({
      description: 'Logs emitted by this address',
      value: contractActivity.logsEmitted,
    });
  }
  return items;
}

/** "Explain this wallet": a deterministic, evidence-backed report. Never a narrative. */
export function buildExplainReport(
  input: AnalysisInput,
  coverage: CoverageDto,
  generatedAt: Date,
): ExplainReportDto {
  return {
    address: input.address,
    chainId: coverage.chainId,
    generatedAt: generatedAt.toISOString(),
    coverage,
    observedActivity: observedActivity(input),
    classifications: classify(input),
    unknowns: unknowns(input, coverage),
    limitations: LIMITATIONS,
    methodology: METHODOLOGY,
  };
}
