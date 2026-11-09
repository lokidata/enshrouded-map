import { describe, expect, it } from 'vitest';
import { GearData, GearItem } from './gear.model';
import { CRITICAL_RATIO, LOW_RATIO, flameLevelCap, recommend, severity } from './recommend.logic';

const constants = {
  armorOffset: 23,
  armorGradient: 15,
  genericWeaponSeed: 10,
  powerCreepWeapon: 0.15000000596046448,
};
const base = { rarity: 'Common', stats: [], upgrades: [] };
const armour = (lvl: number, ups = 0, type?: string): GearItem => ({
  ...base,
  name: ['a', 'a'],
  slot: 'Head',
  type,
  lvl: [lvl, lvl],
  armor: { physical: 0.14 },
  upgrades: Array.from({ length: ups }, () => ({
    name: null,
    armor: { physical: 0.01 },
    stats: [],
  })),
});
const sword = (lvl: number): GearItem => ({
  ...base,
  name: ['s', 's'],
  slot: 'Weapon',
  type: 'Sword',
  lvl: [lvl, lvl],
  damage: { mod: 1, speed: 1, hands: 1, attr: null, types: {} },
});
const data = (items: Record<string, GearItem>): GearData => ({ constants, items });
const run = (items: Record<string, GearItem>, gear: object, P: number, ups = {}) =>
  recommend(data(items), gear, ups, {}, P);

describe('recommend', () => {
  it('thresholds: low under 0.85, critical under 0.70', () => {
    expect([LOW_RATIO, CRITICAL_RATIO]).toEqual([0.85, 0.7]);
    expect(severity(0.85)).toBeNull();
    expect(severity(0.8499)).toBe('low');
    expect(severity(0.7)).toBe('low');
    expect(severity(0.6999)).toBe('critical');
  });

  it('armour boundary: level 17 vs 20 is fine (0.861), 16 is low (0.814)', () => {
    expect(run({ a: armour(17) }, { head: 'a' }, 20)).toEqual([]);
    const [a] = run({ a: armour(16) }, { head: 'a' }, 20);
    expect(a.now.severity).toBe('low');
    expect(a.now.loss).toBe(19);
    expect(a.state).toBe('still');
  });

  it('weapon boundary: base damage 34 / 40 is exactly 0.85, not flagged; 32 / 40 is', () => {
    expect(run({ w: sword(16) }, { weapon1: 'w' }, 20)).toEqual([]); // 34
    const [a] = run({ w: sword(15) }, { weapon1: 'w' }, 20); // 32
    expect(a.kind).toBe('damage');
    expect(a.now.severity).toBe('low');
  });

  it('critical, and untaken upgrades that close the gap vs those that do not', () => {
    const [a] = run({ a: armour(10, 8) }, { head: 'a' }, 20);
    expect(a.now.severity).toBe('critical');
    expect(a.upgrades).toEqual({ count: 7, level: 17 });
    const [b] = run({ a: armour(10, 2) }, { head: 'a' }, 20);
    expect(b.upgrades).toBeNull();
  });

  it('base low but compensated by the upgrades taken: listed, no badge severity, no advice', () => {
    const [a] = run({ a: armour(10, 8) }, { head: 'a' }, 20, { head: 7 }); // base 10, now 17
    expect(a.base.severity).toBe('critical');
    expect(a.now.severity).toBeNull();
    expect(a.state).toBe('compensated');
    expect(a.upgrades).toBeNull();
  });

  it('base ratio ignores the upgrades taken', () => {
    const [a] = run({ a: armour(10, 2) }, { head: 'a' }, 20, { head: 2 });
    expect(a.base.level).toBe(10);
    expect(a.now.level).toBe(12);
    expect(a.base.loss).toBe(46);
    expect(a.now.loss).toBe(37);
  });

  it('level-1 character, item above level, rings, shield, missing data: nothing', () => {
    expect(run({ a: armour(1) }, { head: 'a' }, 1)).toEqual([]);
    expect(run({ a: armour(30) }, { head: 'a' }, 20)).toEqual([]);
    expect(run({ r: { ...armour(1), slot: 'Ring' } }, { ring1: 'r', shield: 'r' }, 50)).toEqual([]);
    expect(recommend(null, { head: 'a' }, {}, {}, 20)).toEqual([]);
    expect(run({}, { head: 'zz' }, 20)).toEqual([]);
    expect(
      recommend({ constants: {}, items: { a: armour(1) } }, { head: 'a' }, {}, {}, 20),
    ).toEqual([]);
  });
});

describe('flame cap', () => {
  const items = { a: armour(9) };
  it('expects the best level of the tier opened before the Flame, null below 1', () => {
    expect(flameLevelCap(1)).toBe(1);
    expect(flameLevelCap(2)).toBe(5);
    expect(flameLevelCap(4)).toBe(15);
    expect(flameLevelCap(11)).toBe(50);
    expect(flameLevelCap(0)).toBeNull();
  });
  it('does not flag gear of the previous tier when the Flame has just risen', () => {
    const r = (flame: number) => recommend(data(items), { head: 'a' }, {}, {}, 40, flame);
    expect(r(0)[0]?.target).toBe(40);
    expect(r(2)).toEqual([]);
    expect(r(3)).toEqual([]); // level 9 = best of tier 2
    expect(r(4)[0]?.target).toBe(15);
    expect(r(4)[0]?.capped).toEqual({ cap: 15, player: 40, flame: 4 });
    expect(r(11)[0]?.capped).toBeNull();
  });
});
