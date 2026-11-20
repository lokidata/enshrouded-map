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
    expect(sameNav(s, { ...s, view: 'lore' })).toBe(false);
    expect(sameNav(s, { ...s, view: 'game' })).toBe(false);
  });
  it('keeps and compares the open add-on', () => {
    const a: NavState = { ...s, view: 'addon', addon: 'server' };
    expect(sameNav(a, { ...a })).toBe(true);
    expect(sameNav(a, { ...a, addon: 'chestsort' })).toBe(false);
    expect(sameNav(s, { ...s, addon: null })).toBe(true); // absent = none
    expect(asNav({ nav: a })).toEqual(a);
  });
  it('accepts only well-formed popped states', () => {
    expect(asNav(null)).toBeNull();
    expect(asNav({ nav: { view: 1 } })).toBeNull();
    expect(asNav({ nav: s })).toEqual(s);
  });
});
