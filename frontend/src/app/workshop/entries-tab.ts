import { Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CraftService } from '../core/craft.service';
import { BlockEntry, Entry } from '../core/craft.model';
import { normalize } from '../core/filter.store';
import { LangService } from '../core/lang.service';
import { ProgressStore } from '../core/progress.store';
import { EntryCard } from './entry-card';

const PAGE = 40;
const NO_TIER = 'none'; // the filter value of the pieces without a tier
const NO_STATION = 'none'; // the filter value of the recipes without a known station

/** The recipes (or the building pieces): search, filter, and the cards. */
const tierOf = (e: Entry | BlockEntry): string => (e as BlockEntry).tier ?? NO_TIER;
/** T0 < T1 < ... < T7, the pieces without a tier last. */
const tierRank = (tier: string): number => (tier === NO_TIER ? 99 : Number(tier.slice(1)) || 0);

@Component({
  selector: 'app-entries-tab',
  imports: [TranslocoPipe, EntryCard],
  template: `
    <div class="filters">
      <input
        type="search"
        [placeholder]="'wsSearch' | transloco"
        [attr.aria-label]="'wsSearch' | transloco"
        [value]="query()"
        (input)="setQuery($any($event.target).value)"
      />
      @if (kind() === 'recipes') {
        <select
          [attr.aria-label]="'wsStation' | transloco"
          (change)="setStation($any($event.target).value)"
        >
          <option value="">{{ 'wsAllStations' | transloco }}</option>
          @for (s of stations(); track s.id) {
            <option [value]="s.id" [selected]="s.id === station()">{{ s.label }}</option>
          }
        </select>
      } @else if (kind() === 'blocks') {
        <select
          [attr.aria-label]="'wsGroup' | transloco"
          (change)="setGroup($any($event.target).value)"
        >
          <option value="">{{ 'wsAllGroups' | transloco }}</option>
          @for (g of groups(); track g.id) {
            <option [value]="g.id" [selected]="g.id === group()">{{ g.label }}</option>
          }
        </select>
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
        <select
          [attr.aria-label]="'wsSort' | transloco"
          (change)="sort.set($any($event.target).value)"
        >
          <option value="name" [selected]="sort() === 'name'">
            {{ 'wsSortName' | transloco }}
          </option>
          <option value="tier" [selected]="sort() === 'tier'">
            {{ 'wsSortTier' | transloco }}
          </option>
        </select>
      }
      <label class="check">
        <input type="checkbox" [checked]="locked()" (change)="locked.set(!locked())" />
        {{ 'wsLockedOnly' | transloco }}
      </label>
    </div>
    <p class="count" role="status">{{ 'wsCount' | transloco: { n: list().length } }}</p>
    <div class="cards">
      @for (e of shown(); track e.id) {
        <app-entry-card [entry]="e" />
      } @empty {
        <p class="empty">{{ 'wsNoResult' | transloco }}</p>
      }
    </div>
    @if (list().length > limit()) {
      <button type="button" class="more" (click)="limit.set(limit() + PAGE)">
        {{ 'wsMore' | transloco: { n: list().length - limit() } }}
      </button>
    }
  `,
  styleUrl: './workshop.css',
})
export class EntriesTab {
  readonly kind = input.required<'recipes' | 'blocks'>();

  protected readonly PAGE = PAGE;
  protected readonly NO_TIER = NO_TIER;
  private readonly craft = inject(CraftService);
  private readonly lang = inject(LangService);
  private readonly progress = inject(ProgressStore);

  protected readonly query = signal('');
  protected readonly station = signal('');
  protected readonly group = signal('');
  protected readonly tier = signal('');
  protected readonly sort = signal<'name' | 'tier'>('name');
  protected readonly locked = signal(false);
  protected readonly limit = signal(PAGE);

  private readonly source = computed<readonly (Entry | BlockEntry)[]>(() => {
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

  protected setGroup(value: string): void {
    this.group.set(value);
    this.limit.set(PAGE);
  }
}
