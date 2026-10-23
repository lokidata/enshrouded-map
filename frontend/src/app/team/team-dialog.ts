import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormField, form, maxLength, required, submit } from '@angular/forms/signals';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthService, errorCode } from '../core/auth.service';
import { copyText, hashLink, timeOf } from '../core/links';
import { Player, TeamStore } from '../core/team.store';

/** Create, join, rename and leave the team; any member adds and removes players, the owner renames or disbands. */
@Component({
  selector: 'app-team-dialog',
  imports: [FormField, TranslocoPipe],
  templateUrl: './team-dialog.html',
  styleUrl: '../auth/auth-dialog.css',
})
export class TeamDialog {
  protected readonly store = inject(TeamStore);
  protected readonly auth = inject(AuthService);
  private readonly transloco = inject(TranslocoService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly model = signal({ name: '' });
  protected readonly nameForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, 40);
  });
  protected readonly error = signal('');
  protected readonly players = signal<Player[]>([]); // in no team: the owner can add them
  protected readonly picked = signal(0);
  protected readonly link = signal<{ url: string; until: string } | null>(null);
  protected readonly copied = signal(false);

  constructor() {
    effect(() => {
      const open = this.store.dialogOpen();
      const el = this.dialog().nativeElement;
      if (open && !el.open) {
        el.showModal();
        this.error.set('');
        this.link.set(null);
        this.model.set({ name: this.store.team()?.name ?? '' });
        void this.loadPlayers();
      }
      if (!open && el.open) el.close();
    });
  }

  protected close(): void {
    this.store.dialogOpen.set(false);
  }

  /** Runs a team action and shows the API's error code, if any. */
  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set('');
    try {
      await action();
    } catch (err) {
      this.error.set(errorCode(err));
    }
  }

  protected save(event: Event): void {
    event.preventDefault();
    void submit(this.nameForm, () =>
      this.run(async () => {
        const name = this.model().name;
        await (this.store.team() ? this.store.rename(name) : this.store.create(name));
        await this.loadPlayers();
      }),
    );
  }

  private async loadPlayers(): Promise<void> {
    let list: Player[] = [];
    if (this.store.team()) {
      try {
        list = await this.store.available();
      } catch {
        // the list stays empty
      }
    }
    this.players.set(list);
    this.picked.set(list[0]?.id ?? 0);
  }

  protected pick(event: Event): void {
    this.picked.set(Number((event.target as HTMLSelectElement).value));
  }

  protected add(): Promise<void> {
    return this.run(async () => {
      await this.store.add(this.picked());
      await this.loadPlayers();
    });
  }

  protected invite(): Promise<void> {
    this.copied.set(false);
    return this.run(async () => {
      const { token, expires_at } = await this.store.invite();
      this.link.set({ url: hashLink('invite', token), until: timeOf(expires_at) });
    });
  }

  protected async copy(url: string): Promise<void> {
    this.copied.set(await copyText(url));
  }

  protected remove(id: number, name: string): Promise<void> | void {
    if (confirm(this.transloco.translate('teamRemoveAsk', { name })))
      return this.run(() => this.store.remove(id));
  }

  protected leave(): Promise<void> | void {
    if (confirm(this.transloco.translate('teamLeaveAsk')))
      return this.run(() => this.afterExit(this.store.leave()));
  }

  protected dissolve(): Promise<void> | void {
    if (confirm(this.transloco.translate('teamDissolveAsk')))
      return this.run(() => this.afterExit(this.store.dissolve()));
  }

  private async afterExit(done: Promise<void>): Promise<void> {
    await done;
    this.players.set([]);
    this.link.set(null);
    this.model.set({ name: '' });
  }
}
