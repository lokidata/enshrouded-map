/**
 * The character of a save (`player_character` section of a `character*.ksd`): level, skills and the worn
 * equipment of the fixed slots. The section is the player's entity in the game's own layout, which is not
 * documented: what is read here was found on real saves and is checked while reading (ids must be known,
 * lengths must add up), and `null` / an empty slot means "not recognised", never a guess.
 *
 *   ... [level u32][xp u32][n u32][n x (skill node id u32, level u8)] ... then the slots of the inventory:
 *   [slot u8][item id u32][count u16][flags u8][extras by flags: 0x01 level u8, 0x02 durability 2 x u32,
 *   0x10 upgrades 2 x u8 (taken, taken), 0x20 gem u32 + level u8]; item and node ids are the FNV-1a of the
 *   GUID (see `guidId`). Slots run 0, 1, 2...: in a current save 0-4 are the outfit, 5-9 the armour,
 *   10-11 the rings, 12 the shield (an older save has no outfit: 0-4, 5-6, 7).
 */

export type FixedSlot = 'head' | 'chest' | 'hands' | 'legs' | 'feet' | 'ring1' | 'ring2' | 'shield';
/** The three weapon slots of the save (slots 16-18 of the hotbar container); a bow is moved to the ranged slot. */
export type WeaponSlot = 'weapon1' | 'weapon2' | 'weapon3' | 'ranged';
const WEAPONS: readonly WeaponSlot[] = ['weapon1', 'weapon2', 'weapon3'];
/** The equipped bow sits at this slot of the quiver container (seen on a real save and its screenshots). */
const RANGED_SLOT = 23;
const FIRST_WEAPON = 16;

/** The kind of item (`slot` of gear.json) each fixed slot takes, in the order of the game's slots. */
const ORDER: readonly [string, FixedSlot][] = [
  ['Head', 'head'],
  ['Chest', 'chest'],
  ['Hands', 'hands'],
  ['Legs', 'legs'],
  ['Feet', 'feet'],
  ['Ring', 'ring1'],
  ['Ring', 'ring2'],
  ['Shield', 'shield'],
];

export interface WornPiece {
  /** FNV-1a of the item's GUID. */
  id: number;
  /** Level of the piece as the game shows it (base level plus upgrades taken); null when the save has none. */
  level: number | null;
  /** Upgrades taken. */
  upgrades: number;
  /** The gem set in it (FNV-1a of its GUID) and the gem's level; null for none. */
  gem: { id: number; level: number } | null;
}

export interface SaveCharacter {
  level: number;
  xp: number;
  /** Skill nodes taken (id = FNV-1a of the node's GUID, as in skills.json), those at level 0 left out. */
  skills: { id: number; level: number }[];
  worn: Partial<Record<FixedSlot | WeaponSlot, WornPiece>>;
}

interface Entry {
  slot: number;
  id: number;
  length: number;
  level: number | null;
  upgrades: number;
  gem: { id: number; level: number } | null;
}

const EXTRAS: readonly (readonly [number, number])[] = [
  [0x01, 1],
  [0x02, 8],
  [0x10, 2],
  [0x20, 5],
];
const KNOWN_FLAGS = 0x33;
const HEADER_SCAN = 0x200;

function entry(v: DataView, p: number): Entry | null {
  if (p + 8 > v.byteLength) return null;
  const flags = v.getUint8(p + 7);
  if (flags & ~KNOWN_FLAGS) return null;
  let length = 8;
  let level: number | null = null;
  let upgrades = 0;
  let gem: Entry['gem'] = null;
  for (const [bit, size] of EXTRAS) {
    if (!(flags & bit)) continue;
    if (bit === 0x01) level = v.getUint8(p + length);
    if (bit === 0x10) upgrades = v.getUint8(p + length);
    if (bit === 0x20 && p + length + 5 <= v.byteLength) {
      const id = v.getUint32(p + length, true);
      if (id !== 0) gem = { id, level: v.getUint8(p + length + 4) };
    }
    length += size;
  }
  if (p + length > v.byteLength) return null;
  return { slot: v.getUint8(p), id: v.getUint32(p + 1, true), length, level, upgrades, gem };
}

