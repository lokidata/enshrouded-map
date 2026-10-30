import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CalcContext } from './craft.calc';
import { CraftData, Entry } from './craft.model';
import { LangService } from './lang.service';
import { Names } from './map-data.model';

/** The workshop data (recipes, altar, building pieces), loaded after the login. */
@Injectable({ providedIn: 'root' })
export class CraftService {
  private readonly http = inject(HttpClient);
  private readonly lang = inject(LangService);

  /** Null until loaded, and when the server has no craft.json (the workshop is then hidden). */
  readonly data = signal<CraftData | null>(null);

  async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.http.get<CraftData>('craft.json')));
    } catch {
      this.data.set(null);
    }
  }

  clear(): void {
    this.data.set(null);
  }

  /** Recipes and building pieces by id. */
  readonly entries = computed(() => {
    const d = this.data();
    return new Map<string, Entry>(
      [...(d?.recipes ?? []), ...(d?.blocks ?? [])].map((e) => [e.id, e]),
    );
  });

  readonly byOutput = computed(() => {
    const index = new Map<string, Entry[]>();
    for (const e of this.entries().values()) {
      if (!e.output) continue;
      const list = index.get(e.output.item) ?? [];
      list.push(e);
      index.set(e.output.item, list);
    }
    return index;
  });

  readonly context = computed<CalcContext>(() => ({
    recipes: this.entries(),
    byOutput: this.byOutput(),
    categories: this.data()?.categories ?? {},
  }));

  text(names: Names): string {
    return names[this.lang.index()] ?? names[0];
  }

  itemName(guid: string): string {
    const item = this.data()?.items[guid];
    return item ? this.text(item.name) : guid;
  }

  icon(guid: string): string | null {
    return this.data()?.items[guid]?.icon ?? null;
  }

  stationName(id: string | null): string {
    const station = id ? this.data()?.stations[id] : undefined;
    return station ? this.text(station.name) : this.lang.t('wsNoStation');
  }
}
