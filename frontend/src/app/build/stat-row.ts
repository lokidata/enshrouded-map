import { Component, computed, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** One line of a breakdown: an i18n key (Character, Equipment, Flame level, a skill attribute...) and the value as text. */
export interface TipPart {
  key: string;
  text: string;
}

let nextId = 0;

/**
 * A row of the Attributes screen (`<div app-stat-row>` inside a `dl`): label, value and, on hover or focus, the game's
 * tooltip: the total, where it comes from and the game's description. Escape closes it; the pointer can enter it.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- a div keeps the dl > div > dt + dd structure valid
  selector: 'div[app-stat-row]',
  imports: [TranslocoPipe],
  template: `
    <dt>{{ label() ?? (labelKey() | transloco) }}</dt>
    <dd [attr.tabindex]="hasTip() ? 0 : null" [attr.aria-describedby]="open() ? id : null">
      @if (estimate()) {
        <span class="est" [title]="estTip() | transloco">{{ 'buildEstimate' | transloco }}</span>
      }
      {{ value() }}
      @if (open() && hasTip()) {
        <span class="tip" role="tooltip" [id]="id">
          <span class="head">
            <span>{{ label() ?? (labelKey() | transloco) }}</span>
            <span>{{ value() }}</span>
          </span>
          @for (p of parts(); track p.key) {
            <span class="part">
              <span>{{ p.key | transloco }}</span>
              <span [class.bonus]="p.key !== 'tipPlayer'">{{ p.text }}</span>
            </span>
          }
          @if (desc()) {
            <span class="desc">{{ desc() }}</span>
          }
          @if (estimate()) {
            <span class="desc note">{{ estTip() | transloco }}</span>
          }
        </span>
      }
    </dd>
  `,
  styleUrl: './stat-row.css',
  host: {
    '(mouseenter)': 'open.set(true)',
    '(mouseleave)': 'open.set(false)',
    '(focusin)': 'open.set(true)',
    '(focusout)': 'open.set(false)',
    '(keydown.escape)': 'open.set(false)',
  },
})
export class StatRow {
  readonly label = input<string | null>(null);
  readonly labelKey = input('');
  readonly value = input.required<string>();
  readonly estimate = input(false);
  readonly estTip = input('buildEstimateTip');
  readonly parts = input<TipPart[]>([]);
  readonly desc = input<string | null>(null);

  protected readonly id = `stat-tip-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly hasTip = computed(() => this.parts().length > 0 || !!this.desc());
}
