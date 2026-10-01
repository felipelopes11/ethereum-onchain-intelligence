import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { TOKEN_STANDARDS, type TokenMetadataStatus, type TokenStandard } from '@eoi/shared';
import type { Database } from '../client';
import { contracts, tokens } from '../schema';

type Hex = `0x${string}`;

/**
 * Array bind parameters are driver-specific (node-postgres serialises JS arrays, PGlite
 * does not), so enum arrays are sent as a Postgres array literal. Values are checked
 * against the closed enum first, so nothing user-controlled reaches the literal.
 */
function toPgEnumArray(values: readonly TokenStandard[]): string {
  for (const value of values) {
    if (!TOKEN_STANDARDS.includes(value)) throw new Error(`Invalid token standard: ${value}`);
  }
  return `{${values.join(',')}}`;
}

export interface TokenMetadataUpdate {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint | null;
  status: TokenMetadataStatus;
  error: string | null;
  /** ERC-165 interfaces the contract declared; merged into contracts.interfaces. */
  declaredInterfaces: TokenStandard[];
}

export class TokenRepository {
  constructor(
    private readonly db: Database,
    private readonly chainId: number,
  ) {}

  async findPendingMetadata(
    limit: number,
  ): Promise<{ address: Hex; standard: TokenStandard | null }[]> {
    return this.db
      .select({ address: tokens.address, standard: tokens.standard })
      .from(tokens)
      .where(and(eq(tokens.chainId, this.chainId), eq(tokens.metadataStatus, 'pending')))
      .orderBy(asc(tokens.firstObservedBlock))
      .limit(limit);
  }

  async updateMetadata(address: Hex, update: TokenMetadataUpdate): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(tokens)
        .set({
          name: update.name,
          symbol: update.symbol,
          decimals: update.decimals,
          totalSupply: update.totalSupply,
          metadataStatus: update.status,
          metadataError: update.error?.slice(0, 256) ?? null,
          metadataFetchedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(tokens.chainId, this.chainId), eq(tokens.address, address)));
      if (update.declaredInterfaces.length > 0) {
        await tx
          .update(contracts)
          .set({
            interfaces: sql`ARRAY(SELECT DISTINCT unnest(${contracts.interfaces} || ${toPgEnumArray(update.declaredInterfaces)}::token_standard[]) ORDER BY 1)`,
            updatedAt: sql`now()`,
          })
          .where(and(eq(contracts.chainId, this.chainId), eq(contracts.address, address)));
      }
    });
  }

  async findByAddresses(addresses: readonly Hex[]) {
    if (addresses.length === 0) return [];
    return this.db
      .select()
      .from(tokens)
      .where(and(eq(tokens.chainId, this.chainId), inArray(tokens.address, [...addresses])));
  }
}
