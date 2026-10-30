import { Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CraftService } from '../core/craft.service';
import { BlockEntry, Entry, Input } from '../core/craft.model';
import { LangService } from '../core/lang.service';
import { MapFocus } from '../core/map-focus.service';
import { ProgressStore } from '../core/progress.store';
import { ProjectStore } from '../core/project.store';
import { ItemChip } from './item-chip';

/** A recipe or a building piece: cost, how it unlocks, where to find it. */
@Component({
  selector: 'app-entry-card',
  imports: [TranslocoPipe, ItemChip],
  template: `
    <article class="entry" [class.known]="known()">
      <header>
        @if (entry().output; as out) {
          @if (craft.icon(out.item); as icon) {
            <img [src]="icon" alt="" width="40" height="40" loading="lazy" />
          }
        }
        <div class="head">
          <h3>
            {{ craft.text(entry().name) }}
            @if (entry().output && entry().output!.count > 1) {
              × {{ entry().output!.count }}
            }
          </h3>
          <p class="meta">
            {{ craft.stationName(entry().station) }}
            @if (tier()) {
              · {{ tier() }}
            }
            @if (entry().seconds) {
              · {{ 'wsSeconds' | transloco: { n: entry().seconds } }}
            }
          </p>
        </div>
        <label class="known-box">
          <input type="checkbox" [checked]="known()" (change)="progress.toggle(markId())" />
          {{ 'wsKnown' | transloco }}
        </label>
      </header>
      <ul class="inputs">
        @for (input of entry().inputs; track $index) {
          <li>
            @if (input.item) {
              <app-item-chip [item]="input.item" [count]="input.count" />
            } @else {
              <span class="any">{{ anyOf(input) }} × {{ input.count }}</span>
            }
          </li>
        }
      </ul>
      <p class="unlock">{{ craft.text(entry().unlock.text) }}</p>
      <div class="actions">
        @if (entry().sources; as sources) {
          <button type="button" (click)="focus.show(sources)">
            {{ 'wsShowOnMap' | transloco }}
          </button>
        }
        <button type="button" (click)="project.add(entry().id)">
          {{ 'wsAddProject' | transloco }}
        </button>
      </div>
    </article>
  `,
  styleUrl: './workshop.css',
})
export class EntryCard {
  readonly entry = input.required<Entry | BlockEntry>();

  protected readonly craft = inject(CraftService);
  protected readonly progress = inject(ProgressStore);
  protected readonly project = inject(ProjectStore);
  protected readonly focus = inject(MapFocus);
  private readonly lang = inject(LangService);

  protected readonly markId = computed(() => `recipe:${this.entry().id}`);
  protected readonly known = computed(() => this.progress.done().has(this.markId()));
  protected readonly tier = computed(() => (this.entry() as BlockEntry).tier);

  /** "Any of: A, B, C" for an ingredient that several items can fill. */
  protected anyOf(input: Input): string {
    const items = this.craft.data()?.categories[input.category!] ?? [];
    const names = items.slice(0, 3).map((i) => this.craft.itemName(i.item));
    return `${this.lang.t('wsAnyOf')} : ${names.join(', ')}${items.length > 3 ? '…' : ''}`;
  }
}
