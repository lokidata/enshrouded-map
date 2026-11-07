import { Component, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NotesTab } from './notes-tab';
import { QuestsTab } from './quests-tab';

type Tab = 'notes' | 'quests';

/** The journal: lore notes (found or not, per player) and quests. Same look as the workshop. */
@Component({
  selector: 'app-lore',
  imports: [TranslocoPipe, NotesTab, QuestsTab],
  template: `
    <div class="tabs" role="tablist" [attr.aria-label]="'lore' | transloco">
      @for (t of tabs; track t) {
        <button
          type="button"
          role="tab"
          [id]="'lore-tab-' + t"
          [attr.aria-selected]="tab() === t"
          aria-controls="lore-panel"
          [class.active]="tab() === t"
          (click)="tab.set(t)"
        >
          {{ 'lore_' + t | transloco }}
        </button>
      }
    </div>
    <div id="lore-panel" class="panel" role="tabpanel" [attr.aria-labelledby]="'lore-tab-' + tab()">
      @if (tab() === 'notes') {
        <app-notes-tab />
      } @else {
        <app-quests-tab />
      }
    </div>
  `,
  host: { class: 'workshop' },
})
export class Lore {
  protected readonly tabs: readonly Tab[] = ['notes', 'quests'];
  protected readonly tab = signal<Tab>('notes');
}
