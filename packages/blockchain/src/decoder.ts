import {
  decodeEventLog,
  decodeFunctionData,
  toEventSelector,
  toFunctionSelector,
  type Abi,
  type AbiEvent,
  type AbiFunction,
  type AbiParameter,
  type Hex,
} from 'viem';
import { formatAbiItem } from 'viem/utils';
import {
  toJsonValue,
  type DecodedArgDto,
  type DecodedCallDto,
  type TokenStandard,
} from '@eoi/shared';
import { erc1155Abi, erc20Abi, erc721Abi, wethAbi } from './abis/standards';
import { selectorOf } from './address';

export interface AbiSource {
  /** Stable identifier shown to users as the provenance of a decoding. */
  id: string;
  abi: Abi;
  /** When set, this ABI is only authoritative for contracts of this token standard. */
  standard?: TokenStandard;
}

export interface DecodeContext {
  /** Token standard of the target/emitter, if the index knows it. */
  standard?: TokenStandard | null;
  /** ABI sources registered for the target/emitter address (protocol contracts). */
  abiIds?: readonly string[];
}

interface FunctionCandidate {
  source: AbiSource;
  item: AbiFunction;
}

interface EventCandidate {
  source: AbiSource;
  item: AbiEvent;
}

export interface DecodedEvent {
  status: 'decoded' | 'unknown';
  name: string | null;
  signature: string | null;
  abiSource: string | null;
  args: DecodedArgDto[];
  /** Named decoded values, for programmatic interpretation. */
  values: Record<string, unknown>;
}

/** Hard cap on calldata we attempt to decode, against pathological inputs. */
export const MAX_DECODE_INPUT_BYTES = 128 * 1024;

const STANDARD_SOURCES: AbiSource[] = [
  { id: 'erc20', abi: erc20Abi, standard: 'erc20' },
  { id: 'erc721', abi: erc721Abi, standard: 'erc721' },
  { id: 'erc1155', abi: erc1155Abi, standard: 'erc1155' },
  { id: 'weth', abi: wethAbi },
];

/**
 * viem types `args` as always present, but it is undefined for zero-argument items
 * (e.g. WETH `deposit()`). Taking the wider type here keeps the runtime check honest.
 */
function orEmpty(args: readonly unknown[] | undefined): readonly unknown[] {
  return args ?? [];
}

/** viem returns checksummed addresses; the platform's canonical form is lowercase hex. */
function lowercaseHex(value: unknown): unknown {
  if (typeof value === 'string') return value.startsWith('0x') ? value.toLowerCase() : value;
  if (Array.isArray(value)) return value.map(lowercaseHex);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, lowercaseHex(v)]));
  }
  return value;
}

function toArgs(params: readonly AbiParameter[], values: readonly unknown[]): DecodedArgDto[] {
  return params.map((param, i) => ({
    name: param.name && param.name.length > 0 ? param.name : `arg${i}`,
    type: param.type,
    value: toJsonValue(lowercaseHex(values[i])),
  }));
}

/**
 * Picks which ABI to trust when several share a selector. Order of preference:
 * ABIs registered for the exact contract, then ABIs matching the contract's known
 * token standard, then a unique candidate. Anything else is reported as ambiguous
 * rather than guessed.
 */
function pickCandidates<T extends { source: AbiSource; item: AbiFunction | AbiEvent }>(
  candidates: readonly T[],
  context: DecodeContext,
): {
  chosen: T[];
  ambiguous: boolean;
} {
  if (context.abiIds?.length) {
    const scoped = candidates.filter((c) => context.abiIds?.includes(c.source.id));
    if (scoped.length > 0) return { chosen: scoped, ambiguous: false };
  }
  if (context.standard) {
    const byStandard = candidates.filter((c) => c.source.standard === context.standard);
    if (byStandard.length > 0) return { chosen: byStandard, ambiguous: false };
  }
  const generic = candidates.filter((c) => !c.source.standard || candidates.length === 1);
  if (generic.length > 0) return { chosen: generic, ambiguous: false };
  return { chosen: [...candidates], ambiguous: !sameParameterNames(candidates) };
}

function sameParameterNames(candidates: readonly { item: AbiFunction | AbiEvent }[]): boolean {
  const shapes = new Set(
    candidates.map((c) => JSON.stringify(c.item.inputs.map((input) => input.name ?? ''))),
  );
  return shapes.size <= 1;
}

export class AbiRegistry {
  private readonly functions = new Map<Hex, FunctionCandidate[]>();
  private readonly events = new Map<Hex, EventCandidate[]>();
  private readonly sourceIds = new Set<string>();

