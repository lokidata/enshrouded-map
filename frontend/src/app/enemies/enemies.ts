import { Component, computed, effect, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Enemy } from '../core/enemies.model';
import { EnemiesService } from '../core/enemies.service';
import { normalize } from '../core/filter.store';
import { LangService } from '../core/lang.service';
import { copyText, hashLink } from '../core/links';
import { MapFocus } from '../core/map-focus.service';
import { ProgressStore } from '../core/progress.store';
import { ViewStore } from '../core/view.store';

type Kind = 'all' | 'boss' | 'elite';

/** The bosses and elite enemies: kind, faction, region, and one enemy's facts with its places on the map. */
@Component({
  selector: 'app-enemies',
  imports: [TranslocoPipe],
  template: `
    <div id="enemies-panel" class="panel">
      <div class="browse">
        <aside class="side" [attr.aria-label]="'wsFilters' | transloco">
          <input
            type="search"
            [placeholder]="'wsFilterName' | transloco"
            [attr.aria-label]="'wsSearch' | transloco"
            [value]="query()"
            (input)="query.set($any($event.target).value); open.set(null)"
          />
          <div class="side-pills" role="group" [attr.aria-label]="'enemyKind' | transloco">
            @for (k of kinds; track k) {
              <button
                type="button"
                class="pill"
                [attr.aria-pressed]="kind() === k"
                (click)="kind.set(k); open.set(null)"
              >
                {{ 'enemyKind_' + k | transloco }}
              </button>
            }
          </div>
          <h3 class="side-title">{{ 'enemyFaction' | transloco }}</h3>
          <ul class="cat-list">
            <li>
              <button type="button" [class.active]="!faction()" (click)="pickFaction('')">
                <span>{{ 'loreAll' | transloco }}</span
                ><b>{{ enemies().length }}</b>
              </button>
            </li>
            @for (f of factions(); track f.id) {
              <li>
                <button
                  type="button"
                  [class.active]="faction() === f.id"
                  [attr.aria-pressed]="faction() === f.id"
                  (click)="pickFaction(f.id)"
                >
                  <span>{{ f.label }}</span
                  ><b>{{ f.n }}</b>
                </button>
              </li>
            }
          </ul>
          @if (regions().length) {
            <h3 class="side-title">{{ 'enemyRegions' | transloco }}</h3>
            <ul class="cat-list">
              @for (r of regions(); track r.id) {
                <li>
                  <button
                    type="button"
                    [class.active]="region() === r.id"
                    [attr.aria-pressed]="region() === r.id"
                    (click)="pickRegion(r.id)"
                  >
                    <span>{{ r.label }}</span
                    ><b>{{ r.n }}</b>
                  </button>
                </li>
              }
            </ul>
          }
        </aside>
        <section class="main">
          @if (current(); as enemy) {
            <button type="button" class="back" (click)="open.set(null)">
              ← {{ 'wsBack' | transloco }}
            </button>
            <header class="item-head">
              @if (enemy.image) {
                <img class="portrait" [src]="enemy.image" alt="" width="144" height="144" />
              }
              <h2>{{ data.text(enemy.name) }}</h2>
              @if (enemy.sources; as sources) {
                <button type="button" class="pill" (click)="focus.show(sources)">
                  {{ 'wsShowOnMap' | transloco }}
                </button>
              }
              <button type="button" class="pill" (click)="copyLink(enemy)">
                {{ (copied() ? 'copied' : 'enemyCopyLink') | transloco }}
              </button>
            </header>
            <dl class="facts">
              <dt>{{ 'enemyType' | transloco }}</dt>
              <dd>{{ (enemy.boss ? 'enemyKind_boss' : 'enemyKind_elite') | transloco }}</dd>
              <dt>{{ 'enemyFaction' | transloco }}</dt>
              <dd>{{ factionLabel(enemy) }}</dd>
              @if (enemy.xp !== null) {
                <dt>{{ 'enemyXpTitle' | transloco }}</dt>
                <dd>× {{ enemy.xp }}</dd>
              }
              @if (enemy.scaling !== null) {
                <dt>{{ 'enemyScalingTitle' | transloco }}</dt>
                <dd>+ {{ percent(enemy.scaling) }} %</dd>
              }
              <dt>{{ 'enemyRegions' | transloco }}</dt>
              <dd>{{ regionLabels(enemy) }}</dd>
              <dt>{{ 'enemySpotsTitle' | transloco }}</dt>
              <dd>{{ enemy.spots }}</dd>
              @if (enemy.sources; as sources) {
                <dt>{{ 'enemyDoneTitle' | transloco }}</dt>
                <dd>{{ doneOf(enemy) }} / {{ sources.markers?.length }}</dd>
              }
              @if (enemy.places.length) {
                <dt>{{ 'enemyPlaces' | transloco }}</dt>
                <dd>{{ placeLabels(enemy) }}</dd>
              }
              @if (enemy.trophy) {
                <dt>{{ 'enemyTrophy' | transloco }}</dt>
                <dd>{{ data.text(enemy.trophy) }}</dd>
              }
            </dl>
          } @else {
            <div class="bar">
              <span class="count" role="status">{{
                'wsCount' | transloco: { n: list().length }
              }}</span>
            </div>
            <div class="cards">
              @for (enemy of list(); track enemy.id) {
                <article class="entry">
                  <header>
                    @if (enemy.image) {
                      <img [src]="enemy.image" alt="" width="56" height="56" loading="lazy" />
                    }
                    <div class="head">
                      <h3>
                        <button type="button" class="chip-link" (click)="open.set(enemy.id)">
                          {{ data.text(enemy.name) }}
                        </button>
                      </h3>
                      <p class="meta">
                        {{ (enemy.boss ? 'enemyKind_boss' : 'enemyKind_elite') | transloco }} ·
                        {{ factionLabel(enemy) }}
                      </p>
                    </div>
                  </header>
                  <p class="preview">
                    @if (enemy.xp !== null) {
                      {{ 'enemyXp' | transloco: { n: enemy.xp } }} ·
                    }
                    @if (enemy.sources; as sources) {
                      {{
                        'enemyDone'
                          | transloco: { done: doneOf(enemy), total: sources.markers?.length }
                      }}
                    } @else {
                      {{ 'enemySpots' | transloco: { n: enemy.spots } }}
                    }
                  </p>
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
})
export class Enemies {
  protected readonly data = inject(EnemiesService);
  protected readonly focus = inject(MapFocus);
  private readonly lang = inject(LangService);
  private readonly views = inject(ViewStore);
  private readonly progress = inject(ProgressStore);

  protected readonly kinds: readonly Kind[] = ['all', 'boss', 'elite'];
  protected readonly query = signal('');
  protected readonly kind = signal<Kind>('all');
  protected readonly faction = signal('');
  protected readonly region = signal('');
  protected readonly open = this.data.open;
  protected readonly copied = signal(false);

  constructor() {
    // the address names the open enemy while the page is shown, so that it can be shared
    effect(() => {
      const id = this.open();
      const hash = this.views.view() === 'enemies' && id ? `#enemy=${id}` : '';
      if (hash || location.hash.startsWith('#enemy=')) {
        history.replaceState(null, '', location.pathname + location.search + hash);
      }
    });
  }

  protected readonly enemies = computed(() => this.data.data()?.enemies ?? []);
  protected readonly current = computed(() => this.enemies().find((e) => e.id === this.open()));

  protected readonly factions = computed(() => {
    const names = this.data.data()?.factions ?? {};
    const counts = new Map<string, number>();
    for (const e of this.enemies())
      if (e.faction) counts.set(e.faction, (counts.get(e.faction) ?? 0) + 1);
    const lang = this.lang.lang();
    return [...counts]
      .map(([id, n]) => ({ id, n, label: this.data.text(names[id]) }))
      .sort((a, b) => a.label.localeCompare(b.label, lang));
  });

  protected readonly regions = computed(() => {
    const names = this.data.data()?.regions ?? {};
    const counts = new Map<string, number>();
    for (const e of this.enemies())
      for (const r of e.regions) counts.set(r, (counts.get(r) ?? 0) + 1);
    const lang = this.lang.lang();
    return [...counts]
      .map(([id, n]) => ({ id, n, label: this.data.text(names[id]) }))
      .sort((a, b) => a.label.localeCompare(b.label, lang));
  });

  protected readonly list = computed(() => {
    const q = normalize(this.query().trim());
    const kind = this.kind();
    const faction = this.faction();
    const region = this.region();
    return this.enemies().filter(
      (e) =>
        (!q || normalize(e.name.join(' ')).includes(q)) &&
        (kind === 'all' || e.boss === (kind === 'boss')) &&
        (!faction || e.faction === faction) &&
        (!region || e.regions.includes(region)),
    );
  });

  protected factionLabel(enemy: Enemy): string {
    const names = enemy.faction ? this.data.data()?.factions[enemy.faction] : null;
    return names ? this.data.text(names) : this.lang.t('loreOther');
  }

  protected regionLabels(enemy: Enemy): string {
    const names = this.data.data()?.regions ?? {};
    return enemy.regions.map((r) => this.data.text(names[r])).join(', ') || '—';
  }

  /** How many of its places on the map are marked done. */
  protected doneOf(enemy: Enemy): number {
    const marks = this.progress.done();
    return (enemy.sources?.markers ?? []).filter((id) => marks.has(id)).length;
  }

  protected placeLabels(enemy: Enemy): string {
    return enemy.places.map((p) => this.data.text(p)).join(', ');
  }

  protected async copyLink(enemy: Enemy): Promise<void> {
    this.copied.set(await copyText(hashLink('enemy', enemy.id)));
  }

  protected percent(scaling: number): number {
    return Math.round(scaling * 100);
  }

  protected pickFaction(id: string): void {
    this.faction.set(id);
    this.open.set(null);
  }

  protected pickRegion(id: string): void {
    this.region.set(this.region() === id ? '' : id);
    this.open.set(null);
  }
}
