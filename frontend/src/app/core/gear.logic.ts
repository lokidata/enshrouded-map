import { ATTRS, Tree } from './skills.logic';
import { AttrKey, Levels } from './skills.model';
import { ArmorKind, Gear, GearItem, GearStat, SlotKey, Upgrades } from './gear.model';

type Constants = Record<string, number>;

export const SLOT_KIND = {
  head: 'Head',
  chest: 'Chest',
  legs: 'Legs',
  hands: 'Hands',
  feet: 'Feet',
  ring1: 'Ring',
  ring2: 'Ring',
  weapon1: 'Weapon',
  weapon2: 'Weapon',
  weapon3: 'Weapon',
  shield: 'Shield',
  ranged: 'Weapon',
} as const;

/** The ranged slot takes bows, the weapon slots everything else. */
export function fits(slot: SlotKey, item: GearItem): boolean {
  if (item.slot !== SLOT_KIND[slot]) return false;
  return slot === 'ranged'
    ? item.type === 'Bow'
    : slot.startsWith('weapon')
      ? item.type !== 'Bow'
      : true;
}

type Shares = Partial<Record<ArmorKind, number>>;

function atLevel(c: Constants, shares: Shares | undefined, level: number): Shares {
  const out: Shares = {};
  for (const [kind, share] of Object.entries(shares ?? {}))
    out[kind as ArmorKind] = Math.round(share * (c['armorOffset'] + c['armorGradient'] * level));
  return out;
}

/** Armour of a piece of item level L: round(share * (offset + gradient * L)), plus its upgrades' (`bonus`). */
export function pieceArmor(c: Constants, item: GearItem): Shares {
  const out = atLevel(c, item.armor, item.lvl[1]);
  for (const [k, v] of Object.entries(item.bonus ?? {}))
    out[k as ArmorKind] = (out[k as ArmorKind] ?? 0) + v;
  return out;
}

/** What upgrade i (0-based) of an item adds in armour: its shares at level L + i + 1. */
export const upgradeArmor = (c: Constants, item: GearItem, i: number): Shares =>
  atLevel(c, item.upgrades[i]?.armor, item.lvl[1] + i + 1);

/** The item with its first n upgrades: base armour counted at L + n, each upgrade's own armour and stat lines added. */
export function upgraded(c: Constants, item: GearItem, n: number, level?: number): GearItem {
  if (level !== undefined) {
    const l = Math.min(Math.max(Math.trunc(level) || item.lvl[0], item.lvl[0]), item.lvl[1]);
    if (l !== item.lvl[1]) item = { ...item, lvl: [item.lvl[0], l] }; // a lower base level: its armour and damage follow
  }
  const count = Math.min(Math.max(0, Math.trunc(n) || 0), item.upgrades.length);
  if (!count) return item;
  const bonus: Shares = {};
  for (let i = 0; i < count; i++)
    for (const [k, v] of Object.entries(upgradeArmor(c, item, i)))
      bonus[k as ArmorKind] = (bonus[k as ArmorKind] ?? 0) + v;
  return {
    ...item,
    lvl: [item.lvl[0] + count, item.lvl[1] + count],
    stats: [...item.stats, ...item.upgrades.slice(0, count).flatMap((u) => u.stats)],
    bonus,
  };
}

/** The items worn with their upgrades; those the data does not know are dropped. */
export function worn(
  c: Constants,
  gear: Gear,
  items: Record<string, GearItem>,
  upgrades: Upgrades = {},
  levels: Upgrades = {},
): GearItem[] {
  return Object.entries(gear).flatMap(([slot, id]) => {
    const item = items[id];
    return item
      ? [upgraded(c, item, upgrades[slot as keyof Upgrades] ?? 0, levels[slot as keyof Upgrades])]
      : [];
  });
}

export const ARMOR_KINDS: readonly ArmorKind[] = [
  'physical',
  'cut',
  'pierce',
  'blunt',
  'magical',
  'fire',
  'ice',
  'shock',
  'shroud',
];

export function armorTotals(c: Constants, pieces: readonly GearItem[]): Record<ArmorKind, number> {
  const total = Object.fromEntries(ARMOR_KINDS.map((k) => [k, 0])) as Record<ArmorKind, number>;
  for (const p of pieces)
    for (const [k, v] of Object.entries(pieceArmor(c, p))) total[k as ArmorKind] += v;
  return total;
}