  constructor(sources: readonly AbiSource[] = []) {
    for (const source of [...STANDARD_SOURCES, ...sources]) this.register(source);
  }

  register(source: AbiSource): void {
    if (this.sourceIds.has(source.id)) throw new Error(`Duplicate ABI source id: ${source.id}`);
    this.sourceIds.add(source.id);
    for (const item of source.abi) {
      if (item.type === 'function') {
        const selector = toFunctionSelector(item);
        this.functions.set(selector, [...(this.functions.get(selector) ?? []), { source, item }]);
      } else if (item.type === 'event' && !item.anonymous) {
        const topic = toEventSelector(item);
        this.events.set(topic, [...(this.events.get(topic) ?? []), { source, item }]);
      }
    }
  }

  knownSelectors(): Hex[] {
    return [...this.functions.keys()];
  }

  /** Function signature for a selector if it is unambiguous; used by list views. */
  functionNameFor(selector: Hex, context: DecodeContext = {}): string | null {
    const candidates = this.functions.get(selector.toLowerCase() as Hex);
    if (!candidates?.length) return null;
    const names = new Set(pickCandidates(candidates, context).chosen.map((c) => c.item.name));
    return names.size === 1 ? ([...names][0] ?? null) : null;
  }

  decodeCall(input: Hex, context: DecodeContext = {}): DecodedCallDto {
    if (input === '0x' || input.length <= 2) return { status: 'empty' };
    const selector = selectorOf(input);
    if (!selector)
      return {
        status: 'unknown',
        selector: null,
        reason: 'Calldata shorter than a 4-byte selector',
      };
    if ((input.length - 2) / 2 > MAX_DECODE_INPUT_BYTES) {
      return { status: 'unknown', selector, reason: 'Calldata exceeds decoding size limit' };
    }
    const candidates = this.functions.get(selector);
    if (!candidates?.length)
      return { status: 'unknown', selector, reason: 'No known ABI for this selector' };

    const { chosen, ambiguous } = pickCandidates(candidates, context);
    for (const candidate of chosen) {
      try {
        const { args } = decodeFunctionData({ abi: [candidate.item], data: input });
        const decodedArgs = orEmpty(args);
        return {
          status: 'decoded',
          selector,
          functionName: candidate.item.name,
          signature: formatAbiItem(candidate.item),
          abiSource: ambiguous
            ? `ambiguous:${chosen.map((c) => c.source.id).join(',')}`
            : candidate.source.id,
          // Parameter names differ between ambiguous candidates, so only types are reported.
          args: ambiguous
            ? toArgs(
                candidate.item.inputs.map((p) => ({ ...p, name: '' })),
                decodedArgs,
              )
            : toArgs(candidate.item.inputs, decodedArgs),
        };
      } catch {
        // Selector matched but the payload does not fit this ABI; try the next candidate.
      }
    }
    return {
      status: 'unknown',
      selector,
      reason: 'Selector matched a known ABI but arguments failed to decode',
    };
  }

  decodeEvent(
    log: { topics: readonly Hex[]; data: Hex },
    context: DecodeContext = {},
  ): DecodedEvent {
    const unknown: DecodedEvent = {
      status: 'unknown',
      name: null,
      signature: null,
      abiSource: null,
      args: [],
      values: {},
    };
    const topic0 = log.topics[0];
    if (!topic0) return unknown;
    const candidates = this.events.get(topic0);
    if (!candidates?.length) return unknown;

    // Strict decoding rejects candidates whose indexed-parameter layout does not match,
    // which is how ERC-20 and ERC-721 Transfer (same topic0) are told apart.
    const ordered = [...pickCandidates(candidates, context).chosen, ...candidates];
    for (const candidate of ordered) {
      try {
        const decoded = decodeEventLog({
          abi: [candidate.item],
          topics: log.topics as [Hex, ...Hex[]],
          data: log.data,
          strict: true,
        });
        const rawArgs = decoded.args as Record<string, unknown> | undefined;
        const values = lowercaseHex(rawArgs ?? {}) as Record<string, unknown>;
        return {
          status: 'decoded',
          name: candidate.item.name,
          signature: formatAbiItem(candidate.item),
          abiSource: candidate.source.id,
          args: toArgs(
            candidate.item.inputs,
            candidate.item.inputs.map((input, i) => values[input.name ?? String(i)]),
          ),
          values,
        };
      } catch {
        // Layout mismatch for this candidate.
      }
    }
    return unknown;
  }
}
