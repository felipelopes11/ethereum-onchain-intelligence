import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { aaveV3PoolAbi } from '../src/abis/aave';
import { erc20Abi, wethAbi } from '../src/abis/standards';
import {
  uniswapV2PairAbi,
  uniswapV2RouterAbi,
  uniswapV3SwapRouter02Abi,
} from '../src/abis/uniswap';
import { parseDelegationDesignator } from '../src/address';
import { AbiRegistry } from '../src/decoder';
import { ProtocolRegistry } from '../src/protocols/registry';

/** Every indexed argument is supplied in these tests, so no topic is null. */
const eventTopics = (...args: Parameters<typeof encodeEventTopics>): Hex[] =>
  encodeEventTopics(...args) as Hex[];

const alice: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const bob: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const usdc: Hex = '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238';
const weth: Hex = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14';

const protocols = new ProtocolRegistry(11155111);
const registry = new AbiRegistry(protocols.abiSources());

describe('AbiRegistry.decodeCall', () => {
  it('reports empty calldata as a plain value transfer, not a function call', () => {
    expect(registry.decodeCall('0x')).toEqual({ status: 'empty' });
  });

  it('decodes ERC-20 transfer with named arguments', () => {
    const input = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [bob, 10n ** 30n],
    });
    expect(registry.decodeCall(input)).toEqual({
      status: 'decoded',
      selector: '0xa9059cbb',
      functionName: 'transfer',
      signature: 'transfer(address,uint256)',
      abiSource: 'erc20',
      args: [
        { name: 'to', type: 'address', value: bob },
        { name: 'value', type: 'uint256', value: (10n ** 30n).toString() },
      ],
    });
  });

  it('does not guess between ERC-20 and ERC-721 for the shared transferFrom selector', () => {
    const input = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transferFrom',
      args: [alice, bob, 7n],
    });
    const unknownTarget = registry.decodeCall(input);
    expect(unknownTarget).toMatchObject({ status: 'decoded', abiSource: 'ambiguous:erc20,erc721' });
    expect(unknownTarget.status === 'decoded' && unknownTarget.args.map((a) => a.name)).toEqual([
      'arg0',
      'arg1',
      'arg2',
    ]);

    const nft = registry.decodeCall(input, { standard: 'erc721' });
    expect(nft).toMatchObject({
      abiSource: 'erc721',
      args: [{}, {}, { name: 'tokenId', value: '7' }],
    });
  });

  it('decodes Uniswap V3 SwapRouter02 struct arguments', () => {
    const input = encodeFunctionData({
      abi: uniswapV3SwapRouter02Abi,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: weth,
          tokenOut: usdc,
          fee: 3000,
          recipient: alice,
          amountIn: 10n ** 18n,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    const decoded = registry.decodeCall(input, { abiIds: ['uniswap-v3-swap-router-02'] });
    expect(decoded).toMatchObject({ status: 'decoded', functionName: 'exactInputSingle' });
    expect(decoded.status === 'decoded' && decoded.args[0]?.value).toMatchObject({
      tokenIn: weth,
      amountIn: '1000000000000000000',
      fee: 3000,
    });
  });

  it('decodes zero-argument functions (WETH deposit)', () => {
    const input = encodeFunctionData({ abi: wethAbi, functionName: 'deposit' });
    expect(registry.decodeCall(input)).toMatchObject({
      status: 'decoded',
      functionName: 'deposit',
      abiSource: 'weth',
      args: [],
    });
  });

  it('returns unknown (with selector) for selectors not in any registered ABI', () => {
    expect(registry.decodeCall('0x12345678deadbeef')).toEqual({
      status: 'unknown',
      selector: '0x12345678',
      reason: 'No known ABI for this selector',
    });
  });

  it('returns unknown when the selector matches but the payload is malformed', () => {
    const input = encodeFunctionData({
      abi: uniswapV2RouterAbi,
      functionName: 'swapExactETHForTokens',
      args: [1n, [weth, usdc], alice, 1n],
    });
    const truncated = input.slice(0, 40) as Hex;
    expect(registry.decodeCall(truncated)).toMatchObject({
      status: 'unknown',
      selector: input.slice(0, 10),
    });
  });

  it('refuses calldata shorter than a selector', () => {
    expect(registry.decodeCall('0x1234')).toMatchObject({ status: 'unknown', selector: null });
  });
});

