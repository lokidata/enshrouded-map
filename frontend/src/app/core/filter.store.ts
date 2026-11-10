import { Injectable, computed, inject, signal } from '@angular/core';
import { Catalog } from './catalog.service';
import { Item } from './map-data.model';
import { MapDataService } from './map-data.service';

export type CardState = 'all' | 'some' | 'none';

export const normalize = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Key of a category's own choice in the overrides ("category|*"); an element key is never "*". */
const WHOLE = '*';

/**
 * Which elements are shown. Only the differences are stored, which is also the
 * format saved in the profile: "category|*" -> shown when the whole category was
 * switched away from its default, "category|element" -> shown for an element
 * that differs from its category. Elements added to the map later follow their
 * category, so a category shown in full stays in full.
 */
const read = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

@Injectable({ providedIn: 'root' })
export class FilterStore {
  private readonly mapData = inject(MapDataService);
  private readonly catalog = inject(Catalog);

  readonly overrides = signal<Readonly<Record<string, boolean>>>({});
  readonly query = signal('');
  /** Show only the markers on a cell of the explored area imported from a save (this browser only). */
  readonly onlyExplored = signal(read('onlyExplored'));
  private readonly normalizedQuery = computed(() => normalize(this.query().trim()));

  setOnlyExplored(on: boolean): void {
    this.onlyExplored.set(on);
    try {
      localStorage.setItem('onlyExplored', on ? '1' : '0');
    } catch {
      // storage blocked: not remembered
    }
  }

  isShown(cat: string, key: string): boolean {
    const overrides = this.overrides();
    return overrides[`${cat}|${key}`] ?? this.categoryShown(overrides, cat);
  }

  setShown(cat: string, key: string, shown: boolean): void {
    this.apply([[cat, key]], shown);
  }

  /** The whole category, elements to come included: its element exceptions are dropped. */
  setCategory(cat: string, shown: boolean): void {
    const next = { ...this.overrides() };
    for (const key of Object.keys(next)) if (key.startsWith(`${cat}|`)) delete next[key];
    if (shown !== this.mapData.data.categories[cat].visible) next[`${cat}|${WHOLE}`] = shown;
    this.overrides.set(next);
  }

  showAll(): void {
    this.setEverything(true);
  }

  hideAll(): void {
    this.setEverything(false);
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

  private categoryShown(overrides: Readonly<Record<string, boolean>>, cat: string): boolean {
    return overrides[`${cat}|${WHOLE}`] ?? this.mapData.data.categories[cat].visible;
  }

  private setEverything(shown: boolean): void {
    const next: Record<string, boolean> = {};
    for (const [cat, category] of Object.entries(this.mapData.data.categories))
      if (shown !== category.visible) next[`${cat}|${WHOLE}`] = shown;
    this.overrides.set(next);
  }

  private apply(targets: [string, string][], shown: boolean): void {
    const next = { ...this.overrides() };
    for (const [cat, key] of targets) {
      const full = `${cat}|${key}`;
      if (shown === this.categoryShown(next, cat)) delete next[full];
      else next[full] = shown;
    }
    this.overrides.set(next);
  }
}
