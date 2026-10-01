import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { AddressKind, AddressKindSource, TokenStandard } from '@eoi/shared';
import type { Database } from '../client';
import { addresses, contracts, syncState, tokens, transactions, walletLabels } from '../schema';
import { queryRows } from '../sql';

type Hex = `0x${string}`;

export interface Coverage {
  fromBlock: bigint | null;
  toBlock: bigint | null;
  updatedAt: Date | null;
}

export interface Appearance {
  blockNumber: bigint;
  timestamp: Date;
  transactionHash: Hex;
}

export interface AddressActivitySummary {
  sent: number;
  received: number;
  total: number;
  firstSeen: Appearance | null;
  lastSeen: Appearance | null;
  contractsInteracted: number;
  /** Outgoing transactions carrying calldata (a function selector). */
  callsWithCalldata: number;
  distinctTokens: number;
  transfers: Record<TokenStandard, { incoming: number; outgoing: number }>;
}

export interface ProtocolCallRow {
  protocolId: string;
  protocolName: string;
  category: string;
  contractAddress: Hex;
  role: string;
  selector: Hex | null;
  transactionCount: number;
  successCount: number;
  firstBlock: bigint;
  lastBlock: bigint;
}

export interface TokenFlowRow {
  tokenAddress: Hex;
  standard: TokenStandard;
  incoming: bigint;
  outgoing: bigint;
  incomingCount: number;
  outgoingCount: number;
  lastBlock: bigint;
}

export interface ActivityBucketRow {
  start: string;
  outgoing: number;
  incoming: number;
}

export interface CounterpartyRow {
  address: Hex;
  transactionCount: number;
  kind: AddressKind | null;
  label: string | null;
  protocolId: string | null;
}

export interface ContractActivityRow {
  logsEmitted: number;
  transferEventsEmitted: number;
  distinctCallers: number;
  incomingCalls: number;
  deployedContracts: number;
}

const STANDARD_TABLES = {
  erc20: sql.raw('token_transfers'),
  erc721: sql.raw('erc721_transfers'),
  erc1155: sql.raw('erc1155_transfers'),
} as const;

/**
 * Read-side queries for address analytics. Every figure is computed from indexed
 * rows only, so callers must present it together with the indexer coverage.
 */
export class AddressQueries {
  constructor(
    private readonly db: Database,
    private readonly chainId: number,
  ) {}

