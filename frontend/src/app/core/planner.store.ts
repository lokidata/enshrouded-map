import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  add,
  canAdd,
  canRemove,
  decode,
  encode,
  fromSaved,
  remove,
  spent,
  toSaved,
} from './skills.logic';
import { FLAME_MAX } from './gear.logic';
import { GEAR_SLOTS, Gear, SlotKey, Upgrades } from './gear.model';
import { Levels, SavedBuild } from './skills.model';
import { GearService } from './gear.service';
import { SkillsService } from './skills.service';
import { GemPick } from './gems.model';
import { GemsService } from './gems.service';
import { gemLevel } from './gems.logic';

const MAX_UPGRADES = 8; // as the API
const MAX_GEM_LEVEL = 200; // as the API
export type Gems = Partial<Record<WeaponSlot, GemPick>>;
const DRAFT = 'skillDraft';
const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(Math.trunc(n) || min, min), max);

export const WEAPON_SLOTS = ['weapon1', 'weapon2', 'weapon3', 'ranged'] as const;
export type WeaponSlot = (typeof WEAPON_SLOTS)[number];
const isWeapon = (k: string) => (WEAPON_SLOTS as readonly string[]).includes(k);
function readLevels(): Upgrades {
  try {
    const raw = JSON.parse(localStorage.getItem('itemLevels') ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(raw).filter(([k, v]) => isSlot(k) && Number.isInteger(v) && (v as number) > 0),
    ) as Upgrades;
  } catch {
    return {};
  }
}
const isSlot = (k: string) => (GEAR_SLOTS as readonly string[]).includes(k);
function readActive(): WeaponSlot {
  try {
    const v = localStorage.getItem('activeWeapon');
    return WEAPON_SLOTS.find((s) => s === v) ?? 'weapon1';
  } catch {
    return 'weapon1';
  }
}

/** The build being planned, and the builds the player saved (api/v1/builds). */
@Injectable({ providedIn: 'root' })
export class PlannerStore {
  private readonly http = inject(HttpClient);
  private readonly skills = inject(SkillsService);
  private readonly gearData = inject(GearService);
  private readonly gemsData = inject(GemsService);

  private readonly draft = this.readDraft();
  readonly levels = signal<Levels>(this.draft.levels);
  /** Character level and Flame level, and what is worn (see gear.json). */
  readonly level = signal(this.draft.level);
  readonly flame = signal(this.draft.flame);
  /** Comfort points of the player's house (not saved in builds). */
  readonly comfort = signal(this.draft.comfort);
  readonly gear = signal<Gear>(this.draft.gear);
  /** The arrow the DPS counts with a bow (an `ammo` guid of gear.json); one type only. Saved in builds as gear.arrow. */
  readonly arrow = signal<string | null>(this.draft.arrow);
  /** How many of each worn piece's upgrades are taken. */
  readonly upgrades = signal<Upgrades>(this.draft.upgrades);
  /** The gem set in each weapon slot, at its level. */
  readonly gems = signal<Gems>(this.draft.gems);
  /** The weapon in hand: only its stat lines count in the totals (the others stay in the bag). */
  readonly active = signal<WeaponSlot>(readActive());
  /** What is worn without the weapons that are not in hand. */
  readonly inHand = computed<Gear>(() =>
    Object.fromEntries(
      Object.entries(this.gear()).filter(([k]) => !isWeapon(k) || k === this.active()),
    ),
  );
  /** Base level chosen per slot (between the item's minimum and maximum), on top of its upgrades; device only. */
  readonly itemLevels = signal<Upgrades>(readLevels());
  readonly name = signal('');
  readonly saved = signal<readonly SavedBuild[]>([]);
  /** The saved build being edited; null for a new one. */
  readonly currentId = signal<number | null>(null);
  readonly error = signal<'too_many' | 'failed' | null>(null);

  readonly used = computed(() => {
    const tree = this.skills.tree();
    return tree ? spent(tree, this.levels()) : 0;
  });
  readonly budget = computed(() => this.skills.data()?.budget ?? 0);

  setActive(slot: WeaponSlot): void {
    this.active.set(slot);
    try {
      localStorage.setItem('activeWeapon', slot);
    } catch {
      // storage blocked: the choice is just not kept
    }
  }

  canAdd(id: number): boolean {
    const tree = this.skills.tree();
    return !!tree && canAdd(tree, this.levels(), id, this.budget());
  }

  canRemove(id: number): boolean {
    const tree = this.skills.tree();
    return !!tree && canRemove(tree, this.levels(), id);
  }

  addLevel(id: number): void {
    if (this.canAdd(id)) this.set(add(this.levels(), id));
  }

  removeLevel(id: number): void {
    if (this.canRemove(id)) this.set(remove(this.levels(), id));
  }

