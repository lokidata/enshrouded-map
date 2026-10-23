import { Injectable, computed, signal } from '@angular/core';

export type LayoutPref = 'auto' | 'left' | 'top';
export const LAYOUTS: readonly LayoutPref[] = ['auto', 'left', 'top'];

/** Where the menu sits: on the left, on top, or by the screen's orientation (portrait: on top). */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly pref = signal<LayoutPref>(this.saved());
  private readonly portrait = signal(false);
  /** True when the menu is on top of the map. */
  readonly top = computed(
    () => this.pref() === 'top' || (this.pref() === 'auto' && this.portrait()),
  );

  constructor() {
    const query = matchMedia('(orientation: portrait)');
    this.portrait.set(query.matches);
    query.addEventListener('change', (e) => this.portrait.set(e.matches));
  }

  set(pref: LayoutPref): void {
    this.pref.set(pref);
    try {
      localStorage.setItem('layout', pref);
    } catch {
      // storage blocked: the choice just is not remembered
    }
    setTimeout(() => dispatchEvent(new Event('resize'))); // the map is resized by Leaflet
  }

  private saved(): LayoutPref {
    try {
      const value = localStorage.getItem('layout');
      return LAYOUTS.find((l) => l === value) ?? 'auto';
    } catch {
      return 'auto';
    }
  }
}
