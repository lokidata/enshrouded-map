import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CraftService } from '../core/craft.service';
import { LangService } from '../core/lang.service';
import { EntryCard } from './entry-card';
import { WorkshopNav } from './workshop-nav';

const PAGE = 40;

/** The crafting stations with their recipe counts, and what one station makes. */
@Component({
  selector: 'app-stations-tab',
  imports: [TranslocoPipe, EntryCard],
  template: `
    <div class="browse">
      <aside class="side" [attr.aria-label]="'wsFilters' | transloco">
        <h3 class="side-title">{{ 'ws_stations' | transloco }}</h3>
        <ul class="cat-list">
          @for (s of stations(); track s.id) {
            <li>
              <button
                type="button"
                [class.active]="s.id === selected()"
                [attr.aria-pressed]="s.id === selected()"
                (click)="open(s.id)"
              >
                <span>{{ s.label }}</span
                ><b>{{ s.count }}</b>
              </button>
            </li>
          }
        </ul>
      </aside>
      <section class="main">
        @if (selected(); as id) {
          <h2>{{ craft.stationName(id === NONE ? null : id) }}</h2>
          <p class="count" role="status">
            {{ 'wsRecipeCount' | transloco: { n: entries().length } }}
          </p>
          <div class="cards">
            @for (e of entries().slice(0, limit()); track e.id) {
              <app-entry-card [entry]="e" />
            }
          </div>
          @if (entries().length > limit()) {
            <button type="button" class="more pill" (click)="limit.set(limit() + PAGE)">
              {{ 'wsMore' | transloco: { n: entries().length - limit() } }}
            </button>
          }
        }
      </section>
    </div>
  `,
})
export class StationsTab {
  protected readonly craft = inject(CraftService);
  protected readonly nav = inject(WorkshopNav);
  private readonly lang = inject(LangService);

  protected readonly PAGE = PAGE;
  protected readonly NONE = 'none';
  protected readonly limit = signal(PAGE);

  protected readonly stations = computed(() => {
    const count = new Map<string, number>();
    for (const e of this.craft.entries().values())
      count.set(e.station ?? this.NONE, (count.get(e.station ?? this.NONE) ?? 0) + 1);
    const lang = this.lang.lang();
    return [...count]
      .map(([id, n]) => ({
        id,
        count: n,
        label: this.craft.stationName(id === this.NONE ? null : id),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, lang) || b.count - a.count);
  });

  /** The open station; the first one until the player picks another. */
  protected readonly selected = computed(
    () => this.nav.station() ?? this.stations()[0]?.id ?? null,
  );

  protected readonly entries = computed(() => {
    const id = this.selected();
    const lang = this.lang.lang();
    return [...this.craft.entries().values()]
      .filter((e) => (e.station ?? this.NONE) === id)
      .sort((a, b) => this.craft.text(a.name).localeCompare(this.craft.text(b.name), lang));
  });

  protected open(id: string): void {
    this.limit.set(PAGE);
    this.nav.station.set(id);
  }
}
