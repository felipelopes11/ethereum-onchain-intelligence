import { getChainInfo } from '@eoi/shared';

/** External block explorer links, so every displayed fact can be cross-checked independently. */
export function explorerUrl(
  chainId: number,
  kind: 'address' | 'tx' | 'block',
  value: string,
): string | null {
  const chain = getChainInfo(chainId);
  return chain ? `${chain.explorerUrl}/${kind}/${value}` : null;
}
