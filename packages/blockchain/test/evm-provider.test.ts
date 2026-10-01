import { createPublicClient, custom, numberToHex, type Hex, type PublicClient } from 'viem';
import { describe, expect, it } from 'vitest';
import { EvmProvider } from '../src/evm-provider';
import { DataInconsistencyError } from '../src/provider';

const BLOCK_HASH: Hex = `0x${'b1'.repeat(32)}`;
const TX_A: Hex = `0x${'a1'.repeat(32)}`;
const TX_B: Hex = `0x${'a2'.repeat(32)}`;
const FROM: Hex = `0x${'11'.repeat(20)}`;
const TO: Hex = `0x${'22'.repeat(20)}`;

function rpcTransaction(hash: Hex, index: number) {
  return {
    hash,
    blockHash: BLOCK_HASH,
    blockNumber: numberToHex(100),
    transactionIndex: numberToHex(index),
    from: FROM,
    to: TO,
    value: '0x1',
    nonce: numberToHex(index),
    gas: '0x5208',
    maxFeePerGas: '0x2',
    maxPriorityFeePerGas: '0x1',
    type: '0x2',
    input: '0x',
    chainId: '0xaa36a7',
    v: '0x0',
    r: `0x${'01'.repeat(32)}`,
    s: `0x${'01'.repeat(32)}`,
    yParity: '0x0',
    accessList: [],
  };
}

function rpcReceipt(hash: Hex, index: number, blockHash: Hex = BLOCK_HASH) {
  return {
    transactionHash: hash,
    transactionIndex: numberToHex(index),
    blockHash,
    blockNumber: numberToHex(100),
    from: FROM,
    to: TO,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    effectiveGasPrice: '0x2',
    contractAddress: null,
    logs: [],
    logsBloom: `0x${'00'.repeat(256)}`,
    status: '0x1',
    type: '0x2',
  };
}

const rpcError = (code: number, message: string) => Object.assign(new Error(message), { code });

type Handler = (method: string, params: unknown[]) => unknown;

function providerWith(handler: Handler, calls: string[] = []): EvmProvider {
  const client = createPublicClient({
    transport: custom(
      {
        request: ({ method, params }: { method: string; params?: unknown[] }) => {
          calls.push(method);
          return Promise.resolve().then(() => handler(method, params ?? []));
        },
      },
      { retryCount: 0 },
    ),
  }) as PublicClient;
  return new EvmProvider({
    rpcUrl: 'http://unused',
    chainId: 11155111,
    client,
    maxRequestsPerSecond: 1_000,
  });
}

const block = {
  number: 100n,
  hash: BLOCK_HASH,
  transactions: [{ hash: TX_A }, { hash: TX_B }],
} as const;

describe('EvmProvider.getBlockReceipts', () => {
  it('uses eth_getBlockReceipts by block hash and normalises results', async () => {
    const calls: string[] = [];
    const provider = providerWith((method, params) => {
      expect(method).toBe('eth_getBlockReceipts');
      expect(params).toEqual([BLOCK_HASH]);
      return [rpcReceipt(TX_A, 0), rpcReceipt(TX_B, 1)];
    }, calls);
    const receipts = await provider.getBlockReceipts(block as never);
    expect(receipts.map((r) => [r.transactionHash, r.status, r.gasUsed])).toEqual([
      [TX_A, 'success', 21_000n],
      [TX_B, 'success', 21_000n],
    ]);
    expect(calls).toEqual(['eth_getBlockReceipts']);
  });

  it('falls back to per-transaction receipts when the node lacks eth_getBlockReceipts', async () => {
    const calls: string[] = [];
    const provider = providerWith((method, params) => {
      if (method === 'eth_getBlockReceipts') throw rpcError(-32601, 'method not found');
      const hash = params[0] as Hex;
      return rpcReceipt(hash, hash === TX_A ? 0 : 1);
    }, calls);
    await provider.getBlockReceipts(block as never);
    await provider.getBlockReceipts(block as never);
    // The unsupported method is remembered: tried exactly once.
    expect(calls.filter((m) => m === 'eth_getBlockReceipts')).toHaveLength(1);
    expect(calls.filter((m) => m === 'eth_getTransactionReceipt')).toHaveLength(4);
  });

  it('rejects receipts that belong to a different block (fork or lagging backend)', async () => {
    const provider = providerWith(() => [
      rpcReceipt(TX_A, 0),
      rpcReceipt(TX_B, 1, `0x${'ff'.repeat(32)}`),
    ]);
    const providerNoRetry = new EvmProvider({
      rpcUrl: 'http://unused',
      chainId: 1,
      client: (provider as unknown as { client: PublicClient }).client,
      maxRetries: 0,
    });
    await expect(providerNoRetry.getBlockReceipts(block as never)).rejects.toBeInstanceOf(
      DataInconsistencyError,
    );
  });
});

describe('EvmProvider resilience', () => {
  it('retries rate-limited requests and counts them', async () => {
    let attempts = 0;
    const provider = providerWith(() => {
      attempts++;
      if (attempts < 3) throw rpcError(-32005, 'limit exceeded');
      return numberToHex(123);
    });
    await expect(provider.getLatestBlockNumber()).resolves.toBe(123n);
    expect(provider.stats()).toMatchObject({ retries: 2, errors: 2, requests: 3 });
  }, 20_000);

  it('normalises blocks to lowercase and maps tx types', async () => {
    const provider = providerWith(() => ({
      number: numberToHex(100),
      hash: BLOCK_HASH.toUpperCase().replace('0X', '0x'),
      parentHash: `0x${'00'.repeat(32)}`,
      timestamp: numberToHex(1_700_000_000),
      miner: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
      gasUsed: '0x5208',
      gasLimit: '0x1c9c380',
      baseFeePerGas: '0x7',
      transactions: [rpcTransaction(TX_A, 0)],
      difficulty: '0x0',
      extraData: '0x',
      logsBloom: `0x${'00'.repeat(256)}`,
      mixHash: `0x${'00'.repeat(32)}`,
      nonce: '0x0000000000000000',
      receiptsRoot: `0x${'00'.repeat(32)}`,
      sha3Uncles: `0x${'00'.repeat(32)}`,
      size: '0x1',
      stateRoot: `0x${'00'.repeat(32)}`,
      totalDifficulty: '0x0',
      transactionsRoot: `0x${'00'.repeat(32)}`,
      uncles: [],
    }));
    const result = await provider.getBlockWithTransactions(100n);
    expect(result.hash).toBe(BLOCK_HASH);
    expect(result.miner).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    expect(result.transactions[0]).toMatchObject({ type: 2, value: 1n, to: TO });
  });

  it('reports read failures per call instead of throwing', async () => {
    const provider = providerWith((method) => {
      if (method === 'eth_call') throw rpcError(3, 'execution reverted');
      return null;
    });
    const [result] = await provider.readContracts([{ address: TO, data: '0x06fdde03' }]);
    expect(result).toMatchObject({ success: false });
  });
});
