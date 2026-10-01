import type { JsonValue } from './dto';

/**
 * Converts values produced by ABI decoding (bigint, nested arrays, structs) into
 * JSON-safe values. bigint becomes a decimal string; it is never coerced to Number.
 */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString(10);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = toJsonValue(entry);
    return out;
  }
  // symbols and functions have no JSON representation.
  return null;
}
