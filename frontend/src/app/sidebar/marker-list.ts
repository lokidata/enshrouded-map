import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CustomMarker, MarkerStore } from '../core/marker.store';
import { MAX_MARKERS } from '../core/markers.logic';
import { listMarkers } from '../core/markers.list';

/** The custom markers in a list: mine, then each teammate's shared ones; a click shows one on the map. Names and notes are shown as text only. */
@Component({
  selector: 'app-marker-list',
  imports: [TranslocoPipe],
  templateUrl: './marker-list.html',
  styleUrl: './marker-list.css',
})
export class MarkerList {
  private readonly store = inject(MarkerStore);

  protected readonly max = MAX_MARKERS;
  protected readonly total = computed(() => this.store.mine().length);
  protected readonly query = signal('');
  protected readonly mine = computed(() => listMarkers(this.store.mine(), this.query()));
  /** Each teammate's shared markers that match the search; a member with none left is not listed. */
  protected readonly members = computed(() =>
    this.store
      .team()
      .map((m) => ({ ...m, markers: listMarkers(m.markers, this.query()) }))
      .filter((m) => m.markers.length),
  );

  protected show(key: string, marker: CustomMarker): void {
    this.store.reveal.set({ key, id: marker.id });
  }
}
