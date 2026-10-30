import { Injectable, signal } from '@angular/core';

export type View = 'map' | 'workshop';

/** What fills the main area next to the menu. */
@Injectable({ providedIn: 'root' })
export class ViewStore {
  readonly view = signal<View>('map');

  set(view: View): void {
    this.view.set(view);
    setTimeout(() => dispatchEvent(new Event('resize'))); // Leaflet measures the map again
  }
}
