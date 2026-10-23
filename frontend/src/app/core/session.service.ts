import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthMode, AuthService, Credentials, UserInfo } from './auth.service';
import { FilterStore } from './filter.store';
import { takeHashToken } from './links';
import { ProgressStore } from './progress.store';

const SAVE_DELAY = 700;

/** Login state, plus what depends on it: progress marks and the filters saved in the profile. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly progress = inject(ProgressStore);
  private readonly filters = inject(FilterStore);

  private saved: string | null = null;
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const json = JSON.stringify({ filters: this.filters.overrides() });
      if (!this.auth.user() || json === this.saved) return;
      this.pending = json;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), SAVE_DELAY);
    });
    // Leaving the page right after a change: send it anyway.
    addEventListener('pagehide', () => {
      if (!this.auth.user() || !this.pending || this.pending === this.saved) return;
      const token = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1] ?? '';
      void fetch('api/v1/settings', {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token) },
        body: JSON.stringify({ settings: JSON.parse(this.pending) }),
      });
    });
  }

  /** Restores the session at startup, or asks for what is missing: the first account, or an invitation / reset link. */
  async start(): Promise<void> {
    const link = takeHashToken();
    try {
      const me = await this.auth.me();
      if (me.username) return await this.enter(me);
      if (me.setup_required) return this.auth.dialog.set('setup');
      if (link?.kind === 'invite') {
        if (!(await this.auth.checkInvitation(link.token)))
          return this.auth.notice.set('errors.invitation_invalid');
        this.auth.inviteToken.set(link.token);
        this.auth.dialog.set('invite');
      } else if (link?.kind === 'reset') {
        const name = await this.auth.checkReset(link.token);
        if (!name) return this.auth.notice.set('errors.reset_invalid');
        this.auth.resetToken.set(link.token);
        this.auth.resetUser.set(name);
        this.auth.dialog.set('reset');
      }
    } catch {
      // API unreachable: the map works without an account
    }
  }

  async authenticate(mode: AuthMode, credentials: Credentials): Promise<void> {
    await this.enter(await this.auth.authenticate(mode, credentials));
  }

  async logout(): Promise<void> {
    clearTimeout(this.timer);
    await this.flush(); // last change before leaving the profile
    try {
      await this.auth.logout();
    } finally {
      this.auth.user.set(null);
      this.auth.isAdmin.set(false);
      this.progress.set([]);
      this.filters.reset();
      this.saved = this.pending = null;
    }
  }

  private async enter(info: UserInfo): Promise<void> {
    const [marks, settings] = await Promise.all([
      firstValueFrom(this.http.get<{ marks: string[] }>('api/v1/progress')),
      firstValueFrom(
        this.http.get<{ settings: { filters?: Record<string, boolean> } | null }>(
          'api/v1/settings',
        ),
      ),
    ]);
    clearTimeout(this.timer);
    this.pending = null;
    this.progress.set(marks.marks);
    // A new profile has no saved filters: it keeps the ones chosen so far, and they get saved.
    if (settings.settings) this.filters.restore(settings.settings);
    this.saved = settings.settings ? JSON.stringify({ filters: this.filters.overrides() }) : null;
    this.auth.isAdmin.set(info.is_admin);
    this.auth.user.set(info.username);
  }

  private async flush(): Promise<void> {
    const json = this.pending;
    if (!json || !this.auth.user()) return;
    try {
      await firstValueFrom(this.http.put('api/v1/settings', { settings: JSON.parse(json) }));
      this.saved = json;
      if (this.pending === json) this.pending = null;
    } catch {
      // stays pending: sent again with the next change
    }
  }
}
