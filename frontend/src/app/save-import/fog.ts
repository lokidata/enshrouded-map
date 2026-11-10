import { KsdError } from './ksd';

/** The explored area: a 13-byte header (`FGOW` at byte 8), then 1280 x 1280 bytes (0 = unseen, 255 = seen), 8 m per cell, north up. */
export const FOG_SIZE = 1280;
const HEADER = 13;

export function readFog(data: Uint8Array): Uint8Array {
  const magic = new TextDecoder().decode(data.subarray(8, 12)); // 13-byte header: 8 bytes, `FGOW`, a version byte
  if (data.length !== HEADER + FOG_SIZE * FOG_SIZE || magic !== 'FGOW') throw new KsdError('fog');
  return data.subarray(HEADER);
}

/** Share of the cells that are explored (a cell counts from half seen). */
export function fogShare(cells: Uint8Array): number {
  let n = 0;
  for (const c of cells) if (c >= 128) n++;
  return n / cells.length;
}

/** RGBA pixels of the veil over the unexplored part: dark and see-through, clear where the player has been. */
export function veilPixels(cells: Uint8Array): Uint8ClampedArray {
  const px = new Uint8ClampedArray(cells.length * 4);
  for (let i = 0; i < cells.length; i++) {
    px[4 * i] = 11;
    px[4 * i + 1] = 15;
    px[4 * i + 2] = 20;
    px[4 * i + 3] = Math.round(0.6 * (255 - cells[i]));
  }
  return px;
}

/** Is the point (x, z) in metres on an explored cell? The grid is north-up and the map's z grows to the north (see `latLng` in map-view), so row 0 is z = size. Outside the world: false. */
export function isExplored(cells: Uint8Array, x: number, z: number, size: number): boolean {
  const cell = size / FOG_SIZE;
  const col = Math.floor(x / cell);
  const row = Math.floor((size - z) / cell);
  if (col < 0 || col >= FOG_SIZE || row < 0 || row >= FOG_SIZE) return false;
  return cells[row * FOG_SIZE + col] >= 128;
}

/** The cells (0..255) back from the veil image: the veil's alpha is 0.6 x unseen (see `veilPixels`), so alpha under 77 means seen. */
export function cellsFromVeil(rgba: Uint8ClampedArray): Uint8Array {
  const cells = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < cells.length; i++)
    cells[i] = Math.min(255, 255 - Math.round(rgba[4 * i + 3] / 0.6));
  return cells;
}

/** Bytes of a grid with one bit per cell (what the server stores for a shared area). */
export const FOG_BYTES = (FOG_SIZE * FOG_SIZE) / 8;

/** One bit per cell, cell i in bit i % 8 of byte i >> 3: explored from half seen. */
export function cellsToBits(cells: Uint8Array): Uint8Array {
  const bits = new Uint8Array(FOG_BYTES);
  for (let i = 0; i < cells.length; i++) if (cells[i] >= 128) bits[i >> 3] |= 1 << (i & 7);
  return bits;
}

export function bitsToCells(bits: Uint8Array): Uint8Array {
  const cells = new Uint8Array(bits.length * 8);
  for (let i = 0; i < cells.length; i++) cells[i] = bits[i >> 3] & (1 << (i & 7)) ? 255 : 0;
  return cells;
}

/** Explored by one or the other. */
export function unionCells(a: Uint8Array, b: Uint8Array): Uint8Array {
  return a.map((v, i) => (v >= 128 || b[i] >= 128 ? 255 : 0));
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
