import { describe, expect, it } from 'vitest';
import { inAltarZone, topCounts } from './markers.zone';

const at = (cat: string, x: number, z: number) => ({ cat, x, z });
const altar = { x: 1000, z: 2000, level: 1 }; // 40 m: 20 m each side
const none = () => false;

describe('inAltarZone', () => {
  it('counts what lies in the square, the border included', () => {
    const r = inAltarZone(
      [at('chest', 1020, 2020), at('chest', 980, 1980), at('camp', 1000, 2000)],
      altar,
      none,
    );
    expect(r.total).toBe(3);
    expect(r.counts).toEqual([
      { cat: 'chest', n: 2 },
      { cat: 'camp', n: 1 },
    ]);
  });

  it('leaves out what is one metre past the border, on either axis', () => {
    const r = inAltarZone(
      [at('a', 1021, 2000), at('a', 1000, 1979), at('a', 979, 2000)],
      altar,
      none,
    );
    expect(r).toEqual({ total: 0, counts: [] });
  });

  it('is a square, not a disc: a corner counts', () => {
    expect(inAltarZone([at('a', 1020, 2020)], altar, none).total).toBe(1);
  });

  it('follows the level: 160 m is 80 m each side', () => {
    const big = { ...altar, level: 4 };
    expect(inAltarZone([at('a', 1080, 2080), at('a', 1081, 2000)], big, none).total).toBe(1);
  });

  it('skips the categories it is told to (labels), and sorts by count then key', () => {
    const r = inAltarZone(
      [
        at('region', 1000, 2000),
        at('b', 1000, 2000),
        at('a', 1001, 2000),
        at('c', 1002, 2000),
        at('c', 1003, 2000),
      ],
      altar,
      (cat) => cat === 'region',
    );
    expect(r.counts.map((c) => c.cat)).toEqual(['c', 'a', 'b']);
    expect(r.total).toBe(4);
  });
});

describe('topCounts', () => {
  const counts = Array.from({ length: 10 }, (_, i) => ({ cat: `c${i}`, n: 10 - i }));
  it('keeps the first 8 and sums the rest', () => {
    const { top, others } = topCounts(counts);
    expect(top).toHaveLength(8);
    expect(others).toBe(2 + 1);
  });
  it('has no others when there are 8 or fewer', () => {
    expect(topCounts(counts.slice(0, 3))).toEqual({ top: counts.slice(0, 3), others: 0 });
  });
});
