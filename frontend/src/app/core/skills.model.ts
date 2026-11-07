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
  /** The attribute an Attribute node raises, by `gain` points per level (`flame`: 1 per 2 levels of the Flame). */
  attr: AttrKey | null;
  gain: number;
  flame: boolean;
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
  updated_at: string;
}
