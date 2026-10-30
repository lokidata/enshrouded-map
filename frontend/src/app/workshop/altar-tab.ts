import { Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CraftService } from '../core/craft.service';
import { AltarEntry } from '../core/craft.model';
import { ItemChip } from './item-chip';

/** What each Flame Altar upgrade and each Flame level costs, and which recipes it opens. */
@Component({
  selector: 'app-altar-tab',
  imports: [TranslocoPipe, ItemChip],
  template: `
    @for (section of sections(); track section.kind) {
      <h2>{{ 'wsAltar_' + section.kind | transloco }}</h2>
      <div class="cards">
        @for (e of section.entries; track e.id) {
          <article class="entry">
            <header>
              <div class="head">
                <h3>{{ craft.text(e.name) }}</h3>
                <p class="meta">
                  {{ 'wsOpensAt' | transloco: { n: e.level + 1 } }}
                </p>
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
  `,
  styleUrl: './workshop.css',
})
export class AltarTab {
  protected readonly craft = inject(CraftService);

  protected readonly sections = computed(() => {
    const all = this.craft.data()?.altar ?? [];
    return (['altar', 'flame'] as const).map((kind) => ({
      kind,
      entries: all.filter((e) => e.kind === kind).sort((a, b) => a.level - b.level),
    }));
  });

  protected names(e: AltarEntry): string[] {
    return e.unlocks
      .map((id) => this.craft.entries().get(id))
      .filter((r) => !!r)
      .map((r) => this.craft.text(r.name))
      .sort();
  }
}
