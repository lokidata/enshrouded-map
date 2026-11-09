import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  armorTotals,
  FLAME_MAX,
  altars,
  attributeTotals,
  flameSkillBonus,
  frostProtection,
  frostSeconds,
  levelPoints,
  restedMinutes,
  lineSum,
  shroudMinutes,
  xpToNext,
  xpTotal,
  effectTotals,
  rowParts,
  rowValue,
  vitalParts,
  Part,
  RowDef,
  statSums,
  vitals,
  worn,
  protection,
  parryPoints,
  blockPoints,
  upgraded,
  weaponClassPct,
  weaponDamage,
  weaponGuard,
  WORLD_KEY,
  worldFactor,
} from '../core/gear.logic';
import { GameSettingsStore } from '../core/game-settings.store';
import { SlotKey } from '../core/gear.model';
import { Names } from '../core/map-data.model';
import { GearService } from '../core/gear.service';
import { GemsService } from '../core/gems.service';
import { PlannerStore } from '../core/planner.store';
import { ATTRS, attributes } from '../core/skills.logic';
import { SkillsService } from '../core/skills.service';
import { ViewStore } from '../core/view.store';
import { BuildsPanel } from './builds-panel';
import { CharacterSheet } from './character';
import { RecommendationsPanel } from './recommendations';
import { StatRow, TipPart } from './stat-row';
import {
  formatRow,
  TABS,
  Tab,
  damageRows,
  miscRows,
  regenRows,
  againstRows,
  weaponRows,
} from './build-rows';

const ATTR_TEXT: Record<string, string> = { resistance: 'endurance' };
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const PART_KEY: Record<string, string> = {
  player: 'tipPlayer',
  equipment: 'tipEquipment',
  upgrades: 'tipUpgrades',
  skills: 'tipSkills',
  flame: 'tipFlame',
};

/** The non-zero parts of a value as lines (+ sign on what is added to the base). */
function tipParts(parts: Part[], fmt: (n: number) => string): TipPart[] {
  return parts
    .filter((p) => p.value !== 0)
    .map((p) => ({
      key: PART_KEY[p.key] ?? `skillAttr_${p.key}`,
      text: (p.key === 'player' || p.value < 0 ? '' : '+') + fmt(p.value),
    }));
}

type Group = 'misc' | 'regen' | 'damage' | 'against' | 'weapon';

interface Row {
  key: string;
  /** The game's own label when gear.json has it. */
  label: string | null;
  value: string;
  estimate: boolean;
  parts: TipPart[];
  desc: string | null;
}

