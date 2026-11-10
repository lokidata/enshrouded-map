import { Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AccountDialog } from './auth/account-dialog';
import { AuthDialog } from './auth/auth-dialog';
import { AdminDialog } from './auth/admin-dialog';
import { DeleteDialog } from './auth/delete-dialog';
import { PasskeyDialog } from './auth/passkey-dialog';
import { ProgressDialog } from './progress-summary/progress-dialog';
import { SaveImportDialog } from './save-import/save-import-dialog';
import { AuthService } from './core/auth.service';
import { LayoutService } from './core/layout.service';
import { ProgressStore } from './core/progress.store';
import { EnemiesService } from './core/enemies.service';
import { PlannerStore } from './core/planner.store';
import { HistoryStore } from './core/history.store';
import { ViewStore } from './core/view.store';
import { Enemies } from './enemies/enemies';
import { Game } from './game/game';
import { Lore } from './lore/lore';
import { MapView } from './map/map-view';
import { Build } from './build/build';
import { Equipment } from './equipment/equipment';
import { Skills } from './skills/skills';
import { Sidebar } from './sidebar/sidebar';
import { TeamDialog } from './team/team-dialog';
import { TopBar } from './topbar/topbar';
import { Workshop } from './workshop/workshop';

const KEY = 'menu';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

@Component({
  selector: 'app-root',
  imports: [
    Sidebar,
    MapView,
    AuthDialog,
    AccountDialog,
    DeleteDialog,
    AdminDialog,
    PasskeyDialog,
    SaveImportDialog,
    ProgressDialog,
    TeamDialog,
    Workshop,
    Lore,
    Enemies,
    Build,
    Equipment,
    Game,
    Skills,
    TopBar,
    TranslocoPipe,
  ],
  template: `
    @if (auth.user()) {
      <app-topbar />
      <div class="body" [class.top]="layout.top()">
        <aside id="sidebar" [hidden]="!menuOpen() || views.view() !== 'map'"><app-sidebar /></aside>
        @if (views.view() === 'map') {
          <button
            type="button"
            class="menu-tab"
            [class.open]="menuOpen()"
            aria-controls="sidebar"
            [attr.aria-expanded]="menuOpen()"
            [attr.aria-label]="(menuOpen() ? 'hideMenu' : 'showMenu') | transloco"
            (click)="toggleMenu()"
          >
            {{ menuOpen() ? (layout.top() ? '˄' : '‹') : layout.top() ? '˅' : '›' }}
          </button>
        }
        <app-map [hidden]="views.view() !== 'map'" />
        @defer (when views.view() === 'workshop') {
          <app-workshop [hidden]="views.view() !== 'workshop'" />
        }
        @defer (when views.view() === 'enemies') {
          <app-enemies [hidden]="views.view() !== 'enemies'" />
        }
        @defer (when views.view() === 'build') {
          <app-build [hidden]="views.view() !== 'build'" />
        }
        @defer (when views.view() === 'equipment') {
          <app-equipment [hidden]="views.view() !== 'equipment'" />
        }
        @defer (when views.view() === 'game') {
          <app-game [hidden]="views.view() !== 'game'" />
        }
        @defer (when views.view() === 'skills') {
          <app-skills [hidden]="views.view() !== 'skills'" />
        }
        @defer (when views.view() === 'lore') {
          <app-lore [hidden]="views.view() !== 'lore'" />
        }
      </div>
    }
    <app-auth-dialog />
    <app-account-dialog />
    <app-delete-dialog />
    <app-admin-dialog />
    <app-passkey-dialog />
    <app-save-import-dialog />
    <app-progress-dialog />
    <app-team-dialog />
    @if (progress.saveFailed()) {
      <div class="toast" role="alert">{{ 'errors.save' | transloco }}</div>
    }
    @if (auth.notice(); as key) {
      <button type="button" class="toast" role="alert" (click)="auth.notice.set(null)">
        {{ key | transloco }}
      </button>
    }
  `,
  host: { '(window:hashchange)': 'onHash()' },
  styleUrl: './app.css',
})
export class App {
  protected readonly progress = inject(ProgressStore);
  protected readonly auth = inject(AuthService);
  protected readonly layout = inject(LayoutService);
  protected readonly views = inject(ViewStore);
  private readonly planner = inject(PlannerStore);
  private readonly history = inject(HistoryStore); // starts the Back/Forward handling
  private readonly enemies = inject(EnemiesService);
  protected readonly menuOpen = signal(read() !== 'closed');

  /** A link pasted in a tab that is already open only changes the fragment: open what it names. */
  protected onHash(): void {
    if (!this.auth.user()) return;
    if (this.planner.openFromHash()) this.views.set('skills');
    if (this.enemies.openFromHash()) this.views.set('enemies');
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
    try {
      localStorage.setItem(KEY, this.menuOpen() ? 'open' : 'closed');
    } catch {
      // private window: the choice just is not remembered
    }
    // the map takes the freed room: Leaflet recomputes its size on a window resize
    setTimeout(() => dispatchEvent(new Event('resize')));
  }
}
