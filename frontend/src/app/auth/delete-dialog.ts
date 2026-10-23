import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormField, form, maxLength, required, submit } from '@angular/forms/signals';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, errorCode } from '../core/auth.service';
import { SessionService } from '../core/session.service';

/** Erases the player's own account and everything saved with it, after asking for the password. */
@Component({
  selector: 'app-delete-dialog',
  imports: [FormField, TranslocoPipe],
  template: `
    <dialog #dialog aria-labelledby="delete-title" (close)="auth.deleteOpen.set(false)">
      <h2 id="delete-title">{{ 'deleteAccount' | transloco }}</h2>
      <p class="warn" role="note">{{ 'deleteWarning' | transloco }}</p>
      <form (submit)="remove($event)">
        <label>
          {{ 'currentPassword' | transloco }}
          <input
            type="password"
            [formField]="passwordForm.password"
            autocomplete="current-password"
          />
        </label>
        <div class="error" role="alert">{{ error() ? ('errors.' + error() | transloco) : '' }}</div>
        <div class="actions">
          <button type="button" (click)="auth.deleteOpen.set(false)">
            {{ 'cancel' | transloco }}
          </button>
          <button type="submit" class="danger">{{ 'deleteConfirm' | transloco }}</button>
        </div>
      </form>
    </dialog>
  `,
  styleUrl: './auth-dialog.css',
})
export class DeleteDialog {
  protected readonly auth = inject(AuthService);
  private readonly session = inject(SessionService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly model = signal({ password: '' });
  protected readonly passwordForm = form(this.model, (path) => {
    required(path.password);
    maxLength(path.password, 128);
  });
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      const open = this.auth.deleteOpen();
      const el = this.dialog().nativeElement;
      if (open && !el.open) {
        this.model.set({ password: '' });
        this.error.set('');
        el.showModal();
      }
      if (!open && el.open) el.close();
    });
  }

  protected remove(event: Event): void {
    event.preventDefault();
    void submit(this.passwordForm, async () => {
      try {
        await this.auth.deleteAccount(this.model().password);
        this.auth.deleteOpen.set(false);
        this.session.forget();
      } catch (err) {
        this.error.set(errorCode(err));
      }
    });
  }
}