/** The game's Character screen (sheet), then its Attributes screen: level, Flame, equipment and skills of the planned build. */
@Component({
  selector: 'app-build',
  imports: [TranslocoPipe, BuildsPanel, CharacterSheet, RecommendationsPanel, StatRow],
  template: `
    @if (gear.data()) {
      <div class="stage">
        <nav class="actions" [attr.aria-label]="'buildActions' | transloco">
          <button type="button" class="pill" (click)="views.set('equipment')">
            {{ 'buildEquipment' | transloco }}
          </button>
          <button type="button" class="pill" (click)="views.set('skills')">
            {{ 'skills' | transloco }}
          </button>
          <button
            type="button"
            class="pill"
            [attr.aria-pressed]="saves()"
            (click)="saves.set(!saves())"
          >
            {{ 'skillBuilds' | transloco }}
          </button>
        </nav>
        @if (saves()) {
          <section class="sheet" [attr.aria-label]="'skillBuilds' | transloco">
            <app-builds-panel />
          </section>
        }
        <div id="attributes" class="attrs">
          <aside class="left" [attr.aria-label]="'buildCharacter' | transloco">
            <h2>{{ 'buildLevel' | transloco }}</h2>
            <div class="level">
              <span class="badge" aria-hidden="true">{{ planner.level() }}</span>
              <label>
                <span class="sr">{{ 'buildLevel' | transloco }}</span>
                <input
                  type="number"
                  [attr.min]="1"
                  [attr.max]="maxLevel()"
                  [value]="planner.level()"
                  (change)="setLevel($event)"
                />
              </label>
            </div>
            <dl>
              <div>
                <dt>{{ 'buildXpNext' | transloco }}</dt>
                <dd>{{ xpNext() }}</dd>
              </div>
              <div>
                <dt>{{ 'buildXpTotal' | transloco }}</dt>
                <dd>{{ xpAll() }}</dd>
              </div>
              <div>
                <dt>{{ 'buildLevelPoints' | transloco }}</dt>
                <dd>{{ points() }}</dd>
              </div>
            </dl>
            <h2>{{ 'buildFlame' | transloco }}</h2>
            <div class="level">
              <span class="badge flame" aria-hidden="true">{{ planner.flame() }}</span>
              <label>
                <span class="sr">{{ 'buildFlame' | transloco }}</span>
                <input
                  type="number"
                  [attr.min]="0"
                  [attr.max]="maxFlame()"
                  [value]="planner.flame()"
                  (change)="setFlame($event)"
                />
              </label>
            </div>
            <p class="blessing">{{ 'buildBlessing' | transloco: { n: flameBonus() } }}</p>

            @if (altars(); as n) {
              <dl>
                <div>
                  <dt>{{ 'buildAltars' | transloco }}</dt>
                  <dd>{{ n }}</dd>
                </div>
                <div>
                  <dt>{{ 'buildFrost' | transloco }}</dt>
                  <dd>{{ (frost() ? 'yes' : 'no') | transloco }}</dd>
                </div>
              </dl>
            }
            <h2>{{ 'buildComfort' | transloco }}</h2>
            <div class="level">
              <label>
                {{ 'buildComfortPoints' | transloco }}
                <input
                  type="number"
                  min="0"
                  [value]="planner.comfort()"
                  (change)="setComfort($event)"
                />
              </label>
            </div>
            <p class="blessing">{{ 'buildComfortHelp' | transloco }}</p>
            <dl>
              <div
                app-stat-row
                labelKey="buildRestedDuration"
                [value]="rested()"
                [parts]="comfortParts()"
                [desc]="'buildRestedNote' | transloco"
              ></div>
              <div
                app-stat-row
                labelKey="buildRestedBonus"
                value="—"
                [desc]="'buildRestedBonusDesc' | transloco"
              ></div>
            </dl>
            <h2>{{ 'buildMain' | transloco }}</h2>
            <dl>
              @for (r of main(); track r.key) {
                <div
                  app-stat-row
                  [label]="r.label"
                  [labelKey]="'buildRow_' + r.key"
                  [value]="r.value"
                  [estimate]="r.estimate"
                  [parts]="r.parts"
                  [desc]="r.desc"
                ></div>
              }
            </dl>
            <h2>{{ 'buildShroud' | transloco }}</h2>
            <dl>
              <div
                app-stat-row
                labelKey="buildRow_passage"
                [value]="'' + (planner.flame() || '—')"
                [estimate]="true"
                [parts]="passage().parts"
                [desc]="passage().desc"
              ></div>
              <div
                app-stat-row
                labelKey="buildRow_shroudTime"
                [value]="shroud() ? shroud() + ' min' : '—'"
                [estimate]="!!shroud()"
                estTip="buildShroudTip"
                [parts]="shroudTime().parts"
                [desc]="shroudTime().desc"
              ></div>
            </dl>
          </aside>

          <div class="col">
            <app-character-sheet />
            <app-recommendations />
            <section class="right">
              <div class="tabs" role="tablist" [attr.aria-label]="'buildTabs' | transloco">
                @for (t of tabs; track t) {
                  <button
                    type="button"
                    role="tab"
                    [id]="'build-tab-' + t"
                    [attr.aria-selected]="tab() === t"
                    aria-controls="build-panel"
                    [class.active]="tab() === t"
                    (click)="tab.set(t)"
                  >
                    {{ 'buildTab_' + t | transloco }}
                  </button>
                }
              </div>
              <div
                id="build-panel"
                class="tabpanel"
                role="tabpanel"
                [attr.aria-labelledby]="'build-tab-' + tab()"
              >
                @if (tab() !== 'protection') {
                  <p class="note">{{ 'buildNote' | transloco }}</p>
                }
                @switch (tab()) {
                  @case ('bases') {
                    <div class="cols">
                      <div>
                        <h3>{{ 'buildPrimary' | transloco }}</h3>
                        <dl>
                          @for (a of attrs(); track a.key) {
                            <div
                              app-stat-row
                              [labelKey]="'skillAttr_' + a.key"
                              [value]="'' + a.total"
                              [estimate]="a.estimate"
                              estTip="buildFlameSkillTip"
                              [parts]="a.parts"
                              [desc]="a.desc"
                            ></div>
                          }
                        </dl>
                        <h3>{{ 'buildMisc' | transloco }}</h3>
                        <dl>
                          @for (r of rows('misc'); track r.key) {
                            <div
                              app-stat-row
                              [label]="r.label"
                              [labelKey]="'buildRow_' + r.key"
                              [value]="r.value"
                              [estimate]="r.estimate"
                              [parts]="r.parts"
                              [desc]="r.desc"
                            ></div>
                          }
                        </dl>
                      </div>
                      <div>
                        <h3>{{ 'buildRegen' | transloco }}</h3>
                        <dl>
                          @for (r of rows('regen'); track r.key) {
                            <div
                              app-stat-row
                              [label]="r.label"
                              [labelKey]="'buildRow_' + r.key"
                              [value]="r.value"
                              [estimate]="r.estimate"
                              [parts]="r.parts"
                              [desc]="r.desc"
                            ></div>
                          }
                        </dl>
                      </div>
                    </div>
                  }
                  @case ('damage') {
                    <div class="cols">
                      <div>
                        <h3>{{ 'buildDamage' | transloco }}</h3>
                        <dl>
                          @for (r of rows('damage'); track r.key) {
                            <div
                              app-stat-row
                              [label]="r.label"
                              [labelKey]="'buildRow_' + r.key"
                              [value]="r.value"
                              [estimate]="r.estimate"
                              [parts]="r.parts"
                              [desc]="r.desc"
                            ></div>
                          }
                        </dl>
                        <h3>{{ 'buildAgainst' | transloco }}</h3>
                        <dl>
                          @for (r of rows('against'); track r.key) {
                            <div
                              app-stat-row
                              [label]="r.label"
                              [labelKey]="'buildRow_' + r.key"
                              [value]="r.value"
                              [estimate]="r.estimate"
                              [parts]="r.parts"
                              [desc]="r.desc"
                            ></div>
                          }
                        </dl>
                      </div>
                      <div>
                        <h3>{{ 'buildPerWeapon' | transloco }}</h3>
                        @for (w of weapons(); track w.slot) {
                          <h4>{{ 'equipSlot_' + w.slot | transloco }} · {{ w.name }}</h4>
                          <dl>
                            <div
                              app-stat-row
                              labelKey="buildWeaponDamage"
                              [value]="w.damage"
                              [estimate]="w.damage !== '—'"
                              estTip="buildWeaponDamageTip"
                              [parts]="w.damageParts"
                            ></div>
                            <div
                              app-stat-row
                              labelKey="buildRow_parry"
                              [value]="w.parry"
                              [estimate]="w.parry !== '—'"
                              estTip="buildParryTip"
                              [parts]="w.parryParts"
                              [desc]="(w.shield ? 'buildWithShield' : 'buildNoShield') | transloco"
                            ></div>
                            @for (p of w.perks; track $index) {
                              <div
                                app-stat-row
                                [label]="p.label"
                                [value]="p.value"
                                [desc]="'buildPerkTip' | transloco: { d: p.desc }"
                              ></div>
                            }
                            @if (w.gem; as e) {
                              <div
                                app-stat-row
                                class="gem-row"
                                labelKey="equipGemSet"
                                [value]="
                                  gems.text(e.gem.name) +
                                  ' · ' +
                                  ('charLevel' | transloco) +
                                  ' ' +
                                  e.level
                                "
                                [desc]="e.text"
                              ></div>
                              @for (l of e.lines; track $index) {
                                <div
                                  app-stat-row
                                  [label]="l.name"
                                  [value]="l.text"
                                  [estimate]="l.estimate"
                                  estTip="buildGemTip"
                                ></div>
                              }
                            }
                            @if (w.block !== '—') {
                              <div app-stat-row labelKey="buildRow_block" [value]="w.block"></div>
                            }
                          </dl>
                        } @empty {
                          <p class="note">{{ 'buildNoWeapon' | transloco }}</p>
                        }
                        <h3>{{ 'buildWeapon' | transloco }}</h3>
                        <dl>
                          @for (r of rows('weapon'); track r.key) {
                            <div
                              app-stat-row
                              [label]="r.label"
                              [labelKey]="'buildRow_' + r.key"
                              [value]="r.value"
                              [estimate]="r.estimate"
                              [parts]="r.parts"
                              [desc]="r.desc"
                            ></div>
                          }
                        </dl>
                      </div>
                    </div>
                  }
                  @case ('protection') {
                    <dl class="lines">
                      <div>
                        <dt>{{ 'buildRow_block' | transloco }}</dt>
                        <dd>{{ guard().block }}</dd>
                      </div>
                      <div>
                        <dt>
                          {{ 'buildRow_parry' | transloco }}
                          @if (guard().by; as by) {
                            ({{ by }})
                          }
                        </dt>
                        <dd>
                          @if (guard().parry !== '—') {
                            <span class="est" [title]="'buildParryTip' | transloco">{{
                              'buildEstimate' | transloco
                            }}</span>
                          }
                          {{ guard().parry }}
                        </dd>
                      </div>
                    </dl>
                    <table>
                      <caption class="sr">
                        {{
                          'buildTab_protection' | transloco
                        }}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col"></th>
                          <th scope="col">{{ 'buildArmor' | transloco }}</th>
                          <th scope="col">{{ 'buildResistance' | transloco }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (p of prot(); track p.kind) {
                          <tr>
                            <th scope="row">{{ 'buildArmor_' + p.kind | transloco }}</th>
                            <td>{{ p.armor }}</td>
                            <td>
                              {{
                                p.resistance === null
                                  ? '—'
                                  : (p.resistance > 0 ? '+' : '') + p.resistance + '%'
                              }}
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                    <p class="note">{{ 'buildNoteArmor' | transloco }}</p>
                  }
                }
              </div>
            </section>
          </div>
        </div>
      </div>
    }
  `,
  styleUrl: './build.css',
})
export class Build {
  protected readonly gear = inject(GearService);
  protected readonly gems = inject(GemsService);
  protected readonly planner = inject(PlannerStore);
  protected readonly views = inject(ViewStore);
  private readonly skills = inject(SkillsService);
  private readonly settings = inject(GameSettingsStore);

