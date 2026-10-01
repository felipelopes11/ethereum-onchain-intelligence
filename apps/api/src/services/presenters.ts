import type { Coverage, schema } from '@eoi/database';
import type { CoverageDto, Hex, TokenDto } from '@eoi/shared';

type TokenRow = typeof schema.tokens.$inferSelect;

export function coverageDto(chainId: number, coverage: Coverage): CoverageDto {
  return {
    chainId,
    fromBlock: coverage.fromBlock?.toString() ?? null,
    toBlock: coverage.toBlock?.toString() ?? null,
    updatedAt: coverage.updatedAt?.toISOString() ?? null,
  };
}

export function tokenDto(row: TokenRow): TokenDto {
  return {
    address: row.address,
    standard: row.standard,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    totalSupply: row.totalSupply?.toString() ?? null,
    metadataStatus: row.metadataStatus,
  };
}

/** Placeholder for a token the index has seen in transfers but holds no row for. */
export function unknownTokenDto(address: Hex): TokenDto {
  return {
    address,
    standard: null,
    name: null,
    symbol: null,
    decimals: null,
    totalSupply: null,
    metadataStatus: 'pending',
  };
}
