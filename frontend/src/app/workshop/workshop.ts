import { Component, ViewEncapsulation, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AltarTab } from './altar-tab';
import { CalculatorTab } from './calculator-tab';
import { EntriesTab } from './entries-tab';
import { ItemsTab } from './items-tab';
import { StationsTab } from './stations-tab';
import { Tab, WorkshopNav } from './workshop-nav';

const TABS: readonly Tab[] = ['recipes', 'items', 'blocks', 'stations', 'altar', 'calc'];

/** Crafting recipes, Flame Altar upgrades, building pieces, and the project calculator. */
@Component({
  selector: 'app-workshop',
  imports: [TranslocoPipe, EntriesTab, AltarTab, CalculatorTab, ItemsTab, StationsTab],
  template: `
    <div class="tabs" role="tablist" [attr.aria-label]="'workshop' | transloco">
      @for (t of tabs; track t) {
        <button
          type="button"
          role="tab"
          [id]="'ws-tab-' + t"
          [attr.aria-selected]="nav.tab() === t"
          [attr.aria-controls]="'ws-panel'"
          [class.active]="nav.tab() === t"
          (click)="nav.tab.set(t)"
        >
          {{ 'ws_' + t | transloco }}
        </button>
      }
    </div>
    <div id="ws-panel" class="panel" role="tabpanel" [attr.aria-labelledby]="'ws-tab-' + nav.tab()">
      @switch (nav.tab()) {
        @case ('recipes') {
          <app-entries-tab kind="recipes" />
        }
        @case ('items') {
          <app-items-tab />
        }
        @case ('stations') {
          <app-stations-tab />
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
  encapsulation: ViewEncapsulation.None, // the one stylesheet reaches the tab components too
  host: { class: 'workshop' },
  styleUrl: './workshop.css',
})
export class Workshop {
  protected readonly tabs = TABS;
  protected readonly nav = inject(WorkshopNav);
}
