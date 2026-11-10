import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { errorCode } from '../core/auth.service';
import { Character, CharacterStore } from '../core/character.store';
import { SessionService } from '../core/session.service';

/** The player's character profiles: follow one, rename, delete, add. */
@Component({
  selector: 'app-character-dialog',
  imports: [TranslocoPipe],
  template: `
    <dialog #dialog aria-labelledby="characters-title" (close)="store.dialogOpen.set(false)">
      <button
        type="button"
        class="x"
        [attr.aria-label]="'close' | transloco"
        (click)="store.dialogOpen.set(false)"
      >
        ✕
      </button>
      <h2 id="characters-title">{{ 'characters' | transloco }}</h2>
      <p class="hint">{{ 'characterHint' | transloco }}</p>
      <ul class="members">
        @for (c of store.list(); track c.id) {
          <li>
            <input
              type="text"
              maxlength="40"
              [value]="c.name"
              [attr.aria-label]="'characterName' | transloco"
              (change)="rename(c, $any($event.target))"
            />
            @if (c.active) {
              <span class="hint">{{ 'characterCurrent' | transloco }}</span>
            } @else {
              <button type="button" (click)="follow(c)">
                {{ 'characterActivate' | transloco }}
              </button>
            }
            <button
              type="button"
              class="danger"
              [disabled]="store.list().length < 2"
              [attr.aria-label]="'characterDelete' | transloco"
              (click)="remove(c)"
            >
              ✕
            </button>
          </li>
        }
      </ul>
      <form (submit)="add($event)">
        <label>
          {{ 'characterNew' | transloco }}
          <input
            type="text"
            maxlength="40"
            autocomplete="off"
            [value]="name()"
            (input)="name.set($any($event.target).value)"
          />
        </label>
        <div class="error" role="alert">{{ error() ? ('errors.' + error() | transloco) : '' }}</div>
        <div class="actions start">
          <button type="submit" class="primary" [disabled]="!name().trim()">
            {{ 'characterAdd' | transloco }}
          </button>
        </div>
      </form>
      <div class="footer">
        <span></span>
        <button type="button" (click)="store.dialogOpen.set(false)">
          {{ 'close' | transloco }}
        </button>
      </div>
    </dialog>
  `,
  styleUrl: '../auth/auth-dialog.css',
})
export class CharacterDialog {
  protected readonly store = inject(CharacterStore);
  private readonly session = inject(SessionService);
  private readonly transloco = inject(TranslocoService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly name = signal('');
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      const open = this.store.dialogOpen();
      const el = this.dialog().nativeElement;
      if (open && !el.open) {
        this.name.set('');
        this.error.set('');
        el.showModal();
      }
      if (!open && el.open) el.close();
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set('');
    try {
      await action();
    } catch (err) {
      this.error.set(errorCode(err));
    }
  }

  protected follow(c: Character): Promise<void> {
    return this.run(() => this.session.selectCharacter(c.id));
  }

  protected async rename(c: Character, input: HTMLInputElement): Promise<void> {
    const value = input.value.trim();
    if (!value || value === c.name) {
      input.value = c.name;
      return;
    }
    await this.run(() => this.store.rename(c.id, value));
    if (this.error()) input.value = c.name;
  }

  protected async remove(c: Character): Promise<void> {
    if (!confirm(this.transloco.translate('characterDeleteAsk', { name: c.name }))) return;
    await this.run(() => this.session.removeCharacter(c.id));
  }

  protected async add(event: Event): Promise<void> {
    event.preventDefault();
    const value = this.name().trim();
    if (!value) return;
    await this.run(() => this.session.addCharacter(value));
    if (!this.error()) this.name.set('');
  }
}