  reset(): void {
    this.setAll({}, 1, 0, {}, {}, {});
    this.arrow.set(null);
    this.writeDraft();
  }

  setArrow(id: string | null): void {
    this.arrow.set(id);
    this.writeDraft();
  }

  setLevel(level: number): void {
    this.level.set(clamp(level, 1, this.limit('playerLevelCap', 200)));
    this.writeDraft();
  }

  setFlame(flame: number): void {
    this.flame.set(clamp(flame, 0, Math.min(this.limit('flameLevelMax', 50), FLAME_MAX)));
    this.writeDraft();
  }

  setComfort(points: number): void {
    this.comfort.set(clamp(points, 0, 100000));
    this.writeDraft();
  }

  /** Wears an item in a slot, or takes the slot's item off (null). */
  wear(slot: SlotKey, item: string | null): void {
    const next: Partial<Record<SlotKey, string>> = { ...this.gear() };
    if (item) next[slot] = item;
    else delete next[slot];
    if (next[slot] !== this.gear()[slot]) {
      this.setUpgrades(slot, 0, false);
      if (isWeapon(slot)) this.setGem(slot as WeaponSlot, null, false);
      this.setItemLevel(slot, null);
    }
    this.gear.set(next);
    this.writeDraft();
  }

  /** The base level of the piece in a slot (null = its maximum). */
  setItemLevel(slot: SlotKey, level: number | null): void {
    const next: Partial<Record<SlotKey, number>> = { ...this.itemLevels() };
    if (level) next[slot] = Math.trunc(level);
    else delete next[slot];
    this.itemLevels.set(next);
    try {
      localStorage.setItem('itemLevels', JSON.stringify(next));
    } catch {
      // storage blocked: the level is just not kept
    }
  }

  /** The first `count` upgrades of the piece in a slot are taken (0 = none). */
  setUpgrades(slot: SlotKey, count: number, write = true): void {
    const next: Partial<Record<SlotKey, number>> = { ...this.upgrades() };
    if (count > 0) next[slot] = count;
    else delete next[slot];
    this.upgrades.set(next);
    if (write) this.writeDraft();
  }

  /** Sets a gem in a weapon slot at a level (clamped to the gem's range), or takes it out (null). */
  setGem(slot: WeaponSlot, pick: GemPick | null, write = true): void {
    const next: Gems = { ...this.gems() };
    if (pick) {
      const gem = this.gemsData.gems().find((g) => g.id === pick.id);
      next[slot] = {
        id: pick.id,
        level: gem ? gemLevel(gem, pick.level) : clamp(pick.level, 1, MAX_GEM_LEVEL),
      };
    } else delete next[slot];
    this.gems.set(next);
    if (write) this.writeDraft();
  }

  /** A new, empty build. */
  create(): void {
    this.currentId.set(null);
    this.name.set('');
    this.error.set(null);
    this.reset();
  }

  open(build: SavedBuild): void {
    const tree = this.skills.tree();
    this.currentId.set(build.id);
    this.name.set(build.name);
    this.error.set(null);
    this.setAll(
      tree ? fromSaved(tree, build.nodes) : {},
      build.level,
      build.flame,
      Object.fromEntries(Object.entries(build.gear).filter(([k]) => k !== 'arrow')),
      fromIndices(build.upgrades ?? {}),
      readGems(build.gems ?? {}),
    );
    this.arrow.set((build.gear as Record<string, string>)['arrow'] ?? null);
    this.writeDraft();
  }

  async load(): Promise<void> {
    try {
      this.saved.set(await firstValueFrom(this.http.get<SavedBuild[]>('api/v1/builds')));
    } catch {
      this.saved.set([]);
    }
  }

  clear(): void {
    this.saved.set([]);
    this.currentId.set(null);
    this.name.set('');
    this.error.set(null);
    this.reset();
  }

  /** Saves the build under its name: a new one, or an update of the one being edited. */
  async save(): Promise<void> {
    const body = {
      name: this.name().trim() || `Build ${this.saved().length + 1}`,
      nodes: toSaved(this.levels()),
      level: this.level(),
      flame: this.flame(),
      gear: { ...this.gear(), ...(this.arrow() ? { arrow: this.arrow()! } : {}) },
      upgrades: toIndices(this.upgrades()),
      gems: this.gems(),
    };
    this.error.set(null);
    try {
      const id = this.currentId();
      const result = await firstValueFrom(
        id === null
          ? this.http.post<SavedBuild>('api/v1/builds', body)
          : this.http.put<SavedBuild>(`api/v1/builds/${id}`, body),
      );
      this.currentId.set(result.id);
      this.name.set(result.name);
      this.saved.update((list) => [result, ...list.filter((b) => b.id !== result.id)]);
    } catch (e) {
      this.error.set((e as { status?: number }).status === 409 ? 'too_many' : 'failed');
    }
  }

