import type { Chain } from 'viem';
import { mainnet, sepolia } from 'viem/chains';

const VIEM_CHAINS: Record<number, Chain> = {
  [sepolia.id]: sepolia,
  [mainnet.id]: mainnet,
};

export function viemChainFor(chainId: number): Chain | undefined {
  return VIEM_CHAINS[chainId];
}