  /** The world factor a value reads (WORLD_KEY), and its tooltip line when it is not the default 1. */
  private factor(what: keyof typeof WORLD_KEY): number {
    return worldFactor(this.settings.values(), WORLD_KEY[what]);
  }
  private worldTip(what: keyof typeof WORLD_KEY): TipPart[] {
    const k = this.factor(what);
    return k === 1 ? [] : [{ key: 'tipWorld', text: `×${k}` }];
  }

  protected readonly tabs = TABS;
  protected readonly tab = signal<Tab>('bases');
  protected readonly saves = signal(false);
  /** The attributes section under the character sheet. */

  private readonly constants = computed(() => this.gear.data()?.constants ?? {});
  protected readonly maxLevel = computed(() =>
    Math.min(this.constants()['playerLevelCap'] ?? 200, 200),
  );
  protected readonly maxFlame = computed(() =>
    Math.min(this.constants()['flameLevelMax'] ?? 50, FLAME_MAX),
  );
  private readonly pieces = computed(() =>
    worn(
      this.constants(),
      this.planner.inHand(),
      this.gear.data()?.items ?? {},
      this.planner.upgrades(),
      this.planner.itemLevels(),
    ),
  );
  private readonly sums = computed(() => statSums(this.pieces()));
  /** The same items without their upgrades: the game's tooltip lists only their own lines as Equipment. */
  private readonly ownSums = computed(() =>
    statSums(
      worn(
        this.constants(),
        this.planner.inHand(),
        this.gear.data()?.items ?? {},
        {},
        this.planner.itemLevels(),
      ),
    ),
  );

