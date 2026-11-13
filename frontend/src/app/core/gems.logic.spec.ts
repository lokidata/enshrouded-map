import { describe, expect, it } from 'vitest';
import { filterGems, formatGem, gemLevel, gemLines, gemParts, gemValue } from './gems.logic';
import { Gem } from './gems.model';

const CREEP = 0.15000000596046448;
const stat = { name: ['a', 'a'] as const, value: 8, scale: 2.5, format: 'Normal' };
const gem = (tier: number, rarity: string, n: string): Gem => ({
  id: n,
  name: [n, n],
  rarity,
  tier,
  lvl: [1, 105],
  stats: [],
});
// gems.json's Gem of Bleeding
const bleeding: Gem = {
  ...gem(1, 'Common', 'Bleeding'),
  desc: [
    'x',
    'Critical Strikes with Cutting damage cause  bleeding, dealing %k damage per second for %k. ',
  ],
  stats: [
    { name: ['d', 'd'], value: 8, format: 'Normal', scale: 2.5999999046325684 },
    { name: ['t', 't'], value: 6000, format: 'Duration', scale: 0.5 },
  ],
};

describe('gems.logic', () => {
  it('scales with the gem level (estimation), constants stay exact', () => {
    expect(gemValue(stat, 2, CREEP).estimate).toBe(true);
    expect(gemValue(stat, 2, CREEP).value).toBeCloseTo(8.75);
    expect(gemValue({ ...stat, scale: undefined }, 50, CREEP)).toEqual({
      value: 8,
      estimate: false,
    });
    expect(gemValue(stat, 9, undefined)).toEqual({ value: 8, estimate: true });
  });
  it('in-game samples at level 15: Bleeding 14 /s for 7.1 s, Toxic Betrayal damage 8', () => {
    expect(gemLines(bleeding, 15, CREEP).map((x) => x.text)).toEqual(['14', '7.1 s']);
    const toxic: Gem = {
      ...bleeding,
      stats: [
        { name: ['p', 'p'], value: 3, format: 'Normal', scale: 2 },
        { name: ['t', 't'], value: 6000, format: 'Duration', scale: 1 },
      ],
    };
    // the game shows 5.2 s for the duration: not reproduced (see gemValue)
    expect(gemLines(toxic, 15, CREEP)[0].text).toBe('8');
  });
  it('writes each stat where its %k stands, in the text order', () => {
    const lines = [
      { text: '14', estimate: true },
      { text: '7.1 s', estimate: true },
    ];
    // Toxic Betrayal reads "for %k that deals %k": the duration (stat 1) comes first
    expect(gemParts('poison for %k that deals %k per second.', [1, 0], lines)).toEqual([
      { kind: 'text', text: 'poison for ' },
      { kind: 'value', text: '7.1 s', estimate: true },
      { kind: 'text', text: ' that deals ' },
      { kind: 'value', text: '14', estimate: true },
      { kind: 'text', text: ' per second.' },
    ]);
  });
  it('leaves "…" where the data has no value, or no fill', () => {
    const lines = [{ text: '5 s', estimate: false }];
    expect(gemParts('a %k b %k c %%', [0, null], lines).map((p) => p.kind)).toEqual([
      'text',
      'value',
      'text',
      'unknown',
      'text',
    ]);
    expect(gemParts('a %k', undefined, lines).map((p) => p.kind)).toEqual(['text', 'unknown']);
  });
  it('writes just the number when the text already says the unit', () => {
    const six = [{ text: '6 s', estimate: false }];
    expect(gemParts('for %k sec. Then', [0], six)).toEqual([
      { kind: 'text', text: 'for ' },
      { kind: 'value', text: '6', estimate: false },
      { kind: 'text', text: ' sec. Then' },
    ]);
    // French: "secondes" is the word, never cut
    expect(gemParts('pendant %k secondes. Puis', [0], six)).toEqual([
      { kind: 'text', text: 'pendant ' },
      { kind: 'value', text: '6', estimate: false },
      { kind: 'text', text: ' secondes. Puis' },
    ]);
    // a duration with no unit in the text keeps its own: "for 6 s."
    expect(gemParts('for %k.', [0], six)[1]).toEqual({
      kind: 'value',
      text: '6 s',
      estimate: false,
    });
  });
  it('clamps the level to the gem range', () => {
    expect(gemLevel(bleeding, 0)).toBe(1);
    expect(gemLevel(bleeding, 500)).toBe(105);
    expect(gemLevel(bleeding, 15.7)).toBe(15);
  });
  it('formats', () => {
    expect(formatGem(6000, 'Duration')).toBe('6 s');
    expect(formatGem(7.5, 'Normal')).toBe('8');
    expect(formatGem(30.123, 'Percentage')).toBe('30.12 %');
  });
  it('filters', () => {
    const l = [gem(1, 'Common', 'Fire'), gem(2, 'Rare', 'Ice')];
    const n = (g: Gem) => g.name[0];
    expect(filterGems(l, 'ic', null, '', n)).toHaveLength(1);
    expect(filterGems(l, '', 1, '', n)[0].id).toBe('Fire');
    expect(filterGems(l, '', null, 'Rare', n)[0].id).toBe('Ice');
  });
});
