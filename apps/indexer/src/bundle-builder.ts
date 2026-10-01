import {
  decodeTokenTransfer,
  selectorOf,
  type ChainBlock,
  type ChainReceipt,
  type TokenTransferEvent,
} from '@eoi/blockchain';
import type { BlockBundle, ObservedContract } from '@eoi/database';
import type { Hex, TokenStandard } from '@eoi/shared';

export interface BundleStats {
  transactions: number;
  logs: number;
  transfers: number;
  /** Logs whose topic0 matched a token event but whose shape did not. Stored as raw logs only. */
  malformedTransferLogs: number;
}

class ContractCollector {
  private readonly byAddress = new Map<Hex, ObservedContract>();

  observeEmitter(address: Hex, standard: TokenStandard | null): void {
    const existing = this.byAddress.get(address);
    if (!existing) {
      this.byAddress.set(address, {
        address,
        deployment: null,
        evidence: 'emitted-log',
        interfaces: standard ? [standard] : [],
      });
      return;
    }
    if (standard && !existing.interfaces.includes(standard)) existing.interfaces.push(standard);
  }

  observeDeployment(address: Hex, deployer: Hex, transactionHash: Hex, blockNumber: bigint): void {
    const existing = this.byAddress.get(address);
    const deployment = { deployer, transactionHash, blockNumber };
    if (existing) {
      existing.deployment = deployment;
      existing.evidence = 'deployment-receipt';
      return;
    }
    this.byAddress.set(address, {
      address,
      deployment,
      evidence: 'deployment-receipt',
      interfaces: [],
    });
  }

  values(): ObservedContract[] {
    return [...this.byAddress.values()];
  }
}

function pushTransfer(
  bundle: BlockBundle,
  chainId: number,
  blockNumber: bigint,
  txHash: Hex,
  event: TokenTransferEvent,
): number {
  const base = {
    chainId,
    blockNumber,
    logIndex: event.logIndex,
    transactionHash: txHash,
    tokenAddress: event.token,
    fromAddress: event.from,
    toAddress: event.to,
  };
  switch (event.standard) {
    case 'erc20':
      bundle.erc20Transfers.push({ ...base, value: event.value });
      return 1;
    case 'erc721':
      bundle.erc721Transfers.push({ ...base, tokenId: event.tokenId });
      return 1;
    case 'erc1155':
      event.items.forEach((item, batchIndex) => {
        bundle.erc1155Transfers.push({
          ...base,
          batchIndex,
          operator: event.operator,
          tokenId: item.tokenId,
          value: item.value,
        });
      });
      return event.items.length;
  }
}

/**
 * Pure transformation from RPC data to database rows. No I/O, so the indexing logic
 * (what counts as a contract, a token, a transfer) is tested without a node.
 */
export function buildBundle(
  chainId: number,
  block: ChainBlock,
  receipts: readonly ChainReceipt[],
): { bundle: BlockBundle; stats: BundleStats } {
  const bundle: BlockBundle = {
    block: {
      chainId,
      number: block.number,
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: new Date(Number(block.timestamp) * 1000),
      miner: block.miner,
      gasUsed: block.gasUsed,
      gasLimit: block.gasLimit,
      baseFeePerGas: block.baseFeePerGas,
      transactionCount: block.transactions.length,
    },
    transactions: [],
    receipts: [],
    logs: [],
    erc20Transfers: [],
    erc721Transfers: [],
    erc1155Transfers: [],
    contracts: [],
    tokens: [],
  };
  const stats: BundleStats = {
    transactions: block.transactions.length,
    logs: 0,
    transfers: 0,
    malformedTransferLogs: 0,
  };
  const contracts = new ContractCollector();
  const tokens = new Map<Hex, TokenStandard>();

  for (const tx of block.transactions) {
    bundle.transactions.push({
      chainId,
      hash: tx.hash,
      blockNumber: block.number,
      transactionIndex: tx.transactionIndex,
      fromAddress: tx.from,
      toAddress: tx.to,
      value: tx.value,
      nonce: tx.nonce,
      type: tx.type,
      gasLimit: tx.gas,
      gasPrice: tx.gasPrice,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      input: tx.input,
      selector: selectorOf(tx.input),
    });
  }

  for (const receipt of receipts) {
    bundle.receipts.push({
      chainId,
      transactionHash: receipt.transactionHash,
      status: receipt.status === 'success' ? 1 : 0,
      gasUsed: receipt.gasUsed,
      cumulativeGasUsed: receipt.cumulativeGasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      contractAddress: receipt.contractAddress,
      logCount: receipt.logs.length,
    });

    // A reverted creation leaves no code behind, so only successful deployments count.
    if (receipt.contractAddress && receipt.status === 'success') {
      contracts.observeDeployment(
        receipt.contractAddress,
        receipt.from,
        receipt.transactionHash,
        block.number,
      );
    }

    for (const log of receipt.logs) {
      if (log.removed) continue;
      stats.logs++;
      bundle.logs.push({
        chainId,
        blockNumber: block.number,
        logIndex: log.logIndex,
        transactionHash: log.transactionHash,
        address: log.address,
        topic0: log.topics[0] ?? null,
        topic1: log.topics[1] ?? null,
        topic2: log.topics[2] ?? null,
        topic3: log.topics[3] ?? null,
        data: log.data,
      });

      const decoded = decodeTokenTransfer(log);
      if (decoded.kind === 'transfer') {
        stats.transfers += pushTransfer(
          bundle,
          chainId,
          block.number,
          log.transactionHash,
          decoded.event,
        );
        contracts.observeEmitter(log.address, decoded.event.standard);
        if (!tokens.has(log.address)) tokens.set(log.address, decoded.event.standard);
      } else {
        if (decoded.kind === 'malformed') stats.malformedTransferLogs++;
        // Only contracts can emit logs: this alone is on-chain proof the address has code.
        contracts.observeEmitter(log.address, null);
      }
    }
  }

  bundle.contracts = contracts.values();
  bundle.tokens = [...tokens].map(([address, standard]) => ({ address, standard }));
  return { bundle, stats };
}
