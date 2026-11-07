import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CraftService } from '../core/craft.service';
import { AltarEntry } from '../core/craft.model';
import { ItemChip } from './item-chip';

/** What each Flame Altar upgrade and each Flame level costs, and which recipes it opens. */
@Component({
  selector: 'app-altar-tab',
  imports: [TranslocoPipe, ItemChip],
  template: `
    <div class="browse">
      <aside class="side" [attr.aria-label]="'wsPlanner' | transloco">
        @for (section of sections(); track section.kind) {
          <fieldset class="planner">
            <legend>
              {{ 'wsAltar_' + section.kind | transloco }} · {{ 'wsPlanner' | transloco }}
            </legend>
            <label>
              {{ 'wsFromLevel' | transloco }}
              <select (change)="setRange(section.kind, 'from', +$any($event.target).value)">
                @for (e of section.entries; track e.id) {
                  <option [value]="e.level" [selected]="e.level === section.from">
                    {{ craft.text(e.name) }}
                  </option>
                }
              </select>
            </label>
            <label>
              {{ 'wsToLevel' | transloco }}
              <select (change)="setRange(section.kind, 'to', +$any($event.target).value)">
                @for (e of section.entries; track e.id) {
                  <option [value]="e.level" [selected]="e.level === section.to">
                    {{ craft.text(e.name) }}
                  </option>
                }
              </select>
            </label>
            <p class="meta">{{ 'wsTotalCost' | transloco }}</p>
            <ul class="inputs">
              @for (t of section.total; track t.item) {
                <li><app-item-chip [item]="t.item" [count]="t.count" /></li>
              }
            </ul>
          </fieldset>
        }
      </aside>
      <div class="main">
        @for (section of sections(); track section.kind) {
          <h2>{{ 'wsAltar_' + section.kind | transloco }}</h2>
          <div class="cards">
            @for (e of section.entries; track e.id) {
              <article class="entry">
                <header>
                  <div class="head">
                    <h3>{{ craft.text(e.name) }}</h3>
                    <p class="meta">{{ 'wsOpensAt' | transloco: { n: e.level + 1 } }}</p>
                  </div>
                </header>
                <ul class="inputs">
                  @for (input of e.inputs; track $index) {
                    <li>
                      @if (input.item) {
                        <app-item-chip [item]="input.item" [count]="input.count" />
                      }
                    </li>
                  }
                </ul>
                @if (e.unlocks.length) {
                  <details>
                    <summary>{{ 'wsOpens' | transloco: { n: e.unlocks.length } }}</summary>
                    <ul class="names">
                      @for (name of names(e); track name) {
                        <li>{{ name }}</li>
                      }
                    </ul>
                  </details>
                }
              </article>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class AltarTab {
  protected readonly craft = inject(CraftService);

  private readonly range = signal<Record<string, { from?: number; to?: number }>>({});

  protected readonly sections = computed(() => {
    const all = this.craft.data()?.altar ?? [];
    const range = this.range();
    return (['altar', 'flame'] as const).map((kind) => {
      const entries = all.filter((e) => e.kind === kind).sort((a, b) => a.level - b.level);
      const from = range[kind]?.from ?? entries[0]?.level ?? 0;
      const to = range[kind]?.to ?? entries.at(-1)?.level ?? 0;
      const sum = new Map<string, number>();
      for (const e of entries)
        if (e.level >= from && e.level <= to)
          for (const i of e.inputs) if (i.item) sum.set(i.item, (sum.get(i.item) ?? 0) + i.count);
      return {
        kind,
        entries,
        from,
        to,
        total: [...sum].map(([item, count]) => ({ item, count })),
      };
    });
  });

  protected setRange(kind: string, key: 'from' | 'to', level: number): void {
    this.range.update((r) => ({ ...r, [kind]: { ...r[kind], [key]: level } }));
  }

  protected names(e: AltarEntry): string[] {
    return e.unlocks
      .map((id) => this.craft.entries().get(id))
      .filter((r) => !!r)
      .map((r) => this.craft.text(r.name))
      .sort();
  }
}