export interface StatSum {
  name: readonly [string, string];
  format: GearStat['format'];
  value: number;
}

/** The stat lines of the pieces added up by name and format: the ids of one line differ. */
export function statSums(pieces: readonly GearItem[]): Map<string, StatSum> {
  const sums = new Map<string, StatSum>();
  for (const p of pieces)
    for (const s of p.stats) {
      const key = `${s.name[1]}|${s.format}`;
      const old = sums.get(key);
      sums.set(key, {
        name: s.name as [string, string],
        format: s.format,
        value: (old?.value ?? 0) + s.value,
      });
    }
  return sums;
}

/** Rarity colours when gear.json has no `colors`. */
const RARITY_FALLBACK: Record<string, string> = {
  Common: '#9aa0a6',
  Uncommon: '#6cc070',
  Rare: '#5aa0f0',
  Epic: '#c58bff',
  Legendary: '#f0a63a',
};
/** The game's colour of a rarity (gear.json `colors`, by lower-case rarity), else the fallback; null when unknown. */
export const rarityColor = (
  colors: Record<string, string> | undefined,
  rarity: string | undefined,
): string | null =>
  rarity ? (colors?.[rarity.toLowerCase()] ?? RARITY_FALLBACK[rarity] ?? null) : null;

const f = Math.fround;
/** The game's float rounding: half away from zero. */
const roundAway = (x: number) => Math.trunc(f(x >= 0 ? x + 0.5 : x - 0.5));

/** The world's game settings (`GameSettingsStore.values()`); a missing or non-number key = the default world, 1. */
export type World = Readonly<Record<string, unknown>>;
export const worldFactor = (w: World, key: string): number => {
  const v = w[key];
  return typeof v === 'number' ? v : 1;
};
/** The setting each Personnage value reads in enshrouded.exe (world settings struct at +0x90 of the player context). */
export const WORLD_KEY = {
  health: 'playerHealthFactor',
  mana: 'playerManaFactor',
  stamina: 'playerStaminaFactor',
  oxygen: 'playerDivingTimeFactor',
  shroud: 'shroudTimeFactor',
  parry: 'enemyStaminaFactor',
} as const;

/**
 * The stun bar of an enemy of level L as enshrouded.exe estimates it for the parry (float32, same order):
 * hit = trunc(base damage x (1 + crit chance x crit bonus) x (1 + L/100)^4 x epicWeaponBonus x hits-to-kill),
 * hits-to-kill = htkStartPve + L/playerLevelMax x (htkEndPve - htkStartPve); stun = round(hit x staminaPerAP /
 * healthPerAP x the world's "enemy stamina" factor). Null when gear.json lacks the constants.
 */
function enemyStun(c: Constants, level: number, enemyStamina: number): number | null {
  const base = weaponBaseDamage(c, level);
  if (base === null || c['parryToDepletion'] === undefined) return null;
  const creep = f(f(level * f(0.01)) + 1);
  let x = f(f(f(f(c['baseCritChance']) * f(c['critBonus'])) + 1) * base);
  for (let i = 0; i < 4; i++) x = f(x * creep);
  const htk = f(
    f(f(level / c['playerLevelMax']) * (c['htkEndPve'] - c['htkStartPve'])) + c['htkStartPve'],
  );
  const hit = Math.max(Math.trunc(f(f(x * f(c['epicWeaponBonus'])) * htk)), 1);
  const ratio = f(c['playerStaminaPerAP'] / c['playerHealthPerAP']);
  return roundAway(f(f(ratio * hit) * f(enemyStamina)));
}

/**
 * Parry power of an item of level L with ParryProficiency_Base `parry`: round(stun x parry x parryToDepletion)
 * (enshrouded.exe, the code of the item card and of the Attributes screen). `enemyStamina` is the world setting
 * (1 by default; the site does not know the world's).
 */
export function parryPower(
  c: Constants,
  parry: number,
  level: number,
  enemyStamina = 1,
): number | null {
  const stun = enemyStun(c, level, enemyStamina);
  return stun === null
    ? null
    : roundAway(Math.abs(f(f(stun * f(parry)) * f(c['parryToDepletion']))));
}

