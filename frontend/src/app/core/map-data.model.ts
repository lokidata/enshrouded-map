/** Names and labels hold one entry per language, in the order of MapData.languages. */
export type Names = readonly string[];

export interface Category {
  label: Names;
  kind: 'icon' | 'label' | 'dots';
  icon?: string;
  visible: boolean;
}

export interface MapMarker {
  name: Names;
  raw: string;
  cat: string;
  x: number;
  y: number;
  z: number;
  fastTravel: boolean;
  /** Loot markers (unique, cosmetic, collectible): the item, a key of MapData.items. */
  item?: string;
  /** Other items the game always puts here (a chest's materials, a boss drop...). */
  loot?: readonly LootEntry[];
}

/** An item that is always found in a container, `amount` times. */
export interface LootEntry {
  item: string;
  amount: number;
}

export interface ItemInfo {
  name: Names;
  icon: string | null;
}

/** A group of identical resources: pts is a flat list of x, z, altitude triples. */
export interface Resource {
  name: Names;
  raw: string;
  pts: readonly number[];
  sizes?: readonly number[];
  color: string;
  /** Guaranteed items of some points (chests), by point index. */
  loot?: Record<string, readonly LootEntry[]>;
}

export interface MapData {
  worldSize: number;
  languages: readonly string[];
  biomes: Record<string, { color: string; label: Names }>;
  categories: Record<string, Category>;
  /** Items named in the loot of markers and resources, by guid. */
  items?: Record<string, ItemInfo>;
  markers: readonly MapMarker[];
}

export type ResourceData = Record<string, readonly Resource[]>;

/** One filterable element of a category (all the markers sharing an in-game name). */
export interface Item {
  cat: string;
  key: string;
  name: Names;
  count: number;
  color?: string;
}

export const itemKey = (name: Names): string => name.join('\u0001');

/** Stable id of a map element for the progress marks: category and position. */
export const markId = (cat: string, x: number, z: number): string =>
  `${cat}:${Math.round(x)}:${Math.round(z)}`;
