import { Injectable, signal } from '@angular/core';
import { FOG_SIZE, cellsFromVeil, fogShare, veilPixels } from './fog';

const KEY = 'fog';
const PERCENT = 'fogShare';

/** The explored area imported from a save, as a veil image. Kept in this browser only (never sent, never shared with the team); forgotten at logout. */
@Injectable({ providedIn: 'root' })
export class FogStore {
  /** PNG data URL of the veil, null without an import. */
  readonly url = signal<string | null>(null);
  /** Share of the map explored (0..1), null without an import. */
  readonly share = signal<number | null>(null);
  /** The explored cells (north-up grid), decoded from the veil; null without an import or until decoded. */
  readonly cells = signal<Uint8Array | null>(null);

  constructor() {
    try {
      this.url.set(localStorage.getItem(KEY));
      const n = Number(localStorage.getItem(PERCENT));
      this.share.set(this.url() && Number.isFinite(n) ? n : null);
      const url = this.url();
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
    try {
      localStorage.setItem(KEY, url);
      localStorage.setItem(PERCENT, String(this.share()));
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

  clear(): void {
    this.url.set(null);
    this.share.set(null);
    this.cells.set(null);
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(PERCENT);
    } catch {
      // nothing to remove
    }
  }
}
