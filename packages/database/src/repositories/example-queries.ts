import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import { queryRows } from '../sql';

type Hex = `0x${string}`;

export interface ExampleItem {
  kind:
    | 'active-address'
    | 'protocol-user'
    | 'token-contract'
    | 'protocol-transaction'
    | 'token-transfer';
  value: Hex;
  description: string;
}

/**
 * Picks demo targets from what is actually indexed right now, instead of hard-coding
 * testnet addresses that may disappear when the indexed window moves.
 */
export class ExampleQueries {
  constructor(
    private readonly db: Database,
    private readonly chainId: number,
  ) {}

  async pick(): Promise<ExampleItem[]> {
    const chain = this.chainId;
    const examples: ExampleItem[] = [];

    const [protocolUser] = await queryRows<{ address: Hex; protocol: string; n: number }>(
      this.db,
      sql`SELECT t.from_address AS address, p.name AS protocol, count(*)::int AS n
          FROM transactions t
          JOIN protocol_contracts pc ON pc.chain_id = t.chain_id AND pc.address = t.to_address
          JOIN protocols p ON p.id = pc.protocol_id
          WHERE t.chain_id = ${chain}
          GROUP BY t.from_address, p.name ORDER BY count(*) DESC LIMIT 1`,
    );
    if (protocolUser) {
      examples.push({
        kind: 'protocol-user',
        value: protocolUser.address,
        description: `Address with ${protocolUser.n} indexed calls to ${protocolUser.protocol} contracts`,
      });
    }

    const [active] = await queryRows<{ address: Hex; n: number }>(
      this.db,
      sql`SELECT from_address AS address, count(*)::int AS n FROM transactions
          WHERE chain_id = ${chain} ${protocolUser ? sql`AND from_address <> ${protocolUser.address}` : sql``}
          GROUP BY from_address ORDER BY count(*) DESC LIMIT 1`,
    );
    if (active) {
      examples.push({
        kind: 'active-address',
        value: active.address,
        description: `Most active sender (${active.n} indexed transactions)`,
      });
    }

    const [token] = await queryRows<{ address: Hex; symbol: string | null; n: number }>(
      this.db,
      sql`SELECT tt.token_address AS address, tk.symbol, count(*)::int AS n
          FROM token_transfers tt JOIN tokens tk ON tk.chain_id = tt.chain_id AND tk.address = tt.token_address
          WHERE tt.chain_id = ${chain} AND tk.metadata_status = 'complete'
          GROUP BY tt.token_address, tk.symbol ORDER BY count(*) DESC LIMIT 1`,
    );
    if (token) {
      examples.push({
        kind: 'token-contract',
        value: token.address,
        description: `ERC-20 contract with ${token.n} indexed transfers (self-declared symbol: ${token.symbol ?? 'none'})`,
      });
    }

    const [protocolTx] = await queryRows<{ hash: Hex; protocol: string }>(
      this.db,
      sql`SELECT t.hash, p.name AS protocol FROM transactions t
          JOIN protocol_contracts pc ON pc.chain_id = t.chain_id AND pc.address = t.to_address
          JOIN protocols p ON p.id = pc.protocol_id
          JOIN transaction_receipts r ON r.chain_id = t.chain_id AND r.transaction_hash = t.hash AND r.status = 1
          WHERE t.chain_id = ${chain}
          ORDER BY t.block_number DESC, t.transaction_index DESC LIMIT 1`,
    );
    if (protocolTx) {
      examples.push({
        kind: 'protocol-transaction',
        value: protocolTx.hash,
        description: `Recent successful ${protocolTx.protocol} transaction`,
      });
    }

    const [transfer] = await queryRows<{ hash: Hex }>(
      this.db,
      sql`SELECT transaction_hash AS hash FROM token_transfers WHERE chain_id = ${chain}
          ORDER BY block_number DESC, log_index DESC LIMIT 1`,
    );
    if (transfer) {
      examples.push({
        kind: 'token-transfer',
        value: transfer.hash,
        description: 'Recent transaction with an ERC-20 transfer',
      });
    }
    return examples;
  }
}
