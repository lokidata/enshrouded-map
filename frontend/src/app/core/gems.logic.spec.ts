import { describe, expect, it } from 'vitest';
import { filterGems, formatGem, gemValue } from './gems.logic';
import { Gem } from './gems.model';

const stat = { name: ['a', 'a'] as const, value: 8, scale: 2.5, format: 'Normal' };
const gem = (tier: number, rarity: string, n: string): Gem => ({
  id: n,
  name: [n, n],
  rarity,
  tier,
  lvl: [1, 105],
  stats: [],
});

describe('gems.logic', () => {
  it('level 1 is exact, above it is an estimation', () => {
    expect(gemValue(stat, 1)).toEqual({ value: 8, estimate: false });
    expect(gemValue(stat, 3)).toEqual({ value: 13, estimate: true });
    expect(gemValue({ ...stat, scale: undefined }, 50)).toEqual({ value: 8, estimate: false });
  });
  it('formats durations from ms', () => {
    expect(formatGem(6000, 'Duration')).toBe('6 s');
    expect(formatGem(7.123, 'Normal')).toBe('7.12');
  });
  it('filters', () => {
    const l = [gem(1, 'Common', 'Fire'), gem(2, 'Rare', 'Ice')];
    const n = (g: Gem) => g.name[0];
    expect(filterGems(l, 'ic', null, '', n)).toHaveLength(1);
    expect(filterGems(l, '', 1, '', n)[0].id).toBe('Fire');
    expect(filterGems(l, '', null, 'Rare', n)[0].id).toBe('Ice');
  });
});