  async delete(id: number): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(`api/v1/builds/${id}`));
      this.saved.update((list) => list.filter((b) => b.id !== id));
      if (this.currentId() === id) this.currentId.set(null);
    } catch {
      this.error.set('failed');
    }
  }

  /** A link that opens this build on the planner. */
  link(): string {
    const data = this.skills.data();
    return `${location.origin}${location.pathname}#build=${data ? encode(data, this.levels()) : ''}`;
  }

  /** Opens the build named by the address (`#build=<code>`); true when there is one. */
  openFromHash(): boolean {
    const code = new URLSearchParams(location.hash.slice(1)).get('build');
    const data = this.skills.data();
    if (code === null || !data) return false;
    this.currentId.set(null);
    this.name.set('');
    this.set(decode(data, code));
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }

  private set(levels: Levels): void {
    this.levels.set(levels);
    this.writeDraft();
  }

  private setAll(
    levels: Levels,
    level: number,
    flame: number,
    gear: Gear,
    upgrades: Upgrades,
    gems: Gems,
  ): void {
    this.upgrades.set(upgrades);
    this.gems.set(gems);
    this.levels.set(levels);
    this.level.set(level);
    this.flame.set(flame);
    this.gear.set(gear);
    this.writeDraft();
  }

  /** A maximum from gear.json, else the API's own. */
  private limit(key: string, api: number): number {
    return Math.min(this.gearData.data()?.constants[key] ?? api, api);
  }

  private readDraft(): {
    levels: Levels;
    level: number;
    flame: number;
    comfort: number;
    gear: Gear;
    arrow: string | null;
    upgrades: Upgrades;
    gems: Gems;
  } {
    try {
      const raw = JSON.parse(localStorage.getItem(DRAFT) ?? '{}') as Record<string, unknown>;
      // before the Build screen the draft was only the levels
      const levels = (raw['levels'] ?? raw) as Record<string, number>;
      const gear = Object.fromEntries(
        Object.entries((raw['gear'] ?? {}) as Record<string, unknown>).filter(
          ([k, v]) => (GEAR_SLOTS as readonly string[]).includes(k) && typeof v === 'string',
        ),
      );
      return {
        levels: Object.fromEntries(
          Object.entries(levels).filter(([, l]) => Number.isInteger(l) && l > 0),
        ),
        level: clamp(Number(raw['level']) || 1, 1, 200),
        flame: clamp(Number(raw['flame']) || 0, 0, 50),
        comfort: clamp(Number(raw['comfort']) || 0, 0, 100000),
        gear,
        arrow: typeof raw['arrow'] === 'string' ? raw['arrow'] : null,
        upgrades: Object.fromEntries(
          Object.entries((raw['upgrades'] ?? {}) as Record<string, unknown>).filter(
            ([k, v]) =>
              k in gear &&
              Number.isInteger(v) &&
              (v as number) > 0 &&
              (v as number) <= MAX_UPGRADES,
          ),
        ),
        gems: readGems((raw['gems'] ?? {}) as Record<string, unknown>),
      };
    } catch {
      return {
        levels: {},
        level: 1,
        flame: 0,
        comfort: 0,
        gear: {},
        arrow: null,
        upgrades: {},
        gems: {},
      };
    }
  }

  private writeDraft(): void {
    try {
      localStorage.setItem(
        DRAFT,
        JSON.stringify({
          levels: this.levels(),
          level: this.level(),
          flame: this.flame(),
          comfort: this.comfort(),
          gear: this.gear(),
          arrow: this.arrow(),
          upgrades: this.upgrades(),
          gems: this.gems(),
        }),
      );
    } catch {
      // storage blocked: the draft is just not kept between visits
    }
  }
}

/** Saved as the indices 0..n-1 (the API allows any list; the chain is a count here). */
const toIndices = (u: Upgrades): Record<string, number[]> =>
  Object.fromEntries(
    Object.entries(u).map(([k, n]) => [k, Array.from({ length: n }, (_, i) => i)]),
  );
const fromIndices = (u: Record<string, number[]>): Upgrades =>
  Object.fromEntries(
    Object.entries(u)
      .filter(([, l]) => l.length)
      .map(([k, l]) => [k, l.length]),
  );

/** Gems of a draft or a saved build: weapon slots with a gem id and a level in the API's range. */
function readGems(raw: Record<string, unknown>): Gems {
  return Object.fromEntries(
    Object.entries(raw).flatMap(([k, v]) => {
      const p = v as Partial<GemPick> | null;
      return isWeapon(k) && typeof p?.id === 'string' && Number.isInteger(p.level)
        ? [[k, { id: p.id, level: clamp(p.level!, 1, MAX_GEM_LEVEL) }]]
        : [];
    }),
  );
}
