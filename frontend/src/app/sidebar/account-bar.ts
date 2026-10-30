import { Component, ElementRef, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../core/auth.service';
import { copyText, hashLink, timeOf } from '../core/links';
import { ProgressStore } from '../core/progress.store';
import { SessionService } from '../core/session.service';
import { TeamStore } from '../core/team.store';

@Component({
  selector: 'app-account-bar',
  host: {
    '(document:click)': 'outside($event)',
    '(keydown.escape)': 'open.set(false)',
  },
  imports: [TranslocoPipe],
  template: `
    <div class="account">
      @if (auth.user(); as name) {
        <button
          type="button"
          class="who"
          aria-haspopup="menu"
          [attr.aria-expanded]="open()"
          (click)="open.set(!open())"
        >
          👤 {{ name }} · {{ progress.mapCount() }} {{ 'progress' | transloco }} ▾
        </button>
        @if (open()) {
          <div class="menu" role="menu">
            <button type="button" role="menuitem" (click)="pick(invite)">
              {{ 'createInvite' | transloco }}
            </button>
            <button type="button" role="menuitem" (click)="pick(openTeam)">
              {{ 'team' | transloco }}
            </button>
            <button type="button" role="menuitem" (click)="pick(openPassword)">
              {{ 'passwordMenu' | transloco }}
            </button>
            @if (auth.passkeysAvailable()) {
              <button type="button" role="menuitem" (click)="pick(openPasskeys)">
                {{ 'passkeys' | transloco }}
              </button>
            }
            @if (auth.isAdmin()) {
              <button type="button" role="menuitem" (click)="pick(openAdmin)">
                {{ 'adminMenu' | transloco }}
              </button>
            }
            <button type="button" role="menuitem" class="danger" (click)="pick(openDelete)">
              {{ 'deleteAccount' | transloco }}
            </button>
            <button type="button" role="menuitem" (click)="pick(logout)">
              {{ 'logout' | transloco }}
            </button>
          </div>
        }
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
      position: relative;
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
    }
    .who {
      width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
      font-size: 13px;
    }
    .menu {
      position: absolute;
      z-index: 10;
      left: 0;
      right: 0;
      top: calc(100% + 4px);
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel);
    }
    .menu button {
      text-align: left;
      border: 0;
      padding: 6px 9px;
    }
    .menu button:hover,
    .menu button:focus-visible {
      background: var(--bg);
    }
    .menu button.danger {
      color: #ff7b72;
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
  protected readonly team = inject(TeamStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly link = signal<{ url: string; until: string } | null>(null);
  protected readonly copied = signal(false);
  protected readonly open = signal(false);

  protected readonly invite = (): Promise<void> => this.createInvite();
  protected readonly openTeam = (): void => this.team.dialogOpen.set(true);
  protected readonly openPassword = (): void => this.auth.accountOpen.set(true);
  protected readonly openPasskeys = (): void => this.auth.passkeysOpen.set(true);
  protected readonly openAdmin = (): void => this.auth.adminOpen.set(true);
  protected readonly openDelete = (): void => this.auth.deleteOpen.set(true);
  protected readonly logout = (): Promise<void> => this.session.logout();

  /** Closes the menu, then runs the chosen entry. */
  protected pick(action: () => unknown): void {
    this.open.set(false);
    void action();
  }

  private async createInvite(): Promise<void> {
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

  protected outside(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  protected async copy(url: string): Promise<void> {
    this.copied.set(await copyText(url));
  }
}
