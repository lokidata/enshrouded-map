import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormField, form, maxLength, required, submit } from '@angular/forms/signals';
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

  protected readonly model = signal({ username: '', password: '', setupToken: '' });
  protected readonly credentials = form(this.model, (path) => {
    required(path.username);
    required(path.password);
    maxLength(path.username, 32);
    maxLength(path.password, 128);
    required(path.setupToken, { when: () => this.auth.dialog() === 'setup' });
  });
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      const mode = this.auth.dialog();
      const el = this.dialog().nativeElement;
      if (mode && !el.open) el.showModal();
      if (!mode && el.open) el.close();
      this.error.set('');
    });
  }

  /** The very first account cannot be skipped. */
  protected keepOpen(event: Event): void {
    if (this.auth.dialog() === 'setup') event.preventDefault();
  }

  protected close(): void {
    this.auth.dialog.set(null);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    void submit(this.credentials, async () => {
      const mode = this.auth.dialog() ?? 'login';
      const { username, password, setupToken } = this.model();
      try {
        await this.session.authenticate(mode, {
          username: username.trim(),
          password,
          ...(mode === 'setup' ? { setup_token: setupToken.trim() } : {}),
        });
        this.model.update((m) => ({ ...m, password: '', setupToken: '' }));
        this.close();
      } catch (err) {
        this.error.set(errorCode(err));
      }
    });
  }
}
