import { createPublicClient, http, type Hex, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import type { EnsResolver } from './provider';

/**
 * ENS lives on Ethereum mainnet. The resolver is optional: when no mainnet RPC is
 * configured the platform simply reports that ENS is unavailable. Resolved mainnet
 * names are NOT proof of ownership on another chain; the UI states this.
 */
export class MainnetEnsResolver implements EnsResolver {
  private readonly client: PublicClient;

  constructor(rpcUrl: string, timeoutMs = 10_000) {
    this.client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl, { timeout: timeoutMs, retryCount: 1 }),
    });
  }

  async resolveName(name: string): Promise<Hex | null> {
    const address = await this.client.getEnsAddress({ name: normalize(name) });
    return address ? (address.toLowerCase() as Hex) : null;
  }

  async lookupAddress(address: Hex): Promise<string | null> {
    // Reverse records are set by the address owner; the UI presents the name as a claim.
    return this.client.getEnsName({ address });
  }
}
