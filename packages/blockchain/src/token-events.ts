import { decodeAbiParameters, hexToBigInt, toEventSelector, type Hex } from 'viem';
import type { TokenStandard } from '@eoi/shared';
import { topicToAddress } from './address';

export const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)');
export const TRANSFER_SINGLE_TOPIC = toEventSelector(
  'TransferSingle(address,address,address,uint256,uint256)',
);
export const TRANSFER_BATCH_TOPIC = toEventSelector(
  'TransferBatch(address,address,address,uint256[],uint256[])',
);

/** Upper bound on items decoded from a single TransferBatch, against oversized logs. */
export const MAX_BATCH_ITEMS = 1_000;

export interface LogLike {
  address: Hex;
  topics: readonly Hex[];
  data: Hex;
  logIndex: number;
}

export type TokenTransferEvent =
  | { standard: 'erc20'; token: Hex; logIndex: number; from: Hex; to: Hex; value: bigint }
  | { standard: 'erc721'; token: Hex; logIndex: number; from: Hex; to: Hex; tokenId: bigint }
  | {
      standard: 'erc1155';
      token: Hex;
      logIndex: number;
      operator: Hex;
      from: Hex;
      to: Hex;
      batch: boolean;
      items: { tokenId: bigint; value: bigint }[];
    };

export type TransferDecodeResult =
  | { kind: 'transfer'; event: TokenTransferEvent }
  | { kind: 'malformed'; standardHint: TokenStandard; reason: string }
  | { kind: 'not-a-transfer' };

const WORD_HEX_LENGTH = 64;
const dataWords = (data: Hex) => (data.length - 2) / WORD_HEX_LENGTH;

function malformed(standardHint: TokenStandard, reason: string): TransferDecodeResult {
  return { kind: 'malformed', standardHint, reason };
}

/**
 * Classifies a log as an ERC-20, ERC-721 or ERC-1155 transfer purely from its shape.
 *
 * ERC-20 and ERC-721 share the same Transfer topic0. They differ in where the third
 * parameter lives: ERC-20 puts `value` in data (3 topics, 32 bytes of data); ERC-721
 * indexes `tokenId` (4 topics, empty data). This is a structural inference, not proof
 * of standard compliance: the emitting contract is untrusted and may lie.
 */
export function decodeTokenTransfer(log: LogLike): TransferDecodeResult {
  const [topic0, t1, t2, t3] = log.topics;
  if (!topic0) return { kind: 'not-a-transfer' };
  const token = log.address.toLowerCase() as Hex;

  if (topic0 === TRANSFER_TOPIC) {
    if (!t1 || !t2) return malformed('erc20', 'Transfer log with fewer than 3 topics');
    const from = topicToAddress(t1);
    const to = topicToAddress(t2);
    if (!from || !to) return malformed('erc20', 'Transfer topic is not a valid address word');

    if (log.topics.length === 3) {
      if (log.data.length !== 2 + WORD_HEX_LENGTH) {
        return malformed(
          'erc20',
          `ERC-20 Transfer data must be 32 bytes, got ${dataWords(log.data) * 32}`,
        );
      }
      return {
        kind: 'transfer',
        event: {
          standard: 'erc20',
          token,
          logIndex: log.logIndex,
          from,
          to,
          value: hexToBigInt(log.data),
        },
      };
    }
    if (log.topics.length === 4 && t3) {
      if (log.data !== '0x') return malformed('erc721', 'ERC-721 Transfer must have empty data');
      return {
        kind: 'transfer',
        event: {
          standard: 'erc721',
          token,
          logIndex: log.logIndex,
          from,
          to,
          tokenId: hexToBigInt(t3),
        },
      };
    }
    return malformed('erc20', `Transfer log with ${log.topics.length} topics`);
  }

  if (topic0 === TRANSFER_SINGLE_TOPIC || topic0 === TRANSFER_BATCH_TOPIC) {
    const batch = topic0 === TRANSFER_BATCH_TOPIC;
    if (log.topics.length !== 4 || !t1 || !t2 || !t3) {
      return malformed('erc1155', 'ERC-1155 transfer must have 4 topics');
    }
    const operator = topicToAddress(t1);
    const from = topicToAddress(t2);
    const to = topicToAddress(t3);
    if (!operator || !from || !to) return malformed('erc1155', 'Topic is not a valid address word');

    if (!batch) {
      if (log.data.length !== 2 + 2 * WORD_HEX_LENGTH) {
        return malformed('erc1155', 'TransferSingle data must be 64 bytes');
      }
      const tokenId = hexToBigInt(`0x${log.data.slice(2, 2 + WORD_HEX_LENGTH)}`);
      const value = hexToBigInt(`0x${log.data.slice(2 + WORD_HEX_LENGTH)}`);
      return {
        kind: 'transfer',
        event: {
          standard: 'erc1155',
          token,
          logIndex: log.logIndex,
          operator,
          from,
          to,
          batch,
          items: [{ tokenId, value }],
        },
      };
    }

    let ids: readonly bigint[];
    let values: readonly bigint[];
    try {
      [ids, values] = decodeAbiParameters([{ type: 'uint256[]' }, { type: 'uint256[]' }], log.data);
    } catch {
      return malformed('erc1155', 'TransferBatch data is not valid ABI encoding');
    }
    if (ids.length !== values.length)
      return malformed('erc1155', 'TransferBatch ids/values length mismatch');
    if (ids.length > MAX_BATCH_ITEMS)
      return malformed('erc1155', `TransferBatch exceeds ${MAX_BATCH_ITEMS} items`);
    return {
      kind: 'transfer',
      event: {
        standard: 'erc1155',
        token,
        logIndex: log.logIndex,
        operator,
        from,
        to,
        batch,
        items: ids.map((tokenId, i) => ({ tokenId, value: values[i] ?? 0n })),
      },
    };
  }

  return { kind: 'not-a-transfer' };
}
