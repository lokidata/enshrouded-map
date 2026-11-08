import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LangService } from '../core/lang.service';
import { GearService } from '../core/gear.service';
import { filterGems, formatGem, gemValue } from '../core/gems.logic';
import { Gem } from '../core/gems.model';
import { GemsService } from '../core/gems.service';
import { EnemiesService } from '../core/enemies.service';
import { ViewStore } from '../core/view.store';

/** The weapon gems: filters, and one gem's stats at a chosen gem level. */
@Component({
  selector: 'app-gems',
  imports: [TranslocoPipe],
  template: `
    <div id="gems-panel" class="panel">
      <div class="browse">
        <aside class="side" [attr.aria-label]="'wsFilters' | transloco">
          <input
            type="search"
            [placeholder]="'wsFilterName' | transloco"
            [attr.aria-label]="'wsSearch' | transloco"
            [value]="query()"
            (input)="query.set($any($event.target).value); openId.set(null)"
          />
          <h3 class="side-title">{{ 'gemTier' | transloco }}</h3>
          <div class="side-pills" role="group" [attr.aria-label]="'gemTier' | transloco">
            @for (t of tiers(); track t) {
              <button
                type="button"
                class="pill"
                [attr.aria-pressed]="tier() === t"
                (click)="tier.set(tier() === t ? null : t); openId.set(null)"
              >
                T{{ t }}
              </button>
            }
          </div>
          <h3 class="side-title">{{ 'wsRarity' | transloco }}</h3>
          <div class="side-pills" role="group" [attr.aria-label]="'wsRarity' | transloco">
            @for (r of rarities(); track r) {
              <button
                type="button"
                class="pill"
                [attr.aria-pressed]="rarity() === r"
                (click)="rarity.set(rarity() === r ? '' : r); openId.set(null)"
              >
                {{ 'rarity_' + r | transloco }}
              </button>
            }
          </div>
        </aside>
        <section class="main">
          @if (current(); as gem) {
            <button type="button" class="back" (click)="openId.set(null)">
              ← {{ 'wsBack' | transloco }}
            </button>
            <header class="item-head">
              @if (gem.icon) {
                <img
                  class="portrait"
                  [src]="gem.icon"
                  [alt]="data.text(gem.name)"
                  width="96"
                  height="96"
                />
              }
              <h2>{{ data.text(gem.name) }}</h2>
            </header>
            <p class="note">{{ 'gemLimits' | transloco }}</p>
            @if (gem.desc) {
              <p>{{ data.text(gem.desc) }}</p>
            }
            <label class="gem-level">
              {{ 'gemLevel' | transloco }}
              <input
                type="number"
                min="1"
                [attr.max]="gem.lvl[1]"
                [value]="level()"
                (change)="setLevel($event, gem)"
              />
            </label>
            <dl class="facts stats">
              <dt>{{ 'gemTier' | transloco }}</dt>
              <dd>T{{ gem.tier }}</dd>
              <dt>{{ 'wsRarity' | transloco }}</dt>
              <dd>{{ 'rarity_' + gem.rarity | transloco }}</dd>
              <dt>{{ 'gemLevels' | transloco }}</dt>
              <dd>{{ gem.lvl[0] }} – {{ gem.lvl[1] }}</dd>
              @for (s of gem.stats; track $index) {
                <dt>{{ data.text(s.name) }}</dt>
                <dd>
                  @let v = value(s, level());
                  {{ v.text }}
                  @if (v.estimate) {
                    <span class="est">{{ 'buildEstimate' | transloco }}</span>
                  }
                </dd>
              }
            </dl>
            <h3>{{ 'gemSources' | transloco }}</h3>
            @if (gem.sources?.length) {
              <p class="note">{{ 'gemSourcesNote' | transloco }}</p>
              <ul class="gem-sources">
                @for (s of gem.sources; track $index) {
                  <li>
                    @if (s.enemy && enemyIds().has(s.enemy)) {
                      <button type="button" class="chip-link" (click)="openEnemy(s.enemy)">
                        {{ data.text(s.name) }}
                      </button>
                    } @else {
                      {{ data.text(s.name) }}
                    }
                  </li>
                }
              </ul>
            } @else {
              <p class="note">{{ 'gemNoSource' | transloco }}</p>
            }
            <h3>{{ 'gemWeapons' | transloco: { n: weapons().length } }}</h3>
            <p class="note">{{ 'gemWeaponsNote' | transloco }}</p>
            <p class="note">{{ 'gemSlotChance' | transloco }} {{ chances() }}</p>
            <ul class="gem-weapons">
              @for (w of weapons(); track w) {
                <li>{{ w }}</li>
              }
            </ul>
          } @else {
            <div class="bar">
              <span class="count" role="status">{{
                'wsCount' | transloco: { n: list().length }
              }}</span>
            </div>
            <div class="cards">
              @for (gem of list(); track gem.id) {
                <article class="entry">
                  <header>
                    @if (gem.icon) {
                      <img [src]="gem.icon" alt="" width="56" height="56" loading="lazy" />
                    }
                    <div class="head">
                      <h3>
                        <button type="button" class="chip-link" (click)="open(gem)">
                          {{ data.text(gem.name) }}
                        </button>
                      </h3>
                      <p class="meta">T{{ gem.tier }} · {{ 'rarity_' + gem.rarity | transloco }}</p>
                    </div>
                  </header>
                </article>
              } @empty {
                <p class="empty">{{ 'wsNoResult' | transloco }}</p>
              }
            </div>
          }
        </section>
      </div>
    </div>
  `,
  host: { class: 'workshop' },
  styles: `
    .est {
      margin-left: 6px;
      color: var(--accent);
      font-size: 11px;
      text-transform: uppercase;
    }
    .gem-level input {
      width: 5em;
      margin-left: 8px;
    }
    .gem-weapons {
      columns: 2;
    }
  `,
})
export class Gems {
  protected readonly data = inject(GemsService);
  private readonly gear = inject(GearService);
  private readonly enemies = inject(EnemiesService);
  private readonly views = inject(ViewStore);
  private readonly lang = inject(LangService);

