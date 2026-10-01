import {
  decodeTokenTransfer,
  describeError,
  type ChainLog,
  type DecodeContext,
} from '@eoi/blockchain';
import { TokenRepository, TransactionQueries, type schema } from '@eoi/database';
import type {
  DecodedEventDto,
  Hex,
  TokenAmountDto,
  TransactionDetailDto,
  TxStatus,
} from '@eoi/shared';
import type { ApiContext } from '../context';

type TokenRow = typeof schema.tokens.$inferSelect;

interface LogInput {
  logIndex: number;
  address: Hex;
  topics: Hex[];
  data: Hex;
}

interface NormalisedTransaction {
  source: TransactionDetailDto['source'];
  hash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  timestamp: Date;
  from: Hex;
  to: Hex | null;
  value: bigint;
  nonce: bigint;
  type: number;
  gasLimit: bigint;
  gasPrice: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  transactionIndex: number;
  input: Hex;
  receipt: {
    status: TxStatus;
    gasUsed: bigint;
    effectiveGasPrice: bigint | null;
    contractAddress: Hex | null;
  } | null;
  logs: LogInput[];
}

export class TransactionService {
  private readonly queries: TransactionQueries;
  private readonly tokens: TokenRepository;

  constructor(private readonly ctx: ApiContext) {
    this.queries = new TransactionQueries(ctx.db, ctx.chain.id);
    this.tokens = new TokenRepository(ctx.db, ctx.chain.id);
  }

  /** Indexed data first; RPC only for transactions outside the indexed range. */
  async get(hash: Hex): Promise<TransactionDetailDto | null> {
    const normalised = (await this.fromIndex(hash)) ?? (await this.fromRpc(hash));
    return normalised ? this.present(normalised) : null;
  }

  private async fromIndex(hash: Hex): Promise<NormalisedTransaction | null> {
    const row = await this.queries.findByHash(hash);
    if (!row) return null;
    const { transaction: tx, receipt } = row;
    return {
      source: 'index',
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      blockHash: row.blockHash,
      timestamp: row.timestamp,
      from: tx.fromAddress,
      to: tx.toAddress,
      value: tx.value,
      nonce: tx.nonce,
      type: tx.type,
      gasLimit: tx.gasLimit,
      gasPrice: tx.gasPrice,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      transactionIndex: tx.transactionIndex,
      input: tx.input,
      receipt: receipt
        ? {
            status: receipt.status === 1 ? 'success' : 'reverted',
            gasUsed: receipt.gasUsed,
            effectiveGasPrice: receipt.effectiveGasPrice,
            contractAddress: receipt.contractAddress,
          }
        : null,
      logs: row.logs.map((log) => ({
        logIndex: log.logIndex,
        address: log.address,
        topics: [log.topic0, log.topic1, log.topic2, log.topic3].filter(
          (t): t is Hex => t !== null,
        ),
        data: log.data,
      })),
    };
  }

  private async fromRpc(hash: Hex): Promise<NormalisedTransaction | null> {
    const tx = await this.ctx.provider.getTransaction(hash);
    if (!tx) return null;
    const [receipt, timestamp] = await Promise.all([
      this.ctx.provider.getTransactionReceipt(hash),
      this.ctx.provider.getBlockTimestamp(tx.blockNumber),
    ]);
    return {
      source: 'rpc',
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      blockHash: tx.blockHash,
      timestamp: new Date(Number(timestamp) * 1000),
      from: tx.from,
      to: tx.to,
      value: tx.value,
      nonce: tx.nonce,
      type: tx.type,
      gasLimit: tx.gas,
      gasPrice: tx.gasPrice,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      transactionIndex: tx.transactionIndex,
      input: tx.input,
      receipt: receipt
        ? {
            status: receipt.status,
            gasUsed: receipt.gasUsed,
            effectiveGasPrice: receipt.effectiveGasPrice,
            contractAddress: receipt.contractAddress,
          }
        : null,
      logs: (receipt?.logs ?? []).map((log: ChainLog) => ({
        logIndex: log.logIndex,
        address: log.address,
        topics: log.topics,
        data: log.data,
      })),
    };
  }

