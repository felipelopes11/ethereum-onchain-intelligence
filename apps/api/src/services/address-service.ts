import { describeError, parseDelegationDesignator } from '@eoi/blockchain';
import {
  AddressQueries,
  TokenRepository,
  TransactionQueries,
  type AddressActivitySummary,
  type ProtocolCallRow,
} from '@eoi/database';
import type {
  AddressActivityDto,
  AddressKind,
  AddressKindSource,
  AddressSummaryDto,
  CounterpartyDto,
  ExplainReportDto,
  Hex,
  Paginated,
  Pagination,
  ProtocolCategory,
  ProtocolInteractionDto,
  TokenFlowDto,
  TokenHoldingDto,
  TransactionListItemDto,
} from '@eoi/shared';
import { buildExplainReport } from '../analysis/explain';
import type { AnalysisInput, ProtocolActionCount } from '../analysis/types';
import type { ApiContext } from '../context';
import { coverageDto, tokenDto, unknownTokenDto } from './presenters';

interface KindResolution {
  kind: AddressKind;
  source: AddressKindSource | null;
  checkedAtBlock: bigint | null;
  delegatedTo: Hex | null;
}

/** Bounds RPC fan-out when enriching counterparties with bytecode checks. */
const MAX_COUNTERPARTY_CODE_CHECKS = 10;
const MIN_DAILY_BUCKETS = 4;

export class AddressService {
  private readonly queries: AddressQueries;
  private readonly transactions: TransactionQueries;
  private readonly tokens: TokenRepository;

  constructor(private readonly ctx: ApiContext) {
    this.queries = new AddressQueries(ctx.db, ctx.chain.id);
    this.transactions = new TransactionQueries(ctx.db, ctx.chain.id);
    this.tokens = new TokenRepository(ctx.db, ctx.chain.id);
  }

  async summary(address: Hex): Promise<AddressSummaryDto> {
    const [
      coverage,
      kind,
      activity,
      protocolRows,
      labels,
      contract,
      token,
      balance,
      nonce,
      ensName,
    ] = await Promise.all([
      this.queries.coverage(),
      this.resolveKind(address),
      this.queries.activitySummary(address),
      this.queries.protocolCalls(address),
      this.queries.labels(address),
      this.queries.contract(address),
      this.queries.token(address),
      this.balance(address),
      this.nonce(address),
      this.ensName(address),
    ]);

    return {
      address,
      chainId: this.ctx.chain.id,
      kind: kind.kind,
      kindSource: kind.source,
      delegatedTo: kind.delegatedTo,
      balance: balance
        ? { wei: balance.wei.toString(), blockNumber: balance.blockNumber.toString() }
        : null,
      nonce,
      transactionCount: { sent: activity.sent, received: activity.received, total: activity.total },
      firstSeen: appearanceDto(activity.firstSeen),
      lastSeen: appearanceDto(activity.lastSeen),
      contractsInteracted: activity.contractsInteracted,
      tokens: activity.distinctTokens,
      transfers: activity.transfers,
      protocols: groupProtocols(protocolRows),
      labels,
      contract: contract
        ? {
            address: contract.address,
            deployer: contract.deployer,
            deploymentTransactionHash: contract.deploymentTransactionHash,
            deploymentBlock: contract.deploymentBlock?.toString() ?? null,
            interfaces: contract.interfaces,
          }
        : null,
      token: token ? tokenDto(token) : null,
      ensName,
      coverage: coverageDto(this.ctx.chain.id, coverage),
    };
  }

  async protocols(address: Hex): Promise<{
    coverage: AddressSummaryDto['coverage'];
    protocols: ProtocolInteractionDto[];
    actions: ProtocolActionCount[];
  }> {
    const [coverage, rows] = await Promise.all([
      this.queries.coverage(),
      this.queries.protocolCalls(address),
    ]);
    return {
      coverage: coverageDto(this.ctx.chain.id, coverage),
      protocols: groupProtocols(rows),
      actions: this.interpretProtocolCalls(rows),
    };
  }