  protected readonly xpNext = computed(() =>
    this.planner.level() >= this.maxLevel() ? '—' : `${xpToNext(this.planner.level())}`,
  );
  protected readonly xpAll = computed(() => `${xpTotal(this.planner.level())}`);
  protected readonly points = computed(() => levelPoints(this.planner.level()));
  protected readonly altars = computed(() => altars(this.planner.flame()));
  protected readonly frost = computed(() => frostProtection(this.planner.flame()));
  /** Flame (wiki, estimation) + the Inner Fires skill (FogResistance_MaxAdder, in seconds). */
  protected readonly shroud = computed(() => {
    const m = shroudMinutes(this.planner.flame(), this.factor('shroud'));
    return m === null ? null : round1(m + (this.fx()['FogResistance_MaxAdder'] ?? 0) / 60);
  });
  private readonly player = computed(() => this.gear.data()?.player);
  /** What the taken skill nodes add to the game's attributes. */
  private readonly fx = computed(() => {
    const t = this.skills.tree();
    return t ? effectTotals(t, this.planner.levels()) : {};
  });

  protected readonly flameBonus = computed(
    () => Math.max(0, this.planner.flame() - 1) * (this.constants()['apPerFlameLevel'] ?? 0),
  );

  /** Skills + Flame: exact. */
  protected readonly attrs = computed(() => {
    const tree = this.skills.tree();
    const fromSkills = tree
      ? attributes(tree, this.planner.levels())
      : (Object.fromEntries(ATTRS.map((a) => [a, 0])) as ReturnType<typeof attributes>);
    const extra = tree
      ? flameSkillBonus(tree, this.planner.levels(), this.planner.flame())
      : fromSkills;
    const total = attributeTotals(this.constants(), fromSkills, this.planner.flame());
    const flame = this.flameBonus();
    return ATTRS.map((key) => {
      const sum = total[key] + extra[key];
      return {
        key,
        total: sum,
        estimate: false,
        parts: tipParts(
          [
            { key: 'flame', value: flame },
            { key: 'skills', value: sum - flame },
          ],
          (n) => `${n}`,
        ),
        desc: this.tip(ATTR_TEXT[key] ?? key, this.attrPerPoint(key)),
      };
    });
  });

