import { FixedSlot, SaveCharacter, WeaponSlot } from './character';
import { guidId } from './knowledge';

/** An item of gear.json, found by the FNV-1a of its GUID (how a save names it). */
export interface ItemInfo {
  guid: string;
  /** `slot` of gear.json: Head, Chest, Hands, Legs, Feet, Ring, Shield, Weapon... */
  kind: string;
  /** `type` of gear.json (Bow...), if any. */
  type?: string;
  lvl: readonly [number, number];
  /** Length of its upgrade chain. */
  chain: number;
}

export function indexItems(
  items: Readonly<
    Record<
      string,
      { slot: string; type?: string; lvl: readonly [number, number]; upgrades: readonly unknown[] }
    >
  >,
): Map<number, ItemInfo> {
  const out = new Map<number, ItemInfo>();
  for (const [guid, it] of Object.entries(items))
    out.set(guidId(guid), {
      guid,
      kind: it.slot,
      type: it.type,
      lvl: it.lvl,
      chain: it.upgrades.length,
    });
  return out;
}

const isWeaponSlot = (s: string): s is WeaponSlot => s.startsWith('weapon') || s === 'ranged';

/** What the planner takes from a save: the level, the skills taken ({node id: level}) and the worn pieces. */
export interface Sheet {
  level: number;
  skills: Record<string, number>;
  /** The gems set in the weapon slots (gem GUID, level). */
  gems: Partial<Record<WeaponSlot, { id: string; level: number }>>;
  gear: Partial<
    Record<
      FixedSlot | WeaponSlot,
      {
        guid: string;
        /** base level, null when the item has a single one */ base: number | null;
        upgrades: number;
      }
    >
  >;
}

/**
 * The save's character as a sheet. A piece's level in the save is its base level plus the upgrades taken, so the
 * base level is that minus the upgrades, kept inside the item's own range (null for an item that has no range).
 */
export function sheetOf(
  c: SaveCharacter,
  items: ReadonlyMap<number, ItemInfo>,
  gems: ReadonlyMap<number, { guid: string; lvl: readonly [number, number] }> = new Map(),
): Sheet {
  const set: Sheet['gems'] = {};
  const gear: Sheet['gear'] = {};
  for (const [slot, piece] of Object.entries(c.worn) as [
    FixedSlot | WeaponSlot,
    NonNullable<SaveCharacter['worn'][FixedSlot]>,
  ][]) {
    const item = items.get(piece.id);
    if (!item) continue;
    const upgrades = Math.min(piece.upgrades, item.chain);
    const [min, max] = item.lvl;
    const base =
      piece.level !== null && min < max
        ? Math.min(Math.max(piece.level - piece.upgrades, min), max)
        : null;
    gear[slot] = { guid: item.guid, base, upgrades };
    const gem = piece.gem && gems.get(piece.gem.id);
    if (piece.gem && gem && isWeaponSlot(slot))
      set[slot] = {
        id: gem.guid,
        level: Math.min(Math.max(piece.gem.level, gem.lvl[0]), gem.lvl[1]),
      };
  }
  return {
    level: c.level,
    skills: Object.fromEntries(c.skills.map((s) => [String(s.id), s.level])),
    gear,
    gems: set,
  };
}