  async tokenHoldings(
    address: Hex,
  ): Promise<{ coverage: AddressSummaryDto['coverage']; items: TokenHoldingDto[] }> {
    const [coverage, flows] = await Promise.all([
      this.queries.coverage(),
      this.tokenFlows(address),
    ]);
    return {
      coverage: coverageDto(this.ctx.chain.id, coverage),
      items: flows.map((flow) => ({
        token: flow.token,
        standard: flow.standard,
        netObserved: (BigInt(flow.incoming) - BigInt(flow.outgoing)).toString(),
        incoming: flow.incoming,
        outgoing: flow.outgoing,
        transferCount: flow.incomingCount + flow.outgoingCount,
        lastTransferBlock: flow.lastBlock,
      })),
    };
  }

  async activity(address: Hex): Promise<AddressActivityDto> {
    const [coverage, timeline, hourOfWeek, counterparties, tokenFlows] = await Promise.all([
      this.queries.coverage(),
      this.timeline(address),
      this.queries.hourOfWeek(address),
      this.counterparties(address),
      this.tokenFlows(address),
    ]);
    return {
      address,
      coverage: coverageDto(this.ctx.chain.id, coverage),
      timelineUnit: timeline.unit,
      timeline: timeline.buckets,
      hourOfWeek,
      counterparties,
      tokenFlows: tokenFlows.map(({ lastBlock: _lastBlock, ...flow }) => flow),
    };
  }

  /** Daily buckets unless that yields too few to show a shape; then hourly. */
  private async timeline(address: Hex) {
    const daily = await this.queries.activityTimeline(address, 'day');
    if (daily.length >= MIN_DAILY_BUCKETS) return { unit: 'day' as const, buckets: daily };
    return { unit: 'hour' as const, buckets: await this.queries.activityTimeline(address, 'hour') };
  }

  async explain(address: Hex): Promise<ExplainReportDto> {
    const input = await this.analysisInput(address);
    return buildExplainReport(
      input,
      coverageDto(this.ctx.chain.id, input.coverage),
      this.ctx.now(),
    );
  }

