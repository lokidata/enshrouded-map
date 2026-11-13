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

/** A piece of a gem's text: plain, a value taken from a stat, or a value the data does not give. */
export type GemPart =
  | { kind: 'text'; text: string }
  | { kind: 'value'; text: string; estimate: boolean }
  | { kind: 'unknown' };

/**
 * The gem's text cut at its %k, each one filled from `fill` (the stat that gives it, see Gem.fill) with the line
 * already computed at the gem's level. A gem without `fill`, or a value the data does not give, stays "…".
 */
export function gemParts(
  desc: string,
  fill: readonly (number | null)[] | undefined,
  lines: readonly { text: string; estimate: boolean }[],
): GemPart[] {
  const pieces = desc.replaceAll('%%', '%').split('%k');
  const parts: GemPart[] = [];
  pieces.forEach((piece, i) => {
    let text = piece.replace(/\s+/g, ' ');
    if (i === 0) text = text.trimStart();
    if (i === pieces.length - 1) text = text.trimEnd();
    const line = i > 0 ? lines[fill?.[i - 1] ?? -1] : undefined;
    if (i > 0) {
      // "pendant %k secondes": the text already says the unit, the value is just the number ("6", not "6 s")
      const unitInText = /^ sec(onde)?s?\b/.test(text);
      const value =
        line && unitInText && line.text.endsWith(' s') ? line.text.slice(0, -2) : line?.text;
      parts.push(
        line ? { kind: 'value', text: value!, estimate: line.estimate } : { kind: 'unknown' },
      );
    }
    if (text) parts.push({ kind: 'text', text });
  });
  return parts;
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
