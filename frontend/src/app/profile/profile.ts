import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormField, form, maxLength, required, submit } from '@angular/forms/signals';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, errorCode } from '../core/auth.service';
import { LANGUAGES } from '../core/lang';
import { tabAfterKey } from '../core/tabs';
import { LangService } from '../core/lang.service';
import { LAYOUTS, LayoutPref, LayoutService } from '../core/layout.service';
import { ProfileDanger } from './profile-danger';
import { ProfilePasskeys } from './profile-passkeys';

type Tab = 'account' | 'passkeys' | 'customization' | 'danger';

/** « Profil » / « Profile »: what is personal to the account, one tab per kind of setting. */
@Component({
  selector: 'app-profile',
  imports: [FormField, TranslocoPipe, ProfilePasskeys, ProfileDanger],
  template: `
    <dialog
      #dialog
      class="wide"
      aria-labelledby="profile-title"
      (close)="auth.profileOpen.set(false)"
    >
      @if (auth.profileOpen()) {
        <button
          type="button"
          class="x"
          [attr.aria-label]="'close' | transloco"
          (click)="auth.profileOpen.set(false)"
        >
          ✕
        </button>
        <h2 id="profile-title">{{ 'profile' | transloco }} · {{ auth.user() }}</h2>
        <div class="tabs" role="tablist" [attr.aria-label]="'profile' | transloco">
          @for (t of tabs(); track t) {
            <button
              type="button"
              role="tab"
              [id]="'profile-tab-' + t"
              [class.active]="active() === t"
              [attr.aria-selected]="active() === t"
              [attr.aria-controls]="'profile-panel'"
              [attr.tabindex]="active() === t ? 0 : -1"
              (click)="tab.set(t)"
              (keydown)="keys($event)"
            >
              {{ 'profileTab_' + t | transloco }}
            </button>
          }
        </div>
        <div
          class="panel"
          role="tabpanel"
          id="profile-panel"
          [attr.aria-labelledby]="'profile-tab-' + active()"
        >
          @switch (active()) {
            @case ('account') {
              <div class="profile">
                <label>
                  {{ 'username' | transloco }}
                  <input [value]="auth.user()" readonly />
                </label>
                <label>
                  {{ 'language' | transloco }}
                  <select (change)="lang.set($any($event.target).value)">
                    @for (code of languages; track code) {
                      <option [value]="code" [selected]="lang.lang() === code">
                        {{ 'language_' + code | transloco }}
                      </option>
                    }
                  </select>
                </label>
                <form (submit)="change($event)">
                  <h3 class="gap">{{ 'changePassword' | transloco }}</h3>
                  <label>
                    {{ 'currentPassword' | transloco }}
                    <input
                      [type]="showPassword() ? 'text' : 'password'"
                      [formField]="passwords.current"
                      autocomplete="current-password"
                    />
                  </label>
                  <div class="pw">
                    <label>
                      {{ 'newPassword' | transloco }}
                      <input
                        [type]="showPassword() ? 'text' : 'password'"
                        [formField]="passwords.next"
                        autocomplete="new-password"
                      />
                    </label>
                    <button
                      type="button"
                      [attr.aria-pressed]="showPassword()"
                      [attr.aria-label]="
                        (showPassword() ? 'hidePassword' : 'showPassword') | transloco
                      "
                      (click)="showPassword.set(!showPassword())"
                    >
                      {{ showPassword() ? '🙈' : '👁' }}
                    </button>
                  </div>
                  <label>
                    {{ 'confirmPassword' | transloco }}
                    <input
                      [type]="showPassword() ? 'text' : 'password'"
                      [formField]="passwords.again"
                      autocomplete="new-password"
                    />
                  </label>
                  <div class="error" role="alert">
                    {{ error() ? ('errors.' + error() | transloco) : '' }}
                  </div>
                  @if (changed()) {
                    <div class="ok" role="status">{{ 'passwordChanged' | transloco }}</div>
                  }
                  <div class="actions">
                    <button type="submit" class="primary">
                      {{ 'savePassword' | transloco }}
                    </button>
                  </div>
                </form>
              </div>
            }
            @case ('passkeys') {
              <div class="profile"><app-profile-passkeys /></div>
            }
            @case ('customization') {
              <div class="profile">
                <label>
                  {{ 'layout' | transloco }}
                  <select (change)="layout.set($any($event.target).value)">
                    @for (l of layouts; track l) {
                      <option [value]="l" [selected]="layout.pref() === l">
                        {{ 'layout_' + l | transloco }}
                      </option>
                    }
                  </select>
                </label>
                <p class="hint">{{ 'layoutDevice' | transloco }}</p>
              </div>
            }
            @case ('danger') {
              <div class="profile"><app-profile-danger /></div>
            }
          }
        </div>
      }
    </dialog>
  `,
  styleUrls: ['../auth/auth-dialog.css', './profile.css'],
})
export class Profile {
  protected readonly auth = inject(AuthService);
  protected readonly lang = inject(LangService);
  protected readonly layout = inject(LayoutService);
  protected readonly languages = LANGUAGES;
  protected readonly layouts: readonly LayoutPref[] = LAYOUTS;

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly tab = signal<Tab>('account');
  protected readonly tabs = computed<Tab[]>(() =>
    this.auth.passkeysAvailable()
      ? ['account', 'passkeys', 'customization', 'danger']
      : ['account', 'customization', 'danger'],
  );
  /** The open tab; the first one when it has gone (Passkeys when they stop being available). */
  protected readonly active = computed(() =>
    this.tabs().includes(this.tab()) ? this.tab() : 'account',
  );

  protected keys(event: KeyboardEvent): void {
    const next = tabAfterKey(this.tabs(), this.active(), event.key);
    if (!next) return;
    event.preventDefault();
    this.tab.set(next);
    setTimeout(() => document.getElementById('profile-tab-' + next)?.focus());
  }

  protected readonly model = signal({ current: '', next: '', again: '' });
  protected readonly passwords = form(this.model, (path) => {
    required(path.current);
    required(path.next);
    required(path.again);
    maxLength(path.current, 128);
    maxLength(path.next, 128);
    maxLength(path.again, 128);
  });
  protected readonly showPassword = signal(false);
  protected readonly error = signal('');
  protected readonly changed = signal(false);

  constructor() {
    // the session ended (logout, expiry, deleted account): the popup must not stay over the login
    effect(() => {
      if (!this.auth.user()) this.auth.profileOpen.set(false);
    });
    effect(() => {
      const open = this.auth.profileOpen();
      const el = this.dialog().nativeElement;
      if (open && !el.open) {
        this.tab.set('account');
        this.model.set({ current: '', next: '', again: '' });
        this.error.set('');
        this.changed.set(false);
        this.showPassword.set(false);
        el.showModal();
      }
      if (!open && el.open) el.close();
    });
  }

  protected change(event: Event): void {
    event.preventDefault();
    void submit(this.passwords, async () => {
      this.error.set('');
      this.changed.set(false);
      const { current, next, again } = this.model();
      if (next !== again) return this.error.set('mismatch');
      try {
        await this.auth.changePassword(current, next);
        this.model.set({ current: '', next: '', again: '' });
        this.changed.set(true);
      } catch (err) {
        this.error.set(errorCode(err));
      }
    });
  }
}
