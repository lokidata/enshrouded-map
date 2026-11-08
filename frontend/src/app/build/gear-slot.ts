import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { GearItem, SlotKey } from '../core/gear.model';
import {
  attackSpeed,
  headline,
  parryPoints,
  WORLD_KEY,
  worldFactor,
  pieceArmor,
  rankDamage,
  rankGain,
  upgraded,
} from '../core/gear.logic';
import { GameSettingsStore } from '../core/game-settings.store';
import { GearService } from '../core/gear.service';
import { GemsService } from '../core/gems.service';
import { PlannerStore, WEAPON_SLOTS } from '../core/planner.store';
import { Recommendations } from '../core/recommend.service';
import { SlotPicker } from '../equipment/slot-picker';

/** One slot of the character sheet: the item's picture (click = pick another), and its card on hover or focus. */
@Component({
  selector: 'app-gear-slot',
  imports: [TranslocoPipe, SlotPicker],
  template: `
    <button
      type="button"
      class="slot"
      [attr.data-rarity]="item()?.rarity"
      [attr.aria-label]="
        ('equipSlot_' + slot() | transloco) +
        ': ' +
        (item() ? gear.text(item()!.name) : ('equipEmpty' | transloco)) +
        (gem() ? ' · ' + gems.text(gem()!.gem.name) + ' ' + gem()!.level : '') +
        (alert()?.now?.severity ? ' · ' + (alertWord() | transloco) : '')
      "
      aria-haspopup="dialog"
      (click)="picking.set(true)"
    >
      @if (item(); as it) {
        <img
          [src]="'items/' + planner.gear()[slot()] + '.png'"
          [alt]="''"
          width="64"
          height="64"
          (error)="hide($event)"
        />
        @if (gem()?.gem?.icon; as icon) {
          <img
            class="gem-badge"
            [src]="icon"
            alt=""
            width="22"
            height="22"
            (error)="hide($event)"
          />
        }
      } @else if (gear.slotArt(slot()); as art) {
        <img class="art" [src]="art" alt="" width="48" height="48" (error)="hide($event)" />
      }
    </button>
    @if (alert(); as a) {
      @if (a.now.severity) {
      <span class="alert" [attr.data-severity]="a.now.severity" aria-hidden="true">
        {{ a.now.severity === 'critical' ? '⛔' : '⚠' }} -{{ a.now.loss }} %
      </span>
      }
    }
    @if (picking()) {
      <dialog
        #dlg
        class="pick"
        [attr.aria-label]="'equipSlot_' + slot() | transloco"
        (close)="close()"
      >
        <button type="button" class="pill x" (click)="dlg.close()">
          {{ 'close' | transloco }}
        </button>
        <app-slot-picker [slot]="slot()" />
      </dialog>
    }
    @if (item() && open() && !picking()) {
      <div class="card" role="group" [attr.aria-label]="gear.text(item()!.name)">
        <h4>{{ gear.text(item()!.name) }}</h4>
        <p class="kind">
          {{ 'equipSlot_' + slot() | transloco }} · {{ 'charEquipped' | transloco }}
        </p>
        <img
          class="pic"
          [src]="'items/' + planner.gear()[slot()] + '.png'"
          alt=""
          width="72"
          height="72"
          (error)="hide($event)"
        />
        <p class="lvl">
          {{ 'charLevel' | transloco }} <b>{{ level() }}</b> / {{ levelMax() }}
        </p>
        <p class="rarity">{{ 'rarity_' + item()!.rarity | transloco }}</p>
        @if (alert(); as a) {
          <p class="alert" [attr.data-severity]="a.now.severity ?? a.base.severity">
            <span aria-hidden="true">{{
              (a.now.severity ?? a.base.severity) === 'critical' ? '⛔' : '⚠'
            }}</span>
            {{ (a.state === 'still' ? 'recoStill' : 'recoCompensated') | transloco }}
            · {{ 'recoBase' | transloco: { level: a.base.level, loss: a.base.loss } }}
          </p>
        }
        <dl>
          <div>
            <dt>{{ 'charArmorPhysical' | transloco }}</dt>
            <dd>{{ armor().physical }}</dd>
          </div>
          <div>
            <dt>{{ 'charArmorMagical' | transloco }}</dt>
            <dd>{{ armor().magical }}</dd>
          </div>
          @if (speed() !== null) {
            <div>
              <dt>{{ speedName() }}</dt>
              <dd>{{ speed() }}s</dd>
            </div>
          }
          @if (item()!.gem) {
            <div>
              <dt>{{ 'equipGem' | transloco }}</dt>
              <dd>
                {{
                  item()!.gem === 1
                    ? ('equipGemAlways' | transloco)
                    : ('equipGemChance' | transloco: { p: item()!.gem! * 100 })
                }}
                ·
                {{
                  (taken() < item()!.upgrades.length ? 'equipGemLocked' : 'equipGemOpen')
                    | transloco
                }}
              </dd>
            </div>
          }
          @if (gem(); as e) {
            <div>
              <dt>{{ 'equipGemSet' | transloco }}</dt>
              <dd>{{ gems.text(e.gem.name) }} · {{ 'charLevel' | transloco }} {{ e.level }}</dd>
            </div>
          }
          @if (parry() !== null) {
            <div>
              <dt>{{ 'buildRow_parry' | transloco }}</dt>
              <dd>
                @if (item()!.parry !== undefined) {
                  <span class="est" [title]="'buildParryTip' | transloco">{{
                    'buildEstimate' | transloco
                  }}</span>
                }
                {{ parry() }}
              </dd>
            </div>
          }
        </dl>
        @if (gem(); as e) {
          <p class="gem-text">
            @if (e.lines[0]?.estimate) {
              <span class="est" [title]="'buildGemTip' | transloco">{{
                'buildEstimate' | transloco
              }}</span>
            }
            {{ lineText(e.lines) }}
          </p>
        }
        @if (item()!.upgrades.length) {
          <p class="head">
            <span>{{ (item()!.damage ? 'charDamage' : 'charArmor') | transloco }}</span>
            <span>{{ 'charUpgrades' | transloco }}</span>
          </p>
          <ol>
            @for (u of item()!.upgrades; track $index) {
              <li>
                <button
                  type="button"
                  [class.on]="$index < taken()"
                  [attr.aria-pressed]="$index < taken()"
                  (click)="take($index)"
                >
                  <span class="rank">
                    <span aria-hidden="true">{{ $index < taken() ? '✓' : '' }}</span>
                    {{ 'charLevel' | transloco }} {{ piece().lvl[1] - taken() + $index + 1 }}
                  </span>
                  <span class="gain">
                    @if (item()!.damage) {
                      {{ gains()[$index].damage === null ? '—' : '+' + gains()[$index].damage }}
                    } @else {
                      +{{ gains()[$index].physical }} / +{{ gains()[$index].magical }}
                    }
                  </span>
                  <span class="what">
                    @if (u.icon) {
                      <img
                        class="uicon"
                        [src]="u.icon"
                        alt=""
                        width="28"
                        height="28"
                        (error)="hide($event)"
                      />
                    }
                    <b>{{
                      u.name ? gear.text(u.name) : ('equipUpgrade' | transloco) + ' ' + ($index + 1)
                    }}</b>
                    @if (gear.perkLine(piece(), u); as p) {
                      <small>{{ p }}</small>
                    }
                    @if (u.desc) {
                      <small class="desc">{{ gear.text(u.desc) }}</small>
                    }
                    @for (s of u.stats; track s.id) {
                      <small>
                        {{ gear.text(s.name) }} +{{ s.value
                        }}{{ s.format === 'Percentage' ? '%' : '' }}
                      </small>
                    }
                  </span>
                </button>
              </li>
            }
          </ol>
        }
      </div>
    }
  `,
  styleUrl: './gear-slot.css',
  host: {
    '[style.--rar]': 'color()',
    '[class.right]': 'right()',
    '[class.up]': 'up()',
    '(mouseenter)': 'open.set(true)',
    '(mouseleave)': 'open.set(false)',
    '(focusin)': 'open.set(true)',
    '(focusout)': 'out($event)',
    '(keydown.escape)': 'open.set(false)',
  },
})
export class GearSlot {
  readonly slot = input.required<SlotKey>();
  /** The card opens to the left (right column) and upwards (lower rows). */
  readonly right = input(false);
  readonly up = input(false);

