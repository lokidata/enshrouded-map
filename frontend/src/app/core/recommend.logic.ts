import { Gear, GearData, SlotKey, Upgrades } from './gear.model';
import { upgraded, weaponBaseDamage } from './gear.logic';

/** Our own rule, not the game's: a piece worth less than this share of the same piece at the character's level is "low". */
export const LOW_RATIO = 0.85;
/** ... and "critical" under this one. */
export const CRITICAL_RATIO = 0.7;

/** Slots with a level formula: armour pieces (armour) and weapons (base damage). Rings and the shield have none. */
const ARMOUR_SLOTS: readonly SlotKey[] = ['head', 'chest', 'legs', 'hands', 'feet'];
const WEAPON_SLOTS: readonly SlotKey[] = ['weapon1', 'weapon2', 'weapon3', 'ranged'];

/**
 * Highest enemy/loot level of each Shroud tier, from the game's spawn data (SceneEntityChunkResource spawn levels,
 * tier N = the Shroud level the Flame N can cross, 1..10; Flame 11 removes the Shroud). The Flame N -> tier N rule is
 * a strong deduction, not read in enshrouded.exe. shortcut: static table, regenerate it if the game changes its zones.
 */
const TIER_MAX_LEVEL: Readonly<Record<number, number>> = {
  1: 5,
  2: 9,
  3: 15,
  4: 20,
  5: 27,
  6: 30,
  7: 35,
  8: 39,
  9: 45,
  10: 50,
};
/**
 * The level of gear expected at a Flame: the best of the tier opened before it (the zone that has just opened is
 * not yet farmed, so its loot is not expected). Flame 1 expects level 1; null below 1 (unknown). Our rule.
 */
export const flameLevelCap = (flame: number): number | null =>
  flame < 1 ? null : flame < 2 ? 1 : (TIER_MAX_LEVEL[Math.min(11, Math.floor(flame)) - 1] ?? 50);

export type Severity = 'low' | 'critical';
/** One reading of a piece against the character's level. */
export interface Reading {
  level: number;
  /** Value of the piece / value of the same piece at the character's level. */
  ratio: number;
  /** Whole percent lost against the same piece at the character's level (0 when level >= target). */
  loss: number;
  severity: Severity | null;
}
export interface Alert {
  slot: SlotKey;
  kind: 'armor' | 'damage';
  /** The level the piece is compared with: the character's, or the best level the Flame gives access to if lower. */
  target: number;
  /** Set when the Flame's expected gear level is below the character's level (the target is then that level), else null. */
  capped: { cap: number; player: number; flame: number } | null;
  /** Base level, no upgrade taken. */
  base: Reading;
  /** With the upgrades taken: what the character has. */
  now: Reading;
  /** 'still': too low even upgraded; 'compensated': the base level is low but the upgrades make up for it. */
  state: 'still' | 'compensated';
  /** Untaken upgrades needed to reach LOW_RATIO, and the level that gives; null when they do not close the gap. */
  upgrades: { count: number; level: number } | null;
}

type Constants = Record<string, number>;

/** Level-dependent value of a piece: armour exact (offset + gradient * L, the share cancels out), weapons base damage. */
function value(c: Constants, kind: Alert['kind'], level: number): number | null {
  if (kind === 'damage') return weaponBaseDamage(c, level);
  const o = c['armorOffset'];
  const g = c['armorGradient'];
  return o === undefined || g === undefined ? null : o + g * level;
}

export const severity = (ratio: number): Severity | null =>
  ratio < CRITICAL_RATIO ? 'critical' : ratio < LOW_RATIO ? 'low' : null;

function assess(
  data: GearData,
  slot: SlotKey,
  id: string,
  taken: number,
  baseLevel: number | undefined,
  player: number,
  flame: number,
): Alert | null {
  const cap = flameLevelCap(flame);
  const target = cap !== null && cap < player ? cap : player;
  const c = data.constants;
  const item = data.items[id];
  if (!item || !Number.isFinite(target)) return null;
  const kind = ARMOUR_SLOTS.includes(slot) ? 'armor' : item.damage ? 'damage' : null;
  if (!kind || (kind === 'armor' && !item.armor)) return null;
  const want = value(c, kind, target);
  if (!want) return null;
  const read = (level: number): Reading | null => {
    const have = value(c, kind, level);
    if (have === null) return null;
    const ratio = level >= target ? 1 : have / want;
    return {
      level,
      ratio,
      loss: Math.round((1 - Math.min(ratio, 1)) * 100),
      severity: level >= target ? null : severity(ratio),
    };
  };
  const level = upgraded(c, item, taken, baseLevel).lvl[1];
  const base = read(upgraded(c, item, 0, baseLevel).lvl[1]);
  const now = read(level);
  if (!base || !now || (!base.severity && !now.severity)) return null;
  const left = item.upgrades.length - Math.min(taken, item.upgrades.length);
  let count = 1;
  while (count <= left && (read(level + count)?.ratio ?? 0) < LOW_RATIO) count++;
  return {
    slot,
    kind,
    target,
    capped: target < player ? { cap: target, player, flame } : null,
    base,
    now,
    state: now.severity ? 'still' : 'compensated',
    upgrades: now.severity && count <= left ? { count, level: level + count } : null,
  };
}

/** Every worn armour piece and weapon whose level is too low against the character's, in slot order. */
export function recommend(
  data: GearData | null,
  gear: Gear,
  upgrades: Upgrades,
  itemLevels: Upgrades,
  playerLevel: number,
  flame = 0,
): Alert[] {
  if (!data) return [];
  return [...ARMOUR_SLOTS, ...WEAPON_SLOTS].flatMap((slot) => {
    const id = gear[slot];
    const a = id
      ? assess(data, slot, id, upgrades[slot] ?? 0, itemLevels[slot], playerLevel, flame)
      : null;
    return a ? [a] : [];
  });
}
