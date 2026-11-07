import { Component, inject, input } from '@angular/core';
import { CraftService } from '../core/craft.service';
import { WorkshopNav } from './workshop-nav';

/** An item with its picture and, when given, a quantity; opens the item's page. */
@Component({
  selector: 'app-item-chip',
  template: `
    <button type="button" class="chip-link" (click)="nav.openItem(item())">
      @if (craft.icon(item()); as icon) {
        <img [src]="icon" alt="" width="24" height="24" loading="lazy" />
      }
      <span>{{ craft.itemName(item()) }}</span>
    </button>
    @if (count() !== null) {
      <b>× {{ count() }}</b>
    }
  `,
  host: { class: 'chip' },
})
export class ItemChip {
  protected readonly craft = inject(CraftService);
  protected readonly nav = inject(WorkshopNav);
  readonly item = input.required<string>();
  readonly count = input<number | null>(null);
}
