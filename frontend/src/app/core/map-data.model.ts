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
}

/** A group of identical resources: pts is a flat list of x, z, altitude triples. */
export interface Resource {
  name: Names;
  raw: string;
  pts: readonly number[];
  sizes?: readonly number[];
  color: string;
}

export interface MapData {
  worldSize: number;
  languages: readonly string[];
  biomes: Record<string, { color: string; label: Names }>;
  categories: Record<string, Category>;
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
