import { Component, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AltarTab } from './altar-tab';
import { CalculatorTab } from './calculator-tab';
import { EntriesTab } from './entries-tab';

type Tab = 'recipes' | 'altar' | 'blocks' | 'calc';
const TABS: readonly Tab[] = ['recipes', 'altar', 'blocks', 'calc'];

/** Crafting recipes, Flame Altar upgrades, building pieces, and the project calculator. */
@Component({
  selector: 'app-workshop',
  imports: [TranslocoPipe, EntriesTab, AltarTab, CalculatorTab],
  template: `
    <div class="tabs" role="tablist" [attr.aria-label]="'workshop' | transloco">
      @for (t of tabs; track t) {
        <button
          type="button"
          role="tab"
          [id]="'ws-tab-' + t"
          [attr.aria-selected]="tab() === t"
          [attr.aria-controls]="'ws-panel'"
          [class.active]="tab() === t"
          (click)="tab.set(t)"
        >
          {{ 'ws_' + t | transloco }}
        </button>
      }
    </div>
    <div id="ws-panel" class="panel" role="tabpanel" [attr.aria-labelledby]="'ws-tab-' + tab()">
      @switch (tab()) {
        @case ('recipes') {
          <app-entries-tab kind="recipes" />
        }
        @case ('altar') {
          <app-altar-tab />
        }
        @case ('blocks') {
          <app-entries-tab kind="blocks" />
        }
        @case ('calc') {
          <app-calculator-tab />
        }
      }
    </div>
  `,
  host: { class: 'workshop' },
  styleUrl: './workshop.css',
})
export class Workshop {
  protected readonly tabs = TABS;
  protected readonly tab = signal<Tab>('recipes');
}
