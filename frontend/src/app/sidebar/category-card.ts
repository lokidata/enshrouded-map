import { Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Catalog } from '../core/catalog.service';
import { FilterStore } from '../core/filter.store';
import { LangService } from '../core/lang.service';
import { MapDataService } from '../core/map-data.service';
import { AuthService } from '../core/auth.service';
import { ProgressStore } from '../core/progress.store';

/** One category: click to show / hide it, the arrow opens its elements. */
@Component({
  selector: 'app-category-card',
  imports: [TranslocoPipe],
  host: { '[style.--c]': 'color()' },
  templateUrl: './category-card.html',
  styleUrl: './category-card.css',
})
export class CategoryCard {
  readonly cat = input.required<string>();
  readonly color = input.required<string>();

  protected readonly filters = inject(FilterStore);
  protected readonly lang = inject(LangService);
  private readonly catalog = inject(Catalog);
  private readonly auth = inject(AuthService);
  private readonly progress = inject(ProgressStore);
  private readonly mapData = inject(MapDataService);

  protected readonly open = signal(false);
  protected readonly category = computed(() => this.mapData.data.categories[this.cat()]);
  protected readonly state = computed(() => this.filters.cardState(this.cat()));
  private readonly list = computed(() => [
    ...(this.catalog.items().get(this.cat())?.values() ?? []),
  ]);
  protected readonly single = computed(() => this.list().length <= 1);
  protected readonly dotColor = computed(() => this.list()[0]?.color);

  /** Elements sorted by name in the current language; only the matching ones while searching. */
  protected readonly rows = computed(() => {
    const i = this.lang.index();
    return this.list()
      .filter((item) => this.filters.matches(item))
      .sort((a, b) => a.name[i].localeCompare(b.name[i], this.lang.lang()));
  });

  private readonly doneByItem = computed(() => {
    const byItem = new Map<string, number>();
    const index = this.catalog.markIndex();
    for (const id of this.progress.done()) {
      const e = index.get(id);
      if (e?.cat === this.cat()) byItem.set(e.key, (byItem.get(e.key) ?? 0) + 1);
    }
    return byItem;
  });

  private readonly trackable = computed(
    () => !!this.auth.user() && this.category().kind !== 'label',
  );

  protected readonly countText = computed(() => {
    const total = this.catalog.counts().get(this.cat()) ?? 0;
    if (!this.trackable()) return `${total}`;
    return `${[...this.doneByItem().values()].reduce((a, b) => a + b, 0)}/${total}`;
  });

  protected itemCount(key: string, count: number): string {
    if (this.trackable()) return `${this.doneByItem().get(key) ?? 0}/${count}`;
    return count > 1 ? `${count}` : '';
  }

  protected toggle(): void {
    this.filters.setCategory(this.cat(), this.state() === 'none');
  }

  protected setItem(key: string, event: Event): void {
    this.filters.setShown(this.cat(), key, (event.target as HTMLInputElement).checked);
  }
}
