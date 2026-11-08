import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { GearItem, SlotKey } from '../core/gear.model';
import {
  attackSpeed,
  fits,
  pieceArmor,
  rankDamage,
  upgradeArmor,
  upgraded,
} from '../core/gear.logic';
import { GearService } from '../core/gear.service';
import { PlannerStore } from '../core/planner.store';

const PAGE = 60;
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

/** The items that fit a slot, with the worn one and its upgrades: shared by the Equipment screen and the character sheet's dialog. */
@Component({
  selector: 'app-slot-picker',
  imports: [TranslocoPipe],
  template: `
    <section class="picker" [attr.aria-label]="'equipSlot_' + slot() | transloco">
      <h3>{{ 'equipSlot_' + slot() | transloco }}</h3>
      @if (itemOf(slot()); as it) {
        <article class="current">
          <h4>{{ gear.text(it.name) }}</h4>
          @if (it.lvl[0] < it.lvl[1]) {
            <label class="lvlpick">
              {{ 'equipBaseLevel' | transloco }}
              <input
                type="number"
                [min]="it.lvl[0]"
                [max]="it.lvl[1]"
                [value]="planner.itemLevels()[slot()] ?? it.lvl[1]"
                (change)="planner.setItemLevel(slot(), +$any($event.target).value || null)"
              />
              <small>({{ it.lvl[0] }}–{{ it.lvl[1] }})</small>
            </label>
          }
          <ul class="lines">
            @for (l of lines(upgradedOf(slot(), it)); track l) {
              <li>{{ l }}</li>
            }
          </ul>
          @if (it.upgrades.length) {
            <h5>{{ 'equipUpgrades' | transloco }}</h5>
            <ol class="upgrades">
              @for (u of it.upgrades; track $index) {
                <li>
                  <button
                    type="button"
                    class="item"
                    [class.on]="$index < taken(slot())"
                    [attr.aria-pressed]="$index < taken(slot())"
                    (click)="take(slot(), $index)"
                  >
                    <span class="name">
                      @if (u.icon) {
                        <img
                          class="uicon"
                          [src]="u.icon"
                          alt=""
                          width="24"
                          height="24"
                          (error)="hide($event)"
                        />
                      }
                      {{
                        u.name
                          ? gear.text(u.name)
                          : ('equipUpgrade' | transloco) + ' ' + ($index + 1)
                      }}
                    </span>
                    <span class="meta">{{ upgradeText(slot(), it, $index) }}</span>
                    @if (u.desc) {
                      <span class="meta">{{ gear.text(u.desc) }}</span>
                    }
                  </button>
                </li>
              }
            </ol>
          }
          <button type="button" class="pill" (click)="planner.wear(slot(), null)">
            {{ 'equipRemove' | transloco }}
          </button>
        </article>
      }
      <div class="filters">
        <input
          type="search"
          [placeholder]="'equipSearch' | transloco"
          [attr.aria-label]="'equipSearch' | transloco"
          [value]="query()"
          (input)="query.set($any($event.target).value); shown.set(PAGE)"
        />
        <select
          [attr.aria-label]="'wsRarity' | transloco"
          (change)="rarity.set($any($event.target).value); shown.set(PAGE)"
        >
          <option value="">{{ 'equipAllRarities' | transloco }}</option>
          @for (r of rarities; track r) {
            <option [value]="r">{{ 'rarity_' + r | transloco }}</option>
          }
        </select>
        @if (types().length > 1) {
          <select
            [attr.aria-label]="'equipClass' | transloco"
            (change)="type.set($any($event.target).value); shown.set(PAGE)"
          >
            <option value="">{{ 'equipAllClasses' | transloco }}</option>
            @for (t of types(); track t) {
              <option [value]="t">{{ 'type_' + t | transloco }}</option>
            }
          </select>
        }
      </div>
      <ul class="items">
        @for (e of visible(); track e.id) {
          <li>
            <button
              type="button"
              class="item"
              [class.on]="planner.gear()[slot()] === e.id"
              [attr.aria-pressed]="planner.gear()[slot()] === e.id"
              (click)="planner.wear(slot(), e.id)"
            >
              <img
                [src]="'items/' + e.id + '.png'"
                alt=""
                width="36"
                height="36"
                (error)="hide($event)"
              />
              <span class="name">{{ gear.text(e.item.name) }}</span>
              <span class="meta">
                {{ 'rarity_' + e.item.rarity | transloco }} · {{ 'equipLevel' | transloco }}
                {{ e.item.lvl[1] }}
              </span>
              <span class="meta">{{ summary(e.item) }}</span>
            </button>
          </li>
        } @empty {
          <li class="empty">{{ 'equipNone' | transloco }}</li>
        }
      </ul>
      @if (matching().length > shown()) {
        <button type="button" class="pill" (click)="shown.set(shown() + PAGE)">
          {{ 'wsMore' | transloco: { n: matching().length - shown() } }}
        </button>
      }
    </section>
  `,
  styleUrl: './equipment.css',
})
export class SlotPicker {
  protected readonly gear = inject(GearService);
  protected readonly planner = inject(PlannerStore);

  protected readonly PAGE = PAGE;
  protected readonly rarities = RARITIES;
  readonly slot = input.required<SlotKey>();
  protected readonly query = signal('');
  protected readonly rarity = signal('');
  // a new slot starts with no class filter and the first page
  protected readonly type = linkedSignal(() => (this.slot(), ''));
  protected readonly shown = linkedSignal(() => (this.slot(), PAGE));