  async coverage(): Promise<Coverage> {
    const [row] = await this.db
      .select({
        from: syncState.startBlock,
        to: syncState.lastProcessedBlock,
        updatedAt: syncState.updatedAt,
      })
      .from(syncState)
      .where(eq(syncState.chainId, this.chainId))
      .limit(1);
    return {
      fromBlock: row?.from ?? null,
      toBlock: row?.to ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async addressRecord(address: Hex) {
    const [row] = await this.db
      .select()
      .from(addresses)
      .where(and(eq(addresses.chainId, this.chainId), eq(addresses.address, address)));
    return row ?? null;
  }

  /** Caches a point-in-time `eth_getCode` result. Never downgrades log/receipt evidence. */
  async recordCodeCheck(address: Hex, hasCode: boolean, atBlock: bigint): Promise<void> {
    const kind: AddressKind = hasCode ? 'contract' : 'eoa';
    const source: AddressKindSource = 'eth_getCode';
    await this.db
      .insert(addresses)
      .values({
        chainId: this.chainId,
        address,
        kind,
        kindSource: source,
        kindCheckedAtBlock: atBlock,
      })
      .onConflictDoUpdate({
        target: [addresses.chainId, addresses.address],
        set: { kind, kindSource: source, kindCheckedAtBlock: atBlock, updatedAt: sql`now()` },
        setWhere: sql`${addresses.kindSource} IS NULL OR ${addresses.kindSource} = 'eth_getCode'`,
      });
  }

  /** Only EOAs can sign transactions, so any indexed sent transaction proves EOA. */
  async hasSentTransactions(address: Hex): Promise<boolean> {
    const [row] = await this.db
      .select({ hash: transactions.hash })
      .from(transactions)
      .where(and(eq(transactions.chainId, this.chainId), eq(transactions.fromAddress, address)))
      .limit(1);
    return row !== undefined;
  }

  async contract(address: Hex) {
    const [row] = await this.db
      .select()
      .from(contracts)
      .where(and(eq(contracts.chainId, this.chainId), eq(contracts.address, address)));
    return row ?? null;
  }

  async token(address: Hex) {
    const [row] = await this.db
      .select()
      .from(tokens)
      .where(and(eq(tokens.chainId, this.chainId), eq(tokens.address, address)));
    return row ?? null;
  }

  async labels(address: Hex) {
    return this.db
      .select({
        label: walletLabels.label,
        category: walletLabels.category,
        source: walletLabels.source,
      })
      .from(walletLabels)
      .where(and(eq(walletLabels.chainId, this.chainId), eq(walletLabels.address, address)));
  }

  async activitySummary(address: Hex): Promise<AddressActivitySummary> {
    const chain = this.chainId;
    const [counts] = await queryRows<{
      sent: number;
      received: number;
      total: number;
      contracts: number;
      calls: number;
    }>(
      this.db,
      sql`SELECT
            count(*) FILTER (WHERE from_address = ${address})::int AS sent,
            count(*) FILTER (WHERE to_address = ${address})::int AS received,
            count(*)::int AS total,
            count(*) FILTER (WHERE from_address = ${address} AND selector IS NOT NULL)::int AS calls,
            count(DISTINCT to_address) FILTER (
              WHERE from_address = ${address}
                AND EXISTS (SELECT 1 FROM addresses a WHERE a.chain_id = ${chain}
                            AND a.address = t.to_address AND a.kind = 'contract')
            )::int AS contracts
          FROM transactions t
          WHERE chain_id = ${chain} AND (from_address = ${address} OR to_address = ${address})`,
    );

    const transfers = {} as AddressActivitySummary['transfers'];
    for (const [standard, table] of Object.entries(STANDARD_TABLES) as [TokenStandard, SQL][]) {
      const [row] = await queryRows<{ incoming: number; outgoing: number }>(
        this.db,
        sql`SELECT count(*) FILTER (WHERE to_address = ${address})::int AS incoming,
                   count(*) FILTER (WHERE from_address = ${address})::int AS outgoing
            FROM ${table} WHERE chain_id = ${chain} AND (from_address = ${address} OR to_address = ${address})`,
      );
      transfers[standard] = { incoming: row?.incoming ?? 0, outgoing: row?.outgoing ?? 0 };
    }

    const [distinct] = await queryRows<{ n: number }>(
      this.db,
      sql`SELECT count(DISTINCT token_address)::int AS n FROM (
            SELECT token_address FROM token_transfers WHERE chain_id = ${chain} AND (from_address = ${address} OR to_address = ${address})
            UNION SELECT token_address FROM erc721_transfers WHERE chain_id = ${chain} AND (from_address = ${address} OR to_address = ${address})
            UNION SELECT token_address FROM erc1155_transfers WHERE chain_id = ${chain} AND (from_address = ${address} OR to_address = ${address})
          ) s`,
    );

    const [firstSeen, lastSeen] = await Promise.all([
      this.appearance(address, 'ASC'),
      this.appearance(address, 'DESC'),
    ]);
    return {
      sent: counts?.sent ?? 0,
      received: counts?.received ?? 0,
      total: counts?.total ?? 0,
      firstSeen,
      lastSeen,
      contractsInteracted: counts?.contracts ?? 0,
      callsWithCalldata: counts?.calls ?? 0,
      distinctTokens: distinct?.n ?? 0,
      transfers,
    };
  }

  /** First/last indexed appearance as tx sender/recipient or token transfer party. */
  private async appearance(address: Hex, direction: 'ASC' | 'DESC'): Promise<Appearance | null> {
    const chain = this.chainId;
    const order = sql.raw(direction);
    const [row] = await queryRows<{
      block_number: string;
      transaction_hash: Hex;
      timestamp: string;
    }>(
      this.db,
      sql`SELECT a.block_number::text AS block_number, a.transaction_hash, b.timestamp::text AS timestamp
          FROM (
            (SELECT block_number, transaction_index AS pos, hash AS transaction_hash FROM transactions
              WHERE chain_id = ${chain} AND from_address = ${address} ORDER BY block_number ${order}, transaction_index ${order} LIMIT 1)
            UNION ALL
            (SELECT block_number, transaction_index, hash FROM transactions
              WHERE chain_id = ${chain} AND to_address = ${address} ORDER BY block_number ${order}, transaction_index ${order} LIMIT 1)
            UNION ALL
            (SELECT block_number, log_index, transaction_hash FROM token_transfers
              WHERE chain_id = ${chain} AND (from_address = ${address} OR to_address = ${address}) ORDER BY block_number ${order}, log_index ${order} LIMIT 1)
            UNION ALL
            (SELECT block_number, log_index, transaction_hash FROM erc721_transfers
              WHERE chain_id = ${chain} AND (from_address = ${address} OR to_address = ${address}) ORDER BY block_number ${order}, log_index ${order} LIMIT 1)
            UNION ALL
            (SELECT block_number, log_index, transaction_hash FROM erc1155_transfers
              WHERE chain_id = ${chain} AND (from_address = ${address} OR to_address = ${address}) ORDER BY block_number ${order}, log_index ${order} LIMIT 1)
          ) a
          JOIN blocks b ON b.chain_id = ${chain} AND b.number = a.block_number
          ORDER BY a.block_number ${order}, a.pos ${order}
          LIMIT 1`,
    );
    if (!row) return null;
    return {
      blockNumber: BigInt(row.block_number),
      timestamp: new Date(row.timestamp),
      transactionHash: row.transaction_hash,
    };
  }

  /** Outgoing calls to known protocol contracts, grouped by function selector. */
  async protocolCalls(address: Hex): Promise<ProtocolCallRow[]> {
    const rows = await queryRows<{
      protocol_id: string;
      protocol_name: string;
      category: string;
      contract_address: Hex;
      role: string;
      selector: Hex | null;
      transaction_count: number;
      success_count: number;
      first_block: string;
      last_block: string;
    }>(
      this.db,
      sql`SELECT pc.protocol_id, p.name AS protocol_name, p.category::text AS category,
                 pc.address AS contract_address, pc.role, t.selector,
                 count(*)::int AS transaction_count,
                 count(*) FILTER (WHERE r.status = 1)::int AS success_count,
                 min(t.block_number)::text AS first_block, max(t.block_number)::text AS last_block
          FROM transactions t
          JOIN protocol_contracts pc ON pc.chain_id = t.chain_id AND pc.address = t.to_address
          JOIN protocols p ON p.id = pc.protocol_id
          LEFT JOIN transaction_receipts r ON r.chain_id = t.chain_id AND r.transaction_hash = t.hash
          WHERE t.chain_id = ${this.chainId} AND t.from_address = ${address}
          GROUP BY pc.protocol_id, p.name, p.category, pc.address, pc.role, t.selector
          ORDER BY transaction_count DESC`,
    );
    return rows.map((r) => ({
      protocolId: r.protocol_id,
      protocolName: r.protocol_name,
      category: r.category,
      contractAddress: r.contract_address,
      role: r.role,
      selector: r.selector,
      transactionCount: r.transaction_count,
      successCount: r.success_count,
      firstBlock: BigInt(r.first_block),
      lastBlock: BigInt(r.last_block),
    }));
  }

  async tokenFlows(address: Hex, limit = 100): Promise<TokenFlowRow[]> {
    const chain = this.chainId;
    const rows = await queryRows<{
      token_address: Hex;
      standard: TokenStandard;
      incoming: string;
      outgoing: string;
      incoming_count: number;
      outgoing_count: number;
      last_block: string;
    }>(
      this.db,
      sql`SELECT token_address, standard,
                 sum(CASE WHEN to_address = ${address} THEN amount ELSE 0 END)::text AS incoming,
                 sum(CASE WHEN from_address = ${address} THEN amount ELSE 0 END)::text AS outgoing,
                 count(*) FILTER (WHERE to_address = ${address})::int AS incoming_count,
                 count(*) FILTER (WHERE from_address = ${address})::int AS outgoing_count,
                 max(block_number)::text AS last_block
          FROM (
            SELECT token_address, 'erc20' AS standard, from_address, to_address, value AS amount, block_number
              FROM token_transfers WHERE chain_id = ${chain} AND (from_address = ${address} OR to_address = ${address})
            UNION ALL
            SELECT token_address, 'erc721', from_address, to_address, 1, block_number
              FROM erc721_transfers WHERE chain_id = ${chain} AND (from_address = ${address} OR to_address = ${address})
            UNION ALL
            SELECT token_address, 'erc1155', from_address, to_address, value, block_number
              FROM erc1155_transfers WHERE chain_id = ${chain} AND (from_address = ${address} OR to_address = ${address})
          ) t
          GROUP BY token_address, standard
          ORDER BY max(block_number) DESC
          LIMIT ${limit}`,
    );
    return rows.map((r) => ({
      tokenAddress: r.token_address,
      standard: r.standard,
      incoming: BigInt(r.incoming),
      outgoing: BigInt(r.outgoing),
      incomingCount: r.incoming_count,
      outgoingCount: r.outgoing_count,
      lastBlock: BigInt(r.last_block),
    }));
  }

  /** Transaction counts per UTC hour or day. `start` is the bucket start as ISO-8601. */
  async activityTimeline(address: Hex, unit: 'hour' | 'day'): Promise<ActivityBucketRow[]> {
    const truncate = sql.raw(unit === 'hour' ? "'hour'" : "'day'");
    return queryRows<ActivityBucketRow>(
      this.db,
      sql`SELECT to_char(date_trunc(${truncate}, b.timestamp AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS start,
                 count(*) FILTER (WHERE t.from_address = ${address})::int AS outgoing,
                 count(*) FILTER (WHERE t.to_address = ${address} AND t.from_address <> ${address})::int AS incoming
          FROM transactions t
          JOIN blocks b ON b.chain_id = t.chain_id AND b.number = t.block_number
          WHERE t.chain_id = ${this.chainId} AND (t.from_address = ${address} OR t.to_address = ${address})
          GROUP BY 1 ORDER BY 1`,
    );
  }

  /** 7 x 24 matrix of transaction counts by UTC weekday (0 = Sunday) and hour. */
  async hourOfWeek(address: Hex): Promise<number[][]> {
    const rows = await queryRows<{ dow: number; hour: number; n: number }>(
      this.db,
      sql`SELECT extract(dow FROM b.timestamp AT TIME ZONE 'UTC')::int AS dow,
                 extract(hour FROM b.timestamp AT TIME ZONE 'UTC')::int AS hour,
                 count(*)::int AS n
          FROM transactions t
          JOIN blocks b ON b.chain_id = t.chain_id AND b.number = t.block_number
          WHERE t.chain_id = ${this.chainId} AND (t.from_address = ${address} OR t.to_address = ${address})
          GROUP BY 1, 2`,
    );
    const matrix = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const row of rows) {
      const day = matrix[row.dow];
      if (day && row.hour >= 0 && row.hour < 24) day[row.hour] = row.n;
    }
    return matrix;
  }

  async counterparties(address: Hex, limit = 20): Promise<CounterpartyRow[]> {
    const chain = this.chainId;
    const rows = await queryRows<{
      address: Hex;
      transaction_count: number;
      kind: AddressKind | null;
      label: string | null;
      protocol_id: string | null;
    }>(
      this.db,
      sql`SELECT c.address, c.transaction_count, a.kind::text AS kind,
                 (SELECT l.label FROM wallet_labels l WHERE l.chain_id = ${chain} AND l.address = c.address ORDER BY l.id LIMIT 1) AS label,
                 pc.protocol_id
          FROM (
            SELECT counterparty AS address, count(*)::int AS transaction_count FROM (
              SELECT to_address AS counterparty FROM transactions
                WHERE chain_id = ${chain} AND from_address = ${address} AND to_address IS NOT NULL AND to_address <> ${address}
              UNION ALL
              SELECT from_address FROM transactions
                WHERE chain_id = ${chain} AND to_address = ${address} AND from_address <> ${address}
            ) x GROUP BY counterparty ORDER BY count(*) DESC LIMIT ${limit}
          ) c
          LEFT JOIN addresses a ON a.chain_id = ${chain} AND a.address = c.address
          LEFT JOIN protocol_contracts pc ON pc.chain_id = ${chain} AND pc.address = c.address
          ORDER BY c.transaction_count DESC, c.address`,
    );
    return rows.map((r) => ({
      address: r.address,
      transactionCount: r.transaction_count,
      kind: r.kind,
      label: r.label,
      protocolId: r.protocol_id,
    }));
  }

  /** Activity of an address *as a contract*: what it emitted and who called it. */
  async contractActivity(address: Hex): Promise<ContractActivityRow> {
    const chain = this.chainId;
    const [row] = await queryRows<ContractActivityRow>(
      this.db,
      sql`SELECT
            (SELECT count(*)::int FROM logs WHERE chain_id = ${chain} AND address = ${address}) AS "logsEmitted",
            ((SELECT count(*) FROM token_transfers WHERE chain_id = ${chain} AND token_address = ${address})
              + (SELECT count(*) FROM erc721_transfers WHERE chain_id = ${chain} AND token_address = ${address})
              + (SELECT count(*) FROM erc1155_transfers WHERE chain_id = ${chain} AND token_address = ${address}))::int AS "transferEventsEmitted",
            (SELECT count(DISTINCT from_address)::int FROM transactions WHERE chain_id = ${chain} AND to_address = ${address}) AS "distinctCallers",
            (SELECT count(*)::int FROM transactions WHERE chain_id = ${chain} AND to_address = ${address} AND selector IS NOT NULL) AS "incomingCalls",
            (SELECT count(*)::int FROM transaction_receipts r JOIN transactions t ON t.chain_id = r.chain_id AND t.hash = r.transaction_hash
              WHERE r.chain_id = ${chain} AND t.from_address = ${address} AND r.contract_address IS NOT NULL AND r.status = 1) AS "deployedContracts"`,
    );
    return (
      row ?? {
        logsEmitted: 0,
        transferEventsEmitted: 0,
        distinctCallers: 0,
        incomingCalls: 0,
        deployedContracts: 0,
      }
    );
  }
}
