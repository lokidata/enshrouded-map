import { Injectable, signal } from '@angular/core';

export type Tab = 'recipes' | 'items' | 'blocks' | 'stations' | 'altar' | 'calc';

/** Which workshop tab is open, and which item or station it shows in detail. */
@Injectable({ providedIn: 'root' })
export class WorkshopNav {
  readonly tab = signal<Tab>('recipes');
  readonly item = signal<string | null>(null);
  readonly station = signal<string | null>(null);
  /** An armour set page; stays open under an item page, so Back returns to it. */
  readonly set = signal<string | null>(null);

  openItem(guid: string | null): void {
    this.item.set(guid);
    this.tab.set('items');
  }

  openSet(key: string | null): void {
    this.item.set(null);
    this.set.set(key);
    this.tab.set('items');
  }

  openStation(id: string | null): void {
    this.station.set(id);
    this.tab.set('stations');
  }
}