  protected readonly main = computed(() => {
    const total = Object.fromEntries(this.attrs().map((a) => [a.key, a.total])) as Parameters<
      typeof vitals
    >[1];
    const world = this.settings.values();
    const v = vitals(this.constants(), total, this.sums(), this.fx(), world);
    const pct = (n: number) => `${n >= 0 ? '+' : ''}${n}%`;
    const parts = vitalParts(
      this.constants(),
      total,
      this.sums(),
      this.fx(),
      this.ownSums(),
      world,
    );
    const row = (key: keyof typeof v, value: string, estimate: boolean, text = key as string) => ({
      key,
      label: null,
      value,
      estimate,
      parts: [
        ...tipParts(parts[key], (n) =>
          key === 'melee' || key === 'ranged' || key === 'magic'
            ? `${round1(n)}%`
            : key === 'oxygen'
              ? `${n}s`
              : `${n}`,
        ),
        ...(key in WORLD_KEY ? this.worldTip(key as keyof typeof WORLD_KEY) : []),
      ],
      desc: this.tip(text),
    });
    return [
      row('health', `${v.health}`, false),
      row('mana', `${v.mana}`, false),
      row('stamina', `${v.stamina}`, false),
      row('melee', pct(v.melee), true, 'damageMelee'),
      row('ranged', pct(v.ranged), false, 'damageRanged'),
      row('magic', pct(v.magic), true, 'damageMagic'),
      row('oxygen', `${v.oxygen}s`, false),
    ];
  });

