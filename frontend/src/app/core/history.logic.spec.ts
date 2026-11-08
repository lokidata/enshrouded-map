import { asNav, sameNav, NavState } from './history.logic';

const s: NavState = {
  view: 'map',
  tab: 'recipes',
  item: null,
  station: null,
  set: null,
  enemy: null,
};

describe('history logic', () => {
  it('compares states', () => {
    expect(sameNav(s, { ...s })).toBe(true);
    expect(sameNav(s, { ...s, item: 'x' })).toBe(false);
    expect(sameNav(s, { ...s, view: 'lore' })).toBe(false);
    expect(sameNav(s, { ...s, view: 'gems' })).toBe(false);
  });
  it('accepts only well-formed popped states', () => {
    expect(asNav(null)).toBeNull();
    expect(asNav({ nav: { view: 1 } })).toBeNull();
    expect(asNav({ nav: s })).toEqual(s);
  });
});
