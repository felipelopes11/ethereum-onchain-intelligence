export interface ChainInfo {
  id: number;
  name: string;
  isTestnet: boolean;
  nativeSymbol: string;
  explorerUrl: string;
  /** Default confirmation depth used by the indexer before a block is treated as stable. */
  defaultConfirmations: number;
}

export const SEPOLIA: ChainInfo = {
  id: 11155111,
  name: 'Sepolia',
  isTestnet: true,
  nativeSymbol: 'SepoliaETH',
  explorerUrl: 'https://sepolia.etherscan.io',
  defaultConfirmations: 12,
};

export const MAINNET: ChainInfo = {
  id: 1,
  name: 'Ethereum Mainnet',
  isTestnet: false,
  nativeSymbol: 'ETH',
  explorerUrl: 'https://etherscan.io',
  defaultConfirmations: 12,
};

export const SUPPORTED_CHAINS: readonly ChainInfo[] = [SEPOLIA, MAINNET];

export function getChainInfo(chainId: number): ChainInfo | undefined {
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId);
}
