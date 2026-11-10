import { Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../core/auth.service';
import { CraftService } from '../core/craft.service';
import { LoreService } from '../core/lore.service';
import { MapDataService } from '../core/map-data.service';
import { ProgressStore } from '../core/progress.store';
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
  private readonly fog = inject(FogStore);
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

  constructor() {
    effect(() => {
      const open = this.auth.progressOpen();
      const el = this.dialog().nativeElement;
      if (open && !el.open) el.showModal();
      if (!open && el.open) el.close();
    });
  }
}
