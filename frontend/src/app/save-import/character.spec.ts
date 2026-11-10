import { describe, expect, it } from 'vitest';
import { readCharacter } from './character';
import { ItemInfo, sheetOf } from './character.logic';

const u32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** One slot of the inventory: slot, item id, count, flags and the extras the flags announce. */
const slot = (i: number, id: number, flags = 0, extras: number[] = []): number[] => [
  i,
  ...u32(id),
  1,
  0,
  flags,
  ...extras,
];
/** A worn piece as a current save writes it: level, durability, upgrades taken (twice). */
const piece = (i: number, id: number, level: number, upgrades: number): number[] =>
  slot(i, id, 0x13, [level, 100, 0, 0, 0, 100, 0, 0, 0, upgrades, upgrades]);

const NODES = new Map([
  [1000, 3],
  [1001, 1],
  [1002, 1],
]);
const KINDS = new Map<number, string>([
  [1, 'Head'],
  [2, 'Chest'],
  [3, 'Hands'],
  [4, 'Legs'],
  [5, 'Feet'],
  [6, 'Ring'],
  [7, 'Ring'],
  [8, 'Shield'],
  [11, 'Head'], // the outfit
  [12, 'Chest'],
  [13, 'Hands'],
  [14, 'Legs'],
  [15, 'Feet'],
  [20, 'Weapon'],
  [21, 'Weapon'],
  [22, 'Weapon'], // a bow
]);

function save(parts: {
  skills: [number, number][];
  slots: number[][];
  level?: number;
}): Uint8Array {
  const skills = parts.skills.flatMap(([id, l]) => [...u32(id), l]);
  return Uint8Array.from([
    ...new Array<number>(40).fill(0),
    ...u32(parts.level ?? 21),
    ...u32(7945),
    ...u32(parts.skills.length),
    ...skills,
    ...new Array<number>(30).fill(0),
    ...parts.slots.flat(),
  ]);
}

describe('readCharacter', () => {
  const armour = [
    piece(5, 1, 15, 5),
    piece(6, 2, 13, 3),
    piece(7, 3, 13, 3),
    piece(8, 4, 13, 3),
    piece(9, 5, 13, 3),
    piece(10, 6, 10, 5),
    piece(11, 7, 19, 4),
    piece(12, 8, 16, 5),
  ];
  const outfit = [11, 12, 13, 14, 15].map((id, i) => slot(i, id));

  it('reads the level, the experience and the skills (a node at level 0 is not taken)', () => {
    const c = readCharacter(
      save({
        skills: [
          [1000, 3],
          [1001, 0],
          [1002, 1],
        ],
        slots: [],
      }),
      NODES,
      KINDS,
    )!;
    expect([c.level, c.xp]).toEqual([21, 7945]);
    expect(c.skills).toEqual([
      { id: 1000, level: 3 },
      { id: 1002, level: 1 },
    ]);
    expect(c.worn).toEqual({});
  });

  it('finds the worn pieces after the outfit, with their level and upgrades', () => {
    const c = readCharacter(
      save({ skills: [[1000, 1]], slots: [...outfit, ...armour, slot(13, 20, 0x11, [3, 0, 0])] }),
      NODES,
      KINDS,
    )!;
    expect(c.worn.head).toEqual({ id: 1, level: 15, upgrades: 5, gem: null });
    expect(c.worn.ring2).toEqual({ id: 7, level: 19, upgrades: 4, gem: null });
    expect(c.worn.shield).toEqual({ id: 8, level: 16, upgrades: 5, gem: null });
    expect(Object.keys(c.worn)).toHaveLength(8);
  });

  it('reads the weapons of slots 16 to 18', () => {
    const weapons = [piece(16, 20, 23, 5), piece(17, 21, 20, 4), piece(18, 22, 12, 2)];
    const c = readCharacter(save({ skills: [], slots: [...armour, ...weapons] }), NODES, KINDS)!;
    expect(c.worn.weapon1).toEqual({ id: 20, level: 23, upgrades: 5, gem: null });
    expect(c.worn.weapon3).toEqual({ id: 22, level: 12, upgrades: 2, gem: null });
    // a stack of arrows in slot 17 is not a weapon
    const odd = readCharacter(
      save({ skills: [], slots: [piece(16, 20, 1, 0), slot(17, 99)] }),
      NODES,
      KINDS,
    )!;
    expect(Object.keys(odd.worn)).toEqual(['weapon1']);
  });

  it('reads the ranged weapon: a bow with a level at slot 23, not an empty placeholder', () => {
    const c = readCharacter(
      save({
        skills: [],
        slots: [piece(17, 22, 0, 0).slice(0, 5).concat([0, 0, 0]), piece(23, 22, 20, 5)],
      }),
      NODES,
      KINDS,
      new Set([22]),
    )!;
    expect(c.worn.ranged).toEqual({ id: 22, level: 20, upgrades: 5, gem: null });
    // a bow in a weapon slot is not a weapon of the sheet
    const w = readCharacter(
      save({ skills: [], slots: [piece(16, 22, 5, 0)] }),
      NODES,
      KINDS,
      new Set([22]),
    )!;
    expect(w.worn.weapon1).toBeUndefined();
  });

  it('reads the gem of a weapon (an id of 0 is no gem)', () => {
    const gemmed = slot(
      16,
      20,
      0x33,
      [23, 100, 0, 0, 0, 100, 0, 0, 0, 5, 5, 0xf0, 0xa1, 0xc7, 0x18, 15],
    );
    const c = readCharacter(
      save({ skills: [], slots: [gemmed, piece(17, 21, 20, 4)] }),
      NODES,
      KINDS,
    )!;
    expect(c.worn.weapon1).toEqual({
      id: 20,
      level: 23,
      upgrades: 5,
      gem: { id: 0x18c7a1f0, level: 15 },
    });
    expect(c.worn.weapon2?.gem).toBeNull();
  });

  it('reads an older save, which has no outfit and no levels on its pieces', () => {
    const old = [1, 2, 3, 4, 5, 6, 7, 8].map((id, i) => slot(i, id));
    const c = readCharacter(save({ skills: [], slots: old, level: 35 }), NODES, KINDS)!;
    expect(c.level).toBe(35);
    expect(c.worn.feet).toEqual({ id: 5, level: null, upgrades: 0, gem: null });
  });

  it('does not take eight slots that are not in the order of the game', () => {
    const shuffled = [2, 1, 3, 4, 5, 6, 7, 8].map((id, i) => slot(i, id));
    expect(readCharacter(save({ skills: [], slots: shuffled }), NODES, KINDS)!.worn).toEqual({});
  });

  it('refuses what it does not recognise: an unknown skill, a cut section', () => {
    expect(readCharacter(save({ skills: [[999, 1]], slots: [] }), NODES, KINDS)).toBeNull();
    expect(readCharacter(new Uint8Array(30), NODES, KINDS)).toBeNull();
    expect(
      readCharacter(save({ skills: [[1000, 1]], slots: [] }).subarray(0, 54), NODES, KINDS),
    ).toBeNull();
  });
});