describe('AbiRegistry.decodeEvent', () => {
  it('distinguishes ERC-20 from ERC-721 Transfer by indexed layout', () => {
    const topics = eventTopics({
      abi: erc20Abi,
      eventName: 'Transfer',
      args: { from: alice, to: bob },
    });
    const data = encodeAbiParameters([{ type: 'uint256' }], [5n]);
    expect(registry.decodeEvent({ topics, data })).toMatchObject({
      status: 'decoded',
      name: 'Transfer',
      abiSource: 'erc20',
      args: [{ name: 'from' }, { name: 'to' }, { name: 'value', value: '5' }],
    });
    const nftTopics = [...topics, encodeAbiParameters([{ type: 'uint256' }], [9n])];
    expect(registry.decodeEvent({ topics: nftTopics, data: '0x' })).toMatchObject({
      abiSource: 'erc721',
    });
  });

  it('decodes Aave Supply events', () => {
    const topics = eventTopics({
      abi: aaveV3PoolAbi,
      eventName: 'Supply',
      args: { reserve: usdc, onBehalfOf: alice, referralCode: 0 },
    });
    const data = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [alice, 100n]);
    expect(registry.decodeEvent({ topics, data })).toMatchObject({
      status: 'decoded',
      name: 'Supply',
    });
  });

  it('decodes Uniswap V2 pair Sync by layout (decoding only, no protocol attribution)', () => {
    const topics = eventTopics({ abi: uniswapV2PairAbi, eventName: 'Sync' });
    const data = encodeAbiParameters([{ type: 'uint112' }, { type: 'uint112' }], [5n, 7n]);
    expect(registry.decodeEvent({ topics, data })).toMatchObject({
      status: 'decoded',
      name: 'Sync',
      abiSource: 'uniswap-v2-pair-layout',
    });
    expect(protocols.detect('0x6c78f419c0e061d65caf6441fb645510d2acfbde')).toBeNull();
  });

  it('returns unknown for unrecognised topics', () => {
    expect(registry.decodeEvent({ topics: [`0x${'12'.repeat(32)}`], data: '0x' }).status).toBe(
      'unknown',
    );
  });
});

describe('parseDelegationDesignator', () => {
  it('recognises EIP-7702 designators and nothing else', () => {
    const delegate = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
    expect(parseDelegationDesignator(`0xEF0100${delegate.slice(2).toUpperCase()}`)).toBe(delegate);
    expect(parseDelegationDesignator('0x6080604052')).toBeNull();
    expect(parseDelegationDesignator(`0xef0100${delegate.slice(2)}00`)).toBeNull();
    expect(parseDelegationDesignator(null)).toBeNull();
  });
});

describe('ProtocolRegistry', () => {
  it('detects protocols only by explicit contract address (case-insensitive)', () => {
    expect(protocols.detect('0x3BFA4769FB09EEFC5A80D6E87C3B9C650F7AE48E')).toMatchObject({
      protocol: { id: 'uniswap', category: 'dex' },
      contract: { role: 'v3-swap-router-02' },
    });
    expect(protocols.detect(alice)).toBeNull();
    expect(protocols.detect(null)).toBeNull();
  });

  it('has no deployments on chains it was not configured for', () => {
    expect(new ProtocolRegistry(1).contracts()).toEqual([]);
  });

  it('interprets function names per protocol, separately from detection', () => {
    expect(protocols.interpretFunction('uniswap', 'exactInputSingle')).toBe('swap');
    expect(protocols.interpretFunction('uniswap', 'mint')).toBe('add-liquidity');
    expect(protocols.interpretFunction('aave-v3', 'mint')).toBe('faucet-mint');
    expect(protocols.interpretFunction('aave-v3', 'transfer')).toBeNull();
  });

  it('refuses configurations where two protocols claim the same address', () => {
    const [uniswap] = protocols.adapters;
    expect(() => new ProtocolRegistry(11155111, [uniswap!, { ...uniswap!, id: 'clone' }])).toThrow(
      /claimed by both/,
    );
  });
});
