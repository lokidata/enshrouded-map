import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { GEAR_SLOTS, GearItem, SlotKey } from '../core/gear.model';
import { GearService } from '../core/gear.service';
import { PlannerStore } from '../core/planner.store';
import { ViewStore } from '../core/view.store';
import { SlotPicker } from './slot-picker';

/** What the character wears: a grid of slots, and a list of the items that fit the chosen slot. */
@Component({
  selector: 'app-equipment',
  imports: [TranslocoPipe, SlotPicker],
  template: `
    @if (gear.data()) {
      <div class="stage">
        <header class="head">
          <button type="button" class="pill" (click)="views.set('build')">
            {{ 'buildBack' | transloco }}
          </button>
          <h2>{{ 'buildEquipment' | transloco }}</h2>
        </header>
        <p class="note">{{ 'equipNote' | transloco }}</p>
        <div class="grid">
          <ul class="slots" [attr.aria-label]="'equipSlots' | transloco">
            @for (s of slots; track s) {
              <li>
                <button
                  type="button"
                  class="slot"
                  [class.on]="slot() === s"
                  [attr.aria-pressed]="slot() === s"
                  (click)="choose(s)"
                >
                  @if (itemOf(s); as it) {
                    <img
                      [src]="'items/' + id(s) + '.png'"
                      alt=""
                      width="40"
                      height="40"
                      (error)="hide($event)"
                    />
                    <span class="name">{{ gear.text(it.name) }}</span>
                  } @else {
                    <span class="name empty">{{ 'equipEmpty' | transloco }}</span>
                  }
                  <span class="slotname">{{ 'equipSlot_' + s | transloco }}</span>
                </button>
              </li>
            }
          </ul>

          <app-slot-picker [slot]="slot()" />
        </div>
      </div>
    }
  `,
  styleUrl: './equipment.css',
})
export class Equipment {
  protected readonly gear = inject(GearService);
  protected readonly planner = inject(PlannerStore);
  protected readonly views = inject(ViewStore);

  protected readonly slots = GEAR_SLOTS;
  protected readonly slot = this.views.slot;

  protected choose(slot: SlotKey): void {
    this.slot.set(slot);
  }

  protected id(slot: SlotKey): string | undefined {
    return this.planner.gear()[slot];
  }

  protected itemOf(slot: SlotKey): GearItem | undefined {
    const id = this.id(slot);
    return id ? this.gear.data()?.items[id] : undefined;
  }

  protected hide(event: Event): void {
    (event.target as HTMLElement).style.visibility = 'hidden'; // no picture for this item
  }
}
