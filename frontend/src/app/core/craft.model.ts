import { Names } from './map-data.model';

/** Format of craft.json, written by pipeline/build_craft.py. */
export interface CraftItem {
  name: Names;
  icon: string | null;
  /** From ItemInfo (pipeline/build_craft.py); absent in a craft.json made before. */
  cat?: string;
  type?: string;
  food?: string;
  rarity?: string;
  cls?: string;
  lvl?: number;
  /** Key of CraftData.sets: the armour set this piece belongs to. */
  set?: string;
}

export interface Station {
  name: Names;
  npc: boolean;
}

export interface Input {
  item?: string;
  /** Any item of CraftData.categories[category]. */
  category?: string;
  count: number;
}

export type UnlockType = 'item' | 'npc' | 'flame' | 'level' | 'quest' | 'none';

export interface Unlock {
  type: UnlockType;
  text: Names;
  /** Items whose obtaining unlocks it (guids). */
  items?: readonly string[];
}

export interface Sources {
  /** Mark ids of map markers. */
  markers?: readonly string[];
  /** Resource groups of the map (chests, ores, plants), by category and name. */
  groups?: readonly { cat: string; name: Names }[];
}

export interface Entry {
  id: string;
  name: Names;
  output: { item: string; count: number } | null;
  station: string | null;
  inputs: readonly Input[];
  seconds: number;
  unlock: Unlock;
  sources?: Sources;
}

export interface BlockEntry extends Entry {
  group: string;
  tier: string | null;
}

/** A Flame Altar upgrade ("altar") or a Flame level ("flame"); `unlocks` wait for level + 1. */
export interface AltarEntry extends Omit<Entry, 'unlock' | 'output'> {
  kind: 'altar' | 'flame';
  level: number;
  unlocks: readonly string[];
}

export interface CraftData {
  items: Record<string, CraftItem>;
  /** Armour sets, pieces ordered head to feet; absent in an older craft.json. */
  sets?: Record<string, { name: Names; pieces: readonly string[] }>;
  stations: Record<string, Station>;
  categories: Record<string, readonly { item: string; scaling: number }[]>;
  groups: Record<string, Names>;
  recipes: readonly Entry[];
  blocks: readonly BlockEntry[];
  altar: readonly AltarEntry[];
}
