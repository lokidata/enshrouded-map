import { Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CraftService } from '../core/craft.service';
import { BlockEntry, Entry } from '../core/craft.model';
import { normalize } from '../core/filter.store';
import { LangService } from '../core/lang.service';
import { ProgressStore } from '../core/progress.store';
import { EntryCard } from './entry-card';
import { ItemChip } from './item-chip';

const PAGE = 40;
type Facet = 'cat' | 'rarity';
const FACETS: readonly { key: Facet; title: string }[] = [
  { key: 'cat', title: 'wsCategory' },
  { key: 'rarity', title: 'wsRarity' },
];
const NO_TIER = 'none'; // the filter value of the pieces without a tier
const NO_STATION = 'none'; // the filter value of the recipes without a known station

/** The recipes (or the building pieces): search, filter, and the cards. */
const tierOf = (e: Entry | BlockEntry): string => (e as BlockEntry).tier ?? NO_TIER;
/** T0 < T1 < ... < T7, the pieces without a tier last. */
const tierRank = (tier: string): number => (tier === NO_TIER ? 99 : Number(tier.slice(1)) || 0);

@Component({
  selector: 'app-entries-tab',
  imports: [TranslocoPipe, EntryCard, ItemChip],
  template: `
    <div class="browse">
      <aside class="side" [attr.aria-label]="'wsFilters' | transloco">
        <input
          type="search"
          [placeholder]="'wsFilterName' | transloco"
          [attr.aria-label]="'wsSearch' | transloco"
          [value]="query()"
          (input)="setQuery($any($event.target).value)"
        />
        @if (categories(); as cat) {
          <h3 class="side-title">{{ 'wsCategory' | transloco }}</h3>
          <ul class="cat-list">
            <li>
              <button type="button" [class.active]="!cat.current" (click)="pickCategory('')">
                <span>{{ 'wsAllItems' | transloco }}</span
                ><b>{{ source().length }}</b>
              </button>
            </li>
            @for (o of cat.options; track o.value) {
              <li>
                <button
                  type="button"
                  [class.active]="cat.current === o.value"
                  [attr.aria-pressed]="cat.current === o.value"
                  (click)="pickCategory(o.value)"
                >
                  <span>{{ o.label }}</span
                  ><b>{{ o.n }}</b>
                </button>
              </li>
            }
          </ul>
        }
        @if (kind() === 'recipes') {
          <label class="side-select">
            <span class="side-title">{{ 'wsStation' | transloco }}</span>
            <select
              [attr.aria-label]="'wsStation' | transloco"
              (change)="setStation($any($event.target).value)"
            >
              <option value="">{{ 'wsAllStations' | transloco }}</option>
              @for (s of stations(); track s.id) {
                <option [value]="s.id" [selected]="s.id === station()">{{ s.label }}</option>
              }
            </select>
          </label>
        } @else {
          <label class="side-select">
            <span class="side-title">{{ 'wsTier' | transloco }}</span>
            <select
              [attr.aria-label]="'wsTier' | transloco"
              (change)="setTier($any($event.target).value)"
            >
              <option value="">{{ 'wsAllTiers' | transloco }}</option>
              @for (t of tiers(); track t) {
                <option [value]="t" [selected]="t === tier()">
                  {{ t === NO_TIER ? ('wsNoTier' | transloco) : t }}
                </option>
              }
            </select>
          </label>
        }
        @if (rarityFacet(); as r) {
          <label class="side-select">
            <span class="side-title">{{ r.title | transloco }}</span>
            <select
              [attr.aria-label]="r.title | transloco"
              (change)="setFacet('rarity', $any($event.target).value)"
            >
              <option value="">{{ 'wsAll' | transloco }}</option>
              @for (o of r.options; track o.value) {
                <option [value]="o.value" [selected]="o.value === sel().rarity">
                  {{ o.label }} ({{ o.n }})
                </option>
              }
            </select>
          </label>
        }
        <label class="check">
          <input type="checkbox" [checked]="locked()" (change)="locked.set(!locked())" />
          {{ 'wsLockedOnly' | transloco }}
        </label>
      </aside>
      <section class="main">
        <div class="bar">
          @if (kind() === 'blocks') {
            <span class="bar-label">{{ 'wsSort' | transloco }}</span>
            <button
              type="button"
              class="pill"
              [attr.aria-pressed]="sort() === 'name'"
              (click)="sort.set('name')"
            >
              {{ 'wsName' | transloco }}
            </button>
            <button
              type="button"
              class="pill"
              [attr.aria-pressed]="sort() === 'tier'"
              (click)="sort.set('tier')"
            >
              {{ 'wsTier' | transloco }}
            </button>
          }
          <span class="count" role="status">{{ 'wsCount' | transloco: { n: list().length } }}</span>
          <button
            type="button"
            class="pill"
            [attr.aria-pressed]="view() === 'grid'"
            (click)="view.set('grid')"
          >
            {{ 'wsViewGrid' | transloco }}
          </button>
          <button
            type="button"
            class="pill"
            [attr.aria-pressed]="view() === 'table'"
            (click)="view.set('table')"
          >
            {{ 'wsViewTable' | transloco }}
          </button>
        </div>
        @if (view() === 'table') {
          <table class="entries-table">
            <thead>
              <tr>
                <th scope="col">{{ 'wsName' | transloco }}</th>
                <th scope="col">{{ 'wsStation' | transloco }}</th>
                @if (kind() === 'blocks') {
                  <th scope="col">{{ 'wsTier' | transloco }}</th>
                }
                <th scope="col">{{ 'wsIngredients' | transloco }}</th>
              </tr>
            </thead>
            <tbody>
              @for (e of shown(); track e.id) {
                <tr>
                  <td>{{ craft.text(e.name) }}</td>
                  <td>{{ craft.stationName(e.station) }}</td>
                  @if (kind() === 'blocks') {
                    <td>{{ tierText(e) }}</td>
                  }
                  <td>
                    <ul class="inputs">
                      @for (i of e.inputs; track $index) {
                        <li>
                          @if (i.item) {
                            <app-item-chip [item]="i.item" [count]="i.count" />
                          } @else {
                            <span class="any">{{ 'wsAnyOf' | transloco }} × {{ i.count }}</span>
                          }
                        </li>
                      }
                    </ul>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="kind() === 'blocks' ? 4 : 3" class="empty">
                    {{ 'wsNoResult' | transloco }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <div class="cards">
            @for (e of shown(); track e.id) {
              <app-entry-card [entry]="e" />
            } @empty {
              <p class="empty">{{ 'wsNoResult' | transloco }}</p>
            }
          </div>
        }
        @if (list().length > limit()) {
          <button type="button" class="more pill" (click)="limit.set(limit() + PAGE)">
            {{ 'wsMore' | transloco: { n: list().length - limit() } }}
          </button>
        }
      </section>
    </div>
  `,
})
export class EntriesTab {
  readonly kind = input.required<'recipes' | 'blocks'>();

