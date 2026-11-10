import { DatePipe } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, errorCode } from '../core/auth.service';
import { CharacterStore } from '../core/character.store';
import { CraftService } from '../core/craft.service';
import { LangService } from '../core/lang.service';
import { MapDataService } from '../core/map-data.service';
import { LoreService } from '../core/lore.service';
import { ProgressStore } from '../core/progress.store';
import { SessionService } from '../core/session.service';
import { FogStore } from './fog.store';
import { ImportEntry, characterNumber, lastImport, rememberImport } from './import-history';
import { fogShare, readFog } from './fog';
import { readKnowledge } from './knowledge';
import { MAX_FILE, readKsd } from './ksd';
import { Kind, Proposal, fresh, propose } from './save-import.logic';

const KINDS = ['recipe', 'quest', 'lore', 'place', 'item'] as const;

interface Line {
  kind: Kind;
  ids: string[];
  total: number;
  take: boolean;
}

type Target = 'active' | 'new';

/** Ticks what a local `character*.ksd` save already knows (recipes, finished quests). The file is read here, it is never sent. */
@Component({
  selector: 'app-save-import-dialog',
  imports: [TranslocoPipe, DatePipe],
  template: `
    <dialog #dialog aria-labelledby="import-title" (close)="auth.saveImportOpen.set(false)">
      <button
        type="button"
        class="x"
        [attr.aria-label]="'close' | transloco"
        (click)="auth.saveImportOpen.set(false)"
      >
        ✕
      </button>
      <h2 id="import-title">{{ 'saveImport' | transloco }}</h2>
      <p class="hint">{{ 'saveImportHint' | transloco }}</p>
      @if (previous(); as p) {
        <p class="hint">
          {{ 'saveImportLast' | transloco: { name: p.name, date: (p.at | date: 'short') } }}
        </p>
      }
      <label>
        {{ 'saveImportFile' | transloco }}
        <input type="file" accept=".ksd" (change)="read($event)" />
      </label>
      <div class="error" role="alert">
        {{
          error()
            ? ('saveImportErr_' + error() | transloco)
            : serverError()
              ? ('errors.' + serverError() | transloco)
              : ''
        }}
      </div>
      @if (lines().length) {
        <p>
          {{ 'saveImportFound' | transloco: { name: fileName() } }}
          @if (slot() !== null) {
            ({{ 'saveImportSlot' | transloco: { n: slot() } }})
          }
        </p>
        <fieldset class="target">
          <legend>{{ 'saveImportInto' | transloco }}</legend>
          <label>
            <input
              type="radio"
              name="import-target"
              [checked]="target() === 'active'"
              (change)="target.set('active')"
            />
            {{ characters.active()?.name }}
          </label>
          <label>
            <input
              type="radio"
              name="import-target"
              [checked]="target() === 'new'"
              (change)="target.set('new')"
            />
            {{ 'saveImportNew' | transloco }}
          </label>
          @if (target() === 'new') {
            <input
              type="text"
              maxlength="40"
              [value]="newName()"
              [attr.aria-label]="'characterName' | transloco"
              (input)="newName.set($any($event.target).value)"
            />
          }
        </fieldset>
        <ul class="members">
          @for (l of lines(); track l.kind; let i = $index) {
            <li>
              <label>
                <input
                  type="checkbox"
                  [checked]="l.take"
                  [disabled]="!l.ids.length"
                  (change)="toggle(i)"
                />
                {{ 'saveImportKind_' + l.kind | transloco }}
              </label>
              <span class="hint">
                {{ 'saveImportCount' | transloco: { n: l.ids.length, total: l.total } }}
              </span>
            </li>
          }
        </ul>
        @if (fog(); as f) {
          <label class="fog">
            <input type="checkbox" [checked]="f.take" (change)="toggleFog()" />
            {{ 'saveImportFog' | transloco: { percent: f.percent } }}
          </label>
        }
        <p class="hint">{{ 'saveImportAdds' | transloco }}</p>
      }
      @if (done() !== null) {
        <div class="ok" role="status">{{ 'saveImportDone' | transloco: { n: done() } }}</div>
      }
      <div class="footer">
        @if (done() === null) {
          <button
            type="button"
            class="primary"
            [disabled]="!count() || busy() || (target() === 'new' && !newName().trim())"
            (click)="apply()"
          >
            {{ 'saveImportApply' | transloco }}
          </button>
        }
        <button type="button" (click)="auth.saveImportOpen.set(false)">
          {{ 'close' | transloco }}
        </button>
      </div>
    </dialog>
  `,
  styleUrl: '../auth/auth-dialog.css',
})
export class SaveImportDialog {
  protected readonly auth = inject(AuthService);
  private readonly craft = inject(CraftService);
  private readonly lore = inject(LoreService);
  private readonly mapData = inject(MapDataService);
  private readonly progress = inject(ProgressStore);
  private readonly session = inject(SessionService);
  private readonly lang = inject(LangService);
  protected readonly characters = inject(CharacterStore);
  private readonly fogStore = inject(FogStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** What the save proposes (null until a file is read), and which kinds the player unticked. */
  private readonly proposal = signal<Proposal | null>(null);
  private readonly unticked = signal<ReadonlySet<Kind>>(new Set());
  /** Into the profile followed now, or into a new one (the usual choice for another character's save). */
  protected readonly target = signal<Target>('active');
  protected readonly newName = signal('');
  protected readonly serverError = signal('');
  /** What each kind would add: new marks only, against the profile that receives them (a new one is empty). */
  protected readonly lines = computed<Line[]>(() => {
    const p = this.proposal();
    if (!p) return [];
    const done: ReadonlySet<string> = this.target() === 'new' ? new Set() : this.progress.done();
    return KINDS.map((kind) => {
      const ids = fresh(p.marks[kind], done);
      return {
        kind,
        ids,
        total: p.marks[kind].length,
        take: ids.length > 0 && !this.unticked().has(kind),
      };
    });
  });
  protected readonly fileName = signal('');
  protected readonly error = signal('');
  protected readonly done = signal<number | null>(null);
  protected readonly busy = signal(false);
  /** The previous import, read each time the dialog opens. */
  protected readonly previous = signal<ImportEntry | null>(null);
  protected readonly slot = signal<number | null>(null);
  /** The explored area found in the save, and whether to import it. */
  protected readonly fog = signal<{ cells: Uint8Array; percent: number; take: boolean } | null>(
    null,
  );

  constructor() {
    effect(() => {
      const open = this.auth.saveImportOpen();
      const el = this.dialog().nativeElement;
      if (open && !el.open) {
        this.proposal.set(null);
        this.fog.set(null);
        this.error.set('');
        this.serverError.set('');
        this.done.set(null);
        this.previous.set(this.lastOfActive());
        el.showModal();
      }
      if (!open && el.open) el.close();
    });
  }

  protected count(): number {
    return (
      this.lines().reduce((n, l) => n + (l.take ? l.ids.length : 0), 0) + (this.fog()?.take ? 1 : 0)
    );
  }

  protected toggleFog(): void {
    this.fog.update((f) => (f ? { ...f, take: !f.take } : f));
  }

  protected toggle(i: number): void {
    const kind = this.lines()[i].kind;
    this.unticked.update((u) => {
      const next = new Set(u);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  private lastOfActive(): ImportEntry | null {
    const id = this.characters.active()?.id;
    return id === undefined ? null : lastImport(id);
  }

  /** "Personnage 3" for character3.ksd, else the file name; never one the player already has. */
  private suggestedName(file: string, slot: number | null): string {
    const base =
      slot !== null ? this.lang.t('characterDefault', { n: slot }) : file.replace(/\.ksd$/i, '');
    const taken = new Set(this.characters.list().map((c) => c.name));
    let name = base.slice(0, 40);
    for (let n = 2; taken.has(name); n++) name = `${base.slice(0, 36)} ${n}`;
    return name;
  }

  protected async read(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.proposal.set(null);
    this.unticked.set(new Set());
    this.fog.set(null);
    this.error.set('');
    this.serverError.set('');
    this.done.set(null);
    if (!file) return;
    if (file.size > MAX_FILE) return this.error.set('size');
    try {
      const sections = readKsd(new Uint8Array(await file.arrayBuffer()));
      const data = sections.get('player_knowledge');
      if (!data) return this.error.set('character');
      const p = propose(
        readKnowledge(data),
        this.craft.data(),
        this.lore.data(),
        this.mapData.data.markers,
      );
      this.fileName.set(file.name);
      this.slot.set(characterNumber(file.name));
      const f = sections.get('fogofwar');
      if (f) {
        const cells = readFog(f);
        this.fog.set({ cells, percent: Math.round(fogShare(cells) * 100), take: true });
      }
      // The same file as last time goes to the profile it came from; an empty profile takes its first
      // import; another character's save is a new profile.
      const last = this.lastOfActive();
      this.target.set(
        last?.name === file.name || this.progress.done().size === 0 ? 'active' : 'new',
      );
      this.newName.set(this.suggestedName(file.name, this.slot()));
      this.proposal.set(p);
    } catch {
      this.error.set('format');
    }
  }

  protected async apply(): Promise<void> {
    const ids = this.lines().flatMap((l) => (l.take ? l.ids : []));
    const counts: ImportEntry['counts'] = {};
    for (const l of this.lines()) if (l.take) counts[l.kind] = l.ids.length;
    const fog = this.fog();
    this.busy.set(true);
    this.serverError.set('');
    try {
      // a new profile first, so that the marks and the explored area land in it
      if (this.target() === 'new') await this.session.addCharacter(this.newName().trim());
      if (fog?.take) this.fogStore.set(fog.cells);
      await this.progress.setAll(ids, true);
    } catch (err) {
      this.serverError.set(errorCode(err));
      this.busy.set(false);
      return;
    }
    this.busy.set(false);
    if (this.progress.saveFailed()) return this.error.set('save');
    const id = this.characters.active()?.id;
    if (id !== undefined)
      rememberImport(id, { name: this.fileName(), at: new Date().toISOString(), counts });
    this.previous.set(this.lastOfActive());
    this.done.set(ids.length + (fog?.take ? 1 : 0));
    this.proposal.set(null);
    this.fog.set(null);
  }
}
