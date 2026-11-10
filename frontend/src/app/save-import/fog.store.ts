import { Injectable, signal } from '@angular/core';
import { FOG_SIZE, cellsFromVeil, fogShare, veilPixels } from './fog';

const KEY = 'fog';
const PERCENT = 'fogShare';

/** localStorage keys of one character profile's explored area. */
const keyOf = (id: number): string => `${KEY}:${id}`;
const percentOf = (id: number): string => `${PERCENT}:${id}`;

/** Removes the stored explored areas: one profile's, or every profile's (and the one of the first version). */
function wipe(id: number | null): void {
  try {
    const keys = Object.keys(localStorage).filter((k) =>
      id === null
        ? k === KEY || k === PERCENT || /^fog(Share)?:/.test(k)
        : k === keyOf(id) || k === percentOf(id),
    );
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // nothing to remove
  }
}

/** The explored area imported from a save, as a veil image, one per character profile. Kept in this browser only (never sent, never shared with the team); forgotten at logout. */
@Injectable({ providedIn: 'root' })
export class FogStore {
  /** PNG data URL of the veil, null without an import. */
  readonly url = signal<string | null>(null);
  /** Share of the map explored (0..1), null without an import. */
  readonly share = signal<number | null>(null);
  /** The explored cells (north-up grid), decoded from the veil; null without an import or until decoded. */
  readonly cells = signal<Uint8Array | null>(null);
  /** The character profile whose area is shown. */
  private id: number | null = null;

  /** Shows the area of this profile (or none). The first version kept one area per browser: the first profile that asks takes it. */
  use(id: number | null): void {
    this.id = id;
    this.url.set(null);
    this.share.set(null);
    this.cells.set(null);
    if (id === null) return;
    try {
      if (localStorage.getItem(keyOf(id)) === null && localStorage.getItem(KEY) !== null) {
        localStorage.setItem(keyOf(id), localStorage.getItem(KEY)!);
        localStorage.setItem(percentOf(id), localStorage.getItem(PERCENT) ?? '');
        localStorage.removeItem(KEY);
        localStorage.removeItem(PERCENT);
      }
      const url = localStorage.getItem(keyOf(id));
      const n = Number(localStorage.getItem(percentOf(id)));
      this.url.set(url);
      this.share.set(url && Number.isFinite(n) ? n : null);
      if (url) void this.decode(url);
    } catch {
      // storage blocked: nothing remembered
    }
  }

  set(cells: Uint8Array): void {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = FOG_SIZE;
    const px = veilPixels(cells);
    canvas.getContext('2d')?.putImageData(new ImageData(px as never, FOG_SIZE, FOG_SIZE), 0, 0);
    const url = canvas.toDataURL('image/png');
    this.url.set(url);
    this.cells.set(cells);
    this.share.set(fogShare(cells));
    if (this.id === null) return;
    try {
      localStorage.setItem(keyOf(this.id), url);
      localStorage.setItem(percentOf(this.id), String(this.share()));
    } catch {
      // too big or blocked: shown for this visit only
    }
  }

  /** Reads the cells back from the stored veil (after a reload). */
  private async decode(url: string): Promise<void> {
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = FOG_SIZE;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0);
      const data = ctx?.getImageData(0, 0, FOG_SIZE, FOG_SIZE).data;
      if (data) this.cells.set(cellsFromVeil(data));
    } catch {
      // unreadable image: the filter simply has nothing to work with
    }
  }

  /** A deleted profile's area goes with it. */
  forget(id: number): void {
    wipe(id);
  }

  /** Logout: nothing stays for the next account. */
  clear(): void {
    this.id = null;
    this.url.set(null);
    this.share.set(null);
    this.cells.set(null);
    wipe(null);
  }
}
