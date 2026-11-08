import { Gem, GemStat } from './gems.model';

/**
 * A stat at a gem level. Level 1 is the data's value (exact). Above it the game's curve is not in the data:
 * `value + scale x (level - 1)` is a linear guess, so callers must label it an estimation. No scale = constant.
 */
export function gemValue(stat: GemStat, level: number): { value: number; estimate: boolean } {
  const n = Math.max(1, Math.trunc(level) || 1) - 1;
  if (!stat.scale || n === 0) return { value: stat.value, estimate: false };
  return { value: stat.value + stat.scale * n, estimate: true };
}

/** A value as the game writes it: durations are in milliseconds in the data. */
export function formatGem(value: number, format: string): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (format === 'Duration') return `${r(value / 1000)} s`;
  if (format === 'Percentage') return `${r(value)} %`;
  return `${r(value)}`;
}

export function filterGems(
  gems: readonly Gem[],
  query: string,
  tier: number | null,
  rarity: string,
  name: (g: Gem) => string,
): Gem[] {
  const q = query.trim().toLowerCase();
  return gems.filter(
    (g) =>
      (!q || name(g).toLowerCase().includes(q)) &&
      (tier === null || g.tier === tier) &&
      (!rarity || g.rarity === rarity),
  );
}
