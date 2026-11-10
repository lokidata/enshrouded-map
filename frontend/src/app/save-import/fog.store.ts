import { Injectable, signal } from '@angular/core';
import { FOG_SIZE, veilPixels } from './fog';

const KEY = 'fog';

/** The explored area imported from a save, as a veil image. Kept in this browser only (never sent, never shared with the team); forgotten at logout. */
@Injectable({ providedIn: 'root' })
export class FogStore {
  /** PNG data URL of the veil, null without an import. */
  readonly url = signal<string | null>(null);

  constructor() {
    try {
      this.url.set(localStorage.getItem(KEY));
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
    try {
      localStorage.setItem(KEY, url);
    } catch {
      // too big or blocked: shown for this visit only
    }
  }

  clear(): void {
    this.url.set(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing to remove
    }
  }
}
