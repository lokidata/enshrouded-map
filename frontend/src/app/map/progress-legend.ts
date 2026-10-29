import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TeamStore } from '../core/team.store';

const KEY = 'legend';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'closed';
  } catch {
    return true;
  }
}

/** The halo colours of the progress tracking; can be folded, and remembers it. */
@Component({
  selector: 'app-progress-legend',
  imports: [TranslocoPipe],
  template: `
    <div class="box">
      <button
        type="button"
        class="head"
        aria-controls="legend-rows"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        {{ 'legendTitle' | transloco }} {{ open() ? '▾' : '▸' }}
      </button>
      @if (open()) {
        <ul id="legend-rows">
          @for (row of rows(); track row.key) {
            <li>
              <i [class]="row.key"></i>
              {{ 'legend_' + row.key | transloco }}
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      right: 10px;
      bottom: 42px;
      z-index: 1000;
    }
    .box {
      background: #000b;
      border-radius: 6px;
      color: var(--muted);
      font-size: 12px;
      min-width: 150px;
    }
    .head {
      width: 100%;
      padding: 5px 10px;
      border: 0;
      background: none;
      color: var(--text);
      font-size: 12px;
      text-align: left;
      cursor: pointer;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0 10px 8px;
      display: grid;
      gap: 4px;
    }
    li {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    i {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #ccc;
      border: 2px solid var(--halo);
      box-shadow: 0 0 4px var(--halo);
      flex-shrink: 0;
    }
    i.alone {
      --halo: #3b82f6;
    }
    i.mine {
      --halo: #b36cf0;
    }
    i.others {
      --halo: #ffa53a;
    }
    i.all {
      --halo: #6fe06f;
    }
  `,
})
export class ProgressLegend {
  private readonly team = inject(TeamStore);

  protected readonly open = signal(read());
  /** Only the colours this team can show: blue and orange need 2 members, violet needs 3. */
  protected readonly rows = computed(() => {
    const n = this.team.total();
    return [
      ...(n >= 2 ? [{ key: 'alone' }] : []),
      ...(n >= 3 ? [{ key: 'mine' }] : []),
      ...(n >= 2 ? [{ key: 'others' }] : []),
      { key: 'all' },
    ];
  });

  protected toggle(): void {
    this.open.update((open) => !open);
    try {
      localStorage.setItem(KEY, this.open() ? 'open' : 'closed');
    } catch {
      // private window: the choice just is not remembered
    }
  }
}