  protected readonly PAGE = PAGE;
  protected readonly NO_TIER = NO_TIER;
  protected readonly craft = inject(CraftService);
  private readonly lang = inject(LangService);
  private readonly progress = inject(ProgressStore);

  protected readonly query = signal('');
  protected readonly station = signal('');
  protected readonly group = signal('');
  protected readonly tier = signal('');
  protected readonly sort = signal<'name' | 'tier'>('name');
  protected readonly locked = signal(false);
  protected readonly limit = signal(PAGE);
  protected readonly sel = signal<Record<Facet, string>>({ cat: '', rarity: '' });
  protected readonly view = signal<'grid' | 'table'>('grid');

  protected readonly source = computed<readonly (Entry | BlockEntry)[]>(() => {
    const d = this.craft.data();
    return (this.kind() === 'recipes' ? d?.recipes : d?.blocks) ?? [];
  });

  /** Search text of each entry: its name, what it makes and its ingredients, in both languages. */
  private readonly haystack = computed(() => {
    const names = (guid: string) => this.craft.data()?.items[guid]?.name ?? [];
    return new Map(
      this.source().map((e) => {
        const texts = [...e.name, ...(e.output ? names(e.output.item) : [])];
        for (const input of e.inputs) if (input.item) texts.push(...names(input.item));
        return [e.id, normalize(texts.join(' '))] as const;
      }),
    );
  });

  /** The category and rarity of what an entry makes (an older craft.json has neither). */
  private meta(e: Entry, key: Facet): string {
    return (e.output && this.craft.data()?.items[e.output.item]?.[key]) || '';
  }

