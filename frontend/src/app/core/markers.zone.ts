import { altarSide } from './markers.logic';

export interface ZoneCount {
  cat: string;
  n: number;
}

export interface Zone {
  total: number;
  /** Per category, most first (ties by category key, so the order is stable). */
  counts: ZoneCount[];
}

/** The map elements inside an altar's build area: the same square as the one drawn, border included (|dx| and |dz| <= side / 2). `skip` leaves out categories (labels). */
export function inAltarZone(
  points: readonly { cat: string; x: number; z: number }[],
  altar: { x: number; z: number; level: number },
  skip: (cat: string) => boolean,
): Zone {
  const half = altarSide(altar.level) / 2;
  const per = new Map<string, number>();
  let total = 0;
  for (const p of points) {
    if (Math.abs(p.x - altar.x) > half || Math.abs(p.z - altar.z) > half || skip(p.cat)) continue;
    per.set(p.cat, (per.get(p.cat) ?? 0) + 1);
    total++;
  }
  const counts = [...per].map(([cat, n]) => ({ cat, n }));
  counts.sort((a, b) => b.n - a.n || (a.cat < b.cat ? -1 : 1));
  return { total, counts };
}

/** The first `max` categories, and how many elements the others hold together. */
export function topCounts(
  counts: readonly ZoneCount[],
  max = 8,
): { top: ZoneCount[]; others: number } {
  const top = counts.slice(0, max);
  return { top, others: counts.slice(max).reduce((n, c) => n + c.n, 0) };
}