  async transactionPage(
    address: Hex,
    pagination: Pagination,
  ): Promise<Paginated<TransactionListItemDto>> {
    const page = await this.transactions.listByAddress(
      address,
      pagination.limit,
      pagination.cursor,
    );
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((tx) => {
        const match = this.ctx.protocols.detect(tx.to);
        return {
          hash: tx.hash,
          blockNumber: tx.blockNumber.toString(),
          timestamp: tx.timestamp.toISOString(),
          from: tx.from,
          to: tx.to,
          contractCreated: tx.contractCreated,
          value: tx.value.toString(),
          status: tx.status === null ? null : tx.status === 1 ? 'success' : 'reverted',
          direction:
            tx.from === address && tx.to === address ? 'self' : tx.from === address ? 'out' : 'in',
          selector: tx.selector,
          functionName: tx.selector
            ? this.ctx.abis.functionNameFor(tx.selector, { abiIds: match?.contract.abiIds ?? [] })
            : null,
          protocol: match?.protocol ?? null,
          fee: tx.fee?.toString() ?? null,
        };
      }),
    };
  }

  private async analysisInput(address: Hex): Promise<AnalysisInput> {
    const [coverage, kind, summary, protocolRows, contractActivity, token] = await Promise.all([
      this.queries.coverage(),
      this.resolveKind(address),
      this.queries.activitySummary(address),
      this.queries.protocolCalls(address),
      this.queries.contractActivity(address),
      this.queries.token(address),
    ]);
    return {
      address,
      kind: kind.kind,
      kindSource: kind.source,
      kindCheckedAtBlock: kind.checkedAtBlock,
      delegatedTo: kind.delegatedTo,
      summary,
      protocolActions: this.interpretProtocolCalls(protocolRows),
      contractActivity: kind.kind === 'eoa' ? null : contractActivity,
      token: token
        ? {
            standard: token.standard,
            name: token.name,
            symbol: token.symbol,
            decimals: token.decimals,
            metadataStatus: token.metadataStatus,
          }
        : null,
      coverage,
    };
  }

  /** Detection already happened in SQL (join on the registry); this is interpretation. */
  private interpretProtocolCalls(rows: readonly ProtocolCallRow[]): ProtocolActionCount[] {
    return rows.map((row) => {
      const match = this.ctx.protocols.detect(row.contractAddress);
      const functionName = row.selector
        ? this.ctx.abis.functionNameFor(row.selector, { abiIds: match?.contract.abiIds ?? [] })
        : null;
      return {
        protocolId: row.protocolId,
        protocolName: row.protocolName,
        category: row.category as ProtocolCategory,
        action: this.ctx.protocols.interpretFunction(row.protocolId, functionName),
        transactionCount: row.transactionCount,
      };
    });
  }

  private async tokenFlows(address: Hex): Promise<(TokenFlowDto & { lastBlock: string })[]> {
    const flows = await this.queries.tokenFlows(address);
    const rows = await this.tokens.findByAddresses(flows.map((f) => f.tokenAddress));
    const byAddress = new Map(rows.map((row) => [row.address, row]));
    return flows.map((flow) => {
      const row = byAddress.get(flow.tokenAddress);
      return {
        token: row ? tokenDto(row) : unknownTokenDto(flow.tokenAddress),
        standard: flow.standard,
        incoming: flow.incoming.toString(),
        outgoing: flow.outgoing.toString(),
        incomingCount: flow.incomingCount,
        outgoingCount: flow.outgoingCount,
        lastBlock: flow.lastBlock.toString(),
      };
    });
  }

  private async counterparties(address: Hex): Promise<CounterpartyDto[]> {
    const rows = await this.queries.counterparties(address);
    let budget = MAX_COUNTERPARTY_CODE_CHECKS;
    return Promise.all(
      rows.map(async (row) => {
        let kind = row.kind;
        if ((kind === null || kind === 'unknown') && budget > 0) {
          budget--;
          kind = (await this.resolveKind(row.address)).kind;
        }
        return {
          address: row.address,
          transactionCount: row.transactionCount,
          label: row.label,
          protocol: this.ctx.protocols.detect(row.address)?.protocol ?? null,
          isContract: kind === 'contract' ? true : kind === 'eoa' ? false : null,
        };
      }),
    );
  }

  /**
   * Evidence order (strongest first):
   *  1. Signed a transaction -> EOA. Definitive, even for EIP-7702 delegated accounts.
   *  2. eth_getCode returns a 0xef0100 delegation designator -> EOA with delegation.
   *  3. Deployment receipt or emitted log -> has code -> contract.
   *  4. eth_getCode non-empty -> contract; empty -> EOA (persisted with its block).
   * RPC failures degrade to the indexed evidence, or "unknown"; never a guessed "eoa".
   */
  private async resolveKind(address: Hex): Promise<KindResolution> {
    const [record, isSender, code] = await Promise.all([
      this.queries.addressRecord(address),
      this.queries.hasSentTransactions(address),
      this.code(address),
    ]);
    const delegatedTo = code ? parseDelegationDesignator(code.value) : null;

    if (isSender) {
      return { kind: 'eoa', source: 'transaction-sender', checkedAtBlock: null, delegatedTo };
    }
    if (code && delegatedTo) {
      await this.queries.recordCodeCheck(address, false, code.blockNumber);
      return { kind: 'eoa', source: 'eth_getCode', checkedAtBlock: code.blockNumber, delegatedTo };
    }
    if (record && record.kind !== 'unknown' && record.kindSource !== 'eth_getCode') {
      return {
        kind: record.kind,
        source: record.kindSource,
        checkedAtBlock: record.kindCheckedAtBlock,
        delegatedTo: null,
      };
    }
    if (code) {
      const hasCode = code.value !== null;
      await this.queries.recordCodeCheck(address, hasCode, code.blockNumber);
      return {
        kind: hasCode ? 'contract' : 'eoa',
        source: 'eth_getCode',
        checkedAtBlock: code.blockNumber,
        delegatedTo: null,
      };
    }
    if (record && record.kind !== 'unknown') {
      return {
        kind: record.kind,
        source: record.kindSource,
        checkedAtBlock: record.kindCheckedAtBlock,
        delegatedTo: null,
      };
    }
    return { kind: 'unknown', source: null, checkedAtBlock: null, delegatedTo: null };
  }

  /** Bytecode at the current head, cached. Null when the RPC call failed. */
  private async code(address: Hex): Promise<{ value: Hex | null; blockNumber: bigint } | null> {
    try {
      return await this.ctx.caches.code.getOrLoad(address, async () => {
        const [value, blockNumber] = await Promise.all([
          this.ctx.provider.getCode(address),
          this.head(),
        ]);
        return { value, blockNumber };
      });
    } catch (error) {
      this.ctx.logger.warn({ address, err: describeError(error) }, 'eth_getCode failed');
      return null;
    }
  }

  private head(): Promise<bigint> {
    return this.ctx.caches.head.getOrLoad('head', () => this.ctx.provider.getLatestBlockNumber());
  }

  private async balance(address: Hex) {
    try {
      return await this.ctx.caches.balance.getOrLoad(address, () =>
        this.ctx.provider.getBalance(address),
      );
    } catch (error) {
      this.ctx.logger.warn({ address, err: describeError(error) }, 'eth_getBalance failed');
      return null;
    }
  }

  private async nonce(address: Hex): Promise<number | null> {
    try {
      return await this.ctx.caches.nonce.getOrLoad(address, () =>
        this.ctx.provider.getTransactionCount(address),
      );
    } catch (error) {
      this.ctx.logger.warn(
        { address, err: describeError(error) },
        'eth_getTransactionCount failed',
      );
      return null;
    }
  }

  private async ensName(address: Hex): Promise<string | null> {
    const ens = this.ctx.ens;
    if (!ens) return null;
    try {
      return await this.ctx.caches.ens.getOrLoad(address, () => ens.lookupAddress(address));
    } catch {
      return null;
    }
  }
}

