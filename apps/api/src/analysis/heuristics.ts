import { ACTION_GROUPS } from '@eoi/blockchain';
import type { ClassificationDto, EvidenceItemDto } from '@eoi/shared';
import type { AnalysisInput, Heuristic } from './types';

export const HEURISTICS_VERSION = '1.0.0';

export const DEFI_MIN_INTERACTIONS = 3;
export const HEAVY_USER_MIN_SENT = 20;
export const HEAVY_USER_MIN_CALL_RATIO = 0.7;

const accountType: Heuristic = {
  id: 'account-type',
  rule: 'An address that signed a transaction is an EOA (only EOAs can originate transactions), including EOAs with an EIP-7702 delegation designator (0xef0100 || delegate) as code. Otherwise it is a contract if it emitted a log, was created by an observed deployment, or eth_getCode returns bytecode.',
  evaluate: ({ kind, kindSource, kindCheckedAtBlock, delegatedTo, summary, contractActivity }) => {
    if (kind === 'unknown') return null;
    const evidence: EvidenceItemDto[] = [];
    if (kindSource === 'transaction-sender') {
      evidence.push({
        description: 'Transactions signed by this address in indexed blocks',
        value: summary.sent,
      });
    }
    if (delegatedTo) {
      evidence.push({
        description: 'EIP-7702 delegation designator points to',
        value: delegatedTo,
      });
    }
    if (kindSource === 'eth_getCode') {
      evidence.push({
        description: delegatedTo
          ? 'eth_getCode returned a delegation designator at block'
          : kind === 'contract'
            ? 'eth_getCode returned non-empty bytecode at block'
            : 'eth_getCode returned empty bytecode at block',
        value: kindCheckedAtBlock?.toString() ?? 'latest',
      });
    }
    if (kindSource === 'emitted-log') {
      evidence.push({
        description: 'Logs emitted by this address in indexed blocks',
        value: contractActivity?.logsEmitted ?? 0,
      });
    }
    if (kindSource === 'deployment-receipt') {
      evidence.push({
        description: 'Contract creation observed in a transaction receipt',
        value: 'yes',
      });
    }
    const label =
      kind === 'contract'
        ? 'Contract'
        : delegatedTo
          ? 'Externally owned account (EOA) with EIP-7702 delegation'
          : 'Externally owned account (EOA)';
    return { label, basis: 'observed', evidence };
  },
};

const tokenContract: Heuristic = {
  id: 'token-contract',
  rule: 'A contract that emitted ERC-20-shaped Transfer events (3 topics, 32-byte value) is likely an ERC-20 token. Name and symbol are self-declared by the contract and are not verified.',
  evaluate: ({ token, contractActivity }) => {
    if (token?.standard !== 'erc20' || !contractActivity) return null;
    return {
      label: 'Likely ERC-20 token contract',
      basis: 'inferred',
      evidence: [
        {
          description: 'Token transfer events emitted in indexed blocks',
          value: contractActivity.transferEventsEmitted,
        },
        { description: 'Self-declared name()', value: token.name ?? 'not available' },
        { description: 'Self-declared symbol()', value: token.symbol ?? 'not available' },
        { description: 'decimals()', value: token.decimals ?? 'not available' },
      ],
    };
  },
};

const nftContract: Heuristic = {
  id: 'nft-contract',
  rule: 'A contract that emitted ERC-721-shaped Transfer events (tokenId indexed) or ERC-1155 TransferSingle/TransferBatch events is likely an NFT / multi-token contract.',
  evaluate: ({ token, contractActivity }) => {
    if ((token?.standard !== 'erc721' && token?.standard !== 'erc1155') || !contractActivity)
      return null;
    return {
      label:
        token.standard === 'erc721'
          ? 'Likely NFT contract (ERC-721)'
          : 'Likely multi-token contract (ERC-1155)',
      basis: 'inferred',
      evidence: [
        {
          description: 'Token transfer events emitted in indexed blocks',
          value: contractActivity.transferEventsEmitted,
        },
        { description: 'Self-declared name()', value: token.name ?? 'not available' },
      ],
    };
  },
};

const defiParticipant: Heuristic = {
  id: 'defi-participant',
  rule: `At least ${DEFI_MIN_INTERACTIONS} outgoing transactions to known DEX or lending protocol contracts (explicit address registry).`,
  evaluate: ({ protocolActions }) => {
    const defi = protocolActions.filter((p) => p.category === 'dex' || p.category === 'lending');
    const total = defi.reduce((sum, p) => sum + p.transactionCount, 0);
    if (total < DEFI_MIN_INTERACTIONS) return null;
    const byGroup = (group: string) =>
      defi
        .filter((p) => p.action && ACTION_GROUPS[p.action] === group)
        .reduce((sum, p) => sum + p.transactionCount, 0);
    const protocolsUsed = [...new Set(defi.map((p) => p.protocolName))].sort();
    return {
      label: 'Likely DeFi participant',
      basis: 'heuristic',
      evidence: [
        { description: 'Interactions with known DeFi contracts', value: total },
        { description: 'Swap-related transactions', value: byGroup('trading') },
        { description: 'Liquidity-related transactions', value: byGroup('liquidity') },
        { description: 'Lending-related transactions', value: byGroup('lending') },
        { description: 'Protocols', value: protocolsUsed.join(', ') },
      ],
    };
  },
};

const heavyContractUser: Heuristic = {
  id: 'heavy-contract-user',
  rule: `At least ${HEAVY_USER_MIN_SENT} sent transactions, of which at least ${HEAVY_USER_MIN_CALL_RATIO * 100}% carry calldata (contract calls rather than plain value transfers).`,
  evaluate: ({ summary }) => {
    if (summary.sent < HEAVY_USER_MIN_SENT) return null;
    const ratio = summary.callsWithCalldata / summary.sent;
    if (ratio < HEAVY_USER_MIN_CALL_RATIO) return null;
    return {
      label: 'Heavy contract user',
      basis: 'heuristic',
      evidence: [
        { description: 'Sent transactions', value: summary.sent },
        { description: 'Sent transactions with calldata', value: summary.callsWithCalldata },
        { description: 'Share of contract calls', value: `${Math.round(ratio * 100)}%` },
        { description: 'Distinct known contracts called', value: summary.contractsInteracted },
      ],
    };
  },
};

const contractDeployer: Heuristic = {
  id: 'contract-deployer',
  rule: 'The address sent at least one successful contract-creation transaction in the indexed range.',
  evaluate: ({ contractActivity }) => {
    if (!contractActivity || contractActivity.deployedContracts === 0) return null;
    return {
      label: 'Contract deployer',
      basis: 'observed',
      evidence: [
        {
          description: 'Successful contract deployments',
          value: contractActivity.deployedContracts,
        },
      ],
    };
  },
};

export const DEFAULT_HEURISTICS: readonly Heuristic[] = [
  accountType,
  tokenContract,
  nftContract,
  contractDeployer,
  defiParticipant,
  heavyContractUser,
];

export function classify(
  input: AnalysisInput,
  heuristics: readonly Heuristic[] = DEFAULT_HEURISTICS,
): ClassificationDto[] {
  return heuristics.flatMap((heuristic) => {
    const result = heuristic.evaluate(input);
    return result ? [{ id: heuristic.id, rule: heuristic.rule, ...result }] : [];
  });
}
