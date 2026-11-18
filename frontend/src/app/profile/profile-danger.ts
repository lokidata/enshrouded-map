import { Component, inject, signal } from '@angular/core';
import { FormField, form, maxLength, required, submit } from '@angular/forms/signals';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, errorCode } from '../core/auth.service';
import { SessionService } from '../core/session.service';

/** Erases the player's own account and everything saved with it, after asking for the password. */
@Component({
  selector: 'app-profile-danger',
  imports: [FormField, TranslocoPipe],
  template: `
    <h3>{{ 'deleteAccount' | transloco }}</h3>
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
        <button type="submit" class="danger">{{ 'deleteConfirm' | transloco }}</button>
      </div>
    </form>
  `,
  styleUrls: ['../auth/auth-dialog.css', './profile.css'],
})
export class ProfileDanger {
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionService);

  protected readonly model = signal({ password: '' });
  protected readonly passwordForm = form(this.model, (path) => {
    required(path.password);
    maxLength(path.password, 128);
  });
  protected readonly error = signal('');

  protected remove(event: Event): void {
    event.preventDefault();
    void submit(this.passwordForm, async () => {
      try {
        await this.auth.deleteAccount(this.model().password);
        this.session.forget();
      } catch (err) {
        this.error.set(errorCode(err));
      }
    });
  }
}
