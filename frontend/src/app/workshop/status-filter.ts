import { Component, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

export type Status = 'all' | 'known' | 'unknown';
export const STATUSES: readonly Status[] = ['all', 'known', 'unknown'];

/** All / Discovered / Not discovered, on one line: shared by the recipe, item, building and station lists. */
@Component({
  selector: 'app-status-filter',
  imports: [TranslocoPipe],
  template: `
    <div class="status" role="group" [attr.aria-label]="'wsStatus' | transloco">
      @for (s of statuses; track s) {
        <button
          type="button"
          class="pill"
          [attr.aria-pressed]="value() === s"
          (click)="value.set(s)"
        >
          {{ 'wsStatus_' + s | transloco }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin: 8px 0;
    }
    .status {
      display: flex;
      gap: 4px;
    }
    .status .pill {
      flex: 1 1 auto;
      min-width: 0;
      padding: 5px 6px;
      font-size: 13px;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
  `,
})
export class StatusFilter {
  protected readonly statuses = STATUSES;
  readonly value = model<Status>('all');
}