describe('sheetOf', () => {
  const info = (lvl: [number, number], chain = 5): ItemInfo => ({
    guid: 'g',
    kind: 'Head',
    lvl,
    chain,
  });
  const items = new Map([
    [1, info([10, 10])],
    [8, info([1, 55])],
    [6, info([5, 5], 4)],
  ]);

  it('gives the base level (level minus upgrades, inside the item range) and the upgrades', () => {
    const s = sheetOf(
      {
        level: 21,
        xp: 0,
        skills: [{ id: 1000, level: 2 }],
        worn: {
          head: { id: 1, level: 15, upgrades: 5, gem: null },
          shield: { id: 8, level: 16, upgrades: 5, gem: null },
          ring1: { id: 6, level: 10, upgrades: 9, gem: null },
          ring2: { id: 99, level: 3, upgrades: 1, gem: null },
        },
      },
      items,
    );
    expect(s.skills).toEqual({ '1000': 2 });
    expect(s.gear.head).toEqual({ guid: 'g', base: null, upgrades: 5 }); // a single level: nothing to choose
    expect(s.gear.shield).toEqual({ guid: 'g', base: 11, upgrades: 5 });
    expect(s.gear.ring1?.upgrades).toBe(4); // the chain's length
    expect(s.gear.ring2).toBeUndefined(); // an item the data does not know
  });

  it('keeps the gem of a weapon with its level inside the gem range, and only a known gem', () => {
    const w: ItemInfo = { guid: 'w', kind: 'Weapon', lvl: [1, 55], chain: 5 };
    const worn = { id: 30, level: 10, upgrades: 0 };
    const gems = new Map([[7, { guid: 'g', lvl: [1, 20] as const }]]);
    const run = (gem: { id: number; level: number }) =>
      sheetOf(
        { level: 1, xp: 0, skills: [], worn: { weapon1: { ...worn, gem } } },
        new Map([[30, w]]),
        gems,
      );
    expect(run({ id: 7, level: 99 }).gems.weapon1).toEqual({ id: 'g', level: 20 });
    expect(run({ id: 8, level: 5 }).gems.weapon1).toBeUndefined();
  });

  it('keeps the ranged weapon as a slot of its own', () => {
    const w: ItemInfo = { guid: 'b', kind: 'Weapon', type: 'Bow', lvl: [1, 55], chain: 5 };
    const s = sheetOf(
      {
        level: 1,
        xp: 0,
        skills: [],
        worn: { ranged: { id: 31, level: 20, upgrades: 5, gem: null } },
      },
      new Map([[31, w]]),
    );
    expect(s.gear.ranged).toEqual({ guid: 'b', base: 15, upgrades: 5 });
  });
});
