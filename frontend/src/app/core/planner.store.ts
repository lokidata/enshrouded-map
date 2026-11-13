import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { keepalivePut } from './keepalive';
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
const LEVELS = 'itemLevels';
const ACTIVE = 'activeWeapon';
/** Where the server's copy stood when this browser last synced, and whether this browser holds changes it has not sent. */
const STAMP = 'sheetStamp';
const DIRTY = 'sheetDirty';
/** Each character profile keeps its own sheet in this browser: the keys carry the profile id. */
const keyOf = (base: string, id: number): string => `${base}:${id}`;
const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(Math.trunc(n) || min, min), max);

export const WEAPON_SLOTS = ['weapon1', 'weapon2', 'weapon3', 'ranged'] as const;
export type WeaponSlot = (typeof WEAPON_SLOTS)[number];
const isWeapon = (k: string) => (WEAPON_SLOTS as readonly string[]).includes(k);
function cleanLevels(raw: Record<string, unknown>): Upgrades {
  return Object.fromEntries(
    Object.entries(raw).filter(([k, v]) => isSlot(k) && Number.isInteger(v) && (v as number) > 0),
  ) as Upgrades;
}
function readLevels(id: number | null): Upgrades {
  if (id === null) return {};
  try {
    return cleanLevels(JSON.parse(localStorage.getItem(keyOf(LEVELS, id)) ?? '{}'));
  } catch {
    return {};
  }
}
const isSlot = (k: string) => (GEAR_SLOTS as readonly string[]).includes(k);
const cleanActive = (v: unknown): WeaponSlot => WEAPON_SLOTS.find((s) => s === v) ?? 'weapon1';
function readActive(id: number | null): WeaponSlot {
  if (id === null) return 'weapon1';
  try {
    return cleanActive(localStorage.getItem(keyOf(ACTIVE, id)));
  } catch {
    return 'weapon1';
  }
}
const PUSH_DELAY_MS = 800;

interface Draft {
  levels: Levels;
  level: number;
  flame: number;
  comfort: number;
  gear: Gear;
  arrow: string | null;
  upgrades: Upgrades;
  gems: Gems;
}

/** The build being planned, and the builds the player saved (api/v1/builds). */
@Injectable({ providedIn: 'root' })
export class PlannerStore {
  private readonly http = inject(HttpClient);
  private readonly skills = inject(SkillsService);
  private readonly gearData = inject(GearService);
  private readonly gemsData = inject(GemsService);