/**
 * Block of a shield of level L with block quality q (enshrouded.exe, float32): expected player health
 * H = playerBaseHealth + 3 x L x healthPerAP x flameLevelMax / playerLevelMax, hits-to-kill = htkStartEvp -
 * L/playerLevelMax x (htkStartEvp - htkEndEvp), hit = trunc(H / htk x expectedBaseDamageFactor),
 * block = round(staminaPerAP / healthPerAP x hit x q). Exact; no world setting.
 */
export function blockPower(c: Constants, quality: number, level: number): number | null {
  if (c['expectedBaseDamageFactor'] === undefined || c['htkStartEvp'] === undefined) return null;
  const health = f(
    f(f(f(f(level * 3) * c['playerHealthPerAP']) * c['flameLevelMax']) / c['playerLevelMax']) +
      c['playerBaseHealth'],
  );
  const htk = f(
    c['htkStartEvp'] - f((c['htkStartEvp'] - c['htkEndEvp']) * f(level / c['playerLevelMax'])),
  );
  const hit = Math.trunc(Math.abs(f(f(health / htk) * f(c['expectedBaseDamageFactor']))));
  const ratio = f(c['playerStaminaPerAP'] / c['playerHealthPerAP']);
  return roundAway(f(ratio * f(hit * f(quality))));
}

/** Parry power of a piece at its level (see parryPower); else its "Parry Power" line. */
export function parryPoints(c: Constants, item: GearItem, enemyStamina = 1): number | null {
  const n = item.parry === undefined ? null : parryPower(c, item.parry, item.lvl[1], enemyStamina);
  return n ?? lineSum(statSums([item]), ['Parry Power'], 'Normal');
}

/** Block of a shield at its level (see blockPower); null without a block quality. */
export const blockPoints = (c: Constants, item: GearItem): number | null =>
  item.block === undefined ? null : blockPower(c, item.block, item.lvl[1]);

/** What the taken skill nodes add to each attribute of the game (per level taken when the effect says so). */
export function effectTotals(t: Tree, levels: Levels): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, level] of Object.entries(levels))
    for (const e of t.byId.get(+id)?.effects ?? [])
      out[e.attr] = (out[e.attr] ?? 0) + e.value * (e.level ? level : 1);
  return out;
}

/**
 * A row of the Attributes screen. Value = (player[attr] - sub) x k + (skill effects on `fx`, default [attr]) x k
 * + the worn items' lines (`names`, in the row's own unit: % or s). No `attr` or no `player` in the data: only the
 * items' lines, null when none (nothing is known).
 */
export interface RowDef {
  key: string;
  /** English names of the item lines in gear.json. */
  names: readonly string[];
  format: GearStat['format'];
  attr?: string;
  sub?: number;
  k?: number;
  fx?: readonly string[];
  /** Game label: the segment of `/rpgTerms/attributes/<text>/displayInfo/label` in gear.json `texts`. */
  text?: string;
  /** The game's short label (alternativeLabel) when it has one. */
  alt?: boolean;
  /** A known contribution is missing (food, Rested...): the value is an estimation. */
  est?: boolean;
  /** Shown without a plus sign. */
  plain?: boolean;
}

export interface RowParts {
  /** The player template's base, in the row's unit. */
  base: number;
  /** Skill effects, in the row's unit. */
  skills: number;
  /** The worn items' lines, in the row's unit. */
  equip: number;
}

/** What a row is made of; null when nothing is known (no player base and no item line). */
export function rowParts(
  d: RowDef,
  player: Record<string, number> | undefined,
  fx: Record<string, number>,
  sums: ReadonlyMap<string, StatSum>,
): RowParts | null {
  const line = lineSum(sums, d.names, d.format);
  const unit = d.format === 'DurationMilliseconds' ? 0.001 : 1;
  const base = d.attr === undefined ? undefined : player?.[d.attr];
  if (base === undefined) return line === null ? null : { base: 0, skills: 0, equip: line * unit };
  const k = d.k ?? 1;
  const skills = (d.fx ?? [d.attr!]).reduce((n, a) => n + (fx[a] ?? 0), 0);
  return { base: (base - (d.sub ?? 0)) * k, skills: skills * k, equip: (line ?? 0) * unit };
}

