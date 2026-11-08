import { Gem, GemStat } from './gems.model';

/**
 * A stat at a gem level: value + scale x powerCreepWeapon x level (durations: the scale is in seconds, the value in
 * ms). The game's curve (WeaponPowerCreep, on the gem's own Level) is code, not data. In-game samples at level 15:
 * Bleeding 14 /s for 7.1 s and Toxic Betrayal damage 8 match; Toxic Betrayal's 5.2 s does not (the data says 6 s
 * at level 1, no rising curve gets below it). So a scaled line is always an estimation. No scale = constant.
 */
export function gemValue(
  stat: GemStat,
  level: number,
  creep: number | undefined,
): { value: number; estimate: boolean } {
  if (!stat.scale) return { value: stat.value, estimate: false };
  if (creep === undefined) return { value: stat.value, estimate: true };
  const per = stat.format === 'Duration' ? 1000 : 1;
  return {
    value: stat.value + stat.scale * per * creep * Math.max(1, Math.trunc(level) || 1),
    estimate: true,
  };
}

/** A value as the game writes it: "Normal" lines are whole numbers (Sint32), durations are ms in the data. */
export function formatGem(value: number, format: string): string {
  const r = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
  if (format === 'Duration') return `${r(value / 1000, 1)} s`;
  if (format === 'Percentage') return `${r(value, 2)} %`;
  return `${Math.round(value)}`;
}

/** The level clamped to the gem's range. */
export function gemLevel(gem: Gem, level: number): number {
  return Math.min(Math.max(Math.trunc(level) || gem.lvl[0], gem.lvl[0]), gem.lvl[1]);
}

/** Each stat of a gem at a level, formatted. */
export function gemLines(
  gem: Gem,
  level: number,
  creep: number | undefined,
): { stat: GemStat; text: string; estimate: boolean }[] {
  return gem.stats.map((stat) => {
    const v = gemValue(stat, level, creep);
    return { stat, text: formatGem(v.value, stat.format), estimate: v.estimate };
  });
}

/**
 * The gem's text with "…" for its %k. Not filled in: the order of the %k is not the order of the data's lines
 * (Toxic Betrayal, Meteoric Impact), and the game's own mapping is code; the values are shown as labelled lines.
 */
export function gemText(desc: string): string {
  return desc.replaceAll('%k', '…').replaceAll('%%', '%').replace(/\s+/g, ' ').trim();
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