function appearanceDto(appearance: AddressActivitySummary['firstSeen']) {
  return appearance
    ? {
        blockNumber: appearance.blockNumber.toString(),
        timestamp: appearance.timestamp.toISOString(),
        transactionHash: appearance.transactionHash,
      }
    : null;
}

function groupProtocols(rows: readonly ProtocolCallRow[]): ProtocolInteractionDto[] {
  const byProtocol = new Map<string, ProtocolInteractionDto>();
  for (const row of rows) {
    let entry = byProtocol.get(row.protocolId);
    if (!entry) {
      entry = {
        id: row.protocolId,
        name: row.protocolName,
        category: row.category as ProtocolCategory,
        transactionCount: 0,
        contracts: [],
        firstBlock: row.firstBlock.toString(),
        lastBlock: row.lastBlock.toString(),
      };
      byProtocol.set(row.protocolId, entry);
    }
    entry.transactionCount += row.transactionCount;
    if (!entry.contracts.some((c) => c.address === row.contractAddress)) {
      entry.contracts.push({ address: row.contractAddress, role: row.role });
    }
    if (row.firstBlock < BigInt(entry.firstBlock)) entry.firstBlock = row.firstBlock.toString();
    if (row.lastBlock > BigInt(entry.lastBlock)) entry.lastBlock = row.lastBlock.toString();
  }
  return [...byProtocol.values()].sort((a, b) => b.transactionCount - a.transactionCount);
}
