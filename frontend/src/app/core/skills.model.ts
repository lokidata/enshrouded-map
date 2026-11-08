import { Names } from './map-data.model';

/** Format of skills.json, written by pipeline/build_skills.py. */
export type SkillType = 'Root' | 'Passive' | 'Active' | 'Attribute';
export type SkillClass = 'Neutral' | 'Warrior' | 'Ranger' | 'Mage';
/** The six attributes of the character, in the order the game lists them. */
export type AttrKey =
  'constitution' | 'spirit' | 'resistance' | 'strength' | 'dexterity' | 'intelligence';

export interface SkillNode {
  id: number;
  x: number;
  y: number;
  type: SkillType;
  /** The game's picture of the node; null when it has none. */
  icon: string | null;
  /** The specialization a Root starts (Survivant, Maître de la bête...). */
  label: Names | null;
  /** The attribute an Attribute node raises, by `gain` points per level (`flame`: floor(perFlame x Flame) instead). */
  attr: AttrKey | null;
  gain: number;
  flame: boolean;
  /** Attribute points per Flame level of a `flame` node (0.5; absent from an older skills.json). */
  perFlame?: number;
  cls: SkillClass;
  name: Names;
  /** %k stands for the value at the node's level (`vals`); ** marks bold parts, __ italic ones. */
  desc: Names;
  /** Points per level. */
  cost: number;
  /** Levels (1 for a node taken once). */
  max: number;
  vals: readonly string[] | null;
  per: Names | null;
  /** What the node changes in the player's attributes (game names), per level taken when `level`. */
  effects?: readonly SkillEffect[];
}

export interface SkillEffect {
  attr: string;
  value: number;
  level: boolean;
  format: 'Normal' | 'Percentage' | 'Duration' | 'DurationMilliseconds';
}

export interface SkillsData {
  /** Points to spend. */
  budget: number;
  nodes: readonly SkillNode[];
  links: readonly (readonly [number, number])[];
}

/** The level of each node taken, by node id. */
export type Levels = Readonly<Record<number, number>>;

/** A build the player saved (api/v1/builds). */
export interface SavedBuild {
  id: number;
  name: string;
  nodes: Record<string, number>;
  level: number;
  flame: number;
  gear: Record<string, string>;
  /** slot -> indices into the item's upgrades, in order (the app writes 0..n-1: a chain). */
  upgrades: Record<string, number[]>;
  updated_at: string;
}
