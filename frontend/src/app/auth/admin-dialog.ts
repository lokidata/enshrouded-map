import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthService, errorCode } from '../core/auth.service';
import { copyText, hashLink, timeOf } from '../core/links';

/** Administrator tools (the first account): reset links and deletion of other players' accounts. */
@Component({
  selector: 'app-admin-dialog',
  imports: [TranslocoPipe],
  templateUrl: './admin-dialog.html',
  styleUrl: './auth-dialog.css',
})
export class AdminDialog {
  protected readonly auth = inject(AuthService);
  private readonly transloco = inject(TranslocoService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly users = signal<{ id: number; username: string }[]>([]);
  protected readonly target = signal(0);
  protected readonly doomed = signal(0); // the account the administrator may delete
  protected readonly deleteError = signal('');
  protected readonly link = signal<{ url: string; until: string } | null>(null);
  protected readonly copied = signal(false);
  protected readonly resetError = signal('');

  constructor() {
    effect(() => {
      const open = this.auth.adminOpen();
      const el = this.dialog().nativeElement;
      if (open && !el.open) {
        el.showModal();
        this.link.set(null);
        this.resetError.set('');
        this.deleteError.set('');
        void this.loadUsers();
      }
      if (!open && el.open) el.close();
    });
  }

  protected close(): void {
    this.auth.adminOpen.set(false);
  }

  protected async generate(): Promise<void> {
    this.resetError.set('');
    this.copied.set(false);
    try {
      const { token, expires_at } = await this.auth.createReset(this.target());
      this.link.set({ url: hashLink('reset', token), until: timeOf(expires_at) });
    } catch (err) {
      this.link.set(null);
      this.resetError.set(errorCode(err));
    }
  }

  protected async copy(url: string): Promise<void> {
    this.copied.set(await copyText(url));
  }

  protected pick(event: Event): void {
    this.target.set(Number((event.target as HTMLSelectElement).value));
    this.link.set(null);
  }

  protected pickDoomed(event: Event): void {
    this.doomed.set(Number((event.target as HTMLSelectElement).value));
  }

  protected async deleteUser(): Promise<void> {
    const name = this.users().find((u) => u.id === this.doomed())?.username ?? '';
    if (!confirm(this.transloco.translate('adminDeleteAsk', { name }))) return;
    this.deleteError.set('');
    try {
      await this.auth.deleteUser(this.doomed());
      this.link.set(null);
      await this.loadUsers();
    } catch (err) {
      this.deleteError.set(errorCode(err));
    }
  }

  private async loadUsers(): Promise<void> {
    try {
      const users = await this.auth.listUsers();
      this.users.set(users);
      this.target.set(users[0]?.id ?? 0);
      this.doomed.set(users[0]?.id ?? 0);
    } catch {
      this.users.set([]);
    }
  }
}
