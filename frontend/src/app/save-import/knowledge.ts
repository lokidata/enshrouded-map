import { KsdError } from './ksd';

export const MAX_KNOWLEDGE = 100_000;

/** `player_knowledge`: `[u32 version = 1][u32 n][n x u32 id][n x u32 flags]`; the length must match exactly. */
export function readKnowledge(data: Uint8Array): Map<number, number> {
  if (data.length < 8) throw new KsdError('knowledge');
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = v.getUint32(4, true);
  if (v.getUint32(0, true) !== 1 || n > MAX_KNOWLEDGE || data.length !== 8 + 8 * n)
    throw new KsdError('knowledge');
  const out = new Map<number, number>();
  for (let i = 0; i < n; i++)
    out.set(v.getUint32(8 + 4 * i, true), v.getUint32(8 + 4 * (n + i), true));
  return out;
}

/** The game's id of an object: FNV-1a 32 bits over the 16 bytes of its GUID, in little-endian field order. */
export function guidId(guid: string): number {
  const hex = guid.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return -1;
  const b = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));
  const bytes = [
    ...b.slice(0, 4).reverse(),
    ...b.slice(4, 6).reverse(),
    ...b.slice(6, 8).reverse(),
    ...b.slice(8),
  ];
  let h = 0x811c9dc5;
  for (const x of bytes) h = Math.imul(h ^ x, 0x01000193) >>> 0;
  return h;
}