export function rowValue(
  d: RowDef,
  player: Record<string, number> | undefined,
  fx: Record<string, number>,
  sums: ReadonlyMap<string, StatSum>,
): number | null {
  const p = rowParts(d, player, fx, sums);
  return p && round2(p.base + p.skills + p.equip);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the lines named so (English names) add up to; null when no worn piece has one: nothing is known then. */
export function lineSum(
  sums: ReadonlyMap<string, StatSum>,
  names: readonly string[],
  format: GearStat['format'],
): number | null {
  let total: number | null = null;
  for (const n of names) {
    const s = sums.get(`${n}|${format}`);
    if (s) total = (total ?? 0) + s.value;
  }
  return total;
}

/** Attributes: skills, plus the Flame (apPerFlameLevel per Flame level above 1). No item line gives attributes. */
export function attributeTotals(
  c: Constants,
  skills: Record<AttrKey, number>,
  flame: number,
): Record<AttrKey, number> {
  const flameBonus = flame > 1 ? (flame - 1) * c['apPerFlameLevel'] : 0;
  return Object.fromEntries(ATTRS.map((a) => [a, skills[a] + flameBonus])) as Record<
    AttrKey,
    number
  >;
}

export interface Vitals {
  health: number;
  mana: number;
  stamina: number;
  melee: number;
  ranged: number;
  magic: number;
  oxygen: number;
}

/**
 * Main characteristics. Exact (checked against the game's Attributes screen, no food buff): health, mana, stamina =
 * base + per point x attribute + the worn items' lines + their upgrades' lines (the game's tooltip lists the items'
 * own lines as "Equipment" and leaves the upgrades' out, they are still in its total), ranged damage = 0.05 x
 * dexterity, oxygen. ESTIMATES: melee and magic damage (0.05 per point of strength / intelligence + the equipment's
 * lines). Damage is in %.
 */
export type PartKey = 'player' | 'equipment' | 'upgrades' | 'skills' | 'flame' | AttrKey;
export interface Part {
  key: PartKey;
  value: number;
}
export type VitalKey = keyof Vitals;

/**
 * Where each main characteristic comes from (zero parts are kept: the caller hides them). `own` = the sums of the
 * items without their upgrades: health, mana and stamina then split "equipment" / "upgrades" like the game's tooltip.
 */
export function vitalParts(
  c: Constants,
  a: Record<AttrKey, number>,
  sums: ReadonlyMap<string, StatSum>,
  fx: Record<string, number> = {},
  own: ReadonlyMap<string, StatSum> = sums,
  world: World = {},
): Record<VitalKey, Part[]> {
  const flat = (n: string) => lineSum(sums, [n], 'Normal') ?? 0;
  const pct = (n: string) => lineSum(sums, [n], 'Percentage') ?? 0;
  const scale = c['damageScalePerAttributePoint'] * 100;
  const base = (value: number): Part => ({ key: 'player', value });
  const equip = (value: number): Part => ({ key: 'equipment', value });
  const lines = (n: string): Part[] => {
    const mine = lineSum(own, [n], 'Normal') ?? 0;
    return [equip(mine), { key: 'upgrades', value: flat(n) - mine }];
  };
  /**
   * enshrouded.exe (Health/Mana/Stamina_Max_Base): round((base + perAP x points) x the world factor), float32; the
   * items' lines (the _Adder) are not scaled. The points' share alone = round(perAP x points x factor) (its other
   * helper), the base gets the rest.
   */
  const scaled = (vital: VitalKey, b: number, perAP: number, attr: AttrKey, n: string): Part[] => {
    const k = f(worldFactor(world, WORLD_KEY[vital as 'health']));
    const points = perAP * a[attr];
    const total = roundAway(f(f(b + points) * k));
    const share = roundAway(f(f(points) * k));
    return [base(total - share), ...lines(n), { key: attr, value: share }];
  };
  return {
    health: scaled(
      'health',
      c['playerBaseHealth'],
      c['playerHealthPerAP'],
      'constitution',
      'Health',
    ),
    mana: scaled('mana', c['playerBaseMana'], c['playerManaPerAP'], 'spirit', 'Mana'),
    stamina: scaled(
      'stamina',
      c['playerBaseStamina'],
      c['playerStaminaPerAP'],
      'resistance',
      'Stamina',
    ),
    melee: [{ key: 'strength', value: scale * a.strength }, equip(pct('Melee Damage'))],
    ranged: [{ key: 'dexterity', value: scale * a.dexterity }, equip(pct('Ranged Damage'))],
    magic: [
      { key: 'intelligence', value: scale * a.intelligence },
      equip(pct('Magic Damage')),
      { key: 'skills', value: (fx['MagicDamageMod'] ?? 0) * 100 },
    ],
    // enshrouded.exe (Oxygen_MaxBase): round(playerBaseOxygen x OxygenMaxMod (1 here) x the diving time factor)
    oxygen: [
      base(roundAway(f(f(c['playerBaseOxygen']) * f(worldFactor(world, WORLD_KEY.oxygen))))),
    ],
  };
}

export function vitals(
  c: Constants,
  a: Record<AttrKey, number>,
  sums: ReadonlyMap<string, StatSum>,
  fx: Record<string, number> = {},
  world: World = {},
): Vitals {
  const parts = vitalParts(c, a, sums, fx, sums, world);
  const sum = (k: VitalKey) => parts[k].reduce((n, p) => n + p.value, 0);
  return {
    health: sum('health'),
    mana: sum('mana'),
    stamina: sum('stamina'),
    melee: round1(sum('melee')),
    ranged: round1(sum('ranged')),
    magic: round1(sum('magic')),
    oxygen: sum('oxygen'),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Resistance lines per armour kind (English names, Percentage); a kind without a known line has no resistance row value. */
export const RESISTANCE: Record<ArmorKind, readonly string[]> = {
  physical: [],
  cut: ['Cutting Resistance'],
  pierce: ['Piercing Resistance'],
  blunt: ['Blunt Resistance'],
  magical: [],
  fire: ['Fire Resistance'],
  ice: ['Ice Resistance'],
  shock: ['Shock Resistance'],
  shroud: ['Shroud Resistance'],
};

export interface ProtectionRow {
  kind: ArmorKind;
  armor: number;
  /** In %, null when no worn piece has the line. */
  resistance: number | null;
}

/** Skill effects (game names) that add resistance, in fraction: DamageSusceptibility_* (5 % per level of the Fire Resistance node...). */
const RESISTANCE_FX: Partial<Record<ArmorKind, string>> = {
  fire: 'DamageSusceptibility_Fire',
  ice: 'DamageSusceptibility_Ice',
  shock: 'DamageSusceptibility_Lightning',
  shroud: 'DamageSusceptibility_Fog',
};

/** With `fx` (the skills' effects, from a gear.json that has `player`) the base is 0 %: a number, never null. */
export function protection(
  c: Constants,
  pieces: readonly GearItem[],
  fx?: Record<string, number>,
): ProtectionRow[] {
  const armor = armorTotals(c, pieces);
  const sums = statSums(pieces);
  return ARMOR_KINDS.map((kind) => {
    const line = lineSum(sums, RESISTANCE[kind], 'Percentage');
    const skill = fx ? (fx[RESISTANCE_FX[kind] ?? ''] ?? 0) * 100 : 0;
    return {
      kind,
      armor: armor[kind],
      resistance: fx ? round2((line ?? 0) + skill) : line,
    };
  });
}

/** XP to go from level L to L + 1 (wiki; L = 20 gives the 8562 of the game's screen, levels 1..49 add up to 429094). */
export function xpToNext(level: number): number {
  const early = [1000, 2023, 3046, 4069, 5092, 6987];
  return level < 1 ? 0 : level <= 6 ? early[level - 1] : Math.floor(7100 + 112.5 * (level - 7));
}

/** Total XP to reach a level from level 1. */
export function xpTotal(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  return total;
}

/** Skill points the level gives (2 per level above 1); the rest of the 212 come from the world. */
export const levelPoints = (level: number): number => 2 * Math.max(0, level - 1);

/** Flame levels 1..11 (wiki): altars to build, frost protection from the 8th. */
export const FLAME_MAX = 11;
const ALTARS = [2, 4, 6, 8, 10, 11, 12, 13, 14, 15, 16];
export const altars = (flame: number): number | null => ALTARS[flame - 1] ?? null;
export const frostProtection = (flame: number): boolean => flame >= 8;
/**
 * Time in the Shroud from the Flame, in minutes: enshrouded.exe sets FogResistance_MaxFlameBase =
 * round((playerBaseFogResistance 240 + playerFogResistancePerFlameLevel 60 x Flame) s x the world's Shroud time
 * factor), float32 (constants inlined: gear.json does not carry them).
 */
export const shroudMinutes = (flame: number, factor = 1): number | null =>
  flame >= 1 ? roundAway(f((240 + 60 * flame) * f(factor))) / 60 : null;

/**
 * The six skills that add one attribute point per two Flame levels. Exact (enshrouded.exe): Flame >> 1, added once
 * when the node is taken (they have one level), on top of the Flame's own (Flame - 1) x apPerFlameLevel.
 */
export function flameSkillBonus(t: Tree, levels: Levels, flame: number): Record<AttrKey, number> {
  const out = Object.fromEntries(ATTRS.map((a) => [a, 0])) as Record<AttrKey, number>;
  for (const [id, level] of Object.entries(levels)) {
    const node = t.byId.get(+id);
    if (node?.attr && node.flame && level > 0)
      out[node.attr] += Math.floor(flame * (node.perFlame ?? 0.5));
  }
  return out;
}

/** The two numbers of the game's character screen: physical and magical armour (the other kinds are the Protection rows). */
export const headline = (a: Partial<Record<ArmorKind, number>>) => ({
  physical: a.physical ?? 0,
  magical: a.magical ?? 0,
});

/** What taking upgrade i (0-based) changes in the headline armour: its own shares plus the base moving up a level. */
export function rankGain(
  c: Constants,
  item: GearItem,
  i: number,
): { physical: number; magical: number } {
  const after = headline(pieceArmor(c, upgraded(c, item, i + 1)));
  const before = headline(pieceArmor(c, upgraded(c, item, i)));
  return { physical: after.physical - before.physical, magical: after.magical - before.magical };
}

/**
 * Base damage of a weapon of item level L. Exact: enshrouded.exe's GetWeaponBaseDamage (impact node) computes
 * trunc(genericWeaponSeed x powerCreepWeapon x L + genericWeaponSeed) from the BalancingTable.
 */
export function weaponBaseDamage(c: Constants, level: number): number | null {
  const seed = c['genericWeaponSeed'];
  const creep = c['powerCreepWeapon'];
  if (seed === undefined || creep === undefined) return null;
  return Math.trunc(Math.fround(Math.fround(seed * creep) * level) + seed);
}

/** Base damage x the item's dmgMod at item level L, unrounded (the json's dmgMod is rounded to 4 decimals). */
function scaledBase(c: Constants, item: GearItem, level: number): number | null {
  const base = item.damage ? weaponBaseDamage(c, level) : null;
  return base === null ? null : Math.round(base * item.damage!.mod * 1e4) / 1e4;
}

/**
 * The card's "Damage" column of upgrade i (0-based) of `item` taken at its base level (no upgrade applied):
 * trunc(base x dmgMod) at L + i + 1 minus the same at L + i. Exact: an Ornate Greatsword's card (dmgMod 1.5, L 11)
 * shows +3 +1 +3 +2 +3 from level 12 to 16.
 */
export function rankDamage(c: Constants, item: GearItem, i: number): number | null {
  const after = scaledBase(c, item, item.lvl[1] + i + 1);
  const before = scaledBase(c, item, item.lvl[1] + i);
  return after === null || before === null ? null : Math.trunc(after) - Math.trunc(before);
}

/**
 * What a damage perk adds: share x base x dmgMod at the item's current level, to 0.1 (the card of the Ornate
 * Greatsword at level 16: +5.1 = 10 % of 51 on each perk, taken or not). How it adds to a hit is not in the data.
 */
export function perkDamage(c: Constants, item: GearItem, share: number): number | null {
  const base = scaledBase(c, item, item.lvl[1]);
  return base === null ? null : Math.round(base * share * 10) / 10;
}

/** The item's "Attack Speed" line (ms) in seconds as the card shows it: truncated to 0.1 s (774 -> "0.7s"). */
export function attackSpeed(item: GearItem): number | null {
  const s = item.stats.find((x) => x.name[1] === 'Attack Speed' && x.format === 'Duration');
  return s ? Math.trunc(s.value / 100) / 10 : null;
}

/** The weapon-class multiplier (player attribute WeaponCategoryDamageMod_*) of each weapon family. */
export const WEAPON_CLASS: Record<string, string> = {
  OneHandedSword: 'WeaponCategoryDamageMod_Single',
  OneHandedAxe: 'WeaponCategoryDamageMod_Single',
  OneHandedClub: 'WeaponCategoryDamageMod_Single',
  TwoHandedAxe: 'WeaponCategoryDamageMod_TwoHand',
  TwoHandedHammer: 'WeaponCategoryDamageMod_TwoHand',
  TwoHandedGreatsword: 'WeaponCategoryDamageMod_GreatSword',
  Staff: 'WeaponCategoryDamageMod_Staff',
  Wand: 'WeaponCategoryDamageMod_Wand',
  Bow: 'WeaponCategoryDamageMod_Bow',
  Daggers: 'WeaponCategoryDamageMod_Dagger',
  Throwable: 'WeaponCategoryDamageMod_Throwable',
  UnarmedFists: 'WeaponCategoryDamageMod_Unarmed',
};

/** The weapon-class bonus in % ((player base - 1 + skill effects) x 100); 0 without the data. */
export function weaponClassPct(
  item: GearItem,
  player: Record<string, number> | undefined,
  fx: Record<string, number>,
): number {
  const attr = WEAPON_CLASS[item.type ?? ''];
  if (!attr || player?.[attr] === undefined) return 0;
  return round2((player[attr] - 1 + (fx[attr] ?? 0)) * 100);
}

export interface WeaponDamage {
  /** weaponBaseDamage at the item's level (upgrades included): exact. */
  base: number;
  /** The item's damage factor (dmgMod: x1.5 on the two-handed ones). */
  factor: number;
  /** The scaling attribute's bonus in % (the Melee / Ranged / Magic damage row of its attribute). */
  attr: number;
  /** The weapon-class bonus in %. */
  cls: number;
  /** base x factor x (1 + attr) x (1 + cls), rounded: ESTIMATE (how the game combines them is not verified). */
  total: number;
}

/** Damage of one weapon; null when it has no damage setup or the data lacks the constants. */
export function weaponDamage(
  c: Constants,
  item: GearItem,
  attrPct: number,
  clsPct: number,
): WeaponDamage | null {
  const base = item.damage ? weaponBaseDamage(c, item.lvl[1]) : null;
  if (base === null || !item.damage) return null;
  const factor = item.damage.mod;
  const total = Math.round(base * factor * (1 + attrPct / 100) * (1 + clsPct / 100));
  return { base, factor, attr: attrPct, cls: clsPct, total };
}

export interface WeaponGuard {
  /** The shield is held with it (one-handed weapon in a weapon slot, a shield worn). */
  shield: boolean;
  /** Parry power of the item that parries (`by`), see parryPower; null when it has none. */
  parry: number | null;
  /** What parries: the shield with a one-handed weapon, else the weapon (the game names it beside the row). */
  by: GearItem;
  /** The shield's block (blockPoints), shown by the game whatever the weapon; null without a shield. */
  block: number | null;
}

/**
 * What a weapon gives to defend. The shield parries only with a one-handed weapon (`damage.hands` 1) of a weapon
 * slot; a two-handed weapon parries itself. The game's Block row is the shield's even with a two-handed weapon.
 */
export function weaponGuard(
  c: Constants,
  slot: SlotKey,
  weapon: GearItem,
  shield: GearItem | undefined,
  enemyStamina = 1,
): WeaponGuard {
  const withShield = !!shield && slot !== 'ranged' && weapon.damage?.hands === 1;
  const by = withShield ? shield! : weapon;
  return {
    shield: withShield,
    parry: parryPoints(c, by, enemyStamina),
    by,
    block: shield ? blockPoints(c, shield) : null,
  };
}