  protected readonly gear = inject(GearService);
  protected readonly planner = inject(PlannerStore);
  private readonly reco = inject(Recommendations);
  protected readonly alert = computed(() => this.reco.bySlot().get(this.slot()));
  protected readonly alertWord = computed(() =>
    this.alert()?.now.severity === 'critical' ? 'reco_critical' : 'reco_low',
  );
  protected readonly gems = inject(GemsService);
  /** The gem set in this slot (weapon slots only). */
  protected readonly gem = computed(() => {
    const ws = WEAPON_SLOTS.find((s) => s === this.slot());
    return ws && this.item() ? this.gems.effect(this.planner.gems()[ws]) : null;
  });
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  protected readonly open = signal(false);
  /** The picker dialog (items of this slot, remove, upgrades) is open. */
  protected readonly picking = signal(false);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  private readonly opener = effect(() => this.dlg()?.nativeElement.showModal());
  /** Keeps the card inside the window: it grows up or down from the slot and is shifted back when it overflows. */
  private readonly placer = effect(() => {
    if (!this.open()) return;
    requestAnimationFrame(() => {
      const card = this.host.nativeElement.querySelector<HTMLElement>('.card');
      if (!card) return;
      card.style.translate = '';
      const r = card.getBoundingClientRect();
      const area = card.closest('.stage')?.getBoundingClientRect(); // the scrolling screen clips the card
      const top = (area?.top ?? 0) + 8;
      const bottom = Math.min(area?.bottom ?? innerHeight, innerHeight) - 8;
      const shift =
        r.bottom > bottom ? Math.max(top - r.top, bottom - r.bottom) : Math.max(0, top - r.top);
      if (shift) card.style.translate = `0 ${shift}px`;
    });
  });
  private readonly constants = computed(() => this.gear.data()?.constants ?? {});
  protected readonly item = computed<GearItem | undefined>(() => {
    const id = this.planner.gear()[this.slot()];
    return id ? this.gear.data()?.items[id] : undefined;
  });
  protected readonly taken = computed(() => this.planner.upgrades()[this.slot()] ?? 0);
  /** The piece with the upgrades taken. */
  private readonly piece = computed(() =>
    upgraded(this.constants(), this.item()!, this.taken(), this.planner.itemLevels()[this.slot()]),
  );
  protected readonly armor = computed(() => headline(pieceArmor(this.constants(), this.piece())));
  private readonly settings = inject(GameSettingsStore);
  protected readonly parry = computed(() =>
    parryPoints(
      this.constants(),
      this.piece(),
      worldFactor(this.settings.values(), WORLD_KEY.parry),
    ),
  );
  protected readonly color = computed(() => this.gear.color(this.item()?.rarity));
  protected readonly level = computed(() => this.piece().lvl[1]);
  protected readonly levelMax = computed(() => this.item()!.lvl[1] + this.item()!.upgrades.length);
  /** Per upgrade: the rise of the armour, or of the weapon's damage (the card's column), from the chosen base level. */
  protected readonly gains = computed(() => {
    const base = upgraded(
      this.constants(),
      this.item()!,
      0,
      this.planner.itemLevels()[this.slot()],
    );
    return base.upgrades.map((_, i) => ({
      ...rankGain(this.constants(), base, i),
      damage: rankDamage(this.constants(), base, i),
    }));
  });
  protected readonly speed = computed(() => attackSpeed(this.item()!));
  protected readonly speedName = computed(() => {
    const s = this.item()!.stats.find((x) => x.name[1] === 'Attack Speed');
    return s ? this.gear.text(s.name) : '';
  });

  /** The upgrades form a chain: a tap takes up to that one, or drops it and the ones after when it is the last taken. */
  protected take(i: number): void {
    this.planner.setUpgrades(this.slot(), this.taken() === i + 1 ? i : i + 1);
  }

  protected close(): void {
    this.picking.set(false);
    this.open.set(false);
    this.host.nativeElement.querySelector('button')?.focus();
  }

  protected out(event: FocusEvent): void {
    if (!this.host.nativeElement.contains(event.relatedTarget as Node | null)) this.open.set(false);
  }

  protected lineText(lines: { name: string; text: string }[]): string {
    return lines.map((l) => `${l.name} ${l.text}`).join(' · ');
  }

  protected hide(event: Event): void {
    (event.target as HTMLElement).style.visibility = 'hidden'; // no picture for this item
  }
}
