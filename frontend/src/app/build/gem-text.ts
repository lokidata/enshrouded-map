import { Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { GemPart } from '../core/gems.logic';

/** A gem's description with the values of its level written in it; "…" where the data has none. */
@Component({
  selector: 'app-gem-text',
  imports: [TranslocoPipe],
  template: `@for (p of parts(); track $index) {
    @switch (p.kind) {
      @case ('value') {
        <b
          class="val"
          [class.est]="p.estimate"
          [title]="p.estimate ? ('buildGemTip' | transloco) : ''"
          >{{ p.text }}</b
        >
      }
      @case ('unknown') {
        <span class="unk" [title]="'gemUnknownValue' | transloco">…</span>
      }
      @default {
        {{ p.text }}
      }
    }
  }`,
  styles: `
    .val {
      font-weight: normal;
      color: var(--gold);
      white-space: nowrap;
    }
    .val.est {
      border-bottom: 1px dotted var(--gold-dim);
    }
    .unk {
      color: var(--muted);
    }
  `,
})
export class GemText {
  readonly parts = input.required<readonly GemPart[]>();
}
