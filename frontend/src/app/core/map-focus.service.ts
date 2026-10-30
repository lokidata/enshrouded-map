import { Injectable, inject, signal } from '@angular/core';
import { Catalog } from './catalog.service';
import { Sources } from './craft.model';
import { FilterStore } from './filter.store';
import { itemKey, markId } from './map-data.model';
import { MapDataService } from './map-data.service';
import { ViewStore } from './view.store';

export interface Point {
  x: number;
  z: number;
}

/** "Show on the map": reveals the places of a recipe, then the map frames them. */
@Injectable({ providedIn: 'root' })
export class MapFocus {
  private readonly mapData = inject(MapDataService);
  private readonly catalog = inject(Catalog);
  private readonly filters = inject(FilterStore);
  private readonly views = inject(ViewStore);

  /** Points the map has to frame; it clears them once done. */
  readonly points = signal<Point[] | null>(null);

  async show(sources: Sources): Promise<void> {
    const points: Point[] = [];
    const wanted = new Set(sources.markers);
    if (wanted.size) {
      for (const m of this.mapData.data.markers) {
        if (!wanted.has(markId(m.cat, m.x, m.z))) continue;
        points.push({ x: m.x, z: m.z });
        this.filters.setShown(m.cat, itemKey(m.name), true);
      }
    }
    // chests and other dotted places are resources, not markers
    if (wanted.size || sources.groups?.length) {
      if (!Object.keys(this.mapData.resources()).length) await this.mapData.loadResources();
      for (const r of this.catalog.resources()) {
        r.ids.forEach((id, i) => {
          if (!wanted.has(id)) return;
          points.push({ x: r.data.pts[i * 3], z: r.data.pts[i * 3 + 1] });
          this.filters.setShown(r.cat, r.key, true);
        });
      }
    }
    if (sources.groups?.length) {
      for (const group of sources.groups) {
        const key = itemKey(group.name);
        for (const r of this.catalog.resources()) {
          if (r.cat !== group.cat || r.key !== key) continue;
          for (let i = 0; i < r.data.pts.length; i += 3)
            points.push({ x: r.data.pts[i], z: r.data.pts[i + 1] });
          this.filters.setShown(r.cat, r.key, true);
        }
      }
    }
    if (!points.length) return;
    this.views.set('map');
    this.points.set(points);
  }
}
