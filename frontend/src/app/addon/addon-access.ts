import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

export interface AccessRow {
  user_id: number;
  username: string;
  level: 'read' | 'action' | null;
}

/** The administrator's list for one add-on: who may read, who may act. The site keeps the list. */
@Component({
  selector: 'app-addon-access',
  imports: [TranslocoPipe],
  template: `
    <p class="hint">{{ 'addon.accessHint' | transloco }}</p>
    @if (rows().length) {
      <table>
        <thead>
          <tr>
            <th>{{ 'addon.accessUser' | transloco }}</th>
            <th>{{ 'addon.accessLevel' | transloco }}</th>
          </tr>
        </thead>
        <tbody>
          @for (u of rows(); track u.user_id) {
            <tr>
              <td>
                <label [for]="id(u)">{{ u.username }}</label>
              </td>
              <td>
                <select [id]="id(u)" [value]="u.level ?? ''" (change)="set(u, $event)">
                  <option value="">{{ 'addon.levelNone' | transloco }}</option>
                  <option value="read">{{ 'addon.levelRead' | transloco }}</option>
                  <option value="action">{{ 'addon.levelAction' | transloco }}</option>
                </select>
              </td>
            </tr>
          }
        </tbody>
      </table>
    } @else if (!failed()) {
      <p class="hint">{{ 'noOtherUser' | transloco }}</p>
    }
    <div class="error" role="alert">{{ failed() ? ('addon.accessError' | transloco) : '' }}</div>
  `,
  styles: `
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      padding: 5px 4px;
      border-bottom: 1px dotted var(--gold-dim);
      text-align: left;
    }
    th {
      color: var(--gold);
      font: 400 15px/1.2 var(--display-sc);
    }
    select {
      padding: 4px 8px;
      border: 1px solid var(--border);
      border-radius: 3px;
      background: var(--ink);
      color: var(--text);
      font: inherit;
    }
    .hint {
      color: var(--muted);
      font-size: 14px;
    }
    .error {
      min-height: 1.2em;
      color: var(--bad);
      font-size: 14px;
    }
  `,
})
export class AddonAccess {
  private readonly http = inject(HttpClient);
  readonly addon = input.required<string>();
  protected readonly rows = signal<AccessRow[]>([]);
  protected readonly failed = signal(false);

  constructor() {
    effect(() => {
      const addon = this.addon();
      untracked(() => void this.load(addon));
    });
  }

  protected id(u: AccessRow): string {
    return `${this.addon()}-lvl-${u.user_id}`;
  }

  private async load(addon: string): Promise<void> {
    try {
      this.rows.set(
        await firstValueFrom(this.http.get<AccessRow[]>(`/api/v1/addons/${addon}/access`)),
      );
      this.failed.set(false);
    } catch {
      this.rows.set([]);
      this.failed.set(true);
    }
  }

  protected async set(u: AccessRow, event: Event): Promise<void> {
    const sel = event.target as HTMLSelectElement;
    const level = (sel.value || null) as AccessRow['level'];
    try {
      await firstValueFrom(
        this.http.put(`/api/v1/addons/${this.addon()}/access/${u.user_id}`, { level }),
      );
      this.failed.set(false);
      u.level = level;
    } catch {
      this.failed.set(true);
      sel.value = u.level ?? ''; // back to what the site holds
    }
  }
}
