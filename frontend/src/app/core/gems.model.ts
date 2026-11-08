import { Names } from './map-data.model';

export interface GemStat {
  name: Names;
  /** The value at the gem's level 1. */
  value: number;
  /** `scaleFactor` of the game's WeaponPowerCreep: the curve itself is not in the data. */
  scale?: number;
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
  comfort?: { constants: Record<string, number> };
}
