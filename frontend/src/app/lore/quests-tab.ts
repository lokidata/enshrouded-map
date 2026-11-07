import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { normalize } from '../core/filter.store';
import { LangService } from '../core/lang.service';
import { LoreQuest } from '../core/lore.model';
import { LoreService } from '../core/lore.service';

type Kind = 'all' | 'main' | 'side';
const NO_GIVER = 'none';

/** The quests of the journal: search, who gives them, main or side, and a quest's steps and rewards. */
@Component({
  selector: 'app-quests-tab',
  imports: [TranslocoPipe],
  template: `
    <div class="browse">
      <aside class="side" [attr.aria-label]="'wsFilters' | transloco">
        <input
          type="search"
          [placeholder]="'wsFilterName' | transloco"
          [attr.aria-label]="'wsSearch' | transloco"
          [value]="query()"
          (input)="query.set($any($event.target).value); open.set(null)"
        />
        <div class="side-pills" role="group" [attr.aria-label]="'loreQuestKind' | transloco">
          @for (k of kinds; track k) {
            <button
              type="button"
              class="pill"
              [attr.aria-pressed]="kind() === k"
              (click)="kind.set(k); open.set(null)"
            >
              {{ 'loreQuestKind_' + k | transloco }}
            </button>
          }
        </div>
        <ul class="cat-list">
          <li>
            <button type="button" [class.active]="!giver()" (click)="pick('')">
              <span>{{ 'loreAll' | transloco }}</span
              ><b>{{ quests().length }}</b>
            </button>
          </li>
        </ul>
        @for (group of groups(); track group.title) {
          <h3 class="side-title">{{ group.title | transloco }}</h3>
          <ul class="cat-list">
            @for (g of group.items; track g.id) {
              <li>
                <button
                  type="button"
                  [class.active]="giver() === g.id"
                  [attr.aria-pressed]="giver() === g.id"
                  (click)="pick(g.id)"
                >
                  <span>{{ g.label }}</span
                  ><b>{{ g.n }}</b>
                </button>
              </li>
            }
          </ul>
        }
      </aside>
      <section class="main">
        @if (current(); as quest) {
          <button type="button" class="back" (click)="open.set(null)">
            ← {{ 'wsBack' | transloco }}
          </button>
          <header class="item-head">
            <h2>{{ lore.text(quest.name) }}</h2>
          </header>
          <p class="meta">
            {{ giverLabel(quest) }} ·
            {{ 'loreQuestKind_' + (quest.main ? 'main' : 'side') | transloco }}
          </p>
          @for (step of quest.steps; track $index) {
            <article class="note-page">
              @if (quest.steps.length > 1) {
                <h3>{{ $index + 1 }}. {{ lore.text(step.name) }}</h3>
              }
              @for (p of lines(step.text); track $index) {
                <p>{{ p }}</p>
              }
            </article>
          }
          @if (quest.rewards.length) {
            <h3>{{ 'loreRewards' | transloco }}</h3>
            <ul class="inputs">
              @for (g of quest.rewards; track g) {
                <li>
                  <span class="chip">
                    @if (lore.data()!.items[g].icon; as icon) {
                      <img [src]="icon" alt="" width="24" height="24" loading="lazy" />
                    }
                    <span>{{ lore.text(lore.data()!.items[g].name) }}</span>
                  </span>
                </li>
              }
            </ul>
          }
        } @else {
          <div class="bar">
            <span class="count" role="status">{{
              'wsCount' | transloco: { n: list().length }
            }}</span>
          </div>
          <div class="cards">
            @for (quest of list(); track quest.id) {
              <article class="entry">
                <header>
                  <div class="head">
                    <h3>
                      <button type="button" class="chip-link" (click)="open.set(quest.id)">
                        {{ lore.text(quest.name) }}
                      </button>
                    </h3>
                    <p class="meta">
                      {{ giverLabel(quest) }} ·
                      {{ 'loreSteps' | transloco: { n: quest.steps.length } }}
                      @if (quest.main) {
                        · {{ 'loreQuestKind_main' | transloco }}
                      }
                    </p>
                  </div>
                </header>
                <p class="preview">{{ preview(quest) }}</p>
              </article>
            } @empty {
              <p class="empty">{{ 'wsNoResult' | transloco }}</p>
            }
          </div>
        }
      </section>
    </div>
  `,
})
export class QuestsTab {
  protected readonly lore = inject(LoreService);
  private readonly lang = inject(LangService);

  protected readonly kinds: readonly Kind[] = ['all', 'main', 'side'];
  protected readonly query = signal('');
  protected readonly giver = signal('');
  protected readonly kind = signal<Kind>('all');
  protected readonly open = signal<string | null>(null);

  protected readonly quests = computed(() => this.lore.data()?.quests ?? []);
  protected readonly current = computed(() => this.quests().find((q) => q.id === this.open()));

  private readonly haystack = computed(
    () =>
      new Map(
        this.quests().map((q) => [
          q.id,
          normalize([...q.name, ...q.steps.flatMap((s) => [...s.name, ...s.text])].join(' ')),
        ]),
      ),
  );

  /** The characters, then the regions, then the quests nobody gives. */
  protected readonly groups = computed(() => {
    const givers = this.lore.data()?.givers ?? {};
    const counts = new Map<string, number>();
    for (const q of this.quests())
      counts.set(q.giver ?? NO_GIVER, (counts.get(q.giver ?? NO_GIVER) ?? 0) + 1);
    const lang = this.lang.lang();
    const entry = (id: string) => ({
      id,
      n: counts.get(id) ?? 0,
      label: id === NO_GIVER ? this.lang.t('loreOther') : this.lore.text(givers[id].name),
    });
    const by = (region: boolean) =>
      Object.keys(givers)
        .filter((id) => givers[id].region === region && counts.has(id))
        .map(entry)
        .sort((a, b) => a.label.localeCompare(b.label, lang));
    return [
      { title: 'loreCharacters', items: by(false) },
      {
        title: 'loreRegions',
        items: [...by(true), ...(counts.has(NO_GIVER) ? [entry(NO_GIVER)] : [])],
      },
    ].filter((g) => g.items.length);
  });

  protected readonly list = computed(() => {
    const q = normalize(this.query().trim());
    const giver = this.giver();
    const kind = this.kind();
    const haystack = this.haystack();
    return this.quests().filter(
      (quest) =>
        (!q || haystack.get(quest.id)!.includes(q)) &&
        (!giver || (quest.giver ?? NO_GIVER) === giver) &&
        (kind === 'all' || quest.main === (kind === 'main')),
    );
  });

  protected giverLabel(quest: LoreQuest): string {
    const giver = quest.giver ? this.lore.data()?.givers[quest.giver] : null;
    return giver ? this.lore.text(giver.name) : this.lang.t('loreOther');
  }

  protected lines(names: LoreQuest['name']): string[] {
    return this.lore.text(names).split('\n');
  }

  protected preview(quest: LoreQuest): string {
    const text = this.lore.text(quest.steps[0].text).replace(/\n/g, ' ');
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }

  protected pick(id: string): void {
    this.giver.set(id);
    this.open.set(null);
  }
}
