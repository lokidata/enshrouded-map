import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { normalize } from '../core/filter.store';
import { LangService } from '../core/lang.service';
import { LoreNote } from '../core/lore.model';
import { LoreService } from '../core/lore.service';
import { ProgressStore } from '../core/progress.store';

const NO_CAT = 'none'; // the filter value of the notes the game puts in no category
type Status = 'all' | 'todo' | 'done';

/** The lore notes: search, category, found or not (a mark "lore:<id>" per player), and a note's pages. */
@Component({
  selector: 'app-notes-tab',
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
        <p class="count" role="status">
          {{ 'loreCountFound' | transloco: { found: foundCount(), total: notes().length } }}
        </p>
        <div class="side-pills" role="group" [attr.aria-label]="'loreStatus' | transloco">
          @for (s of statuses; track s) {
            <button
              type="button"
              class="pill"
              [attr.aria-pressed]="status() === s"
              (click)="status.set(s); open.set(null)"
            >
              {{ 'loreStatus_' + s | transloco }}
            </button>
          }
        </div>
        <h3 class="side-title">{{ 'wsCategory' | transloco }}</h3>
        <ul class="cat-list">
          <li>
            <button type="button" [class.active]="!cat()" (click)="pickCat('')">
              <span>{{ 'loreAll' | transloco }}</span
              ><b>{{ notes().length }}</b>
            </button>
          </li>
          @for (c of categories(); track c.id) {
            <li>
              <button
                type="button"
                [class.active]="cat() === c.id"
                [attr.aria-pressed]="cat() === c.id"
                (click)="pickCat(c.id)"
              >
                <span>{{ c.label }}</span
                ><b>{{ c.n }}</b>
              </button>
            </li>
          }
        </ul>
      </aside>
      <section class="main">
        @if (current(); as note) {
          <button type="button" class="back" (click)="open.set(null)">
            ← {{ 'wsBack' | transloco }}
          </button>
          <header class="item-head">
            <h2>{{ lore.text(note.name) }}</h2>
            <label class="known-box">
              <input type="checkbox" [checked]="found(note)" (change)="toggle(note)" />
              {{ 'loreFound' | transloco }}
            </label>
          </header>
          <p class="meta">
            {{ categoryOf(note) }} · {{ 'lorePages' | transloco: { n: note.pages.length } }}
          </p>
          @for (page of note.pages; track $index) {
            <article class="note-page">
              @if (note.pages.length > 1 || lore.text(page.name) !== lore.text(note.name)) {
                <h3>{{ lore.text(page.name) }}</h3>
              }
              @for (p of paragraphs(page.text); track $index) {
                <p>{{ p }}</p>
              }
            </article>
          }
        } @else {
          <div class="bar">
            <span class="count" role="status">{{
              'wsCount' | transloco: { n: list().length }
            }}</span>
          </div>
          <div class="cards">
            @for (note of shown(); track note.id) {
              <article class="entry" [class.known]="found(note)">
                <header>
                  <div class="head">
                    <h3>
                      <button type="button" class="chip-link" (click)="open.set(note.id)">
                        {{ lore.text(note.name) }}
                      </button>
                    </h3>
                    <p class="meta">
                      {{ categoryOf(note) }} ·
                      {{ 'lorePages' | transloco: { n: note.pages.length } }}
                    </p>
                  </div>
                  <label class="known-box">
                    <input type="checkbox" [checked]="found(note)" (change)="toggle(note)" />
                    {{ 'loreFound' | transloco }}
                  </label>
                </header>
                <p class="preview">{{ preview(note) }}</p>
              </article>
            } @empty {
              <p class="empty">{{ 'wsNoResult' | transloco }}</p>
            }
          </div>
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
export class NotesTab {
  protected readonly lore = inject(LoreService);
  private readonly lang = inject(LangService);
  private readonly progress = inject(ProgressStore);

  protected readonly PAGE = 40;
  protected readonly statuses: readonly Status[] = ['all', 'todo', 'done'];
  protected readonly query = signal('');
  protected readonly cat = signal('');
  protected readonly status = signal<Status>('all');
  protected readonly open = signal<string | null>(null);
  protected readonly limit = signal(this.PAGE);

  protected readonly notes = computed(() => this.lore.data()?.notes ?? []);
  protected readonly current = computed(() => this.notes().find((n) => n.id === this.open()));
  protected readonly foundCount = computed(
    () => this.notes().filter((n) => this.progress.done().has(`lore:${n.id}`)).length,
  );

  /** What each note says, to search in: names and texts of both languages. */
  private readonly haystack = computed(
    () =>
      new Map(
        this.notes().map((n) => [
          n.id,
          normalize([...n.name, ...n.pages.flatMap((p) => [...p.name, ...p.text])].join(' ')),
        ]),
      ),
  );

  protected readonly categories = computed(() => {
    const data = this.lore.data();
    const counts = new Map<string, number>();
    for (const n of this.notes())
      counts.set(n.cat ?? NO_CAT, (counts.get(n.cat ?? NO_CAT) ?? 0) + 1);
    const lang = this.lang.lang();
    return [...counts]
      .map(([id, n]) => ({
        id,
        n,
        label: id === NO_CAT ? this.lang.t('loreOther') : this.lore.text(data!.categories[id]),
      }))
      .sort((a, b) =>
        a.id === NO_CAT ? 1 : b.id === NO_CAT ? -1 : a.label.localeCompare(b.label, lang),
      );
  });

  protected readonly list = computed(() => {
    const q = normalize(this.query().trim());
    const cat = this.cat();
    const status = this.status();
    const done = this.progress.done();
    const haystack = this.haystack();
    return this.notes().filter(
      (n) =>
        (!q || haystack.get(n.id)!.includes(q)) &&
        (!cat || (n.cat ?? NO_CAT) === cat) &&
        (status === 'all' || done.has(`lore:${n.id}`) === (status === 'done')),
    );
  });

  protected readonly shown = computed(() => this.list().slice(0, this.limit()));

  protected found(note: LoreNote): boolean {
    return this.progress.done().has(`lore:${note.id}`);
  }

  protected toggle(note: LoreNote): void {
    this.progress.toggle(`lore:${note.id}`);
  }

  protected categoryOf(note: LoreNote): string {
    const cat = note.cat ? this.lore.data()?.categories[note.cat] : null;
    return cat ? this.lore.text(cat) : this.lang.t('loreOther');
  }

  protected paragraphs(names: LoreNote['name']): string[] {
    return this.lore.text(names).split('\n');
  }

  protected preview(note: LoreNote): string {
    const text = this.lore.text(note.pages[0].text).replace(/\n/g, ' ');
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }

  protected pickCat(id: string): void {
    this.cat.set(id);
    this.limit.set(this.PAGE);
    this.open.set(null);
  }
}