  protected readonly query = signal('');
  protected readonly tier = signal<number | null>(null);
  protected readonly rarity = signal('');
  protected readonly openId = signal<string | null>(null);
  protected readonly level = signal(1);

  protected readonly tiers = computed(() =>
    [...new Set(this.data.gems().map((g) => g.tier))].sort((a, b) => a - b),
  );
  protected readonly rarities = computed(() => {
    const present = new Set(this.data.gems().map((g) => g.rarity));
    return ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].filter((r) => present.has(r));
  });
  protected readonly list = computed(() =>
    filterGems(this.data.gems(), this.query(), this.tier(), this.rarity(), (g) =>
      this.data.text(g.name),
    ),
  );
  protected readonly current = computed(() => this.data.gems().find((g) => g.id === this.openId()));

  /** Weapons with a gem slot (any gem fits: the data has no per-gem restriction); names from gear.json, else the id. */
  protected readonly weapons = computed(() => {
    const items = this.gear.data()?.items ?? {};
    return (this.data.data()?.slot.weapons ?? [])
      .map((id) => (items[id] ? this.gear.text(items[id].name) : id))
      .sort((a, b) => a.localeCompare(b));
  });

  protected readonly enemyIds = computed(
    () => new Set((this.enemies.data()?.enemies ?? []).map((e) => e.id)),
  );

  protected openEnemy(id: string): void {
    this.enemies.open.set(id);
    this.views.set('enemies');
  }

  protected open(gem: Gem): void {
    this.level.set(1);
    this.openId.set(gem.id);
  }

  protected setLevel(event: Event, gem: Gem): void {
    const input = event.target as HTMLInputElement;
    const n = Math.min(Math.max(Math.trunc(input.valueAsNumber) || 1, 1), gem.lvl[1]);
    this.level.set(n);
    input.value = `${n}`;
  }

  protected value(s: Gem['stats'][number], level: number) {
    const v = gemValue(s, level, this.data.creep());
    return { text: formatGem(v.value, s.format), estimate: v.estimate };
  }

  /** Chance that a found weapon of each rarity has a gem slot. */
  protected readonly chances = computed(() => {
    const p = this.data.data()?.slot.probability ?? {};
    return this.rarities()
      .map((r) => [r, p[r.toLowerCase()]] as const)
      .filter(([, v]) => v !== undefined && v > 0)
      .map(([r, v]) => `${this.lang.t('rarity_' + r)} ${Math.round(v * 100)} %`)
      .join(' · ');
  });
}
