import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthDialog } from './auth/auth-dialog';
import { AuthService } from './core/auth.service';
import { ProgressStore } from './core/progress.store';
import { MapView } from './map/map-view';
import { Sidebar } from './sidebar/sidebar';

@Component({
  selector: 'app-root',
  imports: [Sidebar, MapView, AuthDialog, TranslocoPipe],
  template: `
    <aside><app-sidebar /></aside>
    <app-map />
    <app-auth-dialog />
    @if (progress.saveFailed()) {
      <div class="toast" role="alert">{{ 'errors.save' | transloco }}</div>
    }
    @if (auth.notice(); as key) {
      <button type="button" class="toast" role="alert" (click)="auth.notice.set(null)">
        {{ key | transloco }}
      </button>
    }
  `,
  styleUrl: './app.css',
})
export class App {
  protected readonly progress = inject(ProgressStore);
  protected readonly auth = inject(AuthService);
}
