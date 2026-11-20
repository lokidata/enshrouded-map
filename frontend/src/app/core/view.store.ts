import { Injectable, signal } from '@angular/core';
import { SlotKey } from './gear.model';

export type View =
  'map' | 'workshop' | 'lore' | 'enemies' | 'build' | 'equipment' | 'skills' | 'game' | 'addon';

/** What fills the main area next to the menu. */
@Injectable({ providedIn: 'root' })
export class ViewStore {
  readonly view = signal<View>('map');
  /** The slot the Equipment screen lists items for. */
  readonly slot = signal<SlotKey>('head');
  /** The add-on shown when the view is 'addon' (an id from the add-on manifest). */
  readonly addonId = signal<string | null>(null);

  openAddon(id: string): void {
    this.addonId.set(id);
    this.set('addon');
  }

  pick(slot: SlotKey): void {
    this.slot.set(slot);
    this.set('equipment');
  }

  set(view: View): void {
    this.view.set(view);
    setTimeout(() => dispatchEvent(new Event('resize'))); // Leaflet measures the map again
  }
}
