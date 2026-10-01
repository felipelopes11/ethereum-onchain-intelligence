import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { decodeCursor, encodeCursor } from '../cursor';
import { blocks, logs, transactionReceipts, transactions } from '../schema';
import { queryRows } from '../sql';

type Hex = `0x${string}`;

export interface TransactionListRow {
  hash: Hex;
  blockNumber: bigint;
  transactionIndex: number;
  timestamp: Date;
  from: Hex;
  to: Hex | null;
  value: bigint;
  selector: Hex | null;
  status: 0 | 1 | null;
  contractCreated: Hex | null;
  fee: bigint | null;
}

export interface TransactionPage {
  items: TransactionListRow[];
  nextCursor: string | null;
}

export class TransactionQueries {
  constructor(
    private readonly db: Database,
    private readonly chainId: number,
  ) {}

  async findByHash(hash: Hex) {
    const [row] = await this.db
      .select({
        transaction: transactions,
        receipt: transactionReceipts,
        blockHash: blocks.hash,
        timestamp: blocks.timestamp,
      })
      .from(transactions)
      .innerJoin(
        blocks,
        and(eq(blocks.chainId, transactions.chainId), eq(blocks.number, transactions.blockNumber)),
      )
      .leftJoin(
        transactionReceipts,
        and(
          eq(transactionReceipts.chainId, transactions.chainId),
          eq(transactionReceipts.transactionHash, transactions.hash),
        ),
      )
      .where(and(eq(transactions.chainId, this.chainId), eq(transactions.hash, hash)));
    if (!row) return null;
    const txLogs = await this.db
      .select()
      .from(logs)
      .where(and(eq(logs.chainId, this.chainId), eq(logs.transactionHash, hash)))
      .orderBy(asc(logs.logIndex));
    return { ...row, logs: txLogs };
  }

  /**
   * Each UNION branch walks its own (address, block, index) index and stops after
   * limit + 1 rows, so a page touches at most 2 * (limit + 1) transactions.
   *
   * Keyset pagination on (block_number, transaction_index), newest first. Unlike
   * OFFSET, cost does not grow with page depth and pages stay stable while the
   * indexer appends new blocks.
   */
  async listByAddress(address: Hex, limit: number, cursor?: string): Promise<TransactionPage> {
    const position = cursor ? decodeCursor(cursor) : null;
    if (cursor && !position) throw new InvalidCursorError();
    const chain = this.chainId;
    const keyset = position
      ? sql`AND (block_number, transaction_index) < (${position.blockNumber.toString()}::bigint, ${position.position})`
      : sql``;
    const rows = await queryRows<{
      hash: Hex;
      block_number: string;
      transaction_index: number;
      timestamp: string;
      from_address: Hex;
      to_address: Hex | null;
      value: string;
      selector: Hex | null;
      status: number | null;
      contract_address: Hex | null;
      fee: string | null;
    }>(
      this.db,
      sql`SELECT t.hash, t.block_number::text AS block_number, t.transaction_index, b.timestamp::text AS timestamp,
                 t.from_address, t.to_address, t.value::text AS value, t.selector,
                 r.status::int AS status, r.contract_address,
                 (r.gas_used * r.effective_gas_price)::text AS fee
          FROM (
            (SELECT * FROM transactions WHERE chain_id = ${chain} AND from_address = ${address} ${keyset}
              ORDER BY block_number DESC, transaction_index DESC LIMIT ${limit + 1})
            UNION
            (SELECT * FROM transactions WHERE chain_id = ${chain} AND to_address = ${address} ${keyset}
              ORDER BY block_number DESC, transaction_index DESC LIMIT ${limit + 1})
          ) t
          JOIN blocks b ON b.chain_id = t.chain_id AND b.number = t.block_number
          LEFT JOIN transaction_receipts r ON r.chain_id = t.chain_id AND r.transaction_hash = t.hash
          ORDER BY t.block_number DESC, t.transaction_index DESC
          LIMIT ${limit + 1}`,
    );
    const page = rows.slice(0, limit).map((r): TransactionListRow => ({
      hash: r.hash,
      blockNumber: BigInt(r.block_number),
      transactionIndex: r.transaction_index,
      timestamp: new Date(r.timestamp),
      from: r.from_address,
      to: r.to_address,
      value: BigInt(r.value),
      selector: r.selector,
      status: r.status === null ? null : r.status === 1 ? 1 : 0,
      contractCreated: r.contract_address,
      fee: r.fee === null ? null : BigInt(r.fee),
    }));
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        rows.length > limit && last ? encodeCursor(last.blockNumber, last.transactionIndex) : null,
    };
  }
}

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid pagination cursor');
    this.name = 'InvalidCursorError';
  }
}
