import { describe, expect, it } from 'vitest';
import { buildBundle } from '../src/bundle-builder';
import { addr, FakeChain } from './fake-chain';

const alice = addr('alice');
const bob = addr('bob');
const token = addr('token');
const deployed = addr('deployed');

describe('buildBundle', () => {
  it('maps blocks, transactions, receipts and logs to rows', async () => {
    const chain = new FakeChain(2, (n) =>
      n === 1n
        ? [
            {
              from: alice,
              to: token,
              erc20: [
                { token, to: bob, value: 7n },
                { token, to: alice, value: 1n },
              ],
            },
            { from: alice, to: null, deploys: deployed },
          ]
        : [],
    );
    const block = await chain.getBlockWithTransactions(1n);
    const receipts = await chain.getBlockReceipts(block);
    const { bundle, stats } = buildBundle(11155111, block, receipts);

    expect(stats).toEqual({ transactions: 2, logs: 2, transfers: 2, malformedTransferLogs: 0 });
    expect(bundle.block).toMatchObject({
      number: 1n,
      transactionCount: 2,
      timestamp: new Date(1_700_000_012_000),
    });
    expect(bundle.transactions.map((t) => t.toAddress)).toEqual([token, null]);
    expect(bundle.erc20Transfers.map((t) => [t.fromAddress, t.toAddress, t.value])).toEqual([
      [alice, bob, 7n],
      [alice, alice, 1n],
    ]);
    expect(bundle.tokens).toEqual([{ address: token, standard: 'erc20' }]);
    expect(bundle.contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: token, evidence: 'emitted-log', interfaces: ['erc20'] }),
        expect.objectContaining({
          address: deployed,
          evidence: 'deployment-receipt',
          deployment: expect.objectContaining({ deployer: alice }),
        }),
      ]),
    );
  });

  it('does not treat a reverted contract creation as a deployed contract', async () => {
    const chain = new FakeChain(2, (n) =>
      n === 1n ? [{ from: alice, to: null, deploys: deployed }] : [],
    );
    const block = await chain.getBlockWithTransactions(1n);
    const receipts = (await chain.getBlockReceipts(block)).map((r) => ({
      ...r,
      status: 'reverted' as const,
    }));
    const { bundle } = buildBundle(11155111, block, receipts);
    expect(bundle.contracts).toEqual([]);
    expect(bundle.receipts[0]).toMatchObject({ status: 0, contractAddress: deployed });
  });

  it('keeps malformed transfer-shaped logs as raw logs without inventing a transfer', async () => {
    const chain = new FakeChain(2, (n) =>
      n === 1n ? [{ from: alice, to: token, erc20: [{ token, to: bob, value: 1n }] }] : [],
    );
    const block = await chain.getBlockWithTransactions(1n);
    const receipts = await chain.getBlockReceipts(block);
    receipts[0]!.logs[0]!.data = '0x01';
    const { bundle, stats } = buildBundle(11155111, block, receipts);
    expect(stats.malformedTransferLogs).toBe(1);
    expect(bundle.logs).toHaveLength(1);
    expect(bundle.erc20Transfers).toEqual([]);
    expect(bundle.tokens).toEqual([]);
    expect(bundle.contracts).toEqual([expect.objectContaining({ address: token, interfaces: [] })]);
  });
});