  private async present(tx: NormalisedTransaction): Promise<TransactionDetailDto> {
    const tokenAddresses = [
      ...new Set([...tx.logs.map((l) => l.address), ...(tx.to ? [tx.to] : [])]),
    ];
    const tokenRows = await this.tokens.findByAddresses(tokenAddresses);
    const tokens = new Map(tokenRows.map((row) => [row.address, row]));
    const target = this.ctx.protocols.detect(tx.to);

    const effectiveGasPrice = tx.receipt?.effectiveGasPrice ?? null;
    const fee =
      tx.receipt && effectiveGasPrice !== null
        ? (tx.receipt.gasUsed * effectiveGasPrice).toString()
        : null;

    return {
      hash: tx.hash,
      chainId: this.ctx.chain.id,
      source: tx.source,
      blockNumber: tx.blockNumber.toString(),
      blockHash: tx.blockHash,
      timestamp: tx.timestamp.toISOString(),
      confirmations: await this.confirmations(tx.blockNumber),
      from: tx.from,
      to: tx.to,
      contractCreated: tx.receipt?.contractAddress ?? null,
      value: tx.value.toString(),
      nonce: tx.nonce.toString(),
      type: tx.type,
      gasLimit: tx.gasLimit.toString(),
      gasUsed: tx.receipt?.gasUsed.toString() ?? null,
      gasPrice: tx.gasPrice?.toString() ?? null,
      maxFeePerGas: tx.maxFeePerGas?.toString() ?? null,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString() ?? null,
      effectiveGasPrice: tx.receipt?.effectiveGasPrice?.toString() ?? null,
      fee,
      status: tx.receipt?.status ?? null,
      transactionIndex: tx.transactionIndex,
      input: tx.input,
      decoded: this.ctx.abis.decodeCall(tx.input, this.contextFor(tx.to, tokens)),
      protocol: target?.protocol ?? null,
      events: tx.logs.map((log) => this.presentEvent(log, tokens)),
    };
  }

  private contextFor(address: Hex | null, tokens: Map<Hex, TokenRow>): DecodeContext {
    if (!address) return {};
    return {
      abiIds: this.ctx.protocols.detect(address)?.contract.abiIds ?? [],
      standard: tokens.get(address)?.standard ?? null,
    };
  }

  private presentEvent(log: LogInput, tokens: Map<Hex, TokenRow>): DecodedEventDto {
    const decoded = this.ctx.abis.decodeEvent(log, this.contextFor(log.address, tokens));
    const token = tokens.get(log.address);
    const amount = (raw: bigint): TokenAmountDto => ({
      token: log.address,
      symbol: token?.symbol ?? null,
      decimals: token?.decimals ?? null,
      raw: raw.toString(),
    });

    const transfer: DecodedEventDto['transfer'] = [];
    const result = decodeTokenTransfer(log);
    if (result.kind === 'transfer') {
      const event = result.event;
      if (event.standard === 'erc20') {
        transfer.push({
          standard: 'erc20',
          from: event.from,
          to: event.to,
          amount: amount(event.value),
          tokenId: null,
        });
      } else if (event.standard === 'erc721') {
        transfer.push({
          standard: 'erc721',
          from: event.from,
          to: event.to,
          amount: null,
          tokenId: event.tokenId.toString(),
        });
      } else {
        for (const item of event.items) {
          transfer.push({
            standard: 'erc1155',
            from: event.from,
            to: event.to,
            amount: amount(item.value),
            tokenId: item.tokenId.toString(),
          });
        }
      }
    }

    return {
      logIndex: log.logIndex,
      address: log.address,
      status: decoded.status,
      name: decoded.name,
      signature: decoded.signature,
      abiSource: decoded.abiSource,
      args: decoded.args,
      transfer,
      raw: { topics: log.topics, data: log.data },
    };
  }

  private async confirmations(blockNumber: bigint): Promise<string | null> {
    try {
      const head = await this.ctx.caches.head.getOrLoad('head', () =>
        this.ctx.provider.getLatestBlockNumber(),
      );
      return head >= blockNumber ? (head - blockNumber + 1n).toString() : '0';
    } catch (error) {
      this.ctx.logger.warn({ err: describeError(error) }, 'could not read chain head');
      return null;
    }
  }
}
