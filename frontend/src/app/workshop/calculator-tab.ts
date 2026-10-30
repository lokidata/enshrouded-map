import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { RAW, calculate } from '../core/craft.calc';
import { CraftService } from '../core/craft.service';
import { normalize } from '../core/filter.store';
import { LangService } from '../core/lang.service';
import { copyText } from '../core/links';
import { ProjectStore } from '../core/project.store';
import { ItemChip } from './item-chip';

/** Total materials of a project (a list of recipes and building pieces). */
@Component({
  selector: 'app-calculator-tab',
  imports: [TranslocoPipe, ItemChip],
  template: `
    <section>
      <h2>{{ 'wsCalcAdd' | transloco }}</h2>
      <input
        type="search"
        [placeholder]="'wsSearch' | transloco"
        [attr.aria-label]="'wsCalcAdd' | transloco"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
      @if (found().length) {
        <ul class="picks">
          @for (e of found(); track e.id) {
            <li>
              <button type="button" (click)="add(e.id)">
                {{ craft.text(e.name) }} · {{ craft.stationName(e.station) }}
              </button>
            </li>
          }
        </ul>
      }
    </section>

    @if (project.lines().length) {
      <section>
        <h2>{{ 'wsProject' | transloco }}</h2>
        <ul class="lines">
          @for (line of lines(); track line.recipe) {
            <li>
              <label>
                <span class="sr">{{ 'wsQty' | transloco }} {{ craft.text(line.entry.name) }}</span>
                <input
                  type="number"
                  min="1"
                  max="9999"
                  [value]="line.qty"
                  (change)="project.setQty(line.recipe, +$any($event.target).value)"
                />
              </label>
              <span>{{ craft.text(line.entry.name) }}</span>
              <button
                type="button"
                class="danger"
                [attr.aria-label]="'wsRemove' | transloco: { name: craft.text(line.entry.name) }"
                (click)="project.remove(line.recipe)"
              >
                ✕
              </button>
            </li>
          }
        </ul>
        <label class="check">
          <input
            type="checkbox"
            [checked]="project.expand()"
            (change)="project.setExpand(!project.expand())"
          />
          {{ 'wsExpand' | transloco }}
        </label>
        <div class="actions">
          <button type="button" (click)="copy()">
            {{ (copied() ? 'copied' : 'wsCopy') | transloco }}
          </button>
          <button type="button" class="danger" (click)="project.clear()">
            {{ 'wsClear' | transloco }}
          </button>
        </div>
      </section>

      <section>
        <h2>{{ 'wsRawTitle' | transloco }}</h2>
        <ul class="inputs">
          @for (r of raw(); track r.item) {
            <li><app-item-chip [item]="r.item" [count]="r.count" /></li>
          } @empty {
            <li class="empty">{{ 'wsNoResult' | transloco }}</li>
          }
        </ul>
        <p class="meta">{{ 'wsStations' | transloco }} : {{ stations() }}</p>
      </section>

      @if (result().crafted.length) {
        <section>
          <h2>{{ 'wsCraftedTitle' | transloco }}</h2>
          <ul class="choices">
            @for (c of result().crafted; track c.item) {
              <li>
                <app-item-chip [item]="c.item" [count]="c.crafts * (c.recipe.output?.count ?? 1)" />
                <select
                  [attr.aria-label]="'wsRecipeChoice' | transloco: { name: craft.itemName(c.item) }"
                  (change)="project.chooseRecipe(c.item, $any($event.target).value)"
                >
                  @for (o of craft.byOutput().get(c.item) ?? []; track o.id) {
                    <option [value]="o.id" [selected]="o.id === c.recipe.id">
                      {{ craft.text(o.name) }} · {{ craft.stationName(o.station) }}
                    </option>
                  }
                  <option [value]="RAW">{{ 'wsAsRaw' | transloco }}</option>
                </select>
              </li>
            }
          </ul>
        </section>
      }

      @if (categories().length) {
        <section>
          <h2>{{ 'wsCategoriesTitle' | transloco }}</h2>
          <ul class="choices">
            @for (cat of categories(); track cat.id) {
              <li>
                <span>{{ cat.label }}</span>
                <select
                  [attr.aria-label]="cat.label"
                  (change)="project.chooseCategory(cat.id, $any($event.target).value)"
                >
                  @for (o of cat.items; track o.item) {
                    <option [value]="o.item" [selected]="o.item === cat.current">
                      {{ craft.itemName(o.item) }}
                    </option>
                  }
                </select>
              </li>
            }
          </ul>
          <p class="hint">{{ 'wsScalingNote' | transloco }}</p>
        </section>
      }
    } @else {
      <p class="empty">{{ 'wsCalcEmpty' | transloco }}</p>
    }
  `,
  styleUrl: './workshop.css',
})
export class CalculatorTab {
  protected readonly craft = inject(CraftService);
  protected readonly project = inject(ProjectStore);
  private readonly lang = inject(LangService);
  protected readonly RAW = RAW;

  protected readonly query = signal('');
  protected readonly copied = signal(false);

  protected readonly found = computed(() => {
    const q = normalize(this.query().trim());
    if (!q) return [];
    return [...this.craft.entries().values()]
      .filter((e) => e.output && normalize(e.name.join(' ')).includes(q))
      .sort((a, b) =>
        this.craft.text(a.name).localeCompare(this.craft.text(b.name), this.lang.lang()),
      )
      .slice(0, 8);
  });

  protected readonly lines = computed(() =>
    this.project
      .lines()
      .map((l) => ({ ...l, entry: this.craft.entries().get(l.recipe)! }))
      .filter((l) => l.entry),
  );

  protected readonly result = computed(() =>
    calculate(
      this.project.lines(),
      this.craft.context(),
      this.project.choices(),
      this.project.expand(),
    ),
  );

  protected readonly raw = computed(() =>
    [...this.result().raw]
      .map(([item, count]) => ({ item, count }))
      .sort((a, b) =>
        this.craft.itemName(a.item).localeCompare(this.craft.itemName(b.item), this.lang.lang()),
      ),
  );

  protected readonly stations = computed(() =>
    [...this.result().stations]
      .map((s) => this.craft.stationName(s))
      .sort()
      .join(', '),
  );

  /** Ingredients that several items can fill, in the recipes of the project. */
  protected readonly categories = computed(() => {
    const ids = new Set<string>();
    const recipes = [
      ...this.lines().map((l) => l.entry),
      ...this.result().crafted.map((c) => c.recipe),
    ];
    for (const r of recipes) for (const i of r.inputs) if (i.category) ids.add(i.category);
    const choices = this.project.choices().category;
    return [...ids].map((id) => {
      const items = this.craft.data()?.categories[id] ?? [];
      return {
        id,
        items,
        current: choices[id] ?? items[0]?.item,
        label:
          items
            .slice(0, 2)
            .map((i) => this.craft.itemName(i.item))
            .join(' / ') + '…',
      };
    });
  });

  protected add(id: string): void {
    this.project.add(id);
    this.query.set('');
  }

  protected async copy(): Promise<void> {
    const text = this.raw()
      .map((r) => `${this.craft.itemName(r.item)} × ${r.count}`)
      .join('\n');
    this.copied.set(await copyText(text));
  }
}
