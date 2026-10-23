import { Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../core/auth.service';
import { copyText, hashLink, timeOf } from '../core/links';
import { ProgressStore } from '../core/progress.store';
import { SessionService } from '../core/session.service';

@Component({
  selector: 'app-account-bar',
  imports: [TranslocoPipe],
  template: `
    <div class="account">
      @if (auth.user(); as name) {
        <span class="who"
          >👤 {{ name }} · {{ progress.done().size }} {{ 'progress' | transloco }}</span
        >
        <button type="button" (click)="invite()">{{ 'createInvite' | transloco }}</button>
        <button type="button" (click)="auth.accountOpen.set(true)">
          {{ 'account' | transloco }}
        </button>
        <button type="button" (click)="session.logout()">{{ 'logout' | transloco }}</button>
      } @else {
        <button type="button" class="primary" (click)="auth.dialog.set('login')">
          {{ 'login' | transloco }}
        </button>
      }
    </div>
    @if (link(); as l) {
      <div class="invite">
        <label>
          {{ 'inviteLink' | transloco }}
          <input readonly [value]="l.url" (focus)="$any($event.target).select()" />
        </label>
        <button type="button" (click)="copy(l.url)">
          {{ (copied() ? 'copied' : 'copy') | transloco }}
        </button>
        <p>{{ 'inviteUntil' | transloco: { time: l.until } }}</p>
      </div>
    }
  `,
  styles: `
    .account {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
    }
    .who {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text);
    }
    button {
      padding: 4px 9px;
      border: 1px solid var(--border);
      border-radius: 5px;
      background: var(--bg);
      color: var(--text);
      cursor: pointer;
      font-size: 12px;
    }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #1a1a1a;
    }
    .invite {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 6px;
      align-items: end;
      margin-top: 8px;
      font-size: 12px;
      color: var(--muted);
    }
    .invite label {
      display: block;
    }
    .invite input {
      width: 100%;
      margin-top: 2px;
      padding: 5px 7px;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
    }
    .invite p {
      grid-column: 1 / -1;
      margin: 0;
    }
  `,
})
export class AccountBar {
  protected readonly auth = inject(AuthService);
  protected readonly progress = inject(ProgressStore);
  protected readonly session = inject(SessionService);

  protected readonly link = signal<{ url: string; until: string } | null>(null);
  protected readonly copied = signal(false);

  protected async invite(): Promise<void> {
    try {
      const { token, expires_at } = await this.auth.createInvitation();
      const url = hashLink('invite', token);
      const until = timeOf(expires_at);
      this.copied.set(false);
      this.link.set({ url, until });
    } catch {
      this.auth.notice.set('errors.unknown');
    }
  }

  protected async copy(url: string): Promise<void> {
    this.copied.set(await copyText(url));
  }
}