  /** Passage level = Flame level; Shroud time = 4 min + Flame level + Inner Fires (estimations, wiki). */
  protected readonly passage = computed(() => ({
    parts: tipParts([{ key: 'flame', value: this.planner.flame() }], (n) => `${n}`),
    desc: this.tip('fogResistance'),
  }));
  /** (4 min + Flame) x the world's Shroud time factor, then Inner Fires. */
  protected readonly shroudTime = computed(() => ({
    parts: [
      ...tipParts(
        [
          { key: 'player', value: 4 },
          { key: 'flame', value: this.planner.flame() },
        ],
        (n) => `${round1(n)}m`,
      ),
      ...this.worldTip('shroud'),
      ...tipParts(
        [{ key: 'skills', value: (this.fx()['FogResistance_MaxAdder'] ?? 0) / 60 }],
        (n) => `${round1(n)}m`,
      ),
    ],
    desc: this.tip('fogResistanceDuration'),
  }));

  /** The game's description of an attribute (gear.json `texts`); `%k` = the per-point value. */
  private tip(name: string, k?: number): string | null {
    const names = this.gear.data()?.texts?.[`/rpgTerms/attributes/${name}/displayInfo/tooltip`];
    return names ? this.gear.text(names).replace('%k', `${k ?? ''}`) : null;
  }

  private attrPerPoint(key: string): number | undefined {
    const c = this.constants();
    return {
      constitution: c['playerHealthPerAP'],
      spirit: c['playerManaPerAP'],
      resistance: c['playerStaminaPerAP'],
    }[key as 'spirit'];
  }

  protected readonly prot = computed(() =>
    protection(this.constants(), this.pieces(), this.player() ? this.fx() : undefined),
  );
  protected readonly armor = computed(() => armorTotals(this.constants(), this.pieces()));
  /** A worn item with its upgrades and chosen level. */
  private slotItem(slot: SlotKey) {
    const item = this.gear.data()?.items[this.planner.gear()[slot] ?? ''];
    return item
      ? upgraded(
          this.constants(),
          item,
          this.planner.upgrades()[slot] ?? 0,
          this.planner.itemLevels()[slot],
        )
      : undefined;
  }

  /** Protection tab: block and parry of the weapon in hand, as the game's Attributes screen (parry names its item). */
  protected readonly guard = computed(() => {
    const c = this.constants();
    const slot = this.planner.active();
    const weapon = this.slotItem(slot);
    const shield = this.slotItem('shield');
    const k = this.factor('parry');
    const g = weapon
      ? weaponGuard(c, slot, weapon, shield, k)
      : { parry: shield ? parryPoints(c, shield, k) : null, by: shield, block: null };
    const block = weapon ? g.block : shield ? blockPoints(c, shield) : null;
    return {
      block: block === null ? '—' : `${block}`,
      parry: g.parry === null ? '—' : `${g.parry}`,
      by: g.parry !== null && g.by ? this.gear.text(g.by.name) : null,
    };
  });

