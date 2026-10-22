import { Injectable, computed, inject, signal } from '@angular/core';
import { Catalog } from './catalog.service';
import { Item } from './map-data.model';
import { MapDataService } from './map-data.service';

export type CardState = 'all' | 'some' | 'none';

export const normalize = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Which elements are shown. Only the differences with each category's default
 * visibility are stored ("category|element" -> shown), which is also the format
 * saved in the profile: elements added to the map later follow their default.
 */
@Injectable({ providedIn: 'root' })
export class FilterStore {
  private readonly mapData = inject(MapDataService);
  private readonly catalog = inject(Catalog);

  readonly overrides = signal<Readonly<Record<string, boolean>>>({});
  readonly query = signal('');
  private readonly normalizedQuery = computed(() => normalize(this.query().trim()));

  isShown(cat: string, key: string): boolean {
    return this.overrides()[`${cat}|${key}`] ?? this.mapData.data.categories[cat].visible;
  }

  setShown(cat: string, key: string, shown: boolean): void {
    this.apply([[cat, key]], shown);
  }

  setCategory(cat: string, shown: boolean): void {
    this.apply(
      this.keysOf(cat).map((key) => [cat, key]),
      shown,
    );
  }

  showAll(): void {
    this.overrides.set({});
    this.apply(this.allItems(), true);
  }

  hideAll(): void {
    this.overrides.set({});
    this.apply(this.allItems(), false);
  }

  /** Back to the defaults (logged out). */
  reset(): void {
    this.overrides.set({});
  }

  restore(settings: { filters?: Record<string, boolean> } | null): void {
    this.overrides.set({ ...(settings?.filters ?? {}) });
  }

  cardState(cat: string): CardState {
    const keys = this.keysOf(cat);
    const shown = keys.filter((key) => this.isShown(cat, key)).length;
    return shown === keys.length ? 'all' : shown ? 'some' : 'none';
  }

  /** Does the item match the search? Everything does when the search is empty. */
  matches(item: Item): boolean {
    const q = this.normalizedQuery();
    return !q || item.name.some((n) => normalize(n).includes(q));
  }

  matchesText(...texts: string[]): boolean {
    const q = this.normalizedQuery();
    return !q || texts.some((t) => normalize(t).includes(q));
  }

  private keysOf(cat: string): string[] {
    return [...(this.catalog.items().get(cat)?.keys() ?? [])];
  }

  private allItems(): [string, string][] {
    return [...this.catalog.items()].flatMap(([cat, list]) =>
      [...list.keys()].map((key): [string, string] => [cat, key]),
    );
  }

  private apply(targets: [string, string][], shown: boolean): void {
    const next = { ...this.overrides() };
    for (const [cat, key] of targets) {
      const full = `${cat}|${key}`;
      if (shown === this.mapData.data.categories[cat].visible) delete next[full];
      else next[full] = shown;
    }
    this.overrides.set(next);
  }
}