  /** The character profile whose sheet this is (null before the login: nothing is read or written). */
  private profile: number | null = null;
  private touched = false; // the player changed the sheet since the profile was opened
  private stamp: string | null = null; // updated_at of the server copy this sheet is based on
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private unsent: number | null = null; // the profile whose last change is still waiting to be sent
  private readonly draft = this.readDraft(null);
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
  readonly active = signal<WeaponSlot>('weapon1');
  /** What is worn without the weapons that are not in hand. */
  readonly inHand = computed<Gear>(() =>
    Object.fromEntries(
      Object.entries(this.gear()).filter(([k]) => !isWeapon(k) || k === this.active()),
    ),
  );
  /** Base level chosen per slot (between the item's minimum and maximum), on top of its upgrades; device only. */
  readonly itemLevels = signal<Upgrades>({});
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
    if (this.profile === null) return;
    this.schedulePush();
    try {
      localStorage.setItem(keyOf(ACTIVE, this.profile), slot);
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

  /** The skills only: the character's level, equipment and gems are not part of a skill build. */
  reset(): void {
    this.set({});
  }

  /** Everything: a new session or a profile with nothing yet. */
  private resetAll(): void {
    this.setAll({}, 1, 0, {}, {}, {});
    this.arrow.set(null);
    this.writeDraft();
  }

  /**
   * The character as a save has it: its level, its skills and the worn pieces of the fixed slots (armour, rings,
   * shield, weapons, ranged) with their base level, upgrades and gem. The Flame level and the comfort are left as
   * they were. The skill build that was open is closed.
   */
  applyCharacter(sheet: {
    level: number;
    skills: Levels;
    gear: Partial<Record<SlotKey, { guid: string; base: number | null; upgrades: number }>>;
    gems?: Gems;
  }): void {
    const gear: Record<string, string> = { ...this.gear() };
    const upgrades: Record<string, number> = { ...this.upgrades() };
    const levels: Record<string, number> = { ...this.itemLevels() };
    const gems: Gems = { ...this.gems() };
    for (const [slot, w] of Object.entries(sheet.gear)) {
      gear[slot] = w.guid;
      if (isWeapon(slot)) {
        const g = sheet.gems?.[slot as WeaponSlot];
        if (g) gems[slot as WeaponSlot] = g;
        else delete gems[slot as WeaponSlot];
      }
      if (w.upgrades > 0) upgrades[slot] = Math.min(w.upgrades, MAX_UPGRADES);
      else delete upgrades[slot];
      if (w.base !== null) levels[slot] = w.base;
      else delete levels[slot];
    }
    this.currentId.set(null);
    this.name.set('');
    this.setAll(
      sheet.skills,
      clamp(sheet.level, 1, this.limit('playerLevelCap', 200)),
      this.flame(),
      gear,
      upgrades,
      gems,
    );
    this.itemLevels.set(levels);
    if (this.profile === null) return;
    this.schedulePush();
    try {
      localStorage.setItem(keyOf(LEVELS, this.profile), JSON.stringify(levels));
    } catch {
      // storage blocked: the levels are just not kept
    }
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
    if (this.profile === null) return;
    this.schedulePush();
    try {
      localStorage.setItem(keyOf(LEVELS, this.profile), JSON.stringify(next));
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

  /** A new, empty skill build. */
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
    this.set(tree ? fromSaved(tree, build.nodes) : {});
  }

  async load(): Promise<void> {
    try {
      this.saved.set(await firstValueFrom(this.http.get<SavedBuild[]>('api/v1/builds')));
    } catch {
      this.saved.set([]);
    }
  }

  /**
   * The player follows this character profile (null: none): its sheet (level, Flame, equipment, gems,
   * skills, comfort) is read back, and its builds are listed, none of them open. The first version kept one
   * sheet per browser: the first profile that asks takes it.
   */
  async switchProfile(id: number | null): Promise<void> {
    await this.flush(); // the last change of the profile being left
    this.profile = null; // nothing is written while the sheet is swapped
    this.touched = false;
    this.stamp = null;
    this.currentId.set(null);
    this.name.set('');
    this.error.set(null);
    if (id !== null) this.adoptLegacy(id);
    const d = this.readDraft(id);
    this.levels.set(d.levels);
    this.level.set(d.level);
    this.flame.set(d.flame);
    this.comfort.set(d.comfort);
    this.gear.set(d.gear);
    this.arrow.set(d.arrow);
    this.upgrades.set(d.upgrades);
    this.gems.set(d.gems);
    this.itemLevels.set(readLevels(id));
    this.active.set(readActive(id));
    this.profile = id;
    await Promise.all([this.load(), id === null ? undefined : this.pullSheet(id)]);
  }

  /**
   * The server keeps the sheet of each profile, stamped with the time of its last write. This browser keeps the
   * stamp it last saw and whether it holds changes it did not send: changes made here on top of the server's
   * copy are sent; if the server's copy changed since (another device), it wins. `force` = the server just
   * refused a write: take its copy.
   */
  private async pullSheet(id: number, force = false): Promise<void> {
    try {
      const { sheet, updated_at } = await firstValueFrom(
        this.http.get<{ sheet: Record<string, unknown> | null; updated_at: string | null }>(
          `api/v1/characters/${id}/sheet`,
        ),
      );
      if (this.profile !== id) return;
      this.stamp = updated_at;
      if (sheet === null) {
        if (this.hasContent()) this.schedulePush(); // first time on the server: what this browser holds
        return;
      }
      const unsent =
        !force && (this.touched || (this.isDirty(id) && this.savedStamp(id) === updated_at));
      if (unsent) {
        this.saveStamp(id, updated_at);
        void this.push();
        return;
      }
      const d = this.parseDraft(sheet);
      this.levels.set(d.levels);
      this.level.set(d.level);
      this.flame.set(d.flame);
      this.comfort.set(d.comfort);
      this.gear.set(d.gear);
      this.arrow.set(d.arrow);
      this.upgrades.set(d.upgrades);
      this.gems.set(d.gems);
      this.itemLevels.set(cleanLevels((sheet['itemLevels'] ?? {}) as Record<string, unknown>));
      this.active.set(cleanActive(sheet['active']));
      this.unsent = null;
      clearTimeout(this.pushTimer);
      this.writeLocal();
      this.saveStamp(id, updated_at);
      this.setDirty(id, false);
      try {
        localStorage.setItem(keyOf(LEVELS, id), JSON.stringify(this.itemLevels()));
        localStorage.setItem(keyOf(ACTIVE, id), this.active());
      } catch {
        // storage blocked: the server copy is read again next time
      }
    } catch {
      // offline or an older server: this browser's copy stays
    }
  }

  private hasContent(): boolean {
    return (
      this.level() > 1 ||
      this.flame() > 0 ||
      this.comfort() > 0 ||
      Object.keys(this.gear()).length > 0 ||
      Object.keys(this.levels()).length > 0
    );
  }

  private isDirty(id: number): boolean {
    try {
      return localStorage.getItem(keyOf(DIRTY, id)) === '1';
    } catch {
      return false;
    }
  }

  private setDirty(id: number, on: boolean): void {
    try {
      if (on) localStorage.setItem(keyOf(DIRTY, id), '1');
      else localStorage.removeItem(keyOf(DIRTY, id));
    } catch {
      // storage blocked: the change is still sent this visit
    }
  }

  private savedStamp(id: number): string | null {
    try {
      return localStorage.getItem(keyOf(STAMP, id));
    } catch {
      return null;
    }
  }

  private saveStamp(id: number, stamp: string | null): void {
    this.stamp = stamp;
    try {
      if (stamp) localStorage.setItem(keyOf(STAMP, id), stamp);
      else localStorage.removeItem(keyOf(STAMP, id));
    } catch {
      // storage blocked: the next visit reads the server copy
    }
  }

  /** The sheet is sent a moment after the last change. */
  private schedulePush(): void {
    this.touched = true;
    const id = this.profile;
    if (id === null) return;
    this.setDirty(id, true);
    clearTimeout(this.pushTimer);
    this.unsent = id;
    this.pushTimer = setTimeout(() => void this.push(), PUSH_DELAY_MS);
  }

  /** Sends the changes still waiting (before the profile is left or the player logs out). */
  async flush(): Promise<void> {
    if (this.unsent !== null) await this.push();
  }

  /**
   * Writes the sheet on the server, based on the copy this browser last saw. A refusal (409) means another
   * device wrote since: its copy is taken. Any other failure is silent: the changes stay marked as unsent.
   */
  private async push(): Promise<void> {
    const id = this.profile;
    if (id === null) return;
    clearTimeout(this.pushTimer);
    this.unsent = null;
    try {
      const saved = await firstValueFrom(
        this.http.put<{ updated_at: string }>(`api/v1/characters/${id}/sheet`, this.sheetBody()),
      );
      if (this.profile !== id) return;
      this.saveStamp(id, saved.updated_at);
      if (this.unsent === null) this.setDirty(id, false); // nothing changed while it was on its way
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 409) await this.pullSheet(id, true);
    }
  }

  private sheetBody(): { settings: Record<string, unknown>; base: string | null } {
    return {
      settings: { ...this.draftObject(), itemLevels: this.itemLevels(), active: this.active() },
      base: this.stamp,
    };
  }

  /** Leaving the page right after a change: send it anyway (as SessionService does for the filters). */
  private readonly onLeave = addEventListener('pagehide', () => {
    if (this.unsent === null || this.unsent !== this.profile) return;
    keepalivePut(`api/v1/characters/${this.unsent}/sheet`, this.sheetBody());
  });

  /** A deleted profile's sheet goes with it. */
  forgetProfile(id: number): void {
    this.wipe([
      keyOf(DRAFT, id),
      keyOf(LEVELS, id),
      keyOf(ACTIVE, id),
      keyOf(STAMP, id),
      keyOf(DIRTY, id),
    ]);
  }

  clear(): void {
    this.profile = null;
    this.unsent = null;
    this.stamp = null;
    clearTimeout(this.pushTimer);
    this.saved.set([]);
    this.currentId.set(null);
    this.name.set('');
    this.error.set(null);
    this.resetAll();
    this.wipe(
      Object.keys(this.storage()).filter((k) =>
        [DRAFT, LEVELS, ACTIVE, STAMP, DIRTY].some((b) => k === b || k.startsWith(`${b}:`)),
      ),
    );
  }

  private storage(): Record<string, string> {
    try {
      return { ...localStorage };
    } catch {
      return {};
    }
  }

  private wipe(keys: string[]): void {
    try {
      for (const k of keys) localStorage.removeItem(k);
    } catch {
      // nothing to remove
    }
  }

  private adoptLegacy(id: number): void {
    try {
      for (const base of [DRAFT, LEVELS, ACTIVE]) {
        const old = localStorage.getItem(base);
        if (old !== null && localStorage.getItem(keyOf(base, id)) === null) {
          localStorage.setItem(keyOf(base, id), old);
          localStorage.removeItem(base);
        }
      }
    } catch {
      // storage blocked: nothing to move
    }
  }

  /** Saves the skills under a name: a new build, or an update of the one being edited. */
  async save(): Promise<void> {
    const body = {
      name: this.name().trim() || `Build ${this.saved().length + 1}`,
      nodes: toSaved(this.levels()),
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

  private readDraft(id: number | null): Draft {
    try {
      if (id === null) throw new Error('no profile');
      return this.parseDraft(JSON.parse(localStorage.getItem(keyOf(DRAFT, id)) ?? '{}'));
    } catch {
      return this.parseDraft({});
    }
  }

  private parseDraft(raw: Record<string, unknown>): Draft {
    try {
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

  private draftObject(): Draft {
    return {
      levels: this.levels(),
      level: this.level(),
      flame: this.flame(),
      comfort: this.comfort(),
      gear: this.gear(),
      arrow: this.arrow(),
      upgrades: this.upgrades(),
      gems: this.gems(),
    };
  }

  private writeDraft(): void {
    if (this.profile === null) return;
    this.schedulePush();
    this.writeLocal();
  }

  private writeLocal(): void {
    if (this.profile === null) return;
    try {
      localStorage.setItem(keyOf(DRAFT, this.profile), JSON.stringify(this.draftObject()));
    } catch {
      // storage blocked: the draft is just not kept between visits
    }
  }
}

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
