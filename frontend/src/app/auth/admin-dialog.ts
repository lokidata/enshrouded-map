import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AddonAccess } from '../addon/addon-access';
import { AddonService } from '../core/addon.service';
import { AdminAddon, entryDescription, entryLabel } from '../core/addon.logic';
import { AuthService, errorCode } from '../core/auth.service';
import { LangService } from '../core/lang.service';
import { tabAfterKey } from '../core/tabs';
import { copyText, hashLink, timeOf } from '../core/links';

/** Administrator tools (the first account): reset links and deletion of other players' accounts. */
@Component({
  selector: 'app-admin-dialog',
  imports: [TranslocoPipe, AddonAccess],
  templateUrl: './admin-dialog.html',
  styleUrl: './auth-dialog.css',
})
export class AdminDialog {
  protected readonly auth = inject(AuthService);
  private readonly transloco = inject(TranslocoService);
  private readonly addons = inject(AddonService);
  private readonly http = inject(HttpClient);
  private readonly lang = inject(LangService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly users = signal<{ id: number; username: string }[]>([]);
  protected readonly target = signal(0);
  protected readonly doomed = signal(0); // the account the administrator may delete
  protected readonly deleteError = signal('');
  protected readonly link = signal<{ url: string; until: string } | null>(null);
  protected readonly copied = signal(false);
  protected readonly resetError = signal('');

  /** `accounts`, then one tab per add-on the manifest lists (the site keeps the access lists). */
  protected readonly tab = signal('accounts');
  protected readonly entries = signal<AdminAddon[]>([]);
  protected readonly addonError = signal(false);
  protected readonly tabs = computed(() => ['accounts', ...this.entries().map((e) => e.id)]);
  protected readonly current = computed(() => this.entries().find((e) => e.id === this.active()));
  protected readonly active = computed(() =>
    this.tabs().includes(this.tab()) ? this.tab() : 'accounts',
  );

  protected label(id: string): string {
    const e = this.entries().find((x) => x.id === id);
    return e ? entryLabel(e, this.lang.lang()) : id;
  }

  protected description(e: AdminAddon): string {
    return entryDescription(e, this.lang.lang());
  }

  protected async toggle(e: AdminAddon, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    this.addonError.set(false);
    try {
      const row = await firstValueFrom(
        this.http.put<AdminAddon>(`/api/v1/addons/${e.id}`, { enabled: box.checked }),
      );
      this.entries.update((l) => l.map((x) => (x.id === row.id ? row : x)));
      await this.addons.load(); // top bar and host follow at once
    } catch {
      box.checked = e.enabled;
      this.addonError.set(true);
    }
  }

  private async loadAddons(): Promise<void> {
    try {
      this.entries.set(await firstValueFrom(this.http.get<AdminAddon[]>('/api/v1/addons/admin')));
    } catch {
      this.entries.set([]); // add-ons off: the accounts tab alone
    }
  }

  protected keys(event: KeyboardEvent): void {
    const next = tabAfterKey(this.tabs(), this.active(), event.key);
    if (!next) return;
    event.preventDefault();
    this.tab.set(next);
    setTimeout(() => document.getElementById('admin-tab-' + next)?.focus());
  }

  constructor() {
    effect(() => {
      const open = this.auth.adminOpen();
      const el = this.dialog().nativeElement;
      if (open && !el.open) {
        el.showModal();
        this.tab.set('accounts');
        this.link.set(null);
        this.resetError.set('');
        this.deleteError.set('');
        void this.loadUsers();
        void this.loadAddons();
        this.addonError.set(false);
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
