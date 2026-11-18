import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormField, form, maxLength, required, submit } from '@angular/forms/signals';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthService, Passkey, errorCode } from '../core/auth.service';

/** The player's passkeys: add one from this device, or delete the ones they no longer use. */
@Component({
  selector: 'app-profile-passkeys',
  imports: [FormField, TranslocoPipe, DatePipe],
  template: `
    <h3>{{ 'passkeys' | transloco }}</h3>
    <p class="hint">{{ 'passkeyHint' | transloco }}</p>
    @if (list().length) {
      <ul>
        @for (p of list(); track p.id) {
          <li>
            <span>
              {{ p.name }}
              <small class="hint">
                ·
                {{
                  p.last_used_at
                    ? ('passkeyUsed' | transloco: { date: (p.last_used_at + 'Z' | date: 'short') })
                    : ('passkeyNever' | transloco)
                }}
              </small>
            </span>
            <button
              type="button"
              class="danger"
              [attr.aria-label]="'delete' | transloco"
              (click)="remove(p)"
            >
              ✕
            </button>
          </li>
        }
      </ul>
    } @else {
      <p class="hint">{{ 'passkeyNone' | transloco }}</p>
    }
    <form (submit)="add($event)">
      <label>
        {{ 'passkeyName' | transloco }}
        <input [formField]="nameForm.name" autocomplete="off" />
      </label>
      <div class="error" role="alert">{{ error() ? ('errors.' + error() | transloco) : '' }}</div>
      @if (added()) {
        <div class="ok" role="status">{{ 'passkeyAdded' | transloco }}</div>
      }
      <div class="actions">
        <button type="submit" class="primary">
          {{ 'passkeyAdd' | transloco }}
        </button>
      </div>
    </form>
  `,
  styleUrls: ['../auth/auth-dialog.css', './profile.css'],
})
export class ProfilePasskeys {
  private readonly auth = inject(AuthService);
  private readonly transloco = inject(TranslocoService);

  protected readonly list = signal<Passkey[]>([]);
  protected readonly model = signal({ name: '' });
  protected readonly nameForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, 40);
  });
  protected readonly error = signal('');
  protected readonly added = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.list.set(await this.auth.listPasskeys());
    } catch (err) {
      this.error.set(errorCode(err));
    }
  }

  protected add(event: Event): void {
    event.preventDefault();
    void submit(this.nameForm, async () => {
      this.error.set('');
      this.added.set(false);
      try {
        await this.auth.addPasskey(this.model().name.trim());
        this.model.set({ name: '' });
        this.added.set(true);
        await this.load();
      } catch (err) {
        const code = errorCode(err);
        this.error.set(code === 'cancelled' ? '' : code);
      }
    });
  }

  protected async remove(p: Passkey): Promise<void> {
    if (!confirm(this.transloco.translate('passkeyDeleteAsk', { name: p.name }))) return;
    try {
      await this.auth.deletePasskey(p.id);
      await this.load();
    } catch (err) {
      this.error.set(errorCode(err));
    }
  }
}
