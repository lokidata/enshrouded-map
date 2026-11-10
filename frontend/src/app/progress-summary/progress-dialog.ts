import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, errorCode } from '../core/auth.service';
import { CraftService } from '../core/craft.service';
import { LoreService } from '../core/lore.service';
import { MapDataService } from '../core/map-data.service';
import { ProgressStore } from '../core/progress.store';
import { TeamStore } from '../core/team.store';
import { FogStore } from '../save-import/fog.store';
import { summarize } from './progress-summary.logic';

/** What the player has done so far, by category. */
@Component({
  selector: 'app-progress-dialog',
  imports: [TranslocoPipe],
  template: `
    <dialog #dialog aria-labelledby="progress-title" (close)="auth.progressOpen.set(false)">
      <button
        type="button"
        class="x"
        [attr.aria-label]="'close' | transloco"
        (click)="auth.progressOpen.set(false)"
      >
        ✕
      </button>
      <h2 id="progress-title">{{ 'progressTitle' | transloco }}</h2>
      <p class="hint">{{ 'progressHint' | transloco }}</p>
      <ul class="members">
        @for (l of lines(); track l.kind) {
          <li>
            <label [for]="'pg-' + l.kind">
              {{ (l.kind === 'fog' ? 'fogLayer' : 'saveImportKind_' + l.kind) | transloco }}
            </label>
            @if (l.total === null) {
              <span class="hint">{{ 'progressUnknown' | transloco }}</span>
            } @else {
              <progress [id]="'pg-' + l.kind" [value]="l.done" [max]="l.total"></progress>
              <span class="hint">
                {{ l.kind === 'fog' ? l.done + ' %' : l.done + ' / ' + l.total }}
              </span>
            }
          </li>
        }
      </ul>
      @if (fog.share() !== null && team.team()) {
        <fieldset class="target share">
          <legend>{{ 'saveImportTeam' | transloco }}</legend>
          <label>
            <input
              type="checkbox"
              [checked]="fog.shared()"
              (change)="shareFog($any($event.target).checked)"
            />
            {{ 'fogShareMine' | transloco }}
          </label>
          <p class="hint">{{ 'fogShareHint' | transloco }}</p>
          @if (fog.team().length > 0) {
            <p class="hint">{{ 'fogShareInfo' | transloco: { n: fog.team().length } }}</p>
          }
          <div class="error" role="alert">
            {{ error() ? ('errors.' + error() | transloco) : '' }}
          </div>
        </fieldset>
      }
      <div class="footer">
        <span></span>
        <button type="button" (click)="auth.progressOpen.set(false)">
          {{ 'close' | transloco }}
        </button>
      </div>
    </dialog>
  `,
  styleUrl: '../auth/auth-dialog.css',
  styles: `
    progress {
      width: 100%;
      accent-color: var(--accent);
    }
    li {
      display: grid;
      gap: 4px;
    }
  `,
})
export class ProgressDialog {
  protected readonly auth = inject(AuthService);
  private readonly craft = inject(CraftService);
  private readonly lore = inject(LoreService);
  private readonly mapData = inject(MapDataService);
  private readonly progress = inject(ProgressStore);
  protected readonly fog = inject(FogStore);
  protected readonly team = inject(TeamStore);
  protected readonly error = signal('');
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly lines = computed(() =>
    summarize(
      this.progress.done(),
      this.craft.data(),
      this.lore.data(),
      this.mapData.data?.markers ?? [],
      this.fog.share(),
    ),
  );

  protected async shareFog(on: boolean): Promise<void> {
    this.error.set('');
    try {
      await this.fog.setShared(on);
    } catch (err) {
      this.error.set(errorCode(err));
    }
  }

  constructor() {
    effect(() => {
      const open = this.auth.progressOpen();
      const el = this.dialog().nativeElement;
      if (open && !el.open) el.showModal();
      if (!open && el.open) el.close();
    });
  }
}
