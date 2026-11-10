import { Component, computed, inject, input, model, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { calculate } from '../core/craft.calc';
import { CraftService } from '../core/craft.service';
import { BlockEntry, Entry, Input } from '../core/craft.model';
import { LangService } from '../core/lang.service';
import { MapFocus } from '../core/map-focus.service';
import { Found } from '../core/found.service';
import { ProjectStore } from '../core/project.store';
import { ItemChip } from './item-chip';

/** A recipe or a building piece: cost, how it unlocks, where to find it. */
@Component({
  selector: 'app-entry-card',
  imports: [TranslocoPipe, ItemChip],
  template: `
    <article class="entry" [class.known]="known()" [class.multi]="variants().length > 1">
      @if (variants().length > 1) {
        <span class="variants-badge">
          {{ 'wsVariantsBadge' | transloco: { n: variants().length } }}
        </span>
      }
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
          <input type="checkbox" [checked]="known()" (change)="found.setKnown(entry(), !known())" />
          {{ 'wsKnown' | transloco }}
        </label>
      </header>
      @if (variants().length > 1) {
        <div class="variants" role="group" [attr.aria-label]="'wsVariants' | transloco">
          @for (v of variants(); track v.id; let i = $index) {
            <button
              type="button"
              class="pill"
              [class.known]="found.known(v)"
              [attr.aria-pressed]="variant() === i"
              (click)="variant.set(i)"
            >
              {{ variantLabel(v) }}
              @if (found.known(v)) {
                <span aria-hidden="true"> ✓</span>
              }
            </button>
          }
        </div>
      }
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
      <details (toggle)="open.set($any($event.target).open)">
        <summary>{{ 'wsBreakdown' | transloco }}</summary>
        @if (open()) {
          <ul class="inputs">
            @for (r of breakdown().raw; track r.item) {
              <li><app-item-chip [item]="r.item" [count]="r.count" /></li>
            }
          </ul>
          <p class="meta">{{ 'wsSteps' | transloco: { n: breakdown().steps } }}</p>
        }
      </details>
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
})
export class EntryCard {
  readonly entry = input.required<Entry | BlockEntry>();
  /** Other ways to make the same piece (another bench, another cost): a choice is offered when there are several. */
  readonly variants = input<readonly (Entry | BlockEntry)[]>([]);
  /** Index of the shown variant; the parent passes the matching `entry`. */
  readonly variant = model(0);

  protected readonly craft = inject(CraftService);
  protected readonly found = inject(Found);
  protected readonly project = inject(ProjectStore);
  protected readonly focus = inject(MapFocus);
  private readonly lang = inject(LangService);

  protected readonly open = signal(false);
  /** Raw materials and number of crafts for one craft of this entry, down to the raw materials. */
  protected readonly breakdown = computed(() => {
    const r = calculate(
      [{ recipe: this.entry().id, qty: this.entry().output?.count ?? 1 }],
      this.craft.context(),
      this.project.choices(),
      true,
    );
    return { steps: r.steps, raw: [...r.raw].map(([item, count]) => ({ item, count })) };
  });

  protected readonly known = computed(() => this.found.known(this.entry()));
  protected readonly tier = computed(() => (this.entry() as BlockEntry).tier);

  /** What tells a variant apart: the level of what it makes when they all differ, else its bench and how many kinds of materials it takes. */
  protected variantLabel(v: Entry): string {
    const level = this.levelOf(v);
    if (level && this.variants().every((o) => o === v || this.levelOf(o) !== level))
      return this.lang.t('wsLevel', { n: level });
    return `${this.craft.stationName(v.station)} · ${this.lang.t('wsMaterials', { n: v.inputs.length })}`;
  }

  private levelOf(v: Entry): number {
    return (v.output && this.craft.data()?.items[v.output.item]?.lvl) || 0;
  }

  /** "Any of: A, B, C" for an ingredient that several items can fill. */
  protected anyOf(input: Input): string {
    const items = this.craft.data()?.categories[input.category!] ?? [];
    const names = items.slice(0, 3).map((i) => this.craft.itemName(i.item));
    return `${this.lang.t('wsAnyOf')} : ${names.join(', ')}${items.length > 3 ? '…' : ''}`;
  }
}
