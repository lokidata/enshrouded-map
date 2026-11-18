import { KsdError } from './ksd';

/**
 * The Flame Altars of a dedicated server's world save (`world0.ksd`): sections `base00`..`base05`, one per altar spot.
 * A section starts with `[16 bytes GUID][min x, y, z: 3 x u32 LE][max x, y, z: 3 x u32 LE]`, then voxel data that is
 * not read. The unit is HALF a metre, y is the height. The box is the altar's build area: a square of 40 m per level,
 * centred on the altar (checked on one real save, 1 altar of level 4 and 4 of level 1, confirmed in game; the sizes of
 * levels 2 and 3 follow from the sizes the user gave). See docs/DESIGN-save-import.md.
 */
export interface Altar {
  /** Centre in whole metres (the map's x and z), and the height in metres. */
  x: number;
  z: number;
  y: number;
  level: 1 | 2 | 3 | 4;
}

export interface AltarsRead {
  altars: Altar[];
  /** Sections that look like a base but are not a clean altar box: counted, never guessed. */
  skipped: number;
}

export const MAX_BASES = 6;
const WORLD_HALF_METRES = 2 * 10_240;
const HEADER = 16 + 6 * 4;
const HALF_METRES_PER_LEVEL = 80; // 40 m

const BASE = /^base\d+$/;
const SLOT = /^base0[0-5]$/;

/** The altars of the sections of a world save; throws KsdError('bases') when there are more bases than a world holds. */
export function readAltars(sections: ReadonlyMap<string, Uint8Array>): AltarsRead {
  const names = [...sections.keys()].filter((n) => BASE.test(n));
  if (names.length > MAX_BASES) throw new KsdError('bases');
  const altars: Altar[] = [];
  let skipped = 0;
  for (const name of names) {
    const altar = SLOT.test(name) ? readBase(sections.get(name)!) : null;
    if (altar) altars.push(altar);
    else skipped++;
  }
  return { altars, skipped };
}

/** One base section, or null when it is not a clean altar box (too short, degenerate, not square, not a whole level, outside the world). */
function readBase(section: Uint8Array): Altar | null {
  if (section.length < HEADER) return null;
  const v = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const at = (i: number): number => v.getUint32(16 + 4 * i, true);
  const [minX, minY, minZ, maxX, maxY, maxZ] = [at(0), at(1), at(2), at(3), at(4), at(5)];
  const side = maxX - minX;
  if (side <= 0 || maxZ - minZ !== side || maxY < minY) return null; // degenerate, or not a square
  if (side % HALF_METRES_PER_LEVEL !== 0) return null;
  const level = side / HALF_METRES_PER_LEVEL;
  if (level < 1 || level > 4) return null;
  if (maxX > WORLD_HALF_METRES || maxZ > WORLD_HALF_METRES) return null; // minima are unsigned: already >= 0
  return {
    x: Math.round((minX + maxX) / 4),
    z: Math.round((minZ + maxZ) / 4),
    y: (minY + maxY) / 4,
    level: level as Altar['level'],
  };
}

/** The altars not already among the markers (same x and z within 1 m, kind altar), and how many were. */
export function newAltars(
  found: readonly Altar[],
  existing: readonly { x: number; z: number; kind: string }[],
): { fresh: Altar[]; already: number } {
  const here = (a: Altar): boolean =>
    existing.some(
      (m) => m.kind === 'altar' && Math.abs(m.x - a.x) <= 1 && Math.abs(m.z - a.z) <= 1,
    );
  const fresh = found.filter((a) => !here(a));
  return { fresh, already: found.length - fresh.length };
}
