import { Injectable, computed, inject } from '@angular/core';
import { Item, Resource, itemKey, markId } from './map-data.model';
import { MapDataService } from './map-data.service';

export interface PlacedResource {
  cat: string;
  key: string;
  data: Resource;
  ids: string[];
}

const KIND_RANK: Record<string, number> = { icon: 0, dots: 1, label: 2 };

/** What the map contains: elements per category, counts, and the id of every markable element. */
@Injectable({ providedIn: 'root' })
export class Catalog {
  private readonly mapData = inject(MapDataService);

  readonly resources = computed<PlacedResource[]>(() =>
    Object.entries(this.mapData.resources()).flatMap(([cat, list]) =>
      list.map((data) => ({
        cat,
        key: itemKey(data.name),
        data,
        ids: Array.from({ length: data.pts.length / 3 }, (_, i) =>
          markId(cat, data.pts[i * 3], data.pts[i * 3 + 1]),
        ),
      })),
    ),
  );

  readonly items = computed(() => {
    const items = new Map<string, Map<string, Item>>();
    const add = (cat: string, key: string, make: () => Item, count: number) => {
      const list = items.get(cat) ?? new Map<string, Item>();
      items.set(cat, list);
      const item = list.get(key) ?? make();
      item.count += count;
      list.set(key, item);
    };
    for (const m of this.mapData.data.markers) {
      const key = itemKey(m.name);
      add(m.cat, key, () => ({ cat: m.cat, key, name: m.name, count: 0 }), 1);
    }
    for (const r of this.resources()) {
      add(
        r.cat,
        r.key,
        () => ({ cat: r.cat, key: r.key, name: r.data.name, count: 0, color: r.data.color }),
        r.ids.length,
      );
    }
    return items;
  });

  readonly counts = computed(() => {
    const counts = new Map<string, number>();
    for (const [cat, list] of this.items()) {
      counts.set(
        cat,
        [...list.values()].reduce((sum, item) => sum + item.count, 0),
      );
    }
    return counts;
  });

  /** Categories: icons first (by count), then resource dots, then map labels. */
  readonly order = computed(() => {
    const { categories } = this.mapData.data;
    const counts = this.counts();
    const rank = (cat: string) => KIND_RANK[categories[cat].kind];
    return [...counts.keys()].sort((a, b) => rank(a) - rank(b) || counts.get(b)! - counts.get(a)!);
  });

  /** Mark id -> the element it belongs to (labels cannot be marked). */
  readonly markIndex = computed(() => {
    const index = new Map<string, { cat: string; key: string }>();
    for (const m of this.mapData.data.markers) {
      if (this.mapData.data.categories[m.cat].kind !== 'label')
        index.set(markId(m.cat, m.x, m.z), { cat: m.cat, key: itemKey(m.name) });
    }
    for (const r of this.resources())
      for (const id of r.ids) index.set(id, { cat: r.cat, key: r.key });
    return index;
  });
}
