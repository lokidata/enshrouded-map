import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CraftService } from '../core/craft.service';
import { normalize } from '../core/filter.store';
import { Sources } from '../core/craft.model';
import { Names } from '../core/map-data.model';
import { LangService } from '../core/lang.service';
import { Found } from '../core/found.service';
import { MapFocus } from '../core/map-focus.service';
import { ItemChip } from './item-chip';
import { EntryCard } from './entry-card';
import { WorkshopNav } from './workshop-nav';

const PAGE = 40;
type Facet = 'cat' | 'type' | 'rarity' | 'cls' | 'food';
const FACETS: readonly { key: Facet; title: string }[] = [
  { key: 'cat', title: 'wsCategory' },
  { key: 'type', title: 'wsType' },
  { key: 'rarity', title: 'wsRarity' },
  { key: 'cls', title: 'wsClass' },
  { key: 'food', title: 'wsFoodType' },
];

/** Every item of the recipes: search, then one item's page (made by, used in). */
@Component({
  selector: 'app-items-tab',
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
        @if (catFacet(); as cat) {
          <h3 class="side-title">{{ cat.title | transloco }}</h3>
          <ul class="cat-list">
            <li>
              <button type="button" [class.active]="!sel().cat" (click)="setFacet('cat', '')">
                <span>{{ 'wsAllItems' | transloco }}</span
                ><b>{{ rows().length }}</b>
              </button>
            </li>
            @for (o of cat.options; track o.value) {
              <li>
                <button
                  type="button"
                  [class.active]="sel().cat === o.value"
                  [attr.aria-pressed]="sel().cat === o.value"
                  (click)="setFacet('cat', o.value)"
                >
                  <span>{{ o.label }}</span
                  ><b>{{ o.n }}</b>
                </button>
              </li>
            }
          </ul>
        }
        @for (f of otherFacets(); track f.key) {
          <label class="side-select">
            <span class="side-title">{{ f.title | transloco }}</span>
            <select
              [attr.aria-label]="f.title | transloco"
              (change)="setFacet(f.key, $any($event.target).value)"
            >
              <option value="">{{ 'wsAll' | transloco }}</option>
              @for (o of f.options; track o.value) {
                <option [value]="o.value" [selected]="o.value === sel()[f.key]">
                  {{ o.label }} ({{ o.n }})
                </option>
              }
            </select>
          </label>
        }
      </aside>
      <section class="main">
        @if (nav.item(); as guid) {
          <button type="button" class="back" (click)="nav.item.set(null)">
            ← {{ 'wsBack' | transloco }}
          </button>
          <header class="item-head">
            @if (craft.icon(guid); as icon) {
              <img [src]="icon" alt="" width="48" height="48" />
            }
            <h2>{{ craft.itemName(guid) }}</h2>
            @if (onMap(guid); as place) {
              <span class="meta" role="status">
                {{ 'wsMapFound' | transloco: { done: place.done, total: place.total } }}
              </span>
              <button
                type="button"
                class="pill"
                (click)="focus.show({ markers: found.markersOf(guid) })"
              >
                {{ 'wsShowOnMap' | transloco }}
              </button>
            }
            @if (itemSet(); as set) {
              <button type="button" class="pill" (click)="nav.openSet(set.key)">
                {{ 'wsInSet' | transloco: { name: craft.text(set.name) } }}
              </button>
            }
          </header>
          <h3>{{ 'wsMadeBy' | transloco }}</h3>
          <div class="cards">
            @for (e of madeBy(); track e.id) {
              <app-entry-card [entry]="e" />
            } @empty {
              <p class="empty">{{ 'wsNoRecipe' | transloco }}</p>
            }
          </div>
          <h3>{{ 'wsUsedIn' | transloco }} ({{ usedIn().length }})</h3>
          <div class="cards">
            @for (e of usedIn().slice(0, usedLimit()); track e.id) {
              <app-entry-card [entry]="e" />
            } @empty {
              <p class="empty">{{ 'wsNoResult' | transloco }}</p>
            }
          </div>
          @if (usedIn().length > usedLimit()) {
            <button type="button" class="more" (click)="usedLimit.set(usedLimit() + PAGE)">
              {{ 'wsMore' | transloco: { n: usedIn().length - usedLimit() } }}
            </button>
          }
        } @else if (nav.set(); as key) {
          <button type="button" class="back" (click)="nav.set.set(null)">
            ← {{ 'wsBack' | transloco }}
          </button>
          @if (setData(); as set) {
            <header class="item-head">
              <h2>{{ craft.text(set.name) }}</h2>
              @if (setSources(); as src) {
                <button type="button" class="pill" (click)="focus.show(src)">
                  {{ 'wsShowOnMap' | transloco }}
                </button>
              }
            </header>
            <ul class="inputs">
              @for (p of set.pieces; track p) {
                <li><app-item-chip [item]="p" /></li>
              }
            </ul>
            <h3>{{ 'wsHowToGet' | transloco }}</h3>
            <div class="cards">
              @for (e of setEntries(); track e.id) {
                <app-entry-card [entry]="e" />
              } @empty {
                <p class="empty">{{ 'wsNoRecipe' | transloco }}</p>
              }
            </div>
          }
        } @else {
          <div class="bar">
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
              [attr.aria-pressed]="sort() === 'lvl'"
              (click)="sort.set('lvl')"
            >
              {{ 'wsSortLevel' | transloco }}
            </button>
            @if (hasSets()) {
              <button
                type="button"
                class="pill"
                [attr.aria-pressed]="grouped()"
                (click)="setGrouped(!grouped())"
              >
                {{ 'wsGroupSets' | transloco }}
              </button>
            }
            <span class="count" role="status">{{
              'wsCount' | transloco: { n: list().length }
            }}</span>
          </div>
          <ul class="item-grid">
            @for (i of shown(); track i.guid) {
              <li>
                <button type="button" class="item-card" (click)="open(i)">
                  <span class="icon" [class.pieces]="i.isSet">
                    @if (i.isSet) {
                      @for (p of i.pieces; track p) {
                        @if (craft.icon(p); as icon) {
                          <img [src]="icon" alt="" width="30" height="30" loading="lazy" />
                        }
                      }
                    } @else if (craft.icon(i.guid); as icon) {
                      <img [src]="icon" alt="" width="56" height="56" loading="lazy" />
                    }
                  </span>
                  <strong>{{ i.name }}</strong>
                  <span class="meta">
                    {{ i.isSet ? ('wsSetPieces' | transloco: { n: i.pieces.length }) : '' }}
                    {{ !i.isSet && i.cat ? craft.label('cat', i.cat) : '' }}
                    @if (i.lvl) {
                      · {{ 'wsLevel' | transloco: { n: i.lvl } }}
                    }
                  </span>
                </button>
              </li>
            } @empty {
              <li class="empty">{{ 'wsNoResult' | transloco }}</li>
            }
          </ul>
          @if (list().length > limit()) {
            <button type="button" class="more pill" (click)="limit.set(limit() + PAGE)">
              {{ 'wsMore' | transloco: { n: list().length - limit() } }}
            </button>
          }
        }
      </section>
    </div>
  `,
})
export class ItemsTab {
  protected readonly craft = inject(CraftService);
  protected readonly nav = inject(WorkshopNav);
  private readonly lang = inject(LangService);

  protected readonly PAGE = PAGE;
  protected readonly query = signal('');
  protected readonly sel = signal<Record<Facet, string>>({
    cat: '',
    type: '',
    rarity: '',
    cls: '',
    food: '',
  });
  protected readonly sort = signal<'name' | 'lvl'>('name');
  protected readonly limit = signal(PAGE);
  protected readonly usedLimit = signal(PAGE);
  protected readonly focus = inject(MapFocus);
  protected readonly found = inject(Found);
  protected readonly grouped = signal(true);

  /** Items that a recipe makes or uses. */
  protected readonly all = computed(() => {
    const lang = this.lang.lang();
    const items = this.craft.data()?.items ?? {};
    const byOutput = this.craft.byOutput();
    const usedIn = this.craft.usedIn();
    return Object.keys(items)
      .filter((g) => byOutput.has(g) || usedIn.has(g))
      .map((guid) => ({
        guid,
        name: this.craft.itemName(guid),
        search: normalize(items[guid].name.join(' ')),
        cat: items[guid].cat ?? '',
        rarity: items[guid].rarity ?? '',
        cls: items[guid].cls ?? '',
        type: items[guid].type ?? '',
        food: items[guid].food ?? '',
        lvl: items[guid].lvl ?? 0,
        set: items[guid].set ?? '',
        types: items[guid].type ? [items[guid].type!] : [],
        isSet: false,
        pieces: [] as readonly string[],
      }))
      .sort((a, b) => a.name.localeCompare(b.name, lang));
  });

  protected readonly hasSets = computed(
    () => Object.keys(this.craft.data()?.sets ?? {}).length > 0,
  );

  /** The rows of the browser: with grouping, the pieces of an armour set become one row. */
  protected readonly rows = computed(() => {
    const sets = this.craft.data()?.sets ?? {};
    if (!this.grouped() || !this.hasSets()) return this.all();
    const items = this.craft.data()?.items ?? {};
    const lang = this.lang.lang();
    const rows = this.all().filter((i) => !i.set);
    for (const [key, set] of Object.entries(sets)) {
      const first = items[set.pieces[0]];
      rows.push({
        guid: key,
        name: this.craft.text(set.name),
        search: normalize([...set.name, ...set.pieces.flatMap((p) => items[p].name)].join(' ')),
        cat: first.cat ?? '',
        rarity: first.rarity ?? '',
        cls: first.cls ?? '',
        type: '',
        food: '',
        lvl: Math.max(...set.pieces.map((p) => items[p].lvl ?? 0)),
        set: key,
        types: [...new Set(set.pieces.map((p) => items[p].type ?? ''))],
        isSet: true,
        pieces: set.pieces,
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name, lang));
  });

  /** The filters this craft.json can offer (an older one has none of these fields). */
  protected readonly facets = computed(() =>
    FACETS.map((f) => {
      const n = new Map<string, number>();
      for (const i of this.rows()) {
        const values = f.key === 'type' ? i.types : [i[f.key]];
        for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
      }
      const lang = this.lang.lang();
      const options = [...n]
        .map(([value, count]) => ({ value, n: count, label: this.craft.label(f.key, value) }))
        .sort((a, b) => a.label.localeCompare(b.label, lang));
      return { ...f, options };
    }).filter((f) => f.options.length),
  );

  protected readonly catFacet = computed(() => this.facets().find((f) => f.key === 'cat'));
  protected readonly otherFacets = computed(() => this.facets().filter((f) => f.key !== 'cat'));

  protected readonly list = computed(() => {
    const q = normalize(this.query().trim());
    const sel = this.sel();
    const lang = this.lang.lang();
    const byLevel = this.sort() === 'lvl';
    return this.rows()
      .filter(
        (i) =>
          (!q || i.search.includes(q)) &&
          FACETS.every(
            (f) =>
              !sel[f.key] ||
              (f.key === 'type' ? i.types.includes(sel[f.key]) : i[f.key] === sel[f.key]),
          ),
      )
      .sort((a, b) => (byLevel ? a.lvl - b.lvl : 0) || a.name.localeCompare(b.name, lang));
  });

  protected readonly shown = computed(() => this.list().slice(0, this.limit()));
  protected readonly madeBy = computed(
    () => this.craft.byOutput().get(this.nav.item() ?? '') ?? [],
  );
  protected readonly usedIn = computed(() => this.craft.usedIn().get(this.nav.item() ?? '') ?? []);

  protected open(row: { guid: string; isSet: boolean }): void {
    if (row.isSet) this.nav.openSet(row.guid);
    else this.nav.openItem(row.guid);
  }

  protected setGrouped(value: boolean): void {
    this.grouped.set(value);
    this.limit.set(PAGE);
  }

  protected readonly setData = computed(() => this.craft.data()?.sets?.[this.nav.set() ?? '']);

  /** The set of the open item, if any. */
  protected readonly itemSet = computed(() => {
    const key = this.craft.data()?.items[this.nav.item() ?? '']?.set;
    const set = key ? this.craft.data()?.sets?.[key] : undefined;
    return key && set ? { key, name: set.name } : null;
  });

  /** The recipes that make the pieces of the open set: how each one is unlocked. */
  protected readonly setEntries = computed(() =>
    (this.setData()?.pieces ?? []).flatMap((p) => this.craft.byOutput().get(p) ?? []),
  );

  /** Everything the game tells about where the pieces are, to show it on the map. */
  protected readonly setSources = computed<Sources | null>(() => {
    const markers = new Set<string>();
    const groups: { cat: string; name: Names }[] = [];
    for (const e of this.setEntries()) {
      for (const m of e.sources?.markers ?? []) markers.add(m);
      groups.push(...(e.sources?.groups ?? []));
    }
    return markers.size || groups.length ? { markers: [...markers], groups } : null;
  });

  /** How many places of the open item are marked on the map; null when it is not on it. */
  protected onMap(item: string): { done: number; total: number } | null {
    const place = this.found.itemProgress(item);
    return place.total ? place : null;
  }

  protected setFacet(key: Facet, value: string): void {
    this.sel.update((s) => ({ ...s, [key]: value }));
    this.limit.set(PAGE);
  }

  protected setQuery(value: string): void {
    this.query.set(value);
    this.limit.set(PAGE);
  }
}