  protected readonly facets = computed(() =>
    FACETS.map((f) => {
      const counts = new Map<string, number>();
      for (const e of this.source()) {
        const value = this.meta(e, f.key);
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const lang = this.lang.lang();
      const options = [...counts]
        .map(([value, n]) => ({ value, n, label: this.craft.label(f.key, value) }))
        .sort((a, b) => a.label.localeCompare(b.label, lang));
      return { ...f, options };
    }).filter((f) => f.options.length),
  );

  /** The category list: the groups of the building pieces (decoration, comfort...), else the item categories. */
  protected readonly categories = computed(() => {
    if (this.kind() === 'blocks') {
      const n = new Map<string, number>();
      for (const e of this.source()) {
        const id = (e as BlockEntry).group;
        n.set(id, (n.get(id) ?? 0) + 1);
      }
      const options = this.groups()
        .map((g) => ({ value: g.id, label: g.label, n: n.get(g.id) ?? 0 }))
        .filter((o) => o.n);
      return options.length ? { current: this.group(), options } : null;
    }
    const cat = this.facets().find((f) => f.key === 'cat');
    return cat ? { current: this.sel().cat, options: cat.options } : null;
  });
  protected readonly rarityFacet = computed(() => this.facets().find((f) => f.key === 'rarity'));

  protected readonly stations = computed(() => {
    const ids = new Set(this.source().map((e) => e.station ?? NO_STATION));
    return [...ids]
      .map((id) => ({ id, label: this.craft.stationName(id === NO_STATION ? null : id) }))
      .sort((a, b) => a.label.localeCompare(b.label, this.lang.lang()));
  });

  protected readonly groups = computed(() =>
    Object.entries(this.craft.data()?.groups ?? {})
      .filter(([id]) => this.source().some((e) => (e as BlockEntry).group === id))
      .map(([id, names]) => ({ id, label: this.craft.text(names) }))
      .sort((a, b) => a.label.localeCompare(b.label, this.lang.lang())),
  );

  /** Tiers of the pieces (T0, T1...), then "no tier" when some have none. */
  protected readonly tiers = computed(() => {
    const found = new Set(this.source().map((e) => (e as BlockEntry).tier ?? NO_TIER));
    return [...found].sort((a, b) => tierRank(a) - tierRank(b));
  });

  protected readonly list = computed(() => {
    const q = normalize(this.query().trim());
    const sel = this.sel();
    const station = this.station();
    const group = this.group();
    const tier = this.tier();
    const byTier = this.sort() === 'tier';
    const haystack = this.haystack();
    const locked = this.locked();
    const done = this.progress.done();
    const lang = this.lang.lang();
    return this.source()
      .filter(
        (e) =>
          (!q || haystack.get(e.id)!.includes(q)) &&
          (!station || (e.station ?? NO_STATION) === station) &&
          FACETS.every((f) => !sel[f.key] || this.meta(e, f.key) === sel[f.key]) &&
          (!group || (e as BlockEntry).group === group) &&
          (!tier || ((e as BlockEntry).tier ?? NO_TIER) === tier) &&
          (!locked || !done.has(`recipe:${e.id}`)),
      )
      .sort(
        (a, b) =>
          (byTier ? tierRank(tierOf(a)) - tierRank(tierOf(b)) : 0) ||
          this.craft.text(a.name).localeCompare(this.craft.text(b.name), lang),
      );
  });

  protected readonly shown = computed(() => this.list().slice(0, this.limit()));

  protected tierText(e: Entry): string {
    const tier = tierOf(e);
    return tier === NO_TIER ? '' : tier;
  }

  protected setFacet(key: Facet, value: string): void {
    this.sel.update((s) => ({ ...s, [key]: value }));
    this.limit.set(PAGE);
  }

  protected setQuery(value: string): void {
    this.query.set(value);
    this.limit.set(PAGE);
  }

  protected setStation(value: string): void {
    this.station.set(value);
    this.limit.set(PAGE);
  }

  protected setTier(value: string): void {
    this.tier.set(value);
    this.limit.set(PAGE);
  }

  protected pickCategory(value: string): void {
    if (this.kind() === 'blocks') this.setGroup(value);
    else this.setFacet('cat', value);
  }

  protected setGroup(value: string): void {
    this.group.set(value);
    this.limit.set(PAGE);
  }
}
