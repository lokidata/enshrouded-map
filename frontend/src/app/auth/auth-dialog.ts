import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormField, form, maxLength, pattern, required, submit } from '@angular/forms/signals';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, errorCode } from '../core/auth.service';
import { SessionService } from '../core/session.service';

@Component({
  selector: 'app-auth-dialog',
  imports: [FormField, TranslocoPipe],
  templateUrl: './auth-dialog.html',
  styleUrl: './auth-dialog.css',
})
export class AuthDialog {
  protected readonly auth = inject(AuthService);
  private readonly session = inject(SessionService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly model = signal({ username: '', password: '', again: '', setupToken: '' });
  protected readonly credentials = form(this.model, (path) => {
    required(path.username, { when: () => this.auth.dialog() !== 'reset' });
    required(path.password);
    maxLength(path.username, 32);
    maxLength(path.password, 128);
    maxLength(path.again, 128);
    required(path.again, { when: () => this.auth.dialog() !== 'login' });
    const isSetup = () => this.auth.dialog() === 'setup';
    required(path.setupToken, { when: isSetup });
    pattern(path.setupToken, /\S/, { when: isSetup }); // not just spaces: the value is trimmed when sent
  });
  protected readonly error = signal('');
  protected readonly showPassword = signal(false);

  constructor() {
    effect(() => {
      const mode = this.auth.dialog();
      const el = this.dialog().nativeElement;
      if (mode && !el.open) el.showModal();
      if (!mode && el.open) el.close();
      this.error.set('');
      this.showPassword.set(false);
    });
  }

  /** Without an account there is nothing else to see: the dialog cannot be dismissed. */
  protected keepOpen(event: Event): void {
    if (!this.auth.user()) event.preventDefault();
  }

  protected close(): void {
    this.auth.dialog.set(null);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    void submit(this.credentials, async () => {
      const mode = this.auth.dialog() ?? 'login';
      const { username, password, again, setupToken } = this.model();
      if (mode !== 'login' && password !== again) return this.error.set('mismatch');
      try {
        await this.session.authenticate(mode, {
          username: username.trim(),
          password,
          ...(mode === 'setup' ? { setup_token: setupToken.trim() } : {}),
        });
        this.model.update((m) => ({ ...m, password: '', again: '', setupToken: '' }));
        this.close();
      } catch (err) {
        this.error.set(errorCode(err));
      }
    });
  }
}
