import { Component, inject, input } from '@angular/core';
import { CraftService } from '../core/craft.service';

/** An item with its picture and, when given, a quantity. */
@Component({
  selector: 'app-item-chip',
  template: `
    @if (craft.icon(item()); as icon) {
      <img [src]="icon" alt="" width="24" height="24" loading="lazy" />
    }
    <span>{{ craft.itemName(item()) }}</span>
    @if (count() !== null) {
      <b>× {{ count() }}</b>
    }
  `,
  host: { class: 'chip' },
  styleUrl: './workshop.css',
})
export class ItemChip {
  protected readonly craft = inject(CraftService);
  readonly item = input.required<string>();
  readonly count = input<number | null>(null);
}
