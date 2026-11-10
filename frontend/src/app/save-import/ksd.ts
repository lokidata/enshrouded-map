import { Decompress } from 'fzstd';

/** Reader of the game's `.ksd` save container (`SV2C`): a table of named sections, each an `S2BH` block, zstd-compressed or stored. */

export const MAX_FILE = 50_000_000;
export const MAX_SECTIONS = 64;
export const MAX_SECTION = 64_000_000;

export class KsdError extends Error {}

const text = new TextDecoder();

/** The sections of a save, decompressed, by name. Every offset and size is checked before it is used. */
export function readKsd(file: Uint8Array): Map<string, Uint8Array> {
  if (file.length > MAX_FILE || file.length < 0x30) throw new KsdError('size');
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (text.decode(file.subarray(0, 4)) !== 'SV2C') throw new KsdError('magic');
  const table = 0x28 + v.getUint32(0x28, true);
  const count = v.getUint32(0x2c, true);
  if (count > MAX_SECTIONS || table + 20 * count > file.length) throw new KsdError('table');
  const sections = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const at = table + 20 * i;
    const nameAt = at + v.getUint32(at, true);
    const nameLen = v.getUint32(at + 4, true);
    const off = v.getUint32(at + 8, true);
    const size = v.getUint32(at + 12, true);
    if (nameLen > 64 || nameAt + nameLen > file.length || off + size > file.length || size < 14)
      throw new KsdError('section');
    const block = file.subarray(off, off + size);
    if (text.decode(block.subarray(0, 4)) !== 'S2BH') throw new KsdError('block');
    const data = block.subarray(14);
    const name = text.decode(file.subarray(nameAt, nameAt + nameLen));
    sections.set(name, block[9] === 1 ? unzstd(data) : data);
  }
  return sections;
}

/** zstd decompression that stops as soon as the output goes over the cap (no allocation from a size the file claims). */
function unzstd(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    const d = new Decompress((chunk) => {
      total += chunk.length;
      if (total > MAX_SECTION) throw new KsdError('too_big');
      parts.push(chunk);
    });
    d.push(data, true);
  } catch (e) {
    throw e instanceof KsdError ? e : new KsdError('zstd');
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
