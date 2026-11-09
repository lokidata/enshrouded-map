import { Names } from './map-data.model';

/** Format of gear.json, written by pipeline/build_gear.py (see its docstring). */
export type GearSlot =
  'Head' | 'Hands' | 'Chest' | 'Legs' | 'Feet' | 'Ring' | 'Shield' | 'Backpack' | 'Weapon';
export type DamageKind =
  'cut' | 'pierce' | 'blunt' | 'fire' | 'ice' | 'shroud' | 'shock' | 'poison' | 'healing';
export type ArmorKind =
  'physical' | 'cut' | 'pierce' | 'blunt' | 'magical' | 'fire' | 'ice' | 'shroud' | 'shock';

export interface GearStat {
  id: number;
  name: Names;
  value: number;
  format: 'Normal' | 'Percentage' | 'Duration' | 'DurationMilliseconds';
}

export interface GearItem {
  name: Names;
  slot: GearSlot;
  rarity: string;
  lvl: readonly [number, number];
  type?: string;
  armor?: Partial<Record<ArmorKind, number>>;
  block?: number;
  damage?: {
    mod: number;
    speed: number;
    hands: number;
    attr: string | null;
    types: Partial<Record<DamageKind, number>>;
    /** Ranged weapons: seconds of the shot's charge and fire (a shot takes charge + fire). */
    charge?: number;
    fire?: number;
  };
  /** Weapons: chance it has a gem slot (1 = always), unlocked once every upgrade is taken. */
  gem?: number;
  /** ParryProficiency_Base the item adds (the card shows another number, see `parryPoints`). */
  parry?: number;
  stats: readonly GearStat[];
  upgrades: readonly GearUpgrade[];
  /** Only on a piece returned by `worn` with upgrades: their armour, already in absolute points. */
  bonus?: Partial<Record<ArmorKind, number>>;
}

/** One upgrade of an item. They form a chain: upgrade n (1-based) needs the n - 1 before it. */
export interface GearUpgrade {
  name: Names | null;
  armor: Partial<Record<ArmorKind, number>>;
  stats: readonly GearStat[];
  /** ui/<guid>.png */
  icon?: string | null;
  desc?: Names;
  /** A perk that raises this skill node by one level. */
  skill?: number;
  /** Damage perk: adds share x the weapon's base damage of that kind (see `perkDamage`). */
  damage?: { type: DamageKind; share: number; label: Names | null };
}

export interface GearData {
  constants: Record<string, number>;
  /** Base attributes of the player template, named like the game's (all the keys below are optional). */
  player?: Record<string, number>;
  /** Rarity colours of the game's UI, by lower-case rarity. */
  colors?: Record<string, string>;
  /** Game labels by path: [fr, en]. */
  texts?: Record<string, Names>;
  /** Pictures of the game's UI by texture name: ui/<guid>.png. */
  ui?: Record<string, string>;
  items: Record<string, GearItem>;
  /** Arrows (bow ammunition) and spells, by item guid (same ids as craft.json). */
  ammo?: Record<string, Ammo>;
}

/** Ammunition: its own damage setup, added to the weapon's in a shot. Absent damage = no damage (Flare Arrow). */
export interface Ammo {
  name: Names;
  type: 'Arrow' | 'Spell';
  rarity: string;
  /** Fixed level: min = max. */
  lvl: [number, number];
  icon?: string;
  damage?: {
    mod: number;
    speed: number;
    types: Partial<Record<DamageKind, number>>;
    charge?: number;
    fire?: number;
  };
  stats: readonly GearStat[];
  upgrades: readonly GearUpgrade[];
  desc?: Names;
}

/** The slots a build can fill, as the API stores them (`gear` of api/v1/builds). */
export const GEAR_SLOTS = [
  'head',
  'chest',
  'legs',
  'hands',
  'feet',
  'ring1',
  'ring2',
  'weapon1',
  'weapon2',
  'weapon3',
  'shield',
  'ranged',
] as const;
export type SlotKey = (typeof GEAR_SLOTS)[number];

/** The upgrades taken, by slot: how many of the item's chain (see GearUpgrade). */
export type Upgrades = Readonly<Partial<Record<SlotKey, number>>>;

/** What is worn: item guid by slot. */
export type Gear = Readonly<Partial<Record<SlotKey, string>>>;
