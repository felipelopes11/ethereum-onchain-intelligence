import type { Hex } from 'viem';
import type { ProtocolRefDto } from '@eoi/shared';
import type { AbiSource } from '../decoder';
import { aaveV3Adapter } from './aave';
import type { ProtocolAction, ProtocolAdapter, ProtocolContract } from './types';
import { uniswapAdapter } from './uniswap';

export const DEFAULT_PROTOCOL_ADAPTERS: readonly ProtocolAdapter[] = [
  uniswapAdapter,
  aaveV3Adapter,
];

export interface ProtocolMatch {
  protocol: ProtocolRefDto;
  contract: ProtocolContract;
}

/**
 * Protocol detection answers "is this address a known protocol contract?" using an
 * explicit address list. It never infers protocol membership from event or function
 * shapes: anyone can deploy a contract that emits a Uniswap-shaped Swap event.
 *
 * Interpretation is a separate step: given a detected protocol and a decoded
 * function/event name, return the action it represents.
 */
export class ProtocolRegistry {
  private readonly byAddress = new Map<
    Hex,
    { adapter: ProtocolAdapter; contract: ProtocolContract }
  >();

  constructor(
    readonly chainId: number,
    readonly adapters: readonly ProtocolAdapter[] = DEFAULT_PROTOCOL_ADAPTERS,
  ) {
    for (const adapter of adapters) {
      for (const contract of adapter.deployments[chainId] ?? []) {
        const address = contract.address.toLowerCase() as Hex;
        const existing = this.byAddress.get(address);
        if (existing) {
          throw new Error(
            `Address ${address} claimed by both ${existing.adapter.id} and ${adapter.id}`,
          );
        }
        this.byAddress.set(address, { adapter, contract: { ...contract, address } });
      }
    }
  }

  /** ABI sources from all adapters, for the decoder registry. */
  abiSources(): AbiSource[] {
    return this.adapters.flatMap((adapter) => adapter.abis);
  }

  contracts(): { protocol: ProtocolAdapter; contract: ProtocolContract }[] {
    return [...this.byAddress.values()].map(({ adapter, contract }) => ({
      protocol: adapter,
      contract,
    }));
  }

  detect(address: Hex | null | undefined): ProtocolMatch | null {
    if (!address) return null;
    const entry = this.byAddress.get(address.toLowerCase() as Hex);
    if (!entry) return null;
    const { adapter, contract } = entry;
    return {
      protocol: { id: adapter.id, name: adapter.name, category: adapter.category },
      contract,
    };
  }

  interpretFunction(protocolId: string, functionName: string | null): ProtocolAction | null {
    if (!functionName) return null;
    return this.adapter(protocolId)?.functionActions[functionName] ?? null;
  }

  interpretEvent(protocolId: string, eventName: string | null): ProtocolAction | null {
    if (!eventName) return null;
    return this.adapter(protocolId)?.eventActions?.[eventName] ?? null;
  }

  private adapter(protocolId: string): ProtocolAdapter | undefined {
    return this.adapters.find((adapter) => adapter.id === protocolId);
  }
}
