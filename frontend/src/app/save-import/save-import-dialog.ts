import { DatePipe } from '@angular/common';
import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../core/auth.service';
import { CraftService } from '../core/craft.service';
import { MapDataService } from '../core/map-data.service';
import { LoreService } from '../core/lore.service';
import { ProgressStore } from '../core/progress.store';
import { FogStore } from './fog.store';
import { ImportEntry, characterNumber, lastImport, rememberImport } from './import-history';
import { fogShare, readFog } from './fog';
import { readKnowledge } from './knowledge';
import { MAX_FILE, readKsd } from './ksd';
import { Kind, fresh, propose } from './save-import.logic';

interface Line {
  kind: Kind;
  ids: string[];
  total: number;
  take: boolean;
}

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
        {{ error() ? ('saveImportErr_' + error() | transloco) : '' }}
      </div>
      @if (lines().length) {
        <p>
          {{ 'saveImportFound' | transloco: { name: fileName() } }}
          @if (slot() !== null) {
            ({{ 'saveImportSlot' | transloco: { n: slot() } }})
          }
        </p>
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
          <button type="button" class="primary" [disabled]="!count() || busy()" (click)="apply()">
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
  private readonly fogStore = inject(FogStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly lines = signal<Line[]>([]);
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
        this.lines.set([]);
        this.fog.set(null);
        this.error.set('');
        this.done.set(null);
        this.previous.set(lastImport());
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
    this.lines.update((ls) => ls.map((l, j) => (j === i ? { ...l, take: !l.take } : l)));
  }

  protected async read(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.lines.set([]);
    this.fog.set(null);
    this.error.set('');
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
      const done = this.progress.done();
      this.fileName.set(file.name);
      this.slot.set(characterNumber(file.name));
      const f = sections.get('fogofwar');
      if (f) {
        const cells = readFog(f);
        this.fog.set({ cells, percent: Math.round(fogShare(cells) * 100), take: true });
      }
      this.lines.set(
        (['recipe', 'quest', 'lore', 'place', 'item'] as const).map((kind) => {
          const ids = fresh(p.marks[kind], done);
          return { kind, ids, total: p.marks[kind].length, take: ids.length > 0 };
        }),
      );
    } catch {
      this.error.set('format');
    }
  }

  protected async apply(): Promise<void> {
    const ids = this.lines().flatMap((l) => (l.take ? l.ids : []));
    const fog = this.fog();
    if (fog?.take) this.fogStore.set(fog.cells);
    this.busy.set(true);
    await this.progress.setAll(ids, true);
    this.busy.set(false);
    if (this.progress.saveFailed()) return this.error.set('save');
    const counts: ImportEntry['counts'] = {};
    for (const l of this.lines()) if (l.take) counts[l.kind] = l.ids.length;
    rememberImport({ name: this.fileName(), at: new Date().toISOString(), counts });
    this.previous.set(lastImport());
    this.done.set(ids.length + (fog?.take ? 1 : 0));
    this.lines.set([]);
    this.fog.set(null);
  }
}
