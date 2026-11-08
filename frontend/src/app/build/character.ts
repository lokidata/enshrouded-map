import { Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SlotKey } from '../core/gear.model';
import { armorTotals, blockPoints, headline, upgraded, worn } from '../core/gear.logic';
import { GearService } from '../core/gear.service';
import { PlannerStore } from '../core/planner.store';
import { GearSlot } from './gear-slot';

/** The game's character screen: weapons and rings on the left, armour and its totals on the right. */
@Component({
  selector: 'app-character-sheet',
  imports: [TranslocoPipe, GearSlot],
  template: `
    <div class="sheet" role="group" [attr.aria-label]="'buildCharacter' | transloco">
      <div class="left">
        @for (s of main; track s) {
          <div class="row">
            <p class="info">
              <span>{{ 'equipSlot_' + s | transloco }}</span>
              @if (value(s); as v) {
                <b>{{ v.label | transloco }} {{ v.n }}</b>
              }
            </p>
            <app-gear-slot [slot]="s" />
            @if (s === 'ranged') {
              <button
                type="button"
                class="hand"
                [attr.aria-pressed]="planner.active() === s"
                (click)="planner.setActive(s)"
              >
                {{ 'charInHand' | transloco }}
              </button>
            }
          </div>
        }
        <div class="pair" role="group" [attr.aria-label]="'buildWeapons' | transloco">
          @for (w of weapons; track w) {
            <div class="wslot">
              <app-gear-slot [slot]="w" />
              <button
                type="button"
                class="hand"
                [attr.aria-pressed]="planner.active() === w"
                (click)="planner.setActive(w)"
              >
                {{ 'charInHand' | transloco }}
              </button>
            </div>
          }
        </div>
        <div class="pair">
          <app-gear-slot slot="ring1" [up]="true" /><app-gear-slot slot="ring2" [up]="true" />
        </div>
      </div>

      <div class="right">
        <div class="armour">
          @for (s of body; track s; let i = $index) {
            <app-gear-slot [slot]="s" [right]="true" [up]="i > 2" />
          }
        </div>
        <div class="side">
          <p class="total">
            <span>{{ 'charArmorPhysical' | transloco }}</span>
            <b>{{ armor().physical }}</b>
          </p>
          <p class="total">
            <span>{{ 'charArmorMagical' | transloco }}</span>
            <b>{{ armor().magical }}</b>
          </p>
        </div>
      </div>
    </div>
  `,
  styleUrl: './character.css',
})
export class CharacterSheet {
  protected readonly gear = inject(GearService);
  protected readonly planner = inject(PlannerStore);

  protected readonly weapons = ['weapon1', 'weapon2', 'weapon3'] as const;
  protected readonly main: SlotKey[] = ['ranged', 'shield'];
  protected readonly body: SlotKey[] = ['head', 'chest', 'hands', 'legs', 'feet'];

  private readonly constants = computed(() => this.gear.data()?.constants ?? {});
  protected readonly cap = computed(() => Math.min(this.constants()['playerLevelCap'] ?? 200, 200));
  private readonly pieces = computed(() =>
    worn(
      this.constants(),
      this.planner.inHand(),
      this.gear.data()?.items ?? {},
      this.planner.upgrades(),
      this.planner.itemLevels(),
    ),
  );
  protected readonly armor = computed(() => headline(armorTotals(this.constants(), this.pieces())));

  /** The number shown beside a slot: the shield's block, a weapon's damage factor. */
  protected value(slot: SlotKey): { label: string; n: number } | null {
    const item = this.gear.data()?.items[this.planner.gear()[slot] ?? ''];
    if (!item) return null;
    if (slot === 'shield') {
      const piece = upgraded(
        this.constants(),
        item,
        this.planner.upgrades().shield ?? 0,
        this.planner.itemLevels().shield,
      );
      const n = blockPoints(this.constants(), piece);
      return n ? { label: 'buildRow_block', n } : null;
    }
    return item.damage ? { label: 'equipDamageFactor', n: item.damage.mod } : null;
  }
}