/** The slots that follow one another from `p`: each one numbered after the last. */
function chain(v: DataView, p: number): Entry[] {
  const out: Entry[] = [];
  for (let e = entry(v, p); e && (!out.length || e.slot === out[out.length - 1].slot + 1);) {
    out.push(e);
    p += e.length;
    e = entry(v, p);
  }
  return out;
}

/**
 * Reads the character. `nodeMax` maps a skill node id to its highest level, `kindOf` an item id to the kind
 * of item it is (`slot` of gear.json: Head, Chest, Hands, Legs, Feet, Ring, Shield, Weapon...), `bows` the ids
 * of the bows (`type` Bow).
 */
export function readCharacter(
  data: Uint8Array,
  nodeMax: ReadonlyMap<number, number>,
  kindOf: ReadonlyMap<number, string>,
  bows: ReadonlySet<number> = new Set(),
): SaveCharacter | null {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let header: { level: number; xp: number; skills: { id: number; level: number }[] } | null = null;
  for (let p = 0; p + 12 <= Math.min(v.byteLength, HEADER_SCAN) && !header; p++) {
    const level = v.getUint32(p, true);
    const xp = v.getUint32(p + 4, true);
    const n = v.getUint32(p + 8, true);
    if (level < 1 || level > 200 || xp > 10_000_000 || n > 400 || p + 12 + 5 * n > v.byteLength)
      continue;
    const skills: { id: number; level: number }[] = [];
    for (let i = 0, q = p + 12; i < n; i++, q += 5) {
      const id = v.getUint32(q, true);
      const l = v.getUint8(q + 4);
      if (!nodeMax.has(id) || l > nodeMax.get(id)!) break;
      if (l > 0) skills.push({ id, level: l });
      if (i === n - 1) header = { level, xp, skills };
    }
    // an empty list is also what a level byte followed by zeros looks like: a level 1 with no experience is not taken
    if (n === 0 && !(level === 1 && xp === 0)) header = { level, xp, skills };
  }
  if (!header) return null;

  // The block of equipment: eight slots in a row of the kinds above (the last such block: an outfit comes first).
  const worn: SaveCharacter['worn'] = {};
  for (let p = 0; p + 8 <= v.byteLength; p++) {
    const run = chain(v, p);
    for (let i = 0; i + ORDER.length <= run.length; i++) {
      if (!ORDER.every(([kind], k) => kindOf.get(run[i + k].id) === kind)) continue;
      ORDER.forEach(([, slot], k) => {
        const e = run[i + k];
        worn[slot] = { id: e.id, level: e.level, upgrades: e.upgrades, gem: e.gem };
      });
    }
  }
  // The weapons: slots 16-18 of the next container, each a weapon (the last such run wins, like the armour).
  for (let p = 0; p + 8 <= v.byteLength; p++) {
    const run = chain(v, p);
    if (run[0]?.slot !== FIRST_WEAPON) continue;
    run.slice(0, WEAPONS.length).forEach((e, k) => {
      if (e.slot === FIRST_WEAPON + k && kindOf.get(e.id) === 'Weapon' && !bows.has(e.id))
        worn[WEAPONS[k]] = { id: e.id, level: e.level, upgrades: e.upgrades, gem: e.gem };
    });
  }
  // The ranged weapon: a bow with a level at slot 23 (the other bows of the quiver container are spares or
  // empty placeholders, which have no level), the last one found like the others.
  for (let p = 0; p + 8 <= v.byteLength; p++) {
    const e = entry(v, p);
    if (e && e.slot === RANGED_SLOT && e.level !== null && bows.has(e.id))
      worn.ranged = { id: e.id, level: e.level, upgrades: e.upgrades, gem: e.gem };
  }
  return { ...header, worn };
}
