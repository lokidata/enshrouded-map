import { Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AccountDialog } from './auth/account-dialog';
import { AuthDialog } from './auth/auth-dialog';
import { AdminDialog } from './auth/admin-dialog';
import { DeleteDialog } from './auth/delete-dialog';
import { PasskeyDialog } from './auth/passkey-dialog';
import { AuthService } from './core/auth.service';
import { LayoutService } from './core/layout.service';
import { ProgressStore } from './core/progress.store';
import { MapView } from './map/map-view';
import { Sidebar } from './sidebar/sidebar';
import { TeamDialog } from './team/team-dialog';

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
    TeamDialog,
    TranslocoPipe,
  ],
  template: `
    @if (auth.user()) {
      <aside id="sidebar" [hidden]="!menuOpen()"><app-sidebar /></aside>
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
      <app-map />
    }
    <app-auth-dialog />
    <app-account-dialog />
    <app-delete-dialog />
    <app-admin-dialog />
    <app-passkey-dialog />
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
  host: { '[class.top]': 'layout.top()' },
  styleUrl: './app.css',
})
export class App {
  protected readonly progress = inject(ProgressStore);
  protected readonly auth = inject(AuthService);
  protected readonly layout = inject(LayoutService);
  protected readonly menuOpen = signal(read() !== 'closed');

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