  /**
   * Each weapon worn: its damage (base exact, the rest an estimation, see weaponDamage) and what it gives to defend
   * with the shield when it is one-handed (weaponGuard).
   */
  protected readonly weapons = computed(() => {
    const c = this.constants();
    const items = this.gear.data()?.items ?? {};
    const gear = this.planner.gear();
    const ups = this.planner.upgrades();
    const at = (slot: SlotKey) => this.slotItem(slot);
    const shield = at('shield');
    const v = vitals(
      c,
      Object.fromEntries(this.attrs().map((a) => [a.key, a.total])) as Parameters<typeof vitals>[1],
      this.sums(),
      this.fx(),
    );
    const byAttr: Record<string, number> = {
      strength: v.melee,
      dexterity: v.ranged,
      intelligence: v.magic,
    };
    const pct = (n: number) => `${n >= 0 ? '+' : ''}${round1(n)}%`;
    return (['weapon1', 'weapon2', 'weapon3', 'ranged'] as const).flatMap((slot) => {
      const item = at(slot);
      if (!item?.damage) return [];
      const attr = item.damage.attr;
      const d = weaponDamage(
        c,
        item,
        attr ? (byAttr[attr] ?? 0) : 0,
        weaponClassPct(item, this.player(), this.fx()),
      );
      const g = weaponGuard(c, slot, item, shield, this.factor('parry'));
      // the damage perks taken, apart: how they add to the hit is in the game's code, not in its data
      const perks = (items[gear[slot] ?? '']?.upgrades ?? [])
        .slice(0, ups[slot] ?? 0)
        .flatMap((u) => {
          const line = this.gear.perkLine(item, u)?.split(' — ');
          return line && u.damage?.label
            ? [{ label: this.gear.text(u.damage.label), value: line[0], desc: line[1] }]
            : [];
        });
      return [
        {
          slot,
          name: this.gear.text(item.name),
          damage: d ? `${d.total}` : '—',
          damageParts: d
            ? [
                { key: 'tipWeaponBase', text: `${d.base} (${item.lvl[1]})` },
                { key: 'equipDamageFactor', text: `×${d.factor}` },
                ...(attr && d.attr ? [{ key: `skillAttr_${attr}`, text: pct(d.attr) }] : []),
                ...(d.cls ? [{ key: 'tipWeaponClass', text: pct(d.cls) }] : []),
              ]
            : [],
          shield: g.shield,
          parry: g.parry === null ? '—' : `${g.parry}`,
          parryParts:
            g.parry === null
              ? []
              : [
                  {
                    key: g.shield ? 'equipSlot_shield' : 'tipWeapon',
                    text: `${g.parry} (${g.by.lvl[1]})`,
                  },
                  ...this.worldTip('parry'),
                ],
          block: g.block === null ? '—' : `${g.block}`,
          perks,
          // a gem's effects are triggers (crit, kill, block...): shown with the weapon, never in the totals
          gem: this.gems.effect(this.planner.gems()[slot]),
        },
      ];
    });
  });

  private readonly defs = {
    misc: miscRows,
    regen: regenRows,
    damage: damageRows,
    against: againstRows,
    weapon: weaponRows,
  };

  /** Base values of the player template + skills + worn items; without them (older gear.json) only the items' lines. */
  private readonly table = computed(() => {
    const sums = this.sums();
    const player = this.player();
    const fx = this.fx();
    const texts = this.gear.data()?.texts;
    return Object.fromEntries(
      Object.entries(this.defs).map(([group, defs]) => [
        group,
        defs.map((d): Row => {
          // the game computes with 0 frost resistance, so no "—" when no worn piece has the line
          const value = rowValue(d, player, fx, sums) ?? (d.key === 'frost' ? 0 : null);
          const p = rowParts(d, player, fx, sums);
          const f = (n: number) => formatRow(round2(n), { ...d, plain: true });
          return {
            parts: p
              ? tipParts(
                  [
                    { key: 'player', value: p.base },
                    { key: 'equipment', value: p.equip },
                    { key: 'skills', value: p.skills },
                  ],
                  f,
                )
              : [],
            desc: this.tip(d.text ?? ''),
            key: d.key,
            label: this.label(d, texts),
            value: formatRow(value, d),
            estimate: !!d.est && value !== null && player !== undefined,
          };
        }),
      ]),
    ) as Record<Group, Row[]>;
  });

