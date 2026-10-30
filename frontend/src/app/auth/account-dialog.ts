import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormField, form, maxLength, required, submit } from '@angular/forms/signals';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, errorCode } from '../core/auth.service';

/** Change my password. */
@Component({
  selector: 'app-account-dialog',
  imports: [FormField, TranslocoPipe],
  templateUrl: './account-dialog.html',
  styleUrl: './auth-dialog.css',
})
export class AccountDialog {
  protected readonly auth = inject(AuthService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

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
    effect(() => {
      const open = this.auth.accountOpen();
      const el = this.dialog().nativeElement;
      if (open && !el.open) {
        el.showModal();
        this.reset();
      }
      if (!open && el.open) el.close();
    });
  }

  protected close(): void {
    this.auth.accountOpen.set(false);
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

  private reset(): void {
    this.model.set({ current: '', next: '', again: '' });
    this.error.set('');
    this.changed.set(false);
    this.showPassword.set(false);
  }
}
