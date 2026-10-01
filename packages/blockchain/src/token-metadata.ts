import {
  decodeAbiParameters,
  decodeFunctionResult,
  encodeFunctionData,
  hexToString,
  type Hex,
} from 'viem';
import type { TokenMetadataStatus, TokenStandard } from '@eoi/shared';
import { erc165Abi, erc20Abi, erc20Bytes32MetadataAbi, INTERFACE_IDS } from './abis/standards';
import type { BlockchainProvider } from './provider';
import type { ContractReadResult } from './types';

export const MAX_NAME_LENGTH = 128;
export const MAX_SYMBOL_LENGTH = 32;

export interface TokenMetadata {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint | null;
  /** ERC-165 self-declarations. A contract can lie; this is what it claims, not proof. */
  declaredInterfaces: TokenStandard[];
  status: TokenMetadataStatus;
  errors: string[];
}

/** C0/C1 controls, zero-width characters, bidi embeddings/overrides/isolates and BOM. */
function isUnsafeCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

/**
 * Token metadata strings come from arbitrary contracts. We strip control and
 * bidirectional-override characters (used for spoofing), collapse whitespace, and cap
 * the length. Rendering still escapes them; this is defence in depth.
 */
export function sanitizeTokenString(value: string, maxLength: number): string | null {
  // Array.from iterates code points, so surrogate pairs are never split.
  const cleaned = Array.from(value.replace(/\s+/g, ' '))
    .filter((char) => !isUnsafeCodePoint(char.codePointAt(0) ?? 0))
    .join('')
    .trim();
  if (cleaned.length === 0) return null;
  return Array.from(cleaned).slice(0, maxLength).join('');
}

type StringField = 'name' | 'symbol';

function decodeStringResult(
  field: StringField,
  result: ContractReadResult | undefined,
): string | null {
  if (!result?.success) return null;
  const max = field === 'name' ? MAX_NAME_LENGTH : MAX_SYMBOL_LENGTH;
  try {
    const value = decodeFunctionResult({ abi: erc20Abi, functionName: field, data: result.data });
    return sanitizeTokenString(value, max);
  } catch {
    // Fall through to the legacy bytes32 encoding.
  }
  try {
    const raw = decodeFunctionResult({
      abi: erc20Bytes32MetadataAbi,
      functionName: field,
      data: result.data,
    });
    return sanitizeTokenString(hexToString(raw, { size: 32 }).replace(/\0+$/, ''), max);
  } catch {
    return null;
  }
}

function decodeDecimals(result: ContractReadResult | undefined): number | null {
  if (!result?.success) return null;
  try {
    // Decoded as uint256 and range-checked: a uint8 decode would not reject a contract
    // that returns an arbitrary word.
    const [value] = decodeAbiParameters([{ type: 'uint256' }], result.data);
    return value <= 255n ? Number(value) : null;
  } catch {
    return null;
  }
}

function decodeTotalSupply(result: ContractReadResult | undefined): bigint | null {
  if (!result?.success) return null;
  try {
    return decodeFunctionResult({ abi: erc20Abi, functionName: 'totalSupply', data: result.data });
  } catch {
    return null;
  }
}

function decodeSupports(result: ContractReadResult | undefined): boolean {
  if (!result?.success) return false;
  try {
    return decodeFunctionResult({
      abi: erc165Abi,
      functionName: 'supportsInterface',
      data: result.data,
    });
  } catch {
    return false;
  }
}

const METADATA_FIELDS = ['name', 'symbol', 'decimals', 'totalSupply'] as const;

const call = (functionName: (typeof METADATA_FIELDS)[number]) =>
  encodeFunctionData({ abi: erc20Abi, functionName });
const supports = (interfaceId: Hex) =>
  encodeFunctionData({ abi: erc165Abi, functionName: 'supportsInterface', args: [interfaceId] });

/**
 * Reads optional ERC-20 metadata and ERC-165 declarations. None of these functions
 * are mandatory (decimals/name/symbol are OPTIONAL in EIP-20), so absence is recorded
 * as null, never guessed.
 */
export async function readTokenMetadata(
  provider: BlockchainProvider,
  token: Hex,
  standard: TokenStandard | null,
): Promise<TokenMetadata> {
  const results = await provider.readContracts([
    { address: token, data: call('name') },
    { address: token, data: call('symbol') },
    { address: token, data: call('decimals') },
    { address: token, data: call('totalSupply') },
    { address: token, data: supports(INTERFACE_IDS.erc721) },
    { address: token, data: supports(INTERFACE_IDS.erc1155) },
  ]);
  const [nameR, symbolR, decimalsR, supplyR, is721R, is1155R] = results;

  const metadata: TokenMetadata = {
    name: decodeStringResult('name', nameR),
    symbol: decodeStringResult('symbol', symbolR),
    decimals: decodeDecimals(decimalsR),
    totalSupply: decodeTotalSupply(supplyR),
    declaredInterfaces: [
      ...(decodeSupports(is721R) ? (['erc721'] as const) : []),
      ...(decodeSupports(is1155R) ? (['erc1155'] as const) : []),
    ],
    status: 'complete',
    // ERC-165 probes are expected to revert on plain ERC-20s; only metadata reads count.
    errors: [nameR, symbolR, decimalsR, supplyR].flatMap((r, i) =>
      r && !r.success ? [`${METADATA_FIELDS[i] ?? 'call'}: ${r.error}`] : [],
    ),
  };

  // decimals only carries meaning for fungible tokens; NFTs legitimately omit it.
  const fields =
    standard === 'erc20'
      ? [metadata.name, metadata.symbol, metadata.decimals, metadata.totalSupply]
      : [metadata.name, metadata.symbol];
  const present = fields.filter((f) => f !== null).length;
  metadata.status = present === fields.length ? 'complete' : present === 0 ? 'failed' : 'partial';
  return metadata;
}
