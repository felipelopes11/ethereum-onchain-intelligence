/** Keyset cursor over (blockNumber, position) encoded as base64url. Opaque to clients. */
export function encodeCursor(blockNumber: bigint, position: number): string {
  return Buffer.from(`${blockNumber.toString(10)}.${position}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { blockNumber: bigint; position: number } | null {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = /^(\d{1,20})\.(\d{1,9})$/.exec(decoded);
  if (!match?.[1] || !match[2]) return null;
  return { blockNumber: BigInt(match[1]), position: Number(match[2]) };
}