  /** Frost resistance duration (exact formula; the resistance counts the worn items only: food and fires add to it in game). */
  private readonly frostDuration = computed<Row | null>(() => {
    const c = this.constants();
    const r = lineSum(this.sums(), ['Frost Resistance'], 'Normal') ?? 0;
    const s = frostSeconds(c, r, this.factor('bodyHeat'));
    if (s === null) return null;
    const names =
      this.gear.data()?.texts?.[
        '/rpgTerms/attributes/freezeResistRemainingDuration/displayInfo/label'
      ];
    const t = Math.round(s);
    return {
      key: 'frostDuration',
      label: names ? this.gear.text(names) : null,
      value: t >= 60 ? `${Math.floor(t / 60)} min ${t % 60} s` : `${t}s`,
      estimate: false,
      parts: [
        { key: 'tipFrostResistance', text: `${r}` },
        {
          key: 'tipFrostFormula',
          text: `(${r} + 1) × ${c['freezeDurationFactor']} − ${c['freezeDurationOffset']}`,
        },
        ...this.worldTip('bodyHeat'),
      ],
      desc: this.tip('freezeResistRemainingDuration'),
    };
  });

  protected rows(group: Group): Row[] {
    const frost = group === 'misc' ? this.frostDuration() : null;
    return frost ? [...this.table()[group], frost] : this.table()[group];
  }

  private label(d: RowDef, texts: Record<string, Names> | undefined) {
    const path = `/rpgTerms/attributes/${d.text}/displayInfo/`;
    const names = d.text
      ? (d.alt && texts?.[path + 'alternativeLabel']) || texts?.[path + 'label']
      : undefined;
    return names ? this.gear.text(names) : null;
  }

  protected setLevel(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.planner.setLevel(input.valueAsNumber);
    input.value = `${this.planner.level()}`;
  }

  /** Rested duration, exact (game formula); the comfort level is the points entered, capped at 255. */
  private readonly restedMin = computed(() => {
    const c = this.gems.data()?.comfort?.constants ?? {};
    if (c['comfortBase'] === undefined || c['comfortFactor'] === undefined) return null;
    return restedMinutes(
      c['comfortBase'],
      c['comfortFactor'],
      this.planner.comfort(),
      5 + (this.fx()['Rested_MinDuration'] ?? 0),
    );
  });
  protected readonly rested = computed(() => {
    const m = this.restedMin();
    return m === null ? '—' : `${Math.floor(m)} min ${Math.round((m % 1) * 60)} s`;
  });
  protected readonly comfortParts = computed<TipPart[]>(() => {
    const c = this.gems.data()?.comfort?.constants ?? {};
    return [
      { key: 'tipComfort', text: `${Math.min(255, this.planner.comfort())}` },
      ...(c['comfortBase'] !== undefined
        ? [{ key: 'tipComfortBase', text: `${c['comfortBase']}` }]
        : []),
      ...(c['comfortFactor'] !== undefined
        ? [{ key: 'tipComfortFactor', text: `${round2(c['comfortFactor'])}` }]
        : []),
      { key: 'tipRestedMin', text: `${5 + (this.fx()['Rested_MinDuration'] ?? 0)} min` },
    ];
  });

  protected setComfort(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.planner.setComfort(input.valueAsNumber);
    input.value = `${this.planner.comfort()}`;
  }

  protected setFlame(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.planner.setFlame(input.valueAsNumber);
    input.value = `${this.planner.flame()}`;
  }
}
