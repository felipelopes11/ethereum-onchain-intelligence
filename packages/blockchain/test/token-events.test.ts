import { encodeAbiParameters, encodeEventTopics, pad, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { erc1155Abi, erc20Abi, erc721Abi } from '../src/abis/standards';
import { decodeTokenTransfer, MAX_BATCH_ITEMS, TRANSFER_TOPIC } from '../src/token-events';

/** Every indexed argument is supplied in these tests, so no topic is null. */
const eventTopics = (...args: Parameters<typeof encodeEventTopics>): Hex[] =>
  encodeEventTopics(...args) as Hex[];

const token: Hex = '0x1111111111111111111111111111111111111111';
const alice: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const bob: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const operator: Hex = '0xcccccccccccccccccccccccccccccccccccccccc';

const log = (topics: Hex[], data: Hex = '0x') => ({ address: token, topics, data, logIndex: 7 });

describe('decodeTokenTransfer', () => {
  it('decodes an ERC-20 Transfer (3 topics, value in data)', () => {
    const topics = eventTopics({
      abi: erc20Abi,
      eventName: 'Transfer',
      args: { from: alice, to: bob },
    });
    const data = encodeAbiParameters([{ type: 'uint256' }], [1_250_000_000n]);
    expect(decodeTokenTransfer(log(topics, data))).toEqual({
      kind: 'transfer',
      event: { standard: 'erc20', token, logIndex: 7, from: alice, to: bob, value: 1_250_000_000n },
    });
  });

  it('decodes an ERC-721 Transfer (tokenId indexed, empty data) despite the shared topic0', () => {
    const topics = eventTopics({
      abi: erc721Abi,
      eventName: 'Transfer',
      args: { from: alice, to: bob, tokenId: 42n },
    });
    expect(topics[0]).toBe(TRANSFER_TOPIC);
    expect(decodeTokenTransfer(log(topics))).toEqual({
      kind: 'transfer',
      event: { standard: 'erc721', token, logIndex: 7, from: alice, to: bob, tokenId: 42n },
    });
  });

  it('decodes ERC-1155 TransferSingle', () => {
    const topics = eventTopics({
      abi: erc1155Abi,
      eventName: 'TransferSingle',
      args: { operator, from: alice, to: bob },
    });
    const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [5n, 3n]);
    const result = decodeTokenTransfer(log(topics, data));
    expect(result).toMatchObject({
      kind: 'transfer',
      event: { standard: 'erc1155', batch: false, operator, items: [{ tokenId: 5n, value: 3n }] },
    });
  });

  it('decodes ERC-1155 TransferBatch into one item per id', () => {
    const topics = eventTopics({
      abi: erc1155Abi,
      eventName: 'TransferBatch',
      args: { operator, from: alice, to: bob },
    });
    const data = encodeAbiParameters(
      [{ type: 'uint256[]' }, { type: 'uint256[]' }],
      [
        [1n, 2n],
        [10n, 20n],
      ],
    );
    expect(decodeTokenTransfer(log(topics, data))).toMatchObject({
      kind: 'transfer',
      event: {
        batch: true,
        items: [
          { tokenId: 1n, value: 10n },
          { tokenId: 2n, value: 20n },
        ],
      },
    });
  });

  it('flags a Transfer whose address topic has non-zero upper bytes instead of truncating it', () => {
    const topics = eventTopics({
      abi: erc20Abi,
      eventName: 'Transfer',
      args: { from: alice, to: bob },
    });
    const dirty = `0xff${topics[1]!.slice(4)}` as Hex;
    const data = encodeAbiParameters([{ type: 'uint256' }], [1n]);
    expect(decodeTokenTransfer(log([topics[0]!, dirty, topics[2]!], data))).toMatchObject({
      kind: 'malformed',
    });
  });

  it('flags ERC-20-shaped Transfer with wrong data length', () => {
    const topics = eventTopics({
      abi: erc20Abi,
      eventName: 'Transfer',
      args: { from: alice, to: bob },
    });
    expect(decodeTokenTransfer(log(topics, '0x01'))).toMatchObject({
      kind: 'malformed',
      standardHint: 'erc20',
    });
  });

  it('rejects TransferBatch with mismatched array lengths', () => {
    const topics = eventTopics({
      abi: erc1155Abi,
      eventName: 'TransferBatch',
      args: { operator, from: alice, to: bob },
    });
    const data = encodeAbiParameters(
      [{ type: 'uint256[]' }, { type: 'uint256[]' }],
      [[1n, 2n], [10n]],
    );
    expect(decodeTokenTransfer(log(topics, data))).toMatchObject({ kind: 'malformed' });
  });

  it('caps oversized TransferBatch logs', () => {
    const topics = eventTopics({
      abi: erc1155Abi,
      eventName: 'TransferBatch',
      args: { operator, from: alice, to: bob },
    });
    const ids = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => BigInt(i));
    const data = encodeAbiParameters([{ type: 'uint256[]' }, { type: 'uint256[]' }], [ids, ids]);
    expect(decodeTokenTransfer(log(topics, data))).toMatchObject({ kind: 'malformed' });
  });

  it('ignores unrelated logs and garbage data in TransferBatch', () => {
    expect(decodeTokenTransfer(log([pad('0x1234')]))).toEqual({ kind: 'not-a-transfer' });
    expect(decodeTokenTransfer(log([]))).toEqual({ kind: 'not-a-transfer' });
    const topics = eventTopics({
      abi: erc1155Abi,
      eventName: 'TransferBatch',
      args: { operator, from: alice, to: bob },
    });
    expect(decodeTokenTransfer(log(topics, '0xdeadbeef'))).toMatchObject({ kind: 'malformed' });
  });
});
