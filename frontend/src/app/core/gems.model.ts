import { Names } from './map-data.model';

export interface GemStat {
  name: Names;
  /** The value at the gem's level 1. */
  value: number;
  /** `scaleFactor` of the game's scale function `fn` (WeaponPowerCreep for all): see gemValue. */
  scale?: number;
  fn?: string;
  format: string;
}

/** An enemy type that carries the gem in its loot (`enemy` = an id of enemies.json when it has a page). */
export interface GemSource {
  name: Names;
  enemy?: string;
}

export interface Gem {
  id: string;
  name: Names;
  desc?: Names;
  /** Per %k of `desc`, in the text's order: the index of the stat that gives its value, null when the data has none. */
  fill?: readonly (number | null)[];
  rarity: string;
  tier: number;
  lvl: readonly [number, number];
  icon?: string;
  sources?: readonly GemSource[];
  stats: readonly GemStat[];
}

/** gems.json: see pipeline/build_gems.py (only the parts the screens use). */
export interface GemsData {
  gems: readonly Gem[];
  slot: { probability: Record<string, number>; weapons: readonly string[] };
  constants?: { powerCreepWeapon?: number };
  comfort?: { constants: Record<string, number> };
}

/** The gem set in a weapon slot, at its level (saved in builds). */
export interface GemPick {
  id: string;
  level: number;
}
