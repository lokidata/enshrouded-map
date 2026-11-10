import { describe, expect, it } from 'vitest';
import { groupBy, itemVariantKey } from './craft.group';

describe('groupBy', () => {
  it('groups by key in order of first appearance', () => {
    const g = groupBy(['a1', 'b1', 'a2', 'c1', 'b2'], (s) => s[0]);
    expect(g.map((x) => x.key)).toEqual(['a', 'b', 'c']);
    expect(g[0].items).toEqual(['a1', 'a2']);
    expect(g[1].items).toEqual(['b1', 'b2']);
  });

  it('gives an empty list for no items', () => {
    expect(groupBy([], () => 'x')).toEqual([]);
  });
});

describe('itemVariantKey', () => {
  it('ties the levels of one item together, not two different items', () => {
    const a = { name: ['Bâton du serpent', 'Serpent staff'], cat: 'weapons', type: 'Staff' };
    expect(itemVariantKey(a)).toBe(itemVariantKey({ ...a }));
    expect(itemVariantKey(a)).not.toBe(itemVariantKey({ ...a, type: 'Bow' }));
    expect(itemVariantKey(a)).not.toBe(
      itemVariantKey({ ...a, name: ['Épée du serpent', 'Serpent sword'] }),
    );
  });
});