  private readonly candidates = computed(() =>
    Object.entries(this.gear.data()?.items ?? {})
      .filter(([, item]) => fits(this.slot(), item))
      .map(([id, item]) => ({ id, item }))
      .sort(
        (a, b) => b.item.lvl[1] - a.item.lvl[1] || a.item.name[1].localeCompare(b.item.name[1]),
      ),
  );
  /** The weapon families of the slot, for the class filter. */
  protected readonly types = computed(() =>
    [
      ...new Set(
        this.candidates()
          .map((c) => c.item.type)
          .filter((t): t is string => !!t),
      ),
    ].sort(),
  );
  protected readonly matching = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.candidates().filter(
      ({ item }) =>
        (!this.rarity() || item.rarity === this.rarity()) &&
        (!this.type() || item.type === this.type()) &&
        (!q || item.name.some((n) => n.toLowerCase().includes(q))),
    );
  });
  protected readonly visible = computed(() => this.matching().slice(0, this.shown()));

  protected id(slot: SlotKey): string | undefined {
    return this.planner.gear()[slot];
  }

  protected itemOf(slot: SlotKey): GearItem | undefined {
    const id = this.id(slot);
    return id ? this.gear.data()?.items[id] : undefined;
  }

  protected taken(slot: SlotKey): number {
    return this.planner.upgrades()[slot] ?? 0;
  }

  /** The upgrades form a chain: a click takes up to that one, or drops it and the ones after when it is the last taken. */
  protected take(slot: SlotKey, i: number): void {
    this.planner.setUpgrades(slot, this.taken(slot) === i + 1 ? i : i + 1);
  }

  protected upgradedOf(slot: SlotKey, item: GearItem): GearItem {
    return upgraded(
      this.gear.data()!.constants,
      item,
      this.taken(slot),
      this.planner.itemLevels()[slot],
    );
  }

  /** What upgrade i adds: the weapon's damage rise and its damage perk, armour per kind, then its stat lines. */
  protected upgradeText(slot: SlotKey, item: GearItem, i: number): string {
    const c = this.gear.data()!.constants;
    const base = upgraded(c, item, 0, this.planner.itemLevels()[slot]);
    const rise = rankDamage(c, base, i);
    const perk = this.gear.perkLine(this.upgradedOf(slot, item), item.upgrades[i]);
    const parts = [
      ...(rise !== null ? [`${this.t('charDamage')} +${rise}`] : []),
      ...(perk ? [perk] : []),
      ...Object.entries(upgradeArmor(c, item, i)).map(
        ([k, v]) => `${this.t('buildArmor_' + k)} +${v}`,
      ),
    ];
    for (const s of item.upgrades[i].stats)
      parts.push(
        `${this.gear.text(s.name)} ${s.format === 'Percentage' ? s.value + '%' : s.value}`,
      );
    return parts.join(' · ');
  }

  protected hide(event: Event): void {
    (event.target as HTMLElement).style.visibility = 'hidden'; // no picture for this item
  }

  /** One line under an item: its total armour, or its damage factor. */
  protected summary(item: GearItem): string {
    const armor = Object.values(pieceArmor(this.gear.data()!.constants, item)).reduce(
      (n, v) => n + v,
      0,
    );
    if (item.damage) return `×${item.damage.mod}${item.damage.hands === 2 ? ' · 2H' : ''}`;
    return armor ? `${this.t('buildArmor')} ${armor}` : '';
  }

  /** Every line of an item: armour per kind, weapon factors, then its stat lines (with the upgrades taken). */
  protected lines(item: GearItem): string[] {
    const out: string[] = [];
    for (const [k, v] of Object.entries(pieceArmor(this.gear.data()!.constants, item)))
      out.push(`${this.t('buildArmor_' + k)}: ${v}`);
    const d = item.damage;
    if (d) {
      out.push(`${this.t('equipDamageFactor')}: ×${d.mod}`, `${this.t('equipSpeed')}: ×${d.speed}`);
      out.push(`${this.t('equipHands')}: ${d.hands}`);
      if (d.attr) out.push(`${this.t('equipScales')}: ${this.t('skillAttr_' + d.attr)}`);
      if (item.gem)
        out.push(
          `${this.t('equipGem')}: ${item.gem === 1 ? this.t('equipGemAlways') : this.i18n.translate('equipGemChance', { p: item.gem * 100 })}`,
        );
      for (const [k, v] of Object.entries(d.types))
        out.push(`${this.t('buildArmor_' + k)}: ${Math.round(v * 100)}%`);
    }
    const sums = new Map<string, { name: string; value: number; format: string }>();
    for (const s of item.stats) {
      const key = `${s.name[1]}|${s.format}`;
      const old = sums.get(key);
      sums.set(key, {
        name: this.gear.text(s.name),
        value: (old?.value ?? 0) + s.value,
        format: s.format,
      });
    }
    const speed = attackSpeed(item);
    for (const s of sums.values())
      out.push(
        `${s.name}: ${s.format === 'Percentage' ? s.value + '%' : speed !== null && s.name === this.speedName(item) ? speed + 's' : s.value}`,
      );
    return out;
  }

  private speedName(item: GearItem): string | undefined {
    const s = item.stats.find((x) => x.name[1] === 'Attack Speed');
    return s && this.gear.text(s.name);
  }

  private t(key: string): string {
    return this.i18n.translate(key);
  }

  private readonly i18n = inject(TranslocoService);
}
