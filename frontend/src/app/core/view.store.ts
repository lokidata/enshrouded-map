import { Injectable, signal } from '@angular/core';
import { SlotKey } from './gear.model';

export type View =
  'map' | 'workshop' | 'lore' | 'enemies' | 'build' | 'equipment' | 'skills' | 'gems' | 'game';

/** What fills the main area next to the menu. */
@Injectable({ providedIn: 'root' })
export class ViewStore {
  readonly view = signal<View>('map');
  /** The slot the Equipment screen lists items for. */
  readonly slot = signal<SlotKey>('head');

  pick(slot: SlotKey): void {
    this.slot.set(slot);
    this.set('equipment');
  }

  set(view: View): void {
    this.view.set(view);
    setTimeout(() => dispatchEvent(new Event('resize'))); // Leaflet measures the map again
  }
}
