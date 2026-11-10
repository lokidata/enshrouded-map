import { Injectable, inject } from '@angular/core';
import { Entry } from './craft.model';
import { markId } from './map-data.model';
import { MapDataService } from './map-data.service';
import { ProgressStore } from './progress.store';

/**
 * What the map says about an item: a marker that is an item (a cosmetic, a unique item, a collectible)
 * is found when the player marks it, and a recipe that item unlocks is then known: the two stay in step.
 */
@Injectable({ providedIn: 'root' })
export class Found {
  private readonly mapData = inject(MapDataService);
  private readonly progress = inject(ProgressStore);
  private index: Map<string, string[]> | null = null;

  /** Mark ids of the markers of an item on the map (empty when it is not on it). */
  markersOf(item: string): readonly string[] {
    if (!this.index && this.mapData.data) {
      this.index = new Map();
      for (const m of this.mapData.data.markers) {
        if (!m.item) continue;
        const list = this.index.get(m.item) ?? [];
        list.push(markId(m.cat, m.x, m.z));
        this.index.set(m.item, list);
      }
    }
    return this.index?.get(item) ?? [];
  }

  /** How many of the places of an item are marked, out of how many. */
  itemProgress(item: string): { done: number; total: number } {
    const ids = this.markersOf(item);
    const marks = this.progress.done();
    return { done: ids.filter((id) => marks.has(id)).length, total: ids.length };
  }

  /** An item is discovered when one of its places on the map is marked, or a recipe that makes it is known. */
  itemKnown(item: string, makers: readonly Entry[]): boolean {
    return this.itemProgress(item).done > 0 || makers.some((e) => this.known(e));
  }

  /** The item that unlocks a recipe, when it is the only one and it is on the map; null otherwise. */
  unlockItem(entry: Entry): string | null {
    const items = entry.unlock.items ?? [];
    return items.length === 1 && this.markersOf(items[0]).length ? items[0] : null;
  }

  /** A recipe is known when it is ticked, or when the item that unlocks it is marked on the map. */
  known(entry: Entry): boolean {
    const item = this.unlockItem(entry);
    const marks = this.progress.done();
    return marks.has(`recipe:${entry.id}`) || (!!item && this.itemProgress(item).done > 0);
  }

  /**
   * Ticks or unticks a recipe, and its item on the map with it: unticking clears every marker of the
   * item (or the recipe would stay known); ticking marks it only when it has a single place, as the
   * player may have found another one.
   */
  async setKnown(entry: Entry, known: boolean): Promise<void> {
    const item = this.unlockItem(entry);
    const places = item ? this.markersOf(item) : [];
    const recipe = `recipe:${entry.id}`;
    if (known) await this.progress.setAll([recipe, ...(places.length === 1 ? places : [])], true);
    else await this.progress.setAll([recipe, ...places], false);
  }
}
